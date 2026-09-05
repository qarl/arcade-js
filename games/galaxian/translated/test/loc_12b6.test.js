// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_12b6 (ROM 0x12b6-0x12ec): per-object proximity test. Contract (high-window hit path):
// active object in band -> (0x4204)=1 and tail-jump to loc_125e; 158 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_12b6 } from "../loc_12b6.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// High-window hit: (ix+3)=0xE4 -> +0x21 wrap -> A=0x05; -0x05=0x00 (no carry, high window);
// -0x0c borrows (in window); player(0x4202)-(ix+4) +0x0a < 0x15 -> hit.
function runHit() {
  const m = mk({ 0x125e: () => {} });
  m.regs.ix = 0x42d0;
  m.mem.write8(0x42d0, 0x01); // (ix+0) bit0 = active
  m.mem.write8(0x42d3, 0xe4); // (ix+3)
  m.mem.write8(0x42d4, 0x10); // (ix+4)
  m.mem.write8(0x4202, 0x10); // player pos
  m.push16(0x9999);           // caller return
  loc_12b6(m);
  return m;
}

test("loc_12b6: high-window hit sets (0x4204)=1 and tail-jumps loc_125e; 158 T", () => {
  const m = runHit();
  assert.equal(m.cycles, 158, "sum of all instr T-states on the hit path");
  assert.equal(m.mem.read8(0x4204), 0x01, "event flag (0x4204) <- 1");
  assert.deepEqual(m.calls, [0x125e], "tail-jump jp 0x125e");
});

test("loc_12b6: inactive object rets immediately (bit0 clear); 31 T", () => {
  const m = mk({ 0x125e: () => {} });
  m.regs.ix = 0x42d0;
  m.mem.write8(0x42d0, 0x00); // inactive
  m.push16(0x9999);
  loc_12b6(m);
  assert.equal(m.cycles, 31, "bit(20)+ret z taken(11)");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.deepEqual(m.calls, [], "no tail-jump");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_12b6.js
//   find (high-window arm): mem.write8(0x4204, regs.a);  at 0x12d4
//   repl: drop it
//   expect: FAIL -- (0x4204) stays 0, the hit-path assert catches it.
test("loc_12b6: contract catches a dropped (0x4204) write", () => {
  const m = mk({ 0x125e: () => {} });
  m.regs.ix = 0x42d0;
  m.mem.write8(0x42d0, 0x01);
  m.mem.write8(0x42d3, 0xe4);
  m.mem.write8(0x42d4, 0x10);
  m.mem.write8(0x4202, 0x10);
  m.push16(0x9999);
  // mutant: same flow but never writes the flag
  const { regs, mem } = m;
  regs.bit(0, mem.read8(regs.ix + 0x00), (regs.ix + 0x00) >> 8); m.step(0x12ba, 20);
  m.step(0x12bb, 5);
  regs.a = mem.read8(regs.ix + 0x03); m.step(0x12be, 19);
  regs.add(0x21); m.step(0x12c0, 7);
  regs.sub(0x05); m.step(0x12c2, 7);
  m.step(0x12c4, 7);
  regs.sub(0x0c); m.step(0x12c6, 7);
  m.step(0x12c7, 5);
  regs.a = mem.read8(0x4202); m.step(0x12ca, 13);
  regs.sub(mem.read8(regs.ix + 0x04)); m.step(0x12cd, 19);
  regs.add(0x0a); m.step(0x12cf, 7);
  regs.cp(0x15); m.step(0x12d1, 7);
  m.step(0x12d2, 5);
  regs.a = 0x01; m.step(0x12d4, 7); // MUTANT: dropped ld (0x4204),a
  m.step(0x125e, 10); m.call(0x125e);
  assert.throws(() => assert.equal(m.mem.read8(0x4204), 0x01));
});
