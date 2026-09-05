// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_20a7 (Galaxian, ROM 0x20a7-0x20ab): A=(0x40ab); ret z if zero (28 T), else fall
// through into loc_20ac (22 T).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_20a7 } from "../loc_20a7.js";

function mk(stubs = { 0x20ac: "tail" }) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4380; // mapped stack so ret z can pop
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_20a7: (0x40ab)==0 -> ret z; 28 T", () => {
  const m = mk();
  m.mem.workRam[0x0ab] = 0x00;
  const ret = loc_20a7(m);
  assert.equal(m.cycles, 28, "Z path T-total (13+4+11)");
  assert.deepEqual(m.calls, [], "ret z -- no fall-through");
  assert.equal(ret, undefined, "ret z returns nothing");
});

test("loc_20a7: (0x40ab)!=0 -> fall into loc_20ac; 22 T", () => {
  const m = mk();
  m.mem.workRam[0x0ab] = 0x37;
  const ret = loc_20a7(m);
  assert.equal(m.cycles, 22, "NZ path T-total (13+4+5)");
  assert.deepEqual(m.calls, [0x20ac], "falls through into loc_20ac");
  assert.equal(ret, "TAIL", "loc_20ac result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_20a7.js
//   find: regs.a = mem.read8(0x40ab);
//   repl: regs.a = mem.read8(0x40ac);
//   expect: FAIL  (reads the wrong cell; with (0x40ab)!=0 but (0x40ac)==0 it ret-z's instead of falling)
//   verified-anchor: count == 1  (the sole 0x40ab read in loc_20a7.js)
test("loc_20a7: the contract catches a wrong read address", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x40ac); m.step(0x20aa, 13); // MUTANT: wrong cell
    regs.and(regs.a); m.step(0x20ab, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x20ac, 5);
    return m.call(0x20ac);
  };
  const m = mk();
  m.mem.workRam[0x0ab] = 0x37; // (0x40ab)!=0, (0x40ac)==0
  const ret = mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x20ac]));
  assert.equal(ret, undefined);
});
