// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1d51 (Galaxian 0x4009-branch, ROM 0x1d51-0x1d57):
//   1d51  23      inc hl          ; 0x4008 -> 0x4009
//   1d52  7e      ld a,(hl)
//   1d53  a7      and a
//   1d54  28 02   jr z,0x1d58     ; 0x4009 already 0
//   1d56  35      dec (hl)
//   1d57  c0      ret nz
// Entry HL=0x4008. (0x4009)==0: 6+7+4+12 = 29 T, tail loc_1d58. (0x4009)>1: 6+7+4+7+11+11 = 46 T, ret,
// (0x4009) decremented. (0x4009)==1: 6+7+4+7+11+5 = 40 T, dec to 0, falls into loc_1d58.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1d51 } from "../loc_1d51.js";

function mk() {
  const routines = new Map([[0x1d58, () => "STUB"]]);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, cell) {
  const m = mk();
  m.regs.hl = 0x4008;
  m.mem.write8(0x4009, cell);
  const ret = fn(m);
  return { m, cycles: m.cycles, calls: m.calls, ret, hl: m.regs.hl };
}

test("loc_1d51: (0x4009)==0 jumps straight to loc_1d58; 29 T", () => {
  const r = run(loc_1d51, 0x00);
  assert.equal(r.cycles, 29, "T-state total (6+7+4+12)");
  assert.deepEqual(r.calls, [0x1d58], "jr z tail-jump");
  assert.equal(r.hl, 0x4009, "HL bumped to the 0x4009 cell");
});

test("loc_1d51: (0x4009)>1 decrements and returns; 46 T", () => {
  const r = run(loc_1d51, 0x02);
  assert.equal(r.cycles, 46, "T-state total (6+7+4+7+11+11)");
  assert.deepEqual(r.calls, [], "ret nz -- no delegate");
  assert.equal(r.m.mem.read8(0x4009), 0x01, "counter decremented, still non-zero");
});

test("loc_1d51: (0x4009)==1 decrements to 0 and falls into loc_1d58; 40 T", () => {
  const r = run(loc_1d51, 0x01);
  assert.equal(r.cycles, 40, "T-state total (6+7+4+7+11+5)");
  assert.deepEqual(r.calls, [0x1d58], "ret nz not taken -> fall-through");
  assert.equal(r.m.mem.read8(0x4009), 0x00, "counter reached 0");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1d51.js
//   find: if (regs.fNZ) {
//   repl: if (regs.fZ) {          // wrong ret condition
//   expect: FAIL (a still-running counter no longer returns -- calls != [])
test("loc_1d51: the contract catches a flipped ret condition", () => {
  const m = mk();
  m.regs.hl = 0x4008;
  m.mem.write8(0x4009, 0x02);
  const { regs, mem } = m;
  regs.hl = (regs.hl + 1) & 0xffff; m.step(0x1d52, 6);
  regs.a = mem.read8(regs.hl); m.step(0x1d53, 7);
  regs.and(regs.a); m.step(0x1d54, 4);
  m.step(0x1d56, 7);
  regs.decMem8(mem, regs.hl); m.step(0x1d57, 11);
  if (regs.fZ) { m.ret(11); } // MUTANT: wrong condition -- never true here
  else { m.step(0x1d58, 5); m.call(0x1d58); }
  assert.notDeepEqual(m.calls, [], "the flipped condition wrongly falls through to loc_1d58");
});
