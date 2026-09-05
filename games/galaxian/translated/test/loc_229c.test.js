// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_229c (ROM 0x229c-0x22b2): one-shot per (0x400d) slot in the 0x40ad flag table. Already
// set -> ret nz (54 T, no writes). Clear -> mark slot, 0x41c7=1, inc (0x421d), B=(0x421d), delegate loc_22b3
// (106 T to the delegation).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_229c } from "../loc_229c.js";

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

test("loc_229c: slot already flagged -> ret nz, no writes; 54 T", () => {
  const m = mk();
  m.mem.write8(0x400d, 0x00);   // -> HL = 0x40ad
  m.mem.write8(0x40ad, 0x01);   // bit0 already set
  m.push16(0x9999);
  loc_229c(m);
  assert.equal(m.cycles, 54, "ret-nz path T-total");
  assert.equal(m.mem.read8(0x41c7), 0x00, "0x41c7 untouched when slot already flagged");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_229c: clear slot -> mark, 0x41c7=1, inc(0x421d), delegate loc_22b3; 106 T", () => {
  const m = mk({ 0x22b3: (mm) => {} });
  m.mem.write8(0x400d, 0x00);
  m.mem.write8(0x40ad, 0x00);   // bit0 clear
  m.mem.write8(0x421d, 0x00);
  m.push16(0x9999);
  loc_229c(m);
  assert.equal(m.cycles, 106, "T-total up to the loc_22b3 delegation");
  assert.equal(m.mem.read8(0x40ad), 0x01, "slot flag set");
  assert.equal(m.mem.read8(0x41c7), 0x01, "0x41c7 raised");
  assert.equal(m.mem.read8(0x421d), 0x01, "counter incremented");
  assert.equal(m.regs.b, 0x01, "B = (0x421d)");
  assert.deepEqual(m.calls, [0x22b3], "delegates to loc_22b3");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_229c.js
//   find: if (regs.fNZ) { m.ret(11); return; }   repl: (drop the early return)
//   expect: FAIL -- an already-flagged slot would still write 0x41c7 (caught by the first test's assert)
test("loc_229c: contract catches a dropped ret nz guard", () => {
  const m = mk({ 0x22b3: (mm) => {} });
  m.mem.write8(0x400d, 0x00);
  m.mem.write8(0x40ad, 0x01);   // bit0 set -- real code returns here
  m.mem.write8(0x421d, 0x00);
  m.push16(0x9999);
  const { regs, mem } = m;
  regs.a = mem.read8(0x400d); m.step(0x229f, 13);
  regs.hl = 0x40ad; m.step(0x22a2, 10);
  regs.add(regs.l); m.step(0x22a3, 4);
  regs.l = regs.a; m.step(0x22a4, 4);
  regs.bit(0, mem.read8(regs.hl)); m.step(0x22a6, 12);
  m.step(0x22a7, 5); // MUTANT: no ret nz -- proceed anyway
  mem.write8(regs.hl, 0x01); m.step(0x22a9, 10);
  regs.a = 0x01; m.step(0x22ab, 7);
  mem.write8(0x41c7, regs.a); m.step(0x22ae, 13);
  assert.throws(() => assert.equal(m.mem.read8(0x41c7), 0x00));
});
