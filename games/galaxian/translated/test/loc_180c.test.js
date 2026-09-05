// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_180c (ROM 0x180c-0x1814):
//   180c  0f        rrca            ; carry = incoming A bit0
//   180d  3a c4 41  ld a,(0x41c4)   ; reload A (carry survives)
//   1810  30 03     jr nc,0x1815    ; bit0 clear -> store as-is
//   1812  c6 60     add a,0x60
//   1814  1f        rra
//   (fall-through into loc_1815)
// Contract A (bit0 clear): 29 T (4+13+12), delegates loc_1815 with A = 0x41c4 unchanged.
// Contract B (bit0 set):   35 T (4+13+7+7+4), delegates loc_1815 with A = rra(0x41c4+0x60).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_180c } from "../loc_180c.js";

function mk(seen) {
  const routines = new Map([[0x1815, (mm) => { seen.a = mm.regs.a; }]]);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_180c: bit0 clear -> delegate loc_1815 with 0x41c4 unchanged; 29 T", () => {
  const seen = {};
  const m = mk(seen);
  m.regs.a = 0x02;              // bit0 = 0
  m.mem.write8(0x41c4, 0x30);
  loc_180c(m);
  assert.equal(m.cycles, 29, "4 + 13 + 12 (jr taken)");
  assert.deepEqual(m.calls, [0x1815], "falls into loc_1815");
  assert.equal(seen.a, 0x30, "A handed to loc_1815 = 0x41c4 unchanged");
});

test("loc_180c: bit0 set -> add 0x60 + rra, then delegate loc_1815; 35 T", () => {
  const seen = {};
  const m = mk(seen);
  m.regs.a = 0x03;              // bit0 = 1
  m.mem.write8(0x41c4, 0x30);
  loc_180c(m);
  assert.equal(m.cycles, 35, "4 + 13 + 7 + 7 + 4 (jr not taken)");
  assert.deepEqual(m.calls, [0x1815], "falls into loc_1815");
  assert.equal(seen.a, 0x48, "rra(0x30 + 0x60) = 0x48");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_180c.js
//   find: regs.add(0x60);
//   repl: regs.add(0x50);
//   expect: FAIL (A handed to loc_1815 becomes rra(0x80)=0x40, caught by the 0x48 assert)
test("loc_180c: the contract catches a wrong add constant", () => {
  const seen = {};
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.rrca(); m.step(0x180d, 4);
    regs.a = mem.read8(0x41c4); m.step(0x1810, 13);
    if (regs.fNC) { m.step(0x1815, 12); return m.call(0x1815); }
    m.step(0x1812, 7);
    regs.add(0x50); m.step(0x1814, 7); // MUTANT
    regs.rra(); m.step(0x1815, 4);
    return m.call(0x1815);
  };
  const m = mk(seen);
  m.regs.a = 0x03;
  m.mem.write8(0x41c4, 0x30);
  mutant(m);
  assert.throws(() => assert.equal(seen.a, 0x48));
});
