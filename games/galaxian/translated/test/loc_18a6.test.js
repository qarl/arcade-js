// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_18a6 (ROM 0x18a6-0x18b1):
//   18a6  3a 5f 42  ld a,(0x425f)
//   18a9  c6 01     add a,0x01     ; carry only when 0x425f == 0xff
//   18ab  d0        ret nc         ; not armed -> return
//   18ac  3a 1f 42  ld a,(0x421f)
//   18af  a7        and a
//   18b0  c8        ret z          ; level 0 -> return
//   18b1  3d        dec a
//                   -> fall through into loc_18b2
// Contract A (not armed): 31 T (13+7+11), ret.
// Contract B (armed, level 0): 53 T (13+7+5+13+4+11), ret.
// Contract C (armed, level>0): 51 T; A = level-1, tail loc_18b2.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_18a6 } from "../loc_18a6.js";

function mk() {
  const routines = new Map();
  routines.set(0x18b2, () => "TAIL_b2");
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.mem.write8(0x4400, 0x34); m.mem.write8(0x4401, 0x12); // caller return = 0x1234
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_18a6: not armed (0x425f != 0xff) -> ret nc; 31 T", () => {
  const m = mk();
  m.mem.write8(0x425f, 0x10);
  loc_18a6(m);
  assert.equal(m.cycles, 31, "13 + 7 + 11");
  assert.deepEqual(m.calls, [], "no tail");
  assert.equal(m.pc, 0x1234, "ret nc returned to the caller");
});

test("loc_18a6: armed, level 0 -> ret z; 53 T", () => {
  const m = mk();
  m.mem.write8(0x425f, 0xff);
  m.mem.write8(0x421f, 0x00);
  loc_18a6(m);
  assert.equal(m.cycles, 53, "13 + 7 + 5 + 13 + 4 + 11");
  assert.deepEqual(m.calls, [], "no tail");
  assert.equal(m.pc, 0x1234, "ret z returned to the caller");
});

function checkArmedActive(m, ret) {
  assert.equal(m.cycles, 51, "T-state total, armed-active path");
  assert.deepEqual(m.calls, [0x18b2], "tail-jumps into the broadcast");
  assert.equal(ret, "TAIL_b2", "callee result propagates");
  assert.equal(m.regs.a, 0x04, "A = level(0x05) - 1");
}

test("loc_18a6: armed, level>0 -> dec + tail loc_18b2; 51 T", () => {
  const m = mk();
  m.mem.write8(0x425f, 0xff);
  m.mem.write8(0x421f, 0x05);
  const ret = loc_18a6(m);
  checkArmedActive(m, ret);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_18a6.js
//   find: regs.a = regs.dec8(regs.a);
//   repl: regs.a = regs.inc8(regs.a);
//   expect: FAIL (level incremented not decremented, caught by A == 0x04 assert)
test("loc_18a6: the contract catches a wrong level update", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x425f); m.step(0x18a9, 13);
    regs.add(0x01); m.step(0x18ab, 7);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x18ac, 5);
    regs.a = mem.read8(0x421f); m.step(0x18af, 13);
    regs.and(regs.a); m.step(0x18b0, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x18b1, 5);
    regs.a = regs.inc8(regs.a); m.step(0x18b2, 4); // MUTANT
    return m.call(0x18b2);
  };
  const m = mk();
  m.mem.write8(0x425f, 0xff);
  m.mem.write8(0x421f, 0x05);
  const ret = mutant(m);
  assert.throws(() => checkArmedActive(m, ret));
});
