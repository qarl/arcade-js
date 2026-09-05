// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2569 (ROM 0x2569-0x2582): hex-to-BCD. A binary byte in A becomes packed BCD in A
// (leaf, no m.call). Contract: 0x63 -> 0x99 (225 T, six +0x16 loop iters), 0x05 -> 0x05 (67 T, no loop).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2569 } from "../loc_2569.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.push16(0x9999);
  return m;
}

test("loc_2569: 0x63 -> BCD 0x99 with the high-nibble loop; 225 T", () => {
  const m = mk();
  m.regs.a = 0x63;
  loc_2569(m);
  assert.equal(m.regs.a, 0x99, "hex 0x63 == 99 decimal -> BCD 0x99");
  assert.equal(m.cycles, 225, "setup + six +0x16 DAA iters + tail");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_2569: 0x05 -> BCD 0x05 (high nibble zero skips the loop); 67 T", () => {
  const m = mk();
  m.regs.a = 0x05;
  loc_2569(m);
  assert.equal(m.regs.a, 0x05, "low-nibble-only value passes through");
  assert.equal(m.cycles, 67, "jr z,0x2580 taken: no loop");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2569.js
//   find: regs.add(0x16);   (per high-nibble unit)
//   repl: regs.add(0x15);
//   expect: FAIL (0x10 -> 0x15 instead of 0x16; caught by the BCD assert)
test("loc_2569: the contract catches a wrong per-unit BCD increment", () => {
  const m = mk();
  m.regs.a = 0x10;
  const { regs } = m;
  regs.b = regs.a; m.step(0x256a, 4);
  regs.and(0x0f); m.step(0x256c, 7);
  regs.add(0x00); m.step(0x256e, 7);
  regs.daa(); m.step(0x256f, 4);
  regs.c = regs.a; m.step(0x2570, 4);
  regs.a = regs.b; m.step(0x2571, 4);
  regs.and(0xf0); m.step(0x2573, 7);
  m.step(0x2575, 7);
  regs.rrca(); m.step(0x2576, 4);
  regs.rrca(); m.step(0x2577, 4);
  regs.rrca(); m.step(0x2578, 4);
  regs.rrca(); m.step(0x2579, 4);
  regs.b = regs.a; m.step(0x257a, 4);
  regs.xor(regs.a); m.step(0x257b, 4);
  regs.add(0x15); m.step(0x257d, 7); // MUTANT
  regs.daa(); m.step(0x257e, 4);
  m.step(0x2580, 8);
  regs.add(regs.c); m.step(0x2581, 4);
  regs.daa(); m.step(0x2582, 4);
  assert.throws(() => assert.equal(m.regs.a, 0x16));
});
