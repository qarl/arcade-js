// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for restartActorAnimUnlessPhaseAdvanced (ROM 0x141c) — "gate an actor's spawn/queue step on
 * its phase field": if (rec+6) >= 2 the record is left untouched; otherwise (rec+8) is
 * cleared and the record is pointed at the 0x3829 animation sequence (rec+0x0C:=0x29,
 * rec+0x0D:=0x38, rec+0x0E:=0), via the animation helper it tail-calls.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES an actor record, so
 * every case uses a FRESH clone per side, compared on RAM (dumpState, minus stack scratch below the entry SP).
 * pc/SP/cycles are NOT compared. IX (the record pointer) is the only input; the routine has
 * no register live-out — both callers tail-jump into it and its exit runs in the dispatch
 * chain — so the contract is memory only.
 *
 * The routine is dispatched during live gameplay, so every case is CRAFTED: an identical
 * (IX, record image) poke on both sides. Two arms: gate-hit (phase >= 2, no writes) and
 * proceed (phase < 2, four writes).
 *
 * Jobs: 1. EQUAL over both arms; 2. WRITE-SET (proceed writes exactly rec+8/0x0C/0x0D/0x0E);
 * 3. CRAFTED (both arms are craft-only); 4. TEETH (a wrong animation byte is caught).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-141c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_141c as oracle } from "../../translated/loc_141c.js";
import { restartActorAnimUnlessPhaseAdvanced } from "../restartActorAnimUnlessPhaseAdvanced.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80; // an actor-record base in work RAM (arbitrary; the routine takes IX)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the record filled to `fill`, its phase byte (rec+6) seated. */
function craft(phase, fill = 0xaa) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe;
  for (let i = 0; i <= 0x0e; i++) m.mem.write8(REC + i, fill);
  m.mem.write8(REC + 0x06, phase);
  return m;
}

const PROCEED = [0x00, 0x01]; // phase < 2 -> clear rec+8, set animation
const GATE_HIT = [0x02, 0x03, 0xff]; // phase >= 2 -> untouched

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: both arms — restartActorAnimUnlessPhaseAdvanced == oracle in RAM (−stack)", () => {
  for (const phase of [...PROCEED, ...GATE_HIT]) {
    const o = craft(phase);
    const c = craft(phase);
    oracle(o);
    restartActorAnimUnlessPhaseAdvanced(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (phase=${hx(phase)})`);
  }
  console.log(`  EQUAL: ${PROCEED.length} proceed + ${GATE_HIT.length} gate-hit arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: proceed writes exactly rec+8:=0, rec+0x0C:=0x29, rec+0x0D:=0x38, rec+0x0E:=0", () => {
  const before = craft(0x00);
  const after = craft(0x00);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.set(after.stateOffsetToAddr(off), a1[off]);
  }
  const expected = new Map([
    [REC + 0x08, 0x00],
    [REC + 0x0c, 0x29],
    [REC + 0x0d, 0x38],
    [REC + 0x0e, 0x00],
  ]);
  assert.equal(changed.size, expected.size, `expected exactly ${expected.size} written cells, got ${changed.size}`);
  for (const [addr, val] of expected) assert.equal(changed.get(addr), val, `cell ${hx(addr)} must be ${hx(val)}`);
  console.log(`  WRITE-SET: rec+8:=0, rec+0x0C:=0x29, rec+0x0D:=0x38, rec+0x0E:=0 (4 cells)`);
});

test("WRITE-SET: gate-hit writes nothing", () => {
  const before = craft(0x02);
  const after = craft(0x02);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  let changed = 0;
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed++;
  assert.equal(changed, 0, `gate-hit must write nothing, got ${changed} changes`);
  console.log("  WRITE-SET: gate-hit (phase>=2) leaves the record untouched");
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: pre-dirtied record fields are overwritten identically on the proceed arm", () => {
  const o = craft(0x01, 0xff);
  const c = craft(0x01, 0xff);
  oracle(o);
  restartActorAnimUnlessPhaseAdvanced(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(c.mem.read8(REC + 0x08), 0x00, "rec+8 not cleared");
  assert.equal(c.mem.read8(REC + 0x0c), 0x29, "rec+0x0C not set");
  console.log("  CRAFTED: record pre-filled 0xFF -> proceed arm overwrites identically");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong animation byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  restartActorAnimUnlessPhaseAdvanced(c);
  c.mem.write8(REC + 0x0c, 0x00); // BUG: rec+0x0C must be 0x29 (low byte of the anim pointer)

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong animation byte — it is worthless");
  assert.equal(d.addr, REC + 0x0c, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(REC + 0x0c)})`);
  console.log(`  TEETH/RAM: wrong anim byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
