// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0b77 (ROM 0x0b77-0x0b8c): entry gate + 14-entry scan calling loc_0b8d.
//   (a) (0x4200) bit0 clear -> ret nc immediately. 28 T, no calls.
//   (b) (0x4200) bit0 set  -> 14x call loc_0b8d, IX += 5 each, B drains to 0. 688 T, calls [0x0b8d]x14.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0b77 } from "../loc_0b77.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  // loc_0b8d is a real (non-tail) call: pop stub balances the pushed return addr, no cycles charged.
  m.routines.set(0x0b8d, (mm) => { mm.pop16(); });
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.push16(0xbeef); // return address for the routine's own ret
  return m;
}

test("loc_0b77: (0x4200) bit0 clear -> ret nc; 28 T; no scan", () => {
  const m = mk();
  m.mem.write8(0x4200, 0x00);
  loc_0b77(m);
  assert.equal(m.cycles, 28, "13 + 4 + ret nc taken 11");
  assert.deepEqual(m.calls, [], "gate off -> no per-entry checks");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

test("loc_0b77: (0x4200) bit0 set -> scans 14 entries via loc_0b8d; 688 T", () => {
  const m = mk();
  m.mem.write8(0x4200, 0x01);
  loc_0b77(m);
  assert.equal(m.cycles, 688, "head 53 + 14 loops (13x45 + 40) + ret 10");
  assert.deepEqual(m.calls, Array(14).fill(0x0b8d), "one loc_0b8d per entry");
  assert.equal(m.regs.ix, 0x42a6, "IX = 0x4260 + 14*5");
  assert.equal(m.regs.b, 0x00, "djnz drained B");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0b77.js
//   find: if (regs.fNC) {   (the enable-gate ret)
//   repl: if (regs.fC)  {   (inverted sense)
//   expect: FAIL (bit0 set now rets early; the scan never runs, calls == [] not 14x loc_0b8d)
test("loc_0b77: contract catches an inverted enable-gate sense", () => {
  const m = mk();
  const { regs, mem } = m;
  m.mem.write8(0x4200, 0x01); // enabled
  const mutant = (mm) => {
    regs.a = mem.read8(0x4200); mm.step(0x0b7a, 13);
    regs.rrca(); mm.step(0x0b7b, 4);
    if (regs.fC) { mm.ret(11); return; } // MUTANT: inverted sense -> rets on ENABLED
    // (real routine would fall through into the scan loop here)
  };
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, Array(14).fill(0x0b8d)));
});
