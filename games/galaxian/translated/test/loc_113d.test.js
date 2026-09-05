// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_113d (ROM 0x113d-0x1145): dec (ix+0x10) countdown; ret nz while nonzero, else
// ld (ix+0x01),0 and ret. Contract: not-expired 34 T (23+11), expired 57 T (23+5+19+10).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_113d } from "../loc_113d.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  return m;
}

test("loc_113d: timer not expired -> just decrements and rets; 34 T", () => {
  const m = mk();
  m.mem.write8(0x4210, 5); // (ix+0x10) countdown
  m.mem.write8(0x4201, 0x99); // (ix+0x01) state byte -- must survive
  m.push16(0x9999);
  loc_113d(m);
  assert.equal(m.mem.read8(0x4210), 4, "dec (ix+0x10)");
  assert.equal(m.mem.read8(0x4201), 0x99, "state byte untouched while timer nonzero");
  assert.equal(m.pc, 0x9999, "ret nz to caller");
  assert.equal(m.cycles, 34, "23 (dec RMW) + 11 (ret nz taken)");
});

test("loc_113d: timer hits zero -> clears state byte and rets; 57 T", () => {
  const m = mk();
  m.mem.write8(0x4210, 1);
  m.mem.write8(0x4201, 0x99);
  m.push16(0x9999);
  loc_113d(m);
  assert.equal(m.mem.read8(0x4210), 0, "dec (ix+0x10) -> 0");
  assert.equal(m.mem.read8(0x4201), 0, "state byte reset on expiry");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.equal(m.cycles, 57, "23 + 5 (ret nz not taken) + 19 (ld (ix+1),0) + 10 (ret)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_113d.js
//   find: mem.write8(regs.ix + 0x01, 0x00);
//   repl: mem.write8(regs.ix + 0x02, 0x00);   // clears the wrong field
//   expect: FAIL (state byte 0x4201 stays 0x99 on expiry)
test("loc_113d: contract catches clearing the wrong field on expiry", () => {
  const m = mk();
  m.mem.write8(0x4210, 1);
  m.mem.write8(0x4201, 0x99);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.decMem8(mem, regs.ix + 0x10); mm.step(0x1140, 23);
    if (regs.fNZ) { mm.ret(11); return; }
    mm.step(0x1141, 5);
    mem.write8(regs.ix + 0x02, 0x00); mm.step(0x1145, 19); // MUTANT: wrong field
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4201), 0));
});
