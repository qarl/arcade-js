// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1555 (ROM 0x1555-0x15c2): guarded timer/state updater. Contract exercises the
// (0x4006) bit0-clear arm (loc_15a7): (0x4200)/(0x41ef) bit0 set, (0x422b) bit0 clear pass the head;
// (0x4245)=1 and (0x4246)=1 both expire, so it reloads (0x4245)=0x3c,(0x4246)=5 and writes the fixed
// cells (0x422f)=0x5a,(0x424a)=0x2d,(0x422e)=1. Contract: 233 T, no calls.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1555 } from "../loc_1555.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn) {
  const m = mk();
  m.mem.write8(0x4200, 0x01); // bit0 set -> ret nc not taken
  m.mem.write8(0x41ef, 0x01); // bit0 set -> ret nc not taken
  m.mem.write8(0x422b, 0x00); // bit0 clear -> ret c not taken
  m.mem.write8(0x4006, 0x00); // bit0 clear -> jr nc,0x15a7 taken
  m.mem.write8(0x4245, 0x01); // dec -> 0 -> reload
  m.mem.write8(0x4246, 0x01); // dec -> 0 -> reload
  m.push16(0x9999);
  fn(m);
  return m;
}
function checkSpec(m) {
  assert.equal(m.cycles, 233, "T-state total of the loc_15a7 arm");
  assert.deepEqual(m.calls, [], "loc_1555 makes no external calls");
  assert.equal(m.mem.read8(0x4245), 0x3c, "(0x4245) reloaded to 0x3c");
  assert.equal(m.mem.read8(0x4246), 0x05, "(0x4246) reloaded to 5");
  assert.equal(m.mem.read8(0x422f), 0x5a, "(0x422f) <- 0x5a");
  assert.equal(m.mem.read8(0x424a), 0x2d, "(0x424a) <- 0x2d");
  assert.equal(m.mem.read8(0x422e), 0x01, "(0x422e) <- 1");
  assert.equal(m.pc, 0x9999, "ret to caller");
}

test("loc_1555: (0x4006) bit0-clear arm reloads timers + writes fixed cells; 233 T", () => {
  checkSpec(run(loc_1555));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1555.js
//   find: mem.write8(0x424a, regs.a);\n    m.step(0x15bd, 13); // (0x424a) <- 0x2d
//   repl: mem.write8(0x424a, 0x00);\n    m.step(0x15bd, 13);
//   expect: FAIL ((0x424a) becomes 0 instead of 0x2d; caught by the (0x424a) assert)
test("loc_1555: the contract catches a wrong (0x424a) reload value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4200); m.step(0x1558, 13); regs.rrca(); m.step(0x1559, 4);
    if (regs.fNC) { m.ret(11); return; } m.step(0x155a, 5);
    regs.a = mem.read8(0x41ef); m.step(0x155d, 13); regs.rrca(); m.step(0x155e, 4);
    if (regs.fNC) { m.ret(11); return; } m.step(0x155f, 5);
    regs.a = mem.read8(0x422b); m.step(0x1562, 13); regs.rrca(); m.step(0x1563, 4);
    if (regs.fC) { m.ret(11); return; } m.step(0x1564, 5);
    regs.a = mem.read8(0x4006); m.step(0x1567, 13); regs.rrca(); m.step(0x1568, 4);
    // (0x4006) bit0 clear -> loc_15a7 arm
    m.step(0x15a7, 12);
    regs.hl = 0x4245; m.step(0x15aa, 10);
    regs.decMem8(mem, regs.hl); m.step(0x15ab, 11);
    if (regs.fNZ) { m.ret(11); return; } m.step(0x15ac, 5);
    mem.write8(regs.hl, 0x3c); m.step(0x15ae, 10);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x15af, 6);
    regs.decMem8(mem, regs.hl); m.step(0x15b0, 11);
    if (regs.fNZ) { m.ret(11); return; } m.step(0x15b1, 5);
    mem.write8(regs.hl, 0x05); m.step(0x15b3, 10);
    regs.a = 0x5a; m.step(0x15b5, 7); mem.write8(0x422f, regs.a); m.step(0x15b8, 13);
    regs.a = 0x2d; m.step(0x15ba, 7); mem.write8(0x424a, 0x00); m.step(0x15bd, 13); // MUTANT 0x2d->0x00
    regs.a = 0x01; m.step(0x15bf, 7); mem.write8(0x422e, regs.a); m.step(0x15c2, 13);
    m.ret();
  };
  assert.throws(() => checkSpec(run(mutant)));
});
