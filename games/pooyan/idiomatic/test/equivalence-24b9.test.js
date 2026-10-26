// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for descendLeadActorToLanding (ROM 0x24b9, Pooyan) — the actor state-3 handler dispatched
 * from the 0x2436 state table for a record based at IX. It bumps the alternate-frame sub-counter at
 * +0x05 and, only when that lands even (bit0 clear), decrements +0x06. Every call it advances the
 * base Y at +0x04 by two; while Y stays below the floor 0xdc it returns having touched only those
 * fields. Once Y reaches the floor it calls queueSoundCommands95And10 (queue the pattern-A sound), reseeds the frame
 * delay +0x11 to 2, and advances the record's dispatch state +0x02.
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). The routine is memory-only — a state dispatcher reads no register or flag back
 * (its sibling state-4 handler is likewise memory-only), so there is no register live-out and the
 * early-return path's leftover compare flags are outside the contract.
 *
 * Every case is CRAFTED: the leaf is not reached in a plain boot, and its inputs are IX and the five
 * record fields, poked identically on both sides. The record is zero-filled first so the write set is
 * fully determined. The floor cases set GAME_ACTIVE_FLAG so queueSoundCommands95And10's ring append is exercised.
 *
 * Jobs:
 *   1. EQUAL — odd/even frame, below/at the floor, and a Y wrap: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a below-floor even frame writes only +0x04, +0x05, +0x06.
 *   3. TEETH — a wrong written byte MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-24b9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_24b9 as oracle } from "../../translated/loc_24b9.js";
import { descendLeadActorToLanding } from "../descendLeadActorToLanding.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAME_ACTIVE_FLAG, SOUND_RING_WRITE_PTR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80; // actor record base in work RAM (queueSoundCommands95And10's ring writes land elsewhere)
const RECORD_LEN = 0x18;
const FLOOR_Y = 0xdc;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: zero the record, seat the five fields, and arm the ring for the floor path. */
function craft({ y, sub, dec6, delay11 = 0, state2 = 0, gameActive = 0 }) {
  const m = BASE.clone();
  for (let i = 0; i < RECORD_LEN; i++) m.mem.write8(REC + i, 0);
  m.mem.write8(REC + 0x04, y);
  m.mem.write8(REC + 0x05, sub);
  m.mem.write8(REC + 0x06, dec6);
  m.mem.write8(REC + 0x11, delay11);
  m.mem.write8(REC + 0x02, state2);
  m.mem.write8(GAME_ACTIVE_FLAG, gameActive);
  m.mem.write8(SOUND_RING_WRITE_PTR, 0x43); // first ring slot -> appends land at 0x8a43+
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the call push lands below SP (diff-excluded)
  return m;
}

const CASES = [
  { name: "odd frame, climbing", y: 0x00, sub: 0x00, dec6: 0x00 }, // sub 0->1 (odd, no dec6), y->2
  { name: "even frame, climbing", y: 0x10, sub: 0x01, dec6: 0x05 }, // sub 1->2 (even, dec6->4), y->0x12
  { name: "Y wraps, still below floor", y: 0xfe, sub: 0x01, dec6: 0x08 }, // y+2 wraps to 0x00 < 0xdc
  { name: "floor reached (odd)", y: 0xda, sub: 0x00, dec6: 0x00, delay11: 0x09, state2: 0x03, gameActive: 1 },
  { name: "floor reached (even, high Y)", y: 0xfd, sub: 0x03, dec6: 0x02, delay11: 0x05, state2: 0x00, gameActive: 1 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted actor records — descendLeadActorToLanding == oracle in RAM (−stack)", () => {
  for (const c of CASES) {
    const o = craft(c);
    const m = craft(c);
    oracle(o);
    descendLeadActorToLanding(m);
    const d = ramDiffMinusStack(o, m);
    assert.equal(d, null, d && `${c.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted state-3 records identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a below-floor even frame writes only +0x04, +0x05, +0x06", () => {
  const c = CASES[1]; // even frame, climbing
  const before = craft(c);
  const after = craft(c);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const footprint = new Set([REC + 0x02, REC + 0x04, REC + 0x05, REC + 0x06]);
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(after.mem.read8(REC + 0x05), 0x02, "+0x05 sub-counter incremented");
  assert.equal(after.mem.read8(REC + 0x06), 0x04, "+0x06 decremented on the even frame");
  assert.equal(after.mem.read8(REC + 0x04), 0x12, "+0x04 Y advanced by two");
  assert.equal(after.mem.read8(REC + 0x02), 0x00, "+0x02 state unchanged below the floor");
  console.log("  WRITE-SET: below-floor writes confined to +0x04/+0x05/+0x06");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong Y byte is CAUGHT by the RAM diff", () => {
  const c = CASES[3]; // floor reached
  const o = craft(c);
  const m = craft(c);
  oracle(o);
  descendLeadActorToLanding(m);
  m.mem.write8(REC + 0x04, 0x00); // BUG: Y at the floor must be 0xdc, not 0x00
  const d = ramDiffMinusStack(o, m);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong Y byte — it is worthless");
  assert.equal(d.addr, REC + 0x04, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  assert.equal(d.a, FLOOR_Y, "oracle leaves Y at the floor value");
  console.log(`  TEETH: wrong Y caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
