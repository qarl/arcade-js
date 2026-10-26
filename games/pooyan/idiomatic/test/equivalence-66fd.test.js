// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEnemyActorToDescentStateOnDelay (ROM 0x66fd) — "run one actor's phase countdown". If
 * the shared gate flag (0x8930) is clear it does nothing. While the shared countdown (0x892e)
 * is nonzero it decrements it and waits. When the countdown is zero it reloads it to 0x12,
 * bumps the actor's phase (rec+2), clears rec+3/rec+5, seats rec+4:=0x15/rec+6:=0x02, points
 * the record at the 0x3829 animation sequence (rec+0x0C:=0x29/0x0D:=0x38/0x0E:=0), and stores
 * the tile id 0x2c into rec+9.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. Contract: RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles are NOT compared; the routine is table-dispatched and returns
 * no register live-out, so the contract is memory only.
 *
 * Every case is CRAFTED (dispatched in gameplay): identical (IX record image, gate, countdown)
 * pokes on both sides. Three arms: gate-clear (no writes), live-count (one write), expired
 * (the full phase advance).
 *
 * Jobs: 1. EQUAL over all three arms; 2. WRITE-SET (live-count = one cell; expired = the full
 * footprint); 3. CRAFTED (expired arm); 4. TEETH (a wrong tile-id byte is caught).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-66fd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_66fd as oracle } from "../../translated/loc_66fd.js";
import { advanceEnemyActorToDescentStateOnDelay } from "../advanceEnemyActorToDescentStateOnDelay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80; // an actor-record base in work RAM (no overlap with the gate/countdown cells)
const GATE = 0x8930; // shared phase gate flag
const COUNTDOWN = 0x892e; // shared phase countdown
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record filled to `fill`, gate + countdown seated. */
function craft(gate, count, fill = 0xaa) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe;
  for (let i = 0; i <= 0x0e; i++) m.mem.write8(REC + i, fill);
  m.mem.write8(GATE, gate);
  m.mem.write8(COUNTDOWN, count);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: gate-clear / live-count / expired — advanceEnemyActorToDescentStateOnDelay == oracle in RAM (−stack)", () => {
  const CASES = [
    { gate: 0x00, count: 0x05, label: "gate-clear" },
    { gate: 0x00, count: 0x00, label: "gate-clear (count already 0)" },
    { gate: 0x01, count: 0x05, label: "live-count" },
    { gate: 0xff, count: 0x01, label: "live-count (count 1 -> 0)" },
    { gate: 0x01, count: 0x00, label: "expired" },
    { gate: 0xff, count: 0x00, label: "expired (gate 0xff)" },
  ];
  for (const { gate, count, label } of CASES) {
    const o = craft(gate, count);
    const c = craft(gate, count);
    oracle(o);
    advanceEnemyActorToDescentStateOnDelay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (${label})`);
  }
  console.log(`  EQUAL: ${CASES.length} arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: live-count decrements only the countdown", () => {
  const before = craft(0x01, 0x05);
  const after = craft(0x01, 0x05);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.set(after.stateOffsetToAddr(off), a1[off]);
  }
  assert.equal(changed.size, 1, `live-count must write exactly 1 cell, got ${changed.size}`);
  assert.equal(changed.get(COUNTDOWN), 0x04, "countdown must decrement 0x05 -> 0x04");
  console.log("  WRITE-SET: live-count -> countdown 0x05 -> 0x04 (1 cell)");
});

test("WRITE-SET: expired writes the full phase-advance footprint", () => {
  const before = craft(0x01, 0x00);
  const after = craft(0x01, 0x00);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's push16(0x6725) for the 0x381e call is not game state
    changed.set(addr, a1[off]);
  }
  const expected = new Map([
    [COUNTDOWN, 0x12],
    [REC + 0x02, 0xab], // 0xAA + 1
    [REC + 0x03, 0x00],
    [REC + 0x04, 0x15],
    [REC + 0x05, 0x00],
    [REC + 0x06, 0x02],
    [REC + 0x09, 0x2c],
    [REC + 0x0c, 0x29],
    [REC + 0x0d, 0x38],
    [REC + 0x0e, 0x00],
  ]);
  assert.equal(changed.size, expected.size, `expected exactly ${expected.size} written cells, got ${changed.size}`);
  for (const [addr, val] of expected) assert.equal(changed.get(addr), val, `cell ${hx(addr)} must be ${hx(val)}`);
  console.log(`  WRITE-SET: expired -> ${expected.size} cells (countdown reload + phase advance + anim)`);
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: the expired arm overwrites a pre-dirtied record identically", () => {
  const o = craft(0x01, 0x00, 0x77);
  const c = craft(0x01, 0x00, 0x77);
  oracle(o);
  advanceEnemyActorToDescentStateOnDelay(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(c.mem.read8(COUNTDOWN), 0x12, "countdown reloaded");
  assert.equal(c.mem.read8(REC + 0x02), 0x78, "phase bumped 0x77 -> 0x78");
  console.log("  CRAFTED: expired arm over a 0x77-filled record overwrites identically");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong tile-id byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01, 0x00);
  const c = craft(0x01, 0x00);
  oracle(o);
  advanceEnemyActorToDescentStateOnDelay(c);
  c.mem.write8(REC + 0x09, 0x00); // BUG: rec+9 must be the tile id 0x2c

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tile-id byte — it is worthless");
  assert.equal(d.addr, REC + 0x09, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(REC + 0x09)})`);
  console.log(`  TEETH/RAM: wrong tile id caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
