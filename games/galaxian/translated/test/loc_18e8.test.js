// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_18e8 (Galaxian scroller countdown, ROM 0x18e8-0x18ee):
//   18e8  35        dec (hl)        ; countdown byte
//   18e9  c0        ret nz          ; still counting
//   18ea  af        xor a
//   18eb  32 b0 40  ld (0x40b0),a   ; clear scroller enable
//   18ee  c9        ret
// Contract: (HL)=5 -> dec to 4, ret nz, 22 T, 0x40b0 untouched. (HL)=1 -> dec to 0, clear 0x40b0, 43 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_18e8 } from "../loc_18e8.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  return m;
}

function run(fn, cnt) {
  const m = mk();
  m.regs.hl = 0x4200;
  m.regs.sp = 0x4400;
  m.mem.write8(0x4400, 0x00); m.mem.write8(0x4401, 0x20); // ret -> 0x2000
  m.mem.write8(0x4200, cnt);
  m.mem.write8(0x40b0, 0x77); // pre-set to show clear-vs-keep
  fn(m);
  return { cycles: m.cycles, pc: m.pc, cnt: m.mem.read8(0x4200), enable: m.mem.read8(0x40b0) };
}

function checkZero(r) {
  assert.equal(r.cycles, 43, "11+5+4+13+10");
  assert.equal(r.pc, 0x2000, "ret to caller");
  assert.equal(r.cnt, 0x00, "countdown decremented to 0");
  assert.equal(r.enable, 0x00, "0x40b0 cleared (message done)");
}

test("loc_18e8: countdown still nonzero -> ret nz; 22 T, 0x40b0 kept", () => {
  const r = run(loc_18e8, 0x05);
  assert.equal(r.cycles, 22, "11 + 11 (ret nz taken)");
  assert.equal(r.pc, 0x2000, "ret to caller");
  assert.equal(r.cnt, 0x04, "5 -> 4");
  assert.equal(r.enable, 0x77, "0x40b0 untouched while counting");
});

test("loc_18e8: countdown hits zero -> clears 0x40b0; 43 T", () => {
  checkZero(run(loc_18e8, 0x01));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_18e8.js
//   find: mem.write8(0x40b0, regs.a);
//   repl: mem.write8(0x40b1, regs.a);   (clears the wrong cell)
//   expect: FAIL  (0x40b0 stays 0x77 -- caught by enable == 0x00)
//   verified-anchor: count == 1  (the sole `mem.write8(0x40b0, regs.a)` in loc_18e8.js)
test("loc_18e8: the contract catches clearing the wrong cell", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.decMem8(mem, regs.hl); m.step(0x18e9, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x18ea, 5);
    regs.xor(regs.a); m.step(0x18eb, 4);
    mem.write8(0x40b1, regs.a); // MUTANT: wrong cell
    m.step(0x18ee, 13);
    return m.ret();
  };
  assert.throws(() => checkZero(run(mutant, 0x01)));
});
