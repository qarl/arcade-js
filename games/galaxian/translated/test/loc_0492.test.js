// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0492 (ROM 0x0492-0x04bb): post-dispatch handler.
//   (a) (0x4011) bit0 set -> tail to loc_04f2. 33 T (13+8+12), calls [0x04f2].
//   (b) bit0 clear, bit1 clear -> ret z. 47 T, calls [].
//   (c) bit0 clear, bit1 set, count 5, (0x401f) bit0 clear -> consume 2 credits, ldir 0x051b->0x41a0,
//       call c not taken, fall through to loc_04bc. 820 T, calls [0x04bc], (0x4002)=3.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0492 } from "../loc_0492.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : () => {});
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4380; m.push16(0xbeef);
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0492: (0x4011) bit0 set -> tail to loc_04f2; 33 T", () => {
  const m = mk({ 0x04f2: "tail" });
  m.mem.write8(0x4011, 0x01);
  const ret = loc_0492(m);
  assert.equal(m.cycles, 33, "13+8+jr nz taken 12");
  assert.deepEqual(m.calls, [0x04f2], "tails to loc_04f2");
  assert.equal(ret, "TAIL", "tail result propagates");
});

test("loc_0492: bit0 clear, bit1 clear -> ret z; 47 T", () => {
  const m = mk();
  m.mem.write8(0x4011, 0x00);
  loc_0492(m);
  assert.equal(m.cycles, 47, "13+8+7+8+ret z taken 11");
  assert.deepEqual(m.calls, [], "no delegation");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

test("loc_0492: full path consumes 2 credits, ldir, falls into loc_04bc; 820 T", () => {
  const m = mk({ 0x04bc: "noop" });
  m.mem.write8(0x4011, 0x02); // bit0 clear, bit1 set
  m.mem.write8(0x4002, 0x05); // 5 credits
  m.mem.write8(0x401f, 0x00); // bit0 clear -> call c not taken
  loc_0492(m);
  assert.equal(m.cycles, 820, "full fall-through T-total incl. 0x20-byte ldir");
  assert.deepEqual(m.calls, [0x04bc], "delegates to loc_04bc");
  assert.equal(m.mem.read8(0x4002), 3, "credit count 5 - 2 = 3");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0492.js
//   find: if (regs.fNZ) {   (the bit0 -> loc_04f2 branch)
//   repl: if (regs.fZ) {    (inverted sense)
//   expect: FAIL (bit0 set no longer tails; calls == [] not [0x04f2])
test("loc_0492: the contract catches an inverted bit0 branch sense", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4011); m.step(0x0495, 13);
    regs.bit(0, regs.a); m.step(0x0497, 8);
    if (regs.fZ) { m.step(0x04f2, 12); return m.call(0x04f2); } // MUTANT: wrong sense
    m.step(0x0499, 7);
    return m.ret();
  };
  const m = mk({ 0x04f2: "tail" });
  m.mem.write8(0x4011, 0x01);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x04f2]));
});
