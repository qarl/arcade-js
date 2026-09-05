// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_11b0 (ROM 0x11b0-0x11cf): direction octant toward a target -> (ix+0x05). D=0xf0-(ix3),
// A=(0x4202)-(ix4); positive X delta -> loc_11d0 then store; negative -> neg/loc_11d0/neg then store.
// Contract: positive path 115 T, calls [0x11d0], (ix+0x05)=octant; negative path 136 T, octant mirrored.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_11b0 } from "../loc_11b0.js";

function mk(octant = 0x05) {
  const routines = new Map();
  // loc_11d0 stub: pop the pushed return, return a fixed octant in A.
  routines.set(0x11d0, (mm) => { mm.pop16(); mm.regs.a = octant; });
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_11b0: positive X delta -> stores loc_11d0's octant; 115 T", () => {
  const m = mk(0x05);
  m.mem.write8(0x4203, 0x50); // (ix+0x03) sprite Y
  m.mem.write8(0x4204, 0x40); // (ix+0x04) sprite X
  m.mem.write8(0x4202, 0x80); // target X anchor -> X delta = 0x40 (no borrow)
  m.push16(0x9999);
  loc_11b0(m);
  assert.deepEqual(m.calls, [0x11d0], "one call to loc_11d0");
  assert.equal(m.mem.read8(0x4205), 0x05, "(ix+0x05) = octant from loc_11d0");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.equal(m.cycles, 115, "no-carry path T-states");
});

test("loc_11b0: negative X delta -> octant mirrored via neg; 136 T", () => {
  const m = mk(0x05);
  m.mem.write8(0x4203, 0x50);
  m.mem.write8(0x4204, 0x80); // sprite X
  m.mem.write8(0x4202, 0x40); // target X -> X delta borrows
  m.push16(0x9999);
  loc_11b0(m);
  assert.deepEqual(m.calls, [0x11d0], "one call to loc_11d0");
  assert.equal(m.mem.read8(0x4205), 0xfb, "(ix+0x05) = neg(0x05) = 0xFB (mirrored)");
  assert.equal(m.cycles, 136, "carry path T-states");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_11b0.js
//   find: regs.neg(); m.step(0x11cc, 8);   (the second neg in the carry arm)
//   repl: m.step(0x11cc, 8);               (drop the mirror-back neg)
//   expect: FAIL ((ix+0x05) becomes 0x05 instead of 0xFB)
test("loc_11b0: contract catches a dropped mirror-back neg", () => {
  const m = mk(0x05);
  m.mem.write8(0x4203, 0x50);
  m.mem.write8(0x4204, 0x80);
  m.mem.write8(0x4202, 0x40);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.a = 0xf0; mm.step(0x11b2, 7);
    regs.sub(mem.read8(regs.ix + 0x03)); mm.step(0x11b5, 19);
    regs.d = regs.a; mm.step(0x11b6, 4);
    regs.a = mem.read8(0x4202); mm.step(0x11b9, 13);
    regs.sub(mem.read8(regs.ix + 0x04)); mm.step(0x11bc, 19);
    if (regs.fC) {
      mm.step(0x11c5, 12);
      regs.neg(); mm.step(0x11c7, 8);
      mm.push16(0x11ca); mm.step(0x11d0, 17); mm.call(0x11d0);
      mm.step(0x11cc, 8); // MUTANT: dropped mirror-back neg
      mem.write8(regs.ix + 0x05, regs.a); mm.step(0x11cf, 19);
      mm.ret(); return;
    }
    mm.step(0x11be, 7);
    mm.push16(0x11c1); mm.step(0x11d0, 17); mm.call(0x11d0);
    mem.write8(regs.ix + 0x05, regs.a); mm.step(0x11c4, 19);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4205), 0xfb));
});
