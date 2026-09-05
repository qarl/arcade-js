// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1344 (ROM 0x1344-0x13e0): (0x4228)-gated object placement. Path here: trigger set
// (consumed), (0x4220) bit0 clear, (0x421a)=0 -> slot count B=1, object table 0x4391/0x4390 non-empty ->
// scan finds no free slot -> ret. Contract: 192 T, no calls, (0x4228) consumed to 0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1344 } from "../loc_1344.js";

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

test("loc_1344: no-free-slot path, 192 T, no calls, trigger consumed", () => {
  const m = mk();
  m.mem.write8(0x4228, 0x01); // trigger bit0 set (ret nc not taken; then cleared)
  m.mem.write8(0x4220, 0x00); // bit0 clear (ret c not taken)
  m.mem.write8(0x421a, 0x00); m.mem.write8(0x421b, 0x00); // (h+l)>>1 -> B=1
  m.mem.write8(0x4391, 0x01); // object table pair non-empty -> no free slot
  m.push16(0x9999);
  loc_1344(m);
  assert.equal(m.cycles, 192, "sum of all instr T-states on this path");
  assert.deepEqual(m.calls, [], "no spawn on the no-slot path");
  assert.equal(m.mem.read8(0x4228), 0x00, "(0x4228) trigger consumed");
  assert.equal(m.regs.b, 0x00, "djnz drained the 1-slot scan");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1344.js
//   find: mem.write8(0x4228, regs.a);  (the consume, after `xor a`)
//   repl: drop it
//   expect: FAIL -- (0x4228) stays 0x01, so the trigger fires forever; caught by the (0x4228) assert.
test("loc_1344: the contract catches a dropped trigger-consume", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4228); m.step(0x1347, 13);
    regs.rrca(); m.step(0x1348, 4);
    m.step(0x1349, 5); // ret nc not taken
    regs.xor(regs.a); m.step(0x134a, 4);
    // MUTANT: dropped mem.write8(0x4228, regs.a)
    m.step(0x134d, 13);
    regs.a = mem.read8(0x4220); m.step(0x1350, 13);
    regs.rrca(); m.step(0x1351, 4);
    m.step(0x1352, 5); // ret c not taken
    regs.hl = mem.read16(0x421a); m.step(0x1355, 16);
    regs.a = regs.h; m.step(0x1356, 4);
    regs.add(regs.l); m.step(0x1357, 4);
    regs.rra(); m.step(0x1358, 4);
    regs.cp(0x04); m.step(0x135a, 7);
    m.step(0x135e, 12); // jr c taken
    regs.a = regs.inc8(regs.a); m.step(0x135f, 4);
    regs.b = regs.a; m.step(0x1360, 4);
    regs.hl = 0x4391; m.step(0x1363, 10);
    regs.de = 0xffe1; m.step(0x1366, 10);
    regs.a = mem.read8(regs.hl); m.step(0x1367, 7);
    regs.hl = (regs.hl - 1) & 0xffff; m.step(0x1368, 6);
    regs.or(mem.read8(regs.hl)); m.step(0x1369, 7);
    m.step(0x136b, 7); // jr z not taken
    regs.addHl(regs.de); m.step(0x136c, 11);
    regs.djnz(); m.step(0x136e, 8);
    m.ret();
  };
  const m = mk();
  m.mem.write8(0x4228, 0x01);
  m.mem.write8(0x4391, 0x01);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4228), 0x00));
});
