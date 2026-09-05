// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_06d8 (ROM 0x06d8-0x0700): rst-28 state handler. Main-body contract path (0x421D=0,
// 0x41B5!=0, 0x400E!=0, 0x4006 bit0=0): inc (0x400A), dec l, ld (0x4009),0x82, ret nc.
// Contract: 135 T, no m.calls, 0x400A incremented, 0x4009 <- 0x82.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_06d8 } from "../loc_06d8.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// Force the main body + ret nc path.
function run(fn) {
  const m = mk({ 0x0722: () => "722", 0x070d: () => "70d", 0x0712: () => "712", 0x08f2: () => "8f2" });
  m.mem.write8(0x421d, 0x00); // jr nz not taken
  m.mem.write8(0x41b5, 0x01); // jr z (0x0722) not taken
  m.mem.write8(0x400e, 0x01); // jr z (0x0722) not taken
  m.mem.write8(0x400a, 0x00); // inc -> 1
  m.mem.write8(0x4006, 0x00); // bit0 clear -> ret nc taken
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_06d8: main-body sub-state advance + ret nc; 135 T", () => {
  const m = run(loc_06d8);
  assert.equal(m.cycles, 135, "10+13+4+7+13+4+7+13+4+7+11+4+10+13+4+11");
  assert.deepEqual(m.calls, [], "main body rets, no delegation");
  assert.equal(m.mem.read8(0x400a), 0x01, "inc (0x400A) 0 -> 1");
  assert.equal(m.mem.read8(0x4009), 0x82, "0x4009 <- 0x82");
  assert.equal(m.pc, 0x9999, "ret nc to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_06d8.js
//   find: mem.write8(regs.hl, 0x82);
//   repl: mem.write8(regs.hl, 0x83);   (wrong timer value)
//   expect: FAIL (0x4009 becomes 0x83; caught by the 0x4009 assert)
test("loc_06d8: contract catches a wrong 0x4009 value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x400a; m.step(0x06db, 10);
    regs.a = mem.read8(0x421d); m.step(0x06de, 13);
    regs.and(regs.a); m.step(0x06df, 4);
    if (regs.fNZ) { m.step(0x0701, 12); /* interior arm unreached in this path */ throw new Error("unreached"); }
    m.step(0x06e1, 7);
    regs.a = mem.read8(0x41b5); m.step(0x06e4, 13);
    regs.and(regs.a); m.step(0x06e5, 4);
    if (regs.fZ) { m.step(0x0722, 12); return m.call(0x0722); }
    m.step(0x06e7, 7);
    regs.a = mem.read8(0x400e); m.step(0x06ea, 13);
    regs.and(regs.a); m.step(0x06eb, 4);
    if (regs.fZ) { m.step(0x0722, 12); return m.call(0x0722); }
    m.step(0x06ed, 7);
    regs.incMem8(mem, regs.hl); m.step(0x06ee, 11);
    regs.l = regs.dec8(regs.l); m.step(0x06ef, 4);
    mem.write8(regs.hl, 0x83); m.step(0x06f1, 10); // MUTANT
    regs.a = mem.read8(0x4006); m.step(0x06f4, 13);
    regs.rrca(); m.step(0x06f5, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x06f6, 5);
    return m.ret();
  };
  assert.throws(() => assert.equal(run(mutant).mem.read8(0x4009), 0x82));
});
