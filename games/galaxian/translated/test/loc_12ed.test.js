// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_12ed (ROM 0x12ed-0x1326): consume event flag (0x4204); reset state, enqueue sound
// 0x0205, tick countdowns, raise sound_w reg3. Contract (full path, (0x4006) bit0 set): 256 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_12ed } from "../loc_12ed.js";

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
// loc_08f2 stub: pop the pushed return (clean ret, HL untouched).
const clean = (mm) => { mm.pop16(); };

function run() {
  const m = mk({ 0x08f2: clean });
  m.mem.write8(0x4204, 0x01); // event pending
  m.mem.write8(0x421a, 0x03); // countdown (nonzero -> dec)
  m.mem.write8(0x421d, 0x03); // counter (dec -> 0x02, in [0,5])
  m.mem.write8(0x4006, 0x01); // bit0 set -> sound
  m.io.soundReg[3] = 0xff;    // pre-set so the write is observable
  m.push16(0x9999);
  loc_12ed(m);
  return m;
}

test("loc_12ed: consume event, enqueue sound, raise (0x6803)=1; 256 T", () => {
  const m = run();
  assert.equal(m.cycles, 256, "sum of all instr T-states (full path)");
  assert.deepEqual(m.calls, [0x08f2], "one sound-enqueue call");
  assert.equal(m.mem.read8(0x4204), 0x00, "event flag cleared");
  assert.equal(m.mem.read16(0x4200), 0x0100, "(0x4200) <- 0x0100");
  assert.equal(m.mem.read16(0x4205), 0x040a, "(0x4205) <- 0x040a");
  assert.equal(m.mem.read8(0x421a), 0x02, "(0x421a) decremented");
  assert.equal(m.mem.read8(0x421d), 0x02, "(0x421d) decremented, kept in [0,5]");
  assert.equal(m.io.soundReg[3], 0x01, "sound_w reg3 (0x6803) <- 1 (io latch, NOT mem.read8)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_12ed: no event pending -> ret; 33 T", () => {
  const m = mk({ 0x08f2: clean });
  m.mem.write8(0x4204, 0x00);
  m.push16(0x9999);
  loc_12ed(m);
  assert.equal(m.cycles, 33, "ld hl(10)+bit(12)+ret z taken(11)");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.deepEqual(m.calls, [], "no sound enqueue");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_12ed.js
//   find: mem.write8(0x6803, regs.a, 10);  at 0x1323
//   repl: drop it
//   expect: FAIL -- soundReg[3] stays 0xFF, the contract catches it.
test("loc_12ed: contract catches a dropped (0x6803) sound write", () => {
  const m = mk({ 0x08f2: clean });
  m.mem.write8(0x4204, 0x01);
  m.mem.write8(0x421a, 0x03);
  m.mem.write8(0x421d, 0x03);
  m.mem.write8(0x4006, 0x01);
  m.io.soundReg[3] = 0xff;
  m.push16(0x9999);
  const { regs, mem } = m;
  regs.hl = 0x4204; m.step(0x12f0, 10);
  regs.bit(0, mem.read8(regs.hl)); m.step(0x12f2, 12);
  m.step(0x12f3, 5);
  mem.write8(regs.hl, 0x00); m.step(0x12f5, 10);
  regs.hl = 0x0100; m.step(0x12f8, 10);
  mem.write16(0x4200, regs.hl); m.step(0x12fb, 16);
  regs.hl = 0x040a; m.step(0x12fe, 10);
  mem.write16(0x4205, regs.hl); m.step(0x1301, 16);
  regs.de = 0x0205; m.step(0x1304, 10);
  m.push16(0x1307); m.step(0x08f2, 17); m.call(0x08f2);
  regs.a = mem.read8(0x421a); m.step(0x130a, 13);
  regs.and(regs.a); m.step(0x130b, 4);
  m.step(0x130d, 7); regs.a = regs.dec8(regs.a); m.step(0x130e, 4);
  mem.write8(0x421a, regs.a); m.step(0x1311, 13);
  regs.hl = 0x421d; m.step(0x1314, 10);
  regs.decMem8(mem, regs.hl); m.step(0x1315, 11);
  regs.a = mem.read8(regs.hl); m.step(0x1316, 7);
  regs.cp(0x06); m.step(0x1318, 7);
  m.step(0x131c, 12);
  regs.a = mem.read8(0x4006); m.step(0x131f, 13);
  regs.rrca(); m.step(0x1320, 4);
  m.step(0x1321, 5);
  regs.a = 0x01; m.step(0x1323, 7); // MUTANT: dropped ld (0x6803),a
  m.ret();
  assert.throws(() => assert.equal(m.io.soundReg[3], 0x01));
});
