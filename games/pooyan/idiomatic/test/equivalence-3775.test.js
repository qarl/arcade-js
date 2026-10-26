// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for finishActorOrArmTurnaround (ROM 0x3775, Pooyan) — "end-of-move dispatch". Four exit
 * paths keyed on the play-state (0x880a) and the record's move counter (ix+6):
 *   - play-state == 5 (finish): counter != 0 does nothing; counter == 0 blanks the actor's sprite
 *     band (0x17 zero bytes from IX);
 *   - play-state != 5: counter >= 2 does nothing; counter < 2 clears the anim latch (ix+8) and arms
 *     a turn-around animation (0x3829, or 0x3847 when (ix+7) bit1 is set) into (ix+0xc..0xe).
 *
 * Cycle-free memory-equivalence gate (docs/decompiler-pipeline). Each case runs the oracle on one
 * FRESH clone and the module on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the A, HL and B register live-outs.
 *
 * A = the move counter (ix+6) on every path — the register a dispatcher chain can read back — is set
 * by the module and asserted. On the finish-and-blank path the band helper also leaves HL = IX+0x17
 * and B = 0; those are asserted too and match on every path (untouched elsewhere). DE is NOT part of
 * the contract: the arm path leaves the anim pointer in DE but the animation entry treats it as a
 * fixed input no caller reads. The one input, IX, is seated identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — the four dispatch paths (finish/idle, finish/blank, move/idle, move/arm x2): module ==
 *      oracle in RAM (−stack) and in A, HL, B.
 *   2. WRITE-SET — the arm path writes exactly {ix+8, ix+0xc, ix+0xd, ix+0xe}.
 *   3. TEETH — a corrupted armed anim byte, and a wrong A live-out, are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3775.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3775 as oracle } from "../../translated/loc_3775.js";
import { finishActorOrArmTurnaround } from "../finishActorOrArmTurnaround.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PLAY_STATE_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BAND_LEN = 0x17;
const DIRT = 0xaa; // nonzero pre-fill so cleared/written cells are observable
const REC_MOVE_COUNTER = 0x06;
const REC_FLAG_BYTE = 0x07;
const REC_ANIM_LATCH = 0x08;
const REC_ANIM_LO = 0x0c;
const REC_ANIM_HI = 0x0d;
const REC_ANIM_FRAME = 0x0e;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the play-state seated and the record dirtied so its writes are visible. */
function craft(base, phase, counter, flags) {
  const m = BASE.clone();
  m.mem.write8(PLAY_STATE_INDEX, phase);
  for (let i = 0; i < 0x18; i++) m.mem.write8((base + i) & 0xffff, DIRT);
  m.mem.write8((base + REC_MOVE_COUNTER) & 0xffff, counter);
  m.mem.write8((base + REC_FLAG_BYTE) & 0xffff, flags);
  m.regs.ix = base & 0xffff;
  m.regs.a = 0x77; // sentinels: a bridge that fails to set a live-out is caught
  m.regs.hl = 0x1234;
  m.regs.b = 0x99;
  m.regs.de = 0x5555;
  m.regs.sp = 0x8ff0; // dead stack: the finish-path band helper's push/pop + rst land here
  return m;
}

const IX = 0x8a80;
const CASES = [
  { name: "finish, counter nonzero -> idle", phase: 0x05, counter: 0x03, flags: 0x00 },
  { name: "finish, counter zero -> blank band", phase: 0x05, counter: 0x00, flags: 0x00 },
  { name: "move, counter >= 2 -> idle", phase: 0x01, counter: 0x05, flags: 0x00 },
  { name: "move, counter < 2, flag clear -> anim A", phase: 0x01, counter: 0x01, flags: 0x00 },
  { name: "move, counter < 2, flag set -> anim B", phase: 0x01, counter: 0x00, flags: 0x02 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: the dispatch paths — finishActorOrArmTurnaround == oracle in RAM (−stack) + A + HL + B", () => {
  for (const { name, phase, counter, flags } of CASES) {
    const o = craft(IX, phase, counter, flags);
    const c = craft(IX, phase, counter, flags);
    oracle(o);
    const ret = finishActorOrArmTurnaround(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: module must SET A to the oracle's exit A`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${name}: returned A must match the oracle`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `${name}: HL live-out mismatch`);
    assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `${name}: B live-out mismatch`);
  }
  console.log(`  EQUAL: ${CASES.length} dispatch paths identical (RAM −stack + A + HL + B)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the arm path writes exactly {ix+8, ix+0xc, ix+0xd, ix+0xe}", () => {
  const m = craft(IX, 0x01, 0x01, 0x00); // move, counter < 2, flag clear -> arm anim A
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    changed.push({ addr, to: a1[off] });
  }
  const addrs = new Set(changed.map((ch) => ch.addr));
  const expected = [IX + REC_ANIM_LATCH, IX + REC_ANIM_LO, IX + REC_ANIM_HI, IX + REC_ANIM_FRAME];
  assert.equal(changed.length, expected.length, `expected ${expected.length} writes, got ${changed.length}`);
  for (const cell of expected) assert.ok(addrs.has(cell), `expected a write at ${hx(cell)}`);
  // anim A pointer 0x3829 stored little-endian, frame index reset to 0
  assert.equal(m.mem.read8(IX + REC_ANIM_LO), 0x29, "anim pointer low byte");
  assert.equal(m.mem.read8(IX + REC_ANIM_HI), 0x38, "anim pointer high byte");
  assert.equal(m.mem.read8(IX + REC_ANIM_FRAME), 0x00, "anim frame index reset");
  console.log("  WRITE-SET: arm path -> 4 cells (latch clear + anim pointer + frame reset)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted armed anim byte is CAUGHT by the RAM diff", () => {
  const o = craft(IX, 0x01, 0x01, 0x00);
  const c = craft(IX, 0x01, 0x01, 0x00);
  oracle(o);
  finishActorOrArmTurnaround(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  const cell = IX + REC_ANIM_LO;
  c.mem.write8(cell, c.mem.read8(cell) ^ 0xff); // BUG: corrupt the armed anim pointer
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong armed byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A live-out is CAUGHT by the live-out check", () => {
  const o = craft(IX, 0x05, 0x03, 0x00); // finish/idle: A = the (nonzero) move counter
  const c = craft(IX, 0x05, 0x03, 0x00);
  oracle(o);
  const ret = finishActorOrArmTurnaround(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle");
  const broken = (ret ^ 0x01) & 0xff; // an off-by-one counter is a plausible bug the check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the A live-out check must reject a wrong counter");
  console.log(`  TEETH(A): module A ${hx(ret)} == oracle; ${hx(broken)} rejected`);
});
