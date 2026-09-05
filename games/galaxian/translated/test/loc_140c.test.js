// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_140c (ROM 0x140c-0x1445): scans left column groups (0x4179/0x416a) after the gates.
// Two paths: (a) all cells clear -> ret (466 T); (b) a second-group hit tail-jumps to placement 0x1446.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_140c } from "../loc_140c.js";

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
// gates: (0x4220) bit0 clear, (0x4200) bit0 set, (0x4229) bit0 set (consumed), (0x42d0) pair zero,
// (0x4215) bit0 clear (jp c not taken -> left-hand scan).
function seedGates(m) {
  m.mem.write8(0x4200, 0x01);
  m.mem.write8(0x4229, 0x01);
  m.mem.write8(0x4215, 0x00);
}

test("loc_140c: gates pass, no occupied cell -> ret; 466 T, trigger consumed", () => {
  const m = mk();
  seedGates(m);
  m.push16(0x9999);
  loc_140c(m);
  assert.equal(m.cycles, 466, "sum of all instr T-states, both 4-deep scans drained");
  assert.deepEqual(m.calls, [], "nothing to place");
  assert.equal(m.mem.read8(0x4229), 0x00, "(0x4229) trigger consumed");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_140c: second-group hit tail-jumps to placement 0x1446; 413 T", () => {
  const m = mk({ 0x1446: () => {} });
  seedGates(m);
  m.mem.write8(0x4168, 0x01); // third cell of the 0x416a-down group occupied
  m.push16(0x9999);
  loc_140c(m);
  assert.deepEqual(m.calls, [0x1446], "jr nz,0x1446 -- tail to the placement routine");
  assert.equal(m.cycles, 413, "pre-scan + first group drained + 3 cells of the second group");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_140c.js
//   find: return m.call(0x1446);   (the second-group tail-jump)
//   repl: return m.call(0x1472);
//   expect: FAIL -- delegates to the wrong routine; caught by the m.calls assert.
test("loc_140c: the contract catches a wrong second-group tail target", () => {
  const m = mk({ 0x1472: () => {} });
  seedGates(m);
  m.mem.write8(0x4168, 0x01);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.a = mem.read8(0x4220); mm.step(0x140f, 13);
    regs.rrca(); mm.step(0x1410, 4);
    mm.step(0x1411, 5);
    regs.a = mem.read8(0x4200); mm.step(0x1414, 13);
    regs.rrca(); mm.step(0x1415, 4);
    mm.step(0x1416, 5);
    regs.a = mem.read8(0x4229); mm.step(0x1419, 13);
    regs.rrca(); mm.step(0x141a, 4);
    mm.step(0x141b, 5);
    regs.xor(regs.a); mm.step(0x141c, 4);
    mem.write8(0x4229, regs.a); mm.step(0x141f, 13);
    regs.hl = mem.read16(0x42d0); mm.step(0x1422, 16);
    regs.a = regs.h; mm.step(0x1423, 4);
    regs.or(regs.l); mm.step(0x1424, 4);
    regs.rrca(); mm.step(0x1425, 4);
    mm.step(0x1426, 5);
    regs.a = mem.read8(0x4215); mm.step(0x1429, 13);
    regs.c = regs.a; mm.step(0x142a, 4);
    regs.rrca(); mm.step(0x142b, 4);
    mm.step(0x142e, 10);
    regs.hl = 0x4179; mm.step(0x1431, 10);
    regs.b = 0x04; mm.step(0x1433, 7);
    for (;;) {
      regs.bit(0, mem.read8(regs.hl)); mm.step(0x1435, 12);
      if (regs.fNZ) { mm.step(0x1472, 12); return mm.call(0x1472); }
      mm.step(0x1437, 7);
      regs.l = regs.dec8(regs.l); mm.step(0x1438, 4);
      if (regs.djnz() !== 0) { mm.step(0x1433, 13); continue; }
      mm.step(0x143a, 8);
      break;
    }
    regs.l = 0x6a; mm.step(0x143c, 7);
    regs.b = 0x04; mm.step(0x143e, 7);
    for (;;) {
      regs.bit(0, mem.read8(regs.hl)); mm.step(0x1440, 12);
      if (regs.fNZ) { mm.step(0x1472, 12); return mm.call(0x1472); } // MUTANT: 0x1472 not 0x1446
      mm.step(0x1442, 7);
      regs.l = regs.dec8(regs.l); mm.step(0x1443, 4);
      if (regs.djnz() !== 0) { mm.step(0x143e, 13); continue; }
      mm.step(0x1445, 8);
      break;
    }
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x1446]));
});
