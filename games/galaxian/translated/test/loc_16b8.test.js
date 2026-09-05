// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_16b8 (ROM 0x16b8-0x16f4): checksum of 6x10 bytes at 0x4123 (seed 1) drives the
// 0x6800 sound latches; sets 0x4224 = (sum<2 ? 1 : 0). Blank work RAM -> sum 1, so loc_16d6 immediately
// jumps to loc_16ed and zeroes all 3 latches; sum 0 (after the decrements) < 2 so 0x4224 <- 1.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_16b8 } from "../loc_16b8.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// setup 53 + 6 outer rows * 267 + tail 168
const T = 53 + 6 * 267 + 168;

test("loc_16b8: blank checksum zeroes 3 sound latches, 0x4224 <- 1; T", () => {
  const m = mk();
  m.mem.write8(0x4007, 0x00); // gate open
  m.io.soundReg[0] = 0x55; m.io.soundReg[1] = 0x55; m.io.soundReg[2] = 0x55; // observe the clear
  m.push16(0x9999);
  loc_16b8(m);
  assert.equal(m.cycles, T, "sum of all instr T-states");
  assert.deepEqual(m.calls, [], "no calls");
  assert.equal(m.io.soundReg[0], 0x00, "0x6800 latch cleared");
  assert.equal(m.io.soundReg[1], 0x00, "0x6801 latch cleared");
  assert.equal(m.io.soundReg[2], 0x00, "0x6802 latch cleared");
  assert.equal(m.mem.read8(0x4224), 0x01, "0x4224 <- 1 (sum<2)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_16b8.js
//   find: if (regs.fC) { m.step(0x16e7, 12); ... 0x4224 <- 1 ... }  (jr c,0x16e7)
//   repl: invert to `if (regs.fNC)` -> takes the xor-a arm, 0x4224 <- 0
//   expect: FAIL (0x4224 gets 0)
test("loc_16b8: contract catches a wrong 0x4224 value", () => {
  const m = mk();
  m.mem.write8(0x4007, 0x00);
  m.push16(0x9999);
  const ow = m.mem.write8.bind(m.mem);
  m.mem.write8 = (a, v, bo) => ow(a, a === 0x4224 ? 0x00 : v, bo);
  loc_16b8(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4224), 0x01));
});
