// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2585 (Galaxian/DK 2x2 tile-block writer, ROM 0x2585-0x2590):
//   push de / ld de,0x1f / call 0x25a0 / call 0x25a0 / pop de / ret
// Two loc_25a0 pair-writes lay codes A..A+3 as a 2x2 block: (HL)=A, (HL+1)=A+1, (HL+0x20)=A+2,
// (HL+0x21)=A+3 (stride net +0x20 per pair). DE preserved.
// Contract (real loc_25a0): 173 T (11+10+17+49+17+49+10+10), calls [0x25a0,0x25a0], the 4 tiles, DE kept.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2585 } from "../loc_2585.js";
import { loc_25a0 } from "../loc_25a0.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), typeof k === "function" ? k
      : k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_2585: writes a 2x2 tile block from the seed in A, preserves DE; 173 T", () => {
  const m = mk({ 0x25a0: loc_25a0 });
  m.regs.sp = 0x4400;
  m.push16(0xcafe); // caller return address (does not tick)
  m.regs.hl = 0x5000; // VRAM dest
  m.regs.de = 0xbeef; // sentinel: must survive push/pop
  m.regs.a = 0x2c;
  loc_2585(m);

  assert.equal(m.cycles, 173, "own 65 T + two loc_25a0 (49 each) + ret");
  assert.deepEqual(m.calls, [0x25a0, 0x25a0], "two pair-writes");
  assert.equal(m.mem.read8(0x5000), 0x2c, "(HL)=A");
  assert.equal(m.mem.read8(0x5001), 0x2d, "(HL+1)=A+1");
  assert.equal(m.mem.read8(0x5020), 0x2e, "(HL+0x20)=A+2 -- +0x20 net stride");
  assert.equal(m.mem.read8(0x5021), 0x2f, "(HL+0x21)=A+3");
  assert.equal(m.regs.de, 0xbeef, "push de/pop de preserved DE");
  assert.equal(m.pc, 0xcafe, "final ret popped the caller return address");
  assert.equal(m.regs.sp, 0x4400, "stack balanced");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2585.js
//   find: regs.de = 0x001f;
//   repl: regs.de = 0x001e;
//   expect: FAIL  (stride net +0x1f -- second pair lands at 0x501f/0x5020, so (0x5020) != 0x2e)
test("loc_2585: the contract catches a wrong row stride", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.push16(regs.de); m.step(0x2586, 11);
    regs.de = 0x001e; m.step(0x2589, 10); // MUTANT: wrong stride
    m.push16(0x258c); m.step(0x25a0, 17); m.call(0x25a0);
    m.push16(0x258f); m.step(0x25a0, 17); m.call(0x25a0);
    regs.de = m.pop16(); m.step(0x2590, 10);
    m.ret();
  };
  const m = mk({ 0x25a0: loc_25a0 });
  m.regs.sp = 0x4400; m.push16(0xcafe);
  m.regs.hl = 0x5000; m.regs.a = 0x2c;
  mutant(m);
  assert.notEqual(m.mem.read8(0x5020), 0x2e, "mutant stride misplaces the second pair");
});
