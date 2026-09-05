// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_197c (Galaxian, ROM 0x197c-0x1988):
//   197c  3a 02 40  ld a,(0x4002)   ; counter
//   197f  fe 09     cp 0x09
//   1981  30 06     jr nc,0x1989    ; A >= 9 -> tail to loc_1989 (clears 0x6002)
//   1983  3e 01     ld a,0x01
//   1985  32 02 60  ld (0x6002),a   ; coin_lock latch = 1
//   1988  c9        ret
// Two contracts:
//   (a) (0x4002) < 9: fall through, coin_lock = 1, ret. 57 T (13+7+7+7+13+10), calls == [].
//   (b) (0x4002) >= 9: jr nc taken, tail to loc_1989. 32 T (13+7+12), calls == [0x1989].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_197c } from "../loc_197c.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_197c: (0x4002) < 9 -> coin_lock latch = 1 + ret; 57 T", () => {
  const m = mk();
  m.regs.sp = 0x4380; m.push16(0xbeef);
  m.mem.write8(0x4002, 0x05);
  loc_197c(m);
  assert.equal(m.cycles, 57, "fall-through T-total (13+7+7+7+13+10)");
  assert.deepEqual(m.calls, [], "no delegation on the < 9 path");
  assert.equal(m.io.coinLock, 1, "0x6002 write set coin_lock = 1");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

test("loc_197c: (0x4002) >= 9 -> jr nc taken, tails to loc_1989; 32 T", () => {
  const m = mk({ 0x1989: "tail" });
  m.mem.write8(0x4002, 0x09); // 9 - 9 = 0, carry clear -> branch taken
  const ret = loc_197c(m);
  assert.equal(m.cycles, 32, "13 + 7 + jr nc taken 12");
  assert.deepEqual(m.calls, [0x1989], "tails to loc_1989");
  assert.equal(m.io.coinLock, 0, "no coin_lock=1 write on the >= 9 path");
  assert.equal(ret, "TAIL", "tail result propagates out");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_197c.js
//   find: if (regs.fNC) {
//   repl: if (regs.fC) {            (inverted branch sense)
//   expect: FAIL  (A=5 has carry set, so the mutant tails to loc_1989 instead of falling through --
//           caught by the < 9 test: calls == [] and coinLock == 1 both break)
//   verified-anchor: count == 1  (the sole fNC/fC branch in loc_197c.js)
test("loc_197c: the contract catches an inverted branch sense", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4002); m.step(0x197f, 13);
    regs.cp(0x09); m.step(0x1981, 7);
    if (regs.fC) { m.step(0x1989, 12); return m.call(0x1989); } // MUTANT: wrong sense
    m.step(0x1983, 7);
    regs.a = 0x01; m.step(0x1985, 7);
    mem.write8(0x6002, regs.a, 10); m.step(0x1988, 13);
    return m.ret();
  };
  const m = mk({ 0x1989: "tail" });
  m.regs.sp = 0x4380; m.push16(0xbeef);
  m.mem.write8(0x4002, 0x05);
  mutant(m);
  assert.throws(() => {
    assert.deepEqual(m.calls, [], "no delegation on the < 9 path");
    assert.equal(m.io.coinLock, 1, "0x6002 write set coin_lock = 1");
  });
});
