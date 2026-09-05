// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_198e (ROM 0x198e-0x1a11): phase-gated (every 32 frames) two-table walk that sums via
// 0x1a12, then derives a 0/4/8 selector to (0x423f). Contract (full path): 15 calls (0x1a12 x14, 0x003c),
// 1882 T, (0x423f) set. Also the phase-gate early-ret path.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_198e } from "../loc_198e.js";

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
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };
const rd = (m, a) => m.mem.workRam[a & 0x3ff];
const pop = (mm) => { mm.pop16(); };
const pop0 = (mm) => { mm.pop16(); mm.regs.a = 0x00; }; // 0x003c stub: A=0 -> selector 0 arm

// phase gate open + both enable bits set; inputs zeroed so the derived selector arm is deterministic
function scene(m) {
  wr(m, 0x425f, 0x17); // (0x425f)+9 & 0x1f == 0 -> ret nz NOT taken
  wr(m, 0x4007, 0x01); // bit0 set -> rrca carry set -> ret nc NOT taken
  wr(m, 0x4200, 0x01); // bit0 set -> ret nc NOT taken
  wr(m, 0x4202, 0x00);
  wr(m, 0x420e, 0x00);
}

function checkSpec(m) {
  assert.equal(m.cycles, 1882, "full path T-state total");
  assert.deepEqual(
    m.calls,
    [0x1a12, 0x1a12, 0x1a12, 0x1a12, 0x1a12, 0x1a12, 0x1a12,
     0x1a12, 0x1a12, 0x1a12, 0x1a12, 0x1a12, 0x1a12, 0x1a12, 0x003c],
    "7+7 per-entry calls then 0x003c",
  );
  assert.equal(rd(m, 0x423f), 0x00, "selector arm (A=0 from 0x003c stub)");
  assert.equal(m.regs.a, 0x00, "A = stored selector");
  assert.equal(m.pc, 0x9999, "ret to caller");
}

test("loc_198e: full walk -> 14x 0x1a12 + 0x003c, writes (0x423f); 1882 T", () => {
  const m = mk({ 0x1a12: pop, 0x003c: pop0 });
  scene(m);
  m.push16(0x9999);
  loc_198e(m);
  checkSpec(m);
});

test("loc_198e: wrong phase -> immediate ret nz, no calls, 38 T", () => {
  const m = mk({ 0x1a12: pop, 0x003c: pop0 });
  scene(m);
  wr(m, 0x425f, 0x00); // (0+9)&0x1f != 0 -> ret nz taken
  m.push16(0x9999);
  loc_198e(m);
  assert.equal(m.cycles, 38, "13+7+7+11");
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_198e.js
//   find: if (regs.fNZ) {\n    m.ret(11); // ret nz -- wrong phase this frame
//   repl: if (regs.fZ) {  ...  (invert the phase gate)
//   expect: FAIL -- with the open-phase scene the mutant rets immediately (0 calls, 38 T)
test("loc_198e: contract catches an inverted phase gate", () => {
  const m = mk({ 0x1a12: pop, 0x003c: pop0 });
  scene(m);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs } = mm;
    regs.a = mm.mem.read8(0x425f); mm.step(0x1991, 13);
    regs.add(0x09); mm.step(0x1993, 7);
    regs.and(0x1f); mm.step(0x1995, 7);
    if (regs.fZ) { mm.ret(11); return; } // MUTANT: ret z (was ret nz)
    // (unreached with this scene)
  };
  mutant(m);
  assert.throws(() => checkSpec(m));
});
