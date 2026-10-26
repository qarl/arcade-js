// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for selfTestInputPass -- one pass of the self-test input screen at ROM 0x3d57 (its
// endless per-frame loop is folded into loc_3d57's for(;;) wrapper; this tests the memory-effecting pass).
// It debounces the input ports into colour/flip/counter side effects, draws the DIP/port state through the
// draw spine, serialises the port snapshot into a bit grid, and then either plots the running high-score
// checksum or the stored score. Reached only from the operator self-test, so it is never dispatched in a
// normal boot; the arms drive it from crafted seeds, the service switch held, and the $8a pacing bit
// pre-seeded, comparing against the oracle run one pass (its tail loop-back stubbed). It reads POKEY
// RANDOM ($100a), pinned to a constant on both sides.
//
// Dead stack: this routine reseats the stack POINTER as a scratch row counter (0x3eff txs; S=0 on exit), so
// under the oracle every later dissolved jsr pushes into an S=0 stack (0x0100, then wrapping to 0x01ff down);
// the idiomatic layer models the counter with a local and does not push. The first real entry falls through
// from 0x3c97 with S=0xff (0x3b05 ldx #$ff, 0x3b07 txs, balanced since), so there is no caller frame: the floor
// is the window top (all of stack scratch skipped, R43 reseat) plus the wrapped 0x0100 push slot, dead because
// every exit is jmp $3d57 and only a reset (which zeroes page 1) leaves; the rest of page 1 is compared.
// Run: node --test games/centiped/idiomatic/test/equivalence-3d57.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3d57 as oracleRom } from "../../translated/loc_3d57.js";
import { selfTestInputPass } from "../loc_3d57.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3d57;
const TAIL = 0x3fd6;
const deadStack = (ma, mb) => { const below = deadStackAtEntry(ma, mb); return (a) => a === 0x0100 || below(a); };
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStack(ma, mb));

// Fresh machine: pin the RNG, hold the service switch (bit5 clear), and stub the tail so it returns.
function mk(seed = {}) {
  const m = new Machine(ROM, { overrides: new Map([[TAIL, () => {}]]) });
  m.io.pokeyRandom = () => 0xff;
  m.io.dsw1 = seed.dsw1 ?? 0x00;
  m.io.dsw2 = seed.dsw2 ?? 0x00;
  m.io.in1 = seed.in1 ?? 0xff;
  m.io.inputAssert = { 0: 0x20 }; // service pressed -> IN0 bit5 clear (past the entry wait)
  m.regs.s = 0xff; // the real first entry's SP (see header)
  m.mem.write8(0x008a, seed.a8 ?? 0x01); // a set pacing bit so the entry bit-walk exits
  for (const [a, v] of Object.entries(seed.ram || {})) m.mem.write8(Number(a), v);
  return m;
}

// Common zeropage seed shared by the cases (draw cursor, debounce/counter cells, BCD accumulator).
function commonRam(extra) {
  const r = {
    0xef: 0, 0xf3: 0, 0x91: 0x00, 0x92: 0x05,
    0xe6: 0, 0xe7: 0, 0xe8: 0, 0xe9: 0, 0xea: 0, 0xeb: 0, 0xec: 0, 0xed: 0,
    0xb9: 0x03, 0xbb: 0x02, 0x8d: 0x47, 0x8e: 0, 0x8f: 0, 0x90: 0, 0x93: 0, 0x94: 0,
    0x54: 0x10, 0x64: 0x20,
  };
  return Object.assign(r, extra || {});
}

function zeroTable(extra) {
  const r = commonRam(extra);
  for (let a = 0x0178; a <= 0x01b4; a++) r[a] = 0;
  return r;
}

const CASES = [
  { tag: "checksum changed (delta != 0): plots the digits", dsw1: 0x40, dsw2: 0x35, in1: 0x5a, ram: commonRam({ 0x01b5: 0x00, 0x0178: 0x11, 0x0190: 0x22 }) },
  { tag: "checksum stable (delta == 0): plots the score", dsw1: 0x00, dsw2: 0x00, in1: 0xff, ram: zeroTable({ 0x01b5: 0xff, 0x018b: 0x12, 0x018c: 0x34, 0x018d: 0x56 }) },
  { tag: "debounce edge on IN1 bit0", dsw1: 0x0c, dsw2: 0x10, in1: 0x01, ram: commonRam({ 0xea: 0x01, 0x01b5: 0x00, 0x0178: 0x07 }) },
  { tag: "debounce edges flip screen (bits 2/3)", dsw1: 0xff, dsw2: 0xff, in1: 0xff, ram: commonRam({ 0xec: 0x01, 0xed: 0x01, 0x01b5: 0x00, 0x017a: 0x05 }) },
  { tag: "lives-select glyph path (DSW2 top = 3)", dsw1: 0x00, dsw2: 0x60, in1: 0x00, ram: commonRam({ 0x01b5: 0x00, 0x0180: 0x09 }) },
];

test("CRAFTED: every debounce/draw/score branch == oracle in RAM (-stack)", () => {
  for (const s of CASES) {
    const o = mk(s), c = mk(s);
    oracle(o); selfTestInputPass(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a wrong bit-grid roll diverges from the oracle", () => {
  const s = CASES[0];
  const o = mk(s);
  oracle(o);
  const broken = mk(s);
  oracle(broken);
  broken.mem8[0x0400] = (broken.mem8[0x0400] + 1) & 0xff; // BUG: one wrong grid cell in video RAM
  assert.notEqual(
    firstStateDiff(o.dumpState(), broken.dumpState(), (off) => broken.stateOffsetToAddr(off), deadStack(o, broken)),
    null,
    "the RAM diff FAILED to catch a wrong bit-grid cell",
  );
});

test("SP-TOOTH: the fall-through dispatch is seam-placeable, and an unbalanced mutant is refused", () => {
  // Score path (delta == 0): no kept spine call touches SP, so the rewrite reaches its tail SP-balanced.
  const m = mk({ dsw1: 0, dsw2: 0, in1: 0xff, ram: zeroTable({ 0x01b5: 0xff }) });
  const r = seamPlaceable(withOmittedRet, selfTestInputPass, TARGET, m);
  assert.equal(r.placeable, true, `selfTestInputPass must be seam-placeable; got: ${r.error}`);
  const nullMutant = (mm) => { mm.push16(0x1234); };
  const bad = seamPlaceable(withOmittedRet, nullMutant, TARGET, new Machine(ROM));
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse a stack-adrift mutant");
  console.log("  SP-TOOTH: fall-through placeable; unbalanced mutant refused");
});
