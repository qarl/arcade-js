// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for requestSound15 (ROM 0x4c8b) — the sound-trigger stub that
 * requests sound-command 15 by handing it to the shared sound-ring enqueue.
 *
 * The stub's whole effect is memory: the command (high bit set to mark it pending) lands
 * in the ring slot at SOUND_HEAD and the write pointer advances to the next of 8 slots,
 * wrapping after the eighth. Its declared live-out is MEMORY-ONLY, so the gate compares
 * the observable RAM effect — the filled ring slot and the advanced pointer — and does NOT
 * compare pc / SP / value registers: the idiomatic routine is a plain JS call into the
 * shared enqueue, so it never runs the oracle's Z80 ret and leaves the exit registers and
 * return path (dead scratch) untouched.
 *
 * WHY A CRAFTED ENTRY. Attract requests other sound commands (2 among them) but never
 * command 15, so 0x4c8b is never dispatched — the capture/replay harness cannot hook it
 * directly. Per the crafted-entry method the gate instead runs the stub from a REAL
 * captured sound-request state: the sibling stub 0x4c57 (command 2) IS reached during
 * attract, and every sibling shares the same call convention, so its entry state is a
 * faithful state for command 15 too. Crucially 0x4c8b never calls 0x4c57, so cloning that
 * entry introduces no registry recursion. The one input that shapes the output — the ring
 * write pointer — is then swept across all of 0..7 by poking SOUND_HEAD identically on
 * both sides, which also pins the 7 -> 0 wrap.
 *
 * ONE WRINKLE — the oracle path (0x4c8b -> shared enqueue 0x4ca5) saves and restores two
 * register pairs on the stack, and The Pit's stack is real diffed work RAM (0x83ff down).
 * Those pushes leave four dead bytes just below the entry stack pointer that the stack-free
 * idiomatic JS does not reproduce; they are classic dead stack scratch (overwritten by the
 * caller's next push before anything reads them), so the RAM diff excludes exactly that
 * [SP-4, SP) window and compares everything else byte-for-byte.
 *
 * Five checks:
 *   0. HARNESS — capture a real 0x4c57 sound-request entry and confirm the oracle run of
 *      0x4c8b is deterministic (oracle vs oracle -> identical whole state). Proves the
 *      capture/clone/diff plumbing reaches a real sound-request state.
 *   1. EQUAL (real sound-request entry) — requestSound15 == oracle over RAM (outside the
 *      stack scratch), and the ring slot + advanced pointer hold the expected values.
 *   2. EQUAL (crafted pointer sweep 0..7) — with SOUND_HEAD forced to each of 0..7, both
 *      write that slot with the pending command and advance/wrap the pointer, identical.
 *   3. TEETH (wrong command) — a twin that requests command 14 instead of 15 is CAUGHT at
 *      the ring slot (this stub's payload is the index, exactly what the mutation attacks).
 *   4. TEETH (missing pending bit) — a twin that queues 15 without the pending high bit is
 *      CAUGHT at the ring slot (an unmarked slot reads as empty to the driver).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4c8b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4c8b as oracle } from "../../translated/loc_4c8b.js";
import { requestSound15 as idiomatic } from "../requestSound15.js";
import { loc_4c57 as siblingStub } from "../../translated/loc_4c57.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { SOUND_HEAD, SOUND_RING } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const CAPTURE_AT = 0x4c57; // sibling sound stub — a real sound-request entry, reached in attract
const COMMAND = 15; // the sound-command index this stub requests (oracle: ld a,0x0f)
const PENDING = COMMAND | 0x80; // 0x8f — the byte queued (high bit marks the slot pending)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook the sibling sound stub 0x4c57 in a real attract run and clone the machine at its
 * first dispatch — a genuine sound-request state (valid stack with a return address, an
 * in-play ring pointer). The wrapper snapshots then runs the oracle so attract proceeds.
 */
function captureRealSoundRequestEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[CAPTURE_AT, (mm) => {
    if (entry === null) entry = mm.clone();
    return siblingStub(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return entry;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the four dead stack-scratch
 * bytes the oracle's two register saves park just below the entry stack pointer (which the
 * stack-free idiomatic JS does not reproduce). Null when otherwise identical.
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
 * entry: the OBSERVABLE RAM effect (outside the stack scratch). pc, SP and the value
 * registers are the declared-dead live-out and are NOT compared — the idiomatic routine is
 * a plain JS call that never runs the oracle's Z80 ret, so it deliberately leaves those
 * behind. Returns { diffs, ram } (diffs empty == EQUAL).
 */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  return { diffs, ram };
}

test("HARNESS: a real 0x4c57 sound-request entry is captured and the oracle run is deterministic", () => {
  const entry = captureRealSoundRequestEntry(1500);
  assert.ok(entry, "expected the sibling sound stub 0x4c57 to be dispatched during attract");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle pc not deterministic");
  console.log(
    `  HARNESS: captured a real 0x4c57 entry (SP=${hx(entry.regs.sp)}, ` +
      `SOUND_HEAD=${entry.mem.read8(SOUND_HEAD)}); oracle run of 0x4c8b deterministic`,
  );
});

test("EQUAL (real entry): requestSound15 == oracle over the observable RAM effect", () => {
  const entry = captureRealSoundRequestEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry");
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs } = contractDiffs(entry, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));

  // Positive checks: the slot really was filled with the pending command and the pointer advanced.
  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(SOUND_RING + head), PENDING, `ring slot ${head} not filled with the pending command`);
  assert.equal(c.mem.read8(SOUND_HEAD), (head + 1) % 8, `write pointer did not advance from ${head}`);
  console.log(`  EQUAL/real: identical over the observable RAM effect; slot ${head} = ${hx(PENDING)}, pointer -> ${(head + 1) % 8}`);
});

test("EQUAL (pointer sweep 0..7): every slot is written and the pointer advances/wraps, identical", () => {
  const seed = captureRealSoundRequestEntry(1500);
  assert.ok(seed, "need a captured 0x4c57 entry to craft the sweep from");

  for (let head = 0; head < 8; head++) {
    const entry = seed.clone();
    entry.mem.write8(SOUND_HEAD, head);

    const { diffs } = contractDiffs(entry, idiomatic);
    assert.equal(diffs.length, 0, `head=${head}: ${diffs.join("; ")}`);

    const c = entry.clone(); // c already carries head (cloned from entry after the poke)
    idiomatic(c);
    assert.equal(c.mem.read8(SOUND_RING + head), PENDING, `head=${head}: slot ${head} not filled`);
    assert.equal(c.mem.read8(SOUND_HEAD), (head + 1) % 8, `head=${head}: pointer did not advance/wrap`);
  }
  console.log("  EQUAL/sweep: pointers 0..7 all write the pending command and advance (7 -> 0 wrap), identical to the oracle");
});

/** Enqueue with an arbitrary (wrong) command index, but otherwise correct ring mechanics. */
function enqueueWrong(m, index) {
  const { mem } = m;
  const slot = mem.read8(SOUND_HEAD);
  mem.write8(SOUND_HEAD, (slot + 1) % 8);
  mem.write8(SOUND_RING + slot, index | 0x80);
}

/** Broken twin: requests command 14 (a sibling's index) instead of 15. */
function twinWrongCommand(m) {
  enqueueWrong(m, 14);
}

/** Broken twin: queues command 15 but WITHOUT the pending high bit (slot reads as empty). */
function twinNoPendingBit(m) {
  const { mem } = m;
  const slot = mem.read8(SOUND_HEAD);
  mem.write8(SOUND_HEAD, (slot + 1) % 8);
  mem.write8(SOUND_RING + slot, COMMAND); // BUG: high bit not set
}

test("TEETH (wrong command): a twin that requests command 14 is CAUGHT at the ring slot", () => {
  const entry = captureRealSoundRequestEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry to seed the teeth check");
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs, ram } = contractDiffs(entry, twinWrongCommand);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong-command twin — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SOUND_RING + head,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SOUND_RING + head)})`,
  );
  console.log(`  TEETH/command: wrong-command twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH (missing pending bit): a twin that drops the pending high bit is CAUGHT at the ring slot", () => {
  const entry = captureRealSoundRequestEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry to seed the teeth check");
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs, ram } = contractDiffs(entry, twinNoPendingBit);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the missing-high-bit twin — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SOUND_RING + head,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SOUND_RING + head)})`,
  );
  console.log(`  TEETH/highbit: missing-high-bit twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
