// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1c3a (Galaxian, ROM 0x1C3A-0x1C4F): call 0x16f5 + 0x16a6, pet the watchdog, read
// IN0 (0x6000); if (IN0 & 0x83) != 0 store 1 into (0x41c9); fall through into loc_1c50 either way.
// Two contracts: NZ path (IN0=0x01 -> store, 98 T) and Z path (IN0=0x04 -> skip, 83 T).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1c3a } from "../loc_1c3a.js";

function mk(stubs = { 0x16f5: "pop", 0x16a6: "pop", 0x1c50: "tail" }) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4380; // valid work-RAM stack so the two calls' push/pop stay mapped
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const wr = (m, a) => m.mem.workRam[a & 0x3ff];

function checkNZ(m, ret) {
  assert.equal(m.cycles, 98, "NZ path T-total");
  assert.deepEqual(m.calls, [0x16f5, 0x16a6, 0x1c50], "call 0x16f5, 0x16a6, then fall into loc_1c50");
  assert.equal(m.regs.b, 0x01, "B keeps the raw IN0 byte");
  assert.equal(wr(m, 0x41c9), 1, "(0x41c9)=1 when (IN0 & 0x83) != 0");
  assert.equal(ret, "TAIL", "fall-through into loc_1c50 propagates");
}

test("loc_1c3a: IN0 bit set -> (0x41c9)=1, into loc_1c50; 98 T", () => {
  const m = mk();
  m.io.in0 = 0x01; // (0x01 & 0x83) = 0x01 -> non-zero
  checkNZ(m, loc_1c3a(m));
});

test("loc_1c3a: IN0 masks to zero -> no store, into loc_1c50; 83 T", () => {
  const m = mk();
  m.io.in0 = 0x04; // (0x04 & 0x83) = 0 -> jr z taken
  const ret = loc_1c3a(m);
  assert.equal(m.cycles, 83, "Z path T-total (jr z taken)");
  assert.deepEqual(m.calls, [0x16f5, 0x16a6, 0x1c50], "still falls into loc_1c50");
  assert.equal(m.regs.b, 0x04, "B keeps the raw IN0 byte");
  assert.equal(wr(m, 0x41c9), 0, "(0x41c9) untouched when the mask is zero");
  assert.equal(ret, "TAIL", "tail-transfer propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1c3a.js
//   find: mem.write8(0x41c9, regs.a);
//   repl: mem.write8(0x41ca, regs.a);
//   expect: FAIL  (stores the wrong cell; (0x41c9) stays 0 -- caught by checkNZ)
//   verified-anchor: count == 1  (the sole 0x41c9 store in loc_1c3a.js)
test("loc_1c3a: the contract catches a wrong store address", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(0x1c3d); m.step(0x16f5, 17); m.call(0x16f5);
    m.push16(0x1c40); m.step(0x16a6, 17); m.call(0x16a6);
    regs.a = mem.read8(0x7800); m.step(0x1c43, 13);
    regs.a = mem.read8(0x6000); m.step(0x1c46, 13);
    regs.b = regs.a; m.step(0x1c47, 4);
    regs.and(0x83); m.step(0x1c49, 7);
    if (regs.fZ) { m.step(0x1c50, 12); return m.call(0x1c50); }
    m.step(0x1c4b, 7);
    regs.a = 0x01; m.step(0x1c4d, 7);
    mem.write8(0x41ca, regs.a); m.step(0x1c50, 13); // MUTANT: wrong cell
    return m.call(0x1c50);
  };
  const m = mk();
  m.io.in0 = 0x01;
  const ret = mutant(m);
  assert.throws(() => checkNZ(m, ret));
});
