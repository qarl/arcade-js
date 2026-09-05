// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_209c (Galaxian, ROM 0x209c-0x20a6): A=(0x4006); if zero -> branch loc_20a7 (29 T),
// else save A into (0x40ab) and jr into loc_20ac (49 T).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_209c } from "../loc_209c.js";

function mk(stubs = { 0x20a7: "tail", 0x20ac: "tail" }) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4380;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const wr = (m, a) => m.mem.workRam[a & 0x3ff];

test("loc_209c: (0x4006)==0 -> branch to loc_20a7, no save; 29 T", () => {
  const m = mk();
  m.mem.workRam[0x006] = 0x00;
  const ret = loc_209c(m);
  assert.equal(m.cycles, 29, "Z path T-total (13+4+12)");
  assert.deepEqual(m.calls, [0x20a7], "jr z branches to loc_20a7");
  assert.equal(wr(m, 0x40ab), 0, "(0x40ab) untouched on the zero path");
  assert.equal(ret, "TAIL", "loc_20a7 result propagates");
});

test("loc_209c: (0x4006)!=0 -> save into (0x40ab), into loc_20ac; 49 T", () => {
  const m = mk();
  m.mem.workRam[0x006] = 0x37;
  const ret = loc_209c(m);
  assert.equal(m.cycles, 49, "NZ path T-total (13+4+7+13+12)");
  assert.deepEqual(m.calls, [0x20ac], "jr into loc_20ac");
  assert.equal(wr(m, 0x40ab), 0x37, "(0x40ab) = the nonzero (0x4006)");
  assert.equal(ret, "TAIL", "loc_20ac result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_209c.js
//   find: mem.write8(0x40ab, regs.a);
//   repl: mem.write8(0x40ac, regs.a);
//   expect: FAIL  (saves the wrong cell; (0x40ab) stays 0 -- caught by the NZ contract)
//   verified-anchor: count == 1  (the sole 0x40ab store in loc_209c.js)
test("loc_209c: the contract catches a wrong save address", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4006); m.step(0x209f, 13);
    regs.and(regs.a); m.step(0x20a0, 4);
    if (regs.fZ) { m.step(0x20a7, 12); return m.call(0x20a7); }
    m.step(0x20a2, 7);
    mem.write8(0x40ac, regs.a); m.step(0x20a5, 13); // MUTANT: wrong cell
    m.step(0x20ac, 12); return m.call(0x20ac);
  };
  const m = mk();
  m.mem.workRam[0x006] = 0x37;
  mutant(m);
  assert.throws(() => assert.equal(wr(m, 0x40ab), 0x37));
});
