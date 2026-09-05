// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0898 (ROM 0x0898-0x08bb, incl. arm 0x08b1): call loc_08bc; HL=(0x4209); bit0 of
// (0x4018) via rrca picks the X formula. Clear: (0x409f)=~L+0xfc, (0x409d)=~H, 116 T. Set (arm 0x08b1):
// (0x409f)=L-1, (0x409d)=~H, 114 T. calls [0x08bc].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0898 } from "../loc_0898.js";

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
// loc_08bc stub: pop the return pushed by loc_0898's `call` (clean ret, no cycle charge).
const rst08bc = (mm) => { mm.pop16(); };

function setup(io18) {
  const m = mk({ 0x08bc: rst08bc });
  m.push16(0x9999);        // caller return for loc_0898's own ret
  m.mem.write8(0x4209, 0x34);
  m.mem.write8(0x420a, 0x12); // HL=(0x4209)=0x1234
  m.mem.write8(0x4018, io18);
  return m;
}

test("loc_0898: carry-clear arm -> (0x409f)=~L+0xfc, (0x409d)=~H; 116 T", () => {
  const m = setup(0x00); // bit0 clear -> carry clear after rrca
  loc_0898(m);
  assert.equal(m.mem.read8(0x409f), 0xc7, "~0x34=0xCB, +0xfc -> 0xC7");
  assert.equal(m.mem.read8(0x409d), 0xed, "~0x12 -> 0xED");
  assert.deepEqual(m.calls, [0x08bc], "call loc_08bc");
  assert.equal(m.cycles, 116, "17+16+13+4+7+4+4+7+13+4+4+13+10");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0898: carry-set arm 0x08b1 -> (0x409f)=L-1, (0x409d)=~H; 114 T", () => {
  const m = setup(0x01); // bit0 set -> carry set after rrca
  loc_0898(m);
  assert.equal(m.mem.read8(0x409f), 0x33, "L(0x34)-1 -> 0x33");
  assert.equal(m.mem.read8(0x409d), 0xed, "~0x12 -> 0xED");
  assert.deepEqual(m.calls, [0x08bc], "call loc_08bc");
  assert.equal(m.cycles, 114, "17+16+13+4+12+4+4+13+4+4+13+10");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0898.js
//   find: regs.add(0xfc);  (carry-clear arm)   repl: (drop it)
//   expect: FAIL ((0x409f) stays 0xCB instead of 0xC7)
test("loc_0898: the contract catches a dropped `add a,0xfc`", () => {
  const m = setup(0x00);
  const { regs, mem } = m;
  m.push16(0x089b); m.step(0x08bc, 17); m.call(0x08bc);
  regs.hl = mem.read16(0x4209); m.step(0x089e, 16);
  regs.a = mem.read8(0x4018); m.step(0x08a1, 13);
  regs.rrca(); m.step(0x08a2, 4);
  m.step(0x08a4, 7); // jr c not taken
  regs.a = regs.l; m.step(0x08a5, 4);
  regs.cpl(); m.step(0x08a6, 4);
  m.step(0x08a8, 7); // MUTANT: dropped add a,0xfc
  mem.write8(0x409f, regs.a); m.step(0x08ab, 13);
  regs.a = regs.h; m.step(0x08ac, 4);
  regs.cpl(); m.step(0x08ad, 4);
  mem.write8(0x409d, regs.a); m.step(0x08b0, 13);
  m.ret();
  assert.throws(() => assert.equal(m.mem.read8(0x409f), 0xc7));
});
