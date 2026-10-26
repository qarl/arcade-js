// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for enqueueSoundCommand (ROM 0x4ca5) — the shared sound-ring
 * enqueue tail that ~20 sound-trigger stubs jump/fall into.
 *
 * The routine takes a sound-command index (delivered in a register by the calling stub),
 * marks it pending (high bit), stores it into the ring slot at SOUND_HEAD, and advances
 * SOUND_HEAD to the next of 8 slots (wrapping after the eighth). Its declared live-out is
 * MEMORY-ONLY: the filled ring slot and the advanced write pointer. The command-with-high-
 * bit and flags the oracle leaves in registers are dead scratch no caller reads, so the
 * gate compares RAM + pc + SP, NOT the value registers (the honest-signature contract).
 *
 * ONE WRINKLE — the oracle saves and restores two register pairs on the stack, and The
 * Pit's stack is real diffed work RAM (0x83ff downward). Those pushes leave four dead
 * bytes just below the entry stack pointer that the idiomatic JS (which never touches the
 * stack) does not reproduce. They are classic dead stack scratch — overwritten by the
 * caller's own next push before anything reads them — so the RAM diff excludes exactly
 * that [SP-4, SP) window and compares everything else byte-for-byte.
 *
 * Five checks:
 *   0. IDENTITY (harness) — run the unit gate with both arms = the oracle; EQUAL proves
 *      the capture/clone/replay harness reaches 0x4ca5 in a real attract run (the sound
 *      stubs dispatch it ~145 times over 3000 frames).
 *   1. EQUAL (real dispatches, full contract) — for every captured entry, oracle vs
 *      enqueueSoundCommand leave identical RAM (outside the stack scratch) + pc + SP, and
 *      the ring slot + advanced pointer hold exactly the expected values. Attract feeds
 *      write pointers across all of 0..7, so the ring wrap is covered on real states.
 *   2. EQUAL (crafted wrap, pointer==7) — force SOUND_HEAD to 7 on both sides and confirm
 *      both write slot 7 and wrap the pointer to 0, identical — pinning the wrap explicitly.
 *   3. TEETH (real) — a twin that forgets the pending high bit is CAUGHT at the ring slot.
 *   4. TEETH (crafted wrap) — a twin that advances the pointer WITHOUT wrapping is CAUGHT
 *      at SOUND_HEAD on the pointer==7 entry (8 instead of 0).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4ca5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4ca5 as oracle } from "../../translated/loc_4ca5.js";
import { enqueueSoundCommand } from "../enqueueSoundCommand.js";
import { makeMachineFactory } from "../../machine.js";
import { unitEquivalence, deadStackBelow } from "../../../../core/equivalence.js";
import { SOUND_HEAD, SOUND_RING } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x4ca5;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/**
 * Hook 0x4ca5 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. The sound-trigger stubs reach it repeatedly during the attract demo.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return caps;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the four dead stack-scratch
 * bytes the oracle's two register saves parked just below the entry stack pointer
 * (which the stack-free idiomatic JS does not reproduce). Null when otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 4, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Compare a candidate against the oracle over the memory-equivalence contract for one
 * entry: RAM (outside the stack scratch) + pc + SP. Value registers are the declared-dead
 * live-out and excluded. The oracle rets internally; the candidate models the return with
 * one m.ret() so pc + SP line up. Returns a list of human-readable diffs (empty == EQUAL).
 */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret();

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ram };
}

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: the unit gate runs on The Pit and reports EQUAL when both arms are the oracle", () => {
  const res = unitEquivalence(makeMachine, TARGET, oracle, oracle);
  assert.equal(
    res.equal,
    true,
    `gate reported a diff for identical arms: ram=${JSON.stringify(res.ram)} regs=${JSON.stringify(res.regs)}`,
  );
  console.log("  IDENTITY: captured 0x4ca5 (a sound-stub dispatch), cloned, ran oracle vs oracle -> EQUAL");
});

// -- 1. EQUAL (real dispatches, full contract) --------------------------------

test("EQUAL (real dispatches): enqueueSoundCommand == oracle on every captured 0x4ca5 entry", () => {
  const caps = captureDispatches(64, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x4ca5 dispatch during attract");

  const headsSeen = new Set();
  for (const cap of caps) {
    const preHead = cap.mem.read8(SOUND_HEAD);
    const preIndex = cap.regs.a;
    headsSeen.add(preHead);

    // Full-contract equivalence: RAM (outside the stack scratch) + pc + SP.
    const { diffs } = contractDiffs(cap, enqueueSoundCommand); // fresh clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));

    // Positive checks: the slot really was filled (pending bit set) and the pointer advanced.
    const c = cap.clone();
    enqueueSoundCommand(c);
    assert.equal(
      c.mem.read8(SOUND_RING + preHead),
      (preIndex | 0x80) & 0xff,
      `ring slot ${preHead} not filled with the pending command on a real dispatch`,
    );
    assert.equal(
      c.mem.read8(SOUND_HEAD),
      (preHead + 1) % 8,
      `write pointer did not advance/wrap correctly from ${preHead}`,
    );
  }
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical over RAM+pc+SP; ` +
      `write pointers exercised: {${[...headsSeen].sort((x, y) => x - y).join(",")}}`,
  );
});

// -- 2. EQUAL (crafted wrap, pointer==7) --------------------------------------

test("EQUAL (crafted wrap): with SOUND_HEAD forced to 7, both write slot 7 and wrap to 0", () => {
  const seed = captureDispatches(1, 2000)[0];
  assert.ok(seed, "need a real capture to craft the wrap entry from");

  const entry = seed.clone();
  entry.mem.write8(SOUND_HEAD, 7); // force the wrap edge
  const index = entry.regs.a;

  const { diffs } = contractDiffs(entry, enqueueSoundCommand);
  assert.equal(diffs.length, 0, diffs.join("; "));

  const c = entry.clone();
  enqueueSoundCommand(c);
  assert.equal(c.mem.read8(SOUND_HEAD), 0, "the pointer must wrap 7 -> 0");
  assert.equal(c.mem.read8(SOUND_RING + 7), (index | 0x80) & 0xff, "slot 7 must be filled");
  console.log("  EQUAL/crafted: pointer 7 -> 0 wrap, slot 7 filled, identical to the oracle");
});

// -- 3. TEETH (real): the missing-high-bit twin is caught ---------------------

/** Broken twin: stores the command WITHOUT setting the pending high bit. */
function twinNoPendingBit(m) {
  const { mem, regs } = m;
  const slot = mem.read8(SOUND_HEAD);
  mem.write8(SOUND_HEAD, (slot + 1) % 8);
  mem.write8(SOUND_RING + slot, regs.a); // BUG: high bit not set — slot reads as empty
}

test("TEETH (real): a twin that drops the pending high bit is CAUGHT at the ring slot", () => {
  const cap = captureDispatches(1, 2000)[0];
  assert.ok(cap, "need a real capture to seed the teeth check");
  const slot = cap.mem.read8(SOUND_HEAD);

  const { diffs, ram } = contractDiffs(cap, twinNoPendingBit);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the missing-high-bit twin — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SOUND_RING + slot,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SOUND_RING + slot)})`,
  );
  console.log(`  TEETH/real: missing-high-bit twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

// -- 4. TEETH (crafted wrap): the no-wrap twin is caught ----------------------

/** Broken twin: advances the pointer without wrapping (8 instead of 0 at the edge). */
function twinNoWrap(m) {
  const { mem, regs } = m;
  const slot = mem.read8(SOUND_HEAD);
  mem.write8(SOUND_HEAD, slot + 1); // BUG: no mod-8 wrap
  mem.write8(SOUND_RING + slot, regs.a | 0x80);
}

test("TEETH (crafted wrap): a twin that never wraps the pointer is CAUGHT at SOUND_HEAD", () => {
  const seed = captureDispatches(1, 2000)[0];
  assert.ok(seed, "need a real capture to craft the wrap entry from");

  const entry = seed.clone();
  entry.mem.write8(SOUND_HEAD, 7); // only the wrap edge exposes this bug

  const { diffs, ram } = contractDiffs(entry, twinNoWrap);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the no-wrap twin at the pointer edge — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SOUND_HEAD,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SOUND_HEAD)})`,
  );
  console.log(`  TEETH/crafted: no-wrap twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
