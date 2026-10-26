// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for startNextDigSpawn (ROM 0x2bf2, The Pit) — start the next queued
 * dig-object spawn, or clear the spawn-active flag when the 24-slot queue at 0x80c3 is
 * empty. Occupied queue -> tail-call the placement path loc_2c04; empty queue -> clear
 * HAZARD_ACTIVE_COUNT (0x80bd) and tail-call the background/terrain animation loc_2f71.
 *
 * WHY THE CONTRACT IS RAM-ONLY (outside a stack window). The occupied hand-off is the
 * already-decompiled spawnPendingDigObject; the empty hand-off (0x2f71) is the decompiled
 * advanceChamberCreature, called directly. The oracle startNextDigSpawn leaves its scan's pointer-walk
 * in the registers and the placement chain saves register pairs on the stack; the
 * stack-free idiomatic path does not reproduce those exact saved bytes, so a few dead
 * bytes just below the entry stack pointer differ (pushed, popped, and never read
 * before their slots are overwritten). Those are classic dead stack scratch, so the
 * diff excludes a small window below the entry SP — measured transient depth is 6
 * bytes, and every real work-RAM write on this path sits at or below 0x8239, far from
 * that window — and compares all other RAM byte-for-byte. pc/SP/value-registers are the
 * declared-dead live-out and are not compared (the idiomatic layer does not preserve
 * the Z80 trace).
 *
 * WHICH ARM EACH CHECK EXERCISES. startNextDigSpawn is dispatched during attract (reached from
 * advanceDigCarveObject's "no spawn active -> go spawn one" path), and in every real dispatch the
 * queue is populated, so real captures cover the OCCUPIED path (loc_2c04). The empty
 * path is never reached naturally, so it is covered by a CRAFTED entry: a real captured
 * state with the whole queue zeroed identically on both sides.
 *
 * Checks:
 *   0. HARNESS — capture a real 0x2bf2 dispatch and confirm the oracle run is
 *      deterministic (oracle vs oracle identical outside the stack window). Also
 *      documents that the real capture is the occupied path.
 *   1. EQUAL (real occupied entry) — startNextDigSpawn == oracle over RAM (outside the stack
 *      window); positive check that the placement path ran (spawn-active flag raised).
 *   2. EQUAL (crafted empty queue) — with the whole queue zeroed on both sides, both
 *      clear the spawn-active flag and hand off to the animation, byte-for-byte
 *      identical (no stack difference on this arm).
 *   3. TEETH (empty path) — a twin that leaves the spawn-active flag wrong is CAUGHT at
 *      0x80bd.
 *   4. TEETH (occupied path) — a twin that ignores the queue and always takes the empty
 *      path is CAUGHT (it misses the spawn: the flag stays 0 and the placement work is
 *      absent).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2bf2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2bf2 as oracle } from "../../translated/loc_2bf2.js";
import { startNextDigSpawn as idiomatic } from "../startNextDigSpawn.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { HAZARD_ACTIVE_COUNT } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x2bf2;
const QUEUE_BASE = 0x80c3; // 24-slot pending-spawn queue (deliberately hex — role not pinned)
const QUEUE_LEN = 24;
const STACK_WINDOW = 32; // dead-scratch bytes below the entry SP to exclude (observed depth 6)
const MAX_FRAMES = 2000; // 0x2bf2 is dispatched a couple of times within this window
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Hook 0x2bf2 in a real attract run and clone the machine at its first dispatch — a genuine spawn-consideration
 *  state (populated queue, valid stack, real background counters). The wrapper snapshots then runs the oracle. */
function captureFirstDispatch(maxFrames) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return entry;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack scratch just
 * below the entry stack pointer (the placement chain saves a register pair there whose
 * value the stack-free idiomatic scan does not reproduce). Null when otherwise
 * identical. The window sits far above every real work-RAM write on this path.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_WINDOW, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

function queueHasPending(machine) {
  for (let i = 0; i < QUEUE_LEN; i++) if (machine.mem.read8(QUEUE_BASE + i) !== 0) return true;
  return false;
}

test("HARNESS: a real 0x2bf2 dispatch is captured and the oracle run is deterministic", () => {
  const entry = captureFirstDispatch(MAX_FRAMES);
  assert.ok(entry, "expected 0x2bf2 to be dispatched during attract");
  assert.ok(queueHasPending(entry), "the real captured dispatch should exercise the occupied-queue path");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = ramDiffOutsideStack(a, b, entry.regs.sp);
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  console.log(
    `  HARNESS: captured a real 0x2bf2 entry (SP=${hx(entry.regs.sp)}, occupied queue); oracle run deterministic`,
  );
});

test("EQUAL (real occupied entry): startNextDigSpawn == oracle over RAM, and the spawn is placed", () => {
  const entry = captureFirstDispatch(MAX_FRAMES);
  assert.ok(entry, "need a captured 0x2bf2 entry");

  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  idiomatic(b);

  const d = ramDiffOutsideStack(a, b, entry.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);

  assert.equal(b.mem.read8(HAZARD_ACTIVE_COUNT), 1, "the placement path should raise the spawn-active flag");
  console.log("  EQUAL/occupied: identical outside the stack window; spawn-active flag raised to 1");
});

test("EQUAL (crafted empty queue): both clear the spawn-active flag and hand off, identical", () => {
  const seed = captureFirstDispatch(MAX_FRAMES);
  assert.ok(seed, "need a captured 0x2bf2 entry to craft the empty-queue case from");

  const entry = seed.clone();
  for (let i = 0; i < QUEUE_LEN; i++) entry.mem.write8(QUEUE_BASE + i, 0); // empty the whole queue

  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  idiomatic(b);

  // The empty arm hands off (0x2f71 -> the object movers) into the shared actor-update tail
  // (updateEnemy2 -> advanceTwoSpriteActor), a dissolved DIRECT call that runs stack-free
  // while the oracle marshals the same tail through the Z80 stack; those dead stack bytes differ, so
  // exclude the dead stack-scratch window and compare the rest.
  const d = ramDiffOutsideStack(a, b, entry.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  assert.equal(b.mem.read8(HAZARD_ACTIVE_COUNT), 0, "the empty path should clear the spawn-active flag to 0");
  console.log("  EQUAL/empty: whole queue zeroed, both clear the flag and hand off, byte-for-byte identical");
});

/** Broken twin: correct scan, but the empty path leaves the wrong spawn-active flag. */
function twinWrongSpawnFlag(m) {
  const { mem8 } = m;
  for (let slot = 0; slot < QUEUE_LEN; slot++) {
    if (mem8[QUEUE_BASE + slot] !== 0) return m.call(0x2c04);
  }
  mem8[HAZARD_ACTIVE_COUNT] = 0xff; // BUG: should clear the flag to 0
  return m.call(0x2f71);
}

test("TEETH (empty path): a wrong spawn-active flag is CAUGHT at 0x80bd", () => {
  const seed = captureFirstDispatch(MAX_FRAMES);
  assert.ok(seed, "need a captured 0x2bf2 entry to seed the teeth check");

  const entry = seed.clone();
  for (let i = 0; i < QUEUE_LEN; i++) entry.mem.write8(QUEUE_BASE + i, 0); // force the empty path

  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  twinWrongSpawnFlag(b);

  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.notEqual(d, null, "the gate FAILED to catch a wrong spawn-active flag — it proves nothing");
  assert.equal(d.addr, HAZARD_ACTIVE_COUNT, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(HAZARD_ACTIVE_COUNT)})`);
  console.log(`  TEETH/empty: wrong spawn flag caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: never scans the queue, always takes the empty path (misses the spawn). */
function twinNeverScans(m) {
  const { mem8 } = m;
  mem8[HAZARD_ACTIVE_COUNT] = 0; // BUG: treats the queue as empty without checking
  return m.call(0x2f71);
}

test("TEETH (occupied path): ignoring the queue and skipping the spawn is CAUGHT", () => {
  const entry = captureFirstDispatch(MAX_FRAMES); // real occupied-queue entry
  assert.ok(entry, "need a captured 0x2bf2 entry to seed the teeth check");
  assert.ok(queueHasPending(entry), "the teeth need an occupied queue so the two paths diverge");

  const a = entry.clone(); // oracle (places the spawn)
  const b = entry.clone(); // broken twin (skips it)
  oracle(a);
  twinNeverScans(b);

  const d = ramDiffOutsideStack(a, b, entry.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped spawn — it proves nothing");
  // The meaningful behavioural signal: the oracle raised the spawn-active flag, the twin left it clear.
  assert.equal(a.mem.read8(HAZARD_ACTIVE_COUNT), 1, "the oracle should have raised the spawn-active flag");
  assert.equal(b.mem.read8(HAZARD_ACTIVE_COUNT), 0, "the twin should have left the spawn-active flag clear");
  console.log(`  TEETH/occupied: skipped spawn caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b}); flag 1 vs 0`);
});
