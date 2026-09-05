// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_10e4 (ROM 0x10e4-0x10e7): A = field +0x02, rst 0x28 dispatch through the inline
// word table @0x10e8. Contract: 30 T (19+11), A = field +0x02, the rst pushes table base 0x10e8, and the
// dispatched routine's ret (no continuation pushed) returns to loc_10e4's caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_10e4 } from "../loc_10e4.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
// Stub rst-0x28: pop the pushed table base, record it + A, then step to loc_10e4's caller (no extra cycles).
const rst28 = (mm) => {
  mm.rst28base = mm.pop16();
  mm.rst28a = mm.regs.a;
  mm.step(mm.pop16(), 0);
};

test("loc_10e4: A=field+0x02 and rst 0x28 with table base 0x10e8; 30 T", () => {
  const m = mk({ 0x0028: rst28 });
  m.mem.write8(0x4202, 0x01); // field +0x02 = sub-state index 1
  m.push16(0x9999);
  loc_10e4(m);
  assert.equal(m.cycles, 30, "19 (ld a,(ix+0x02)) + 11 (rst 0x28)");
  assert.deepEqual(m.calls, [0x0028], "dispatch via rst 0x28");
  assert.equal(m.rst28a, 0x01, "A loaded from field +0x02");
  assert.equal(m.rst28base, 0x10e8, "rst 0x28 pushed the inline table base");
  assert.equal(m.pc, 0x9999, "dispatched routine rets to loc_10e4's caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_10e4.js
//   find: regs.a = mem.read8((regs.ix + 0x02) & 0xffff);
//   repl: regs.a = mem.read8((regs.ix + 0x00) & 0xffff);  // wrong field
//   expect: FAIL (A = field +0x00 = 9, not 1; caught by the rst28a assert)
test("loc_10e4: the contract catches the wrong state field", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8((regs.ix + 0x00) & 0xffff); m.step(0x10e7, 19); // MUTANT: +0x00
    m.push16(0x10e8); m.step(0x0028, 11); return m.call(0x0028);
  };
  const m = mk({ 0x0028: rst28 });
  m.mem.write8(0x4200, 0x09); // field +0x00
  m.mem.write8(0x4202, 0x01); // field +0x02
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.rst28a, 0x01));
});
