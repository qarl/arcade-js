// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0df6 (ROM 0x0df6-0x0e0e): (ix+0x19)<-A(target); (ix+0x09)<-neg(A-(ix+0x04)) move
// delta; zero (ix+0x1a..0x1c); inc (ix+0x02); ret. Contract for target=0x50, curX=0x30: delta=0xE0, 159 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0df6 } from "../loc_0df6.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4000;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0df6: stores target + move delta, zeroes accum, bumps sub-state; 159 T; ret", () => {
  const m = mk();
  m.regs.a = 0x50; // target X handed in
  m.mem.write8(0x4004, 0x30); // (ix+0x04) current X
  m.mem.write8(0x4002, 0x02); // (ix+0x02) sub-state
  m.push16(0x9999); // caller return for the ret
  loc_0df6(m);
  assert.equal(m.mem.read8(0x4019), 0x50, "(ix+0x19) <- target X");
  assert.equal(m.mem.read8(0x4009), 0xe0, "(ix+0x09) <- neg(0x50-0x30) = 0xE0 (signed move toward target)");
  assert.equal(m.mem.read8(0x401a), 0x00, "(ix+0x1a) cleared");
  assert.equal(m.mem.read8(0x401b), 0x00, "(ix+0x1b) cleared");
  assert.equal(m.mem.read8(0x401c), 0x00, "(ix+0x1c) cleared");
  assert.equal(m.mem.read8(0x4002), 0x03, "inc (ix+0x02)");
  assert.equal(m.regs.a, 0x00, "xor a left A=0");
  assert.deepEqual(m.calls, [], "leaf routine, no delegation");
  assert.equal(m.cycles, 159, "19+19+8+19+4+19+19+19+23+10");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0df6.js
//   find: regs.neg();
//   repl: (drop it) -> (ix+0x09) gets 0x20 instead of 0xE0
//   expect: FAIL (wrong-sign move delta, caught by the (ix+0x09) assert)
test("loc_0df6: contract catches a dropped `neg` (wrong-sign move delta)", () => {
  const m = mk();
  m.regs.a = 0x50;
  m.mem.write8(0x4004, 0x30);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    mem.write8((regs.ix + 0x19) & 0xffff, regs.a); mm.step(0x0df9, 19);
    regs.sub(mem.read8((regs.ix + 0x04) & 0xffff)); mm.step(0x0dfc, 19);
    mm.step(0x0dfe, 8); // MUTANT: dropped `neg`
    mem.write8((regs.ix + 0x09) & 0xffff, regs.a); mm.step(0x0e01, 19);
    regs.xor(regs.a); mm.step(0x0e02, 4);
    mem.write8((regs.ix + 0x1a) & 0xffff, regs.a); mm.step(0x0e05, 19);
    mem.write8((regs.ix + 0x1b) & 0xffff, regs.a); mm.step(0x0e08, 19);
    mem.write8((regs.ix + 0x1c) & 0xffff, regs.a); mm.step(0x0e0b, 23);
    regs.incMem8(mem, (regs.ix + 0x02) & 0xffff); mm.step(0x0e0e, 10);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4009), 0xe0));
});
