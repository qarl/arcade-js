// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0d71 (ROM 0x0d71-0x0dd0): object state-1 path move. Reads Y/X deltas from the table
// at 0x1e00 + cursor (ix+0x13); exercised path is the positive-X arm ((ix+6) clear) that stays on screen,
// expires both counters and advances the state.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0d71 } from "../loc_0d71.js";

function mk(rom = new Uint8Array(0x4000)) {
  const m = new Machine(rom, new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function seed(m) {
  const { mem } = m;
  m.regs.ix = 0x42b0;
  mem.write8(0x42b0 + 0x13, 0x00); // path cursor
  mem.write8(0x42b0 + 0x03, 0x60); // Y
  mem.write8(0x42b0 + 0x04, 0x50); // X
  mem.write8(0x42b0 + 0x06, 0x00); // (ix+6) bit0 clear -> positive-X arm
  mem.write8(0x42b0 + 0x10, 0x01); // step counter -> expires this frame
  mem.write8(0x42b0 + 0x11, 0x01); // leg counter -> expires this frame
  mem.write8(0x42b0 + 0x05, 0x40); // speed
  mem.write8(0x42b0 + 0x02, 0x01); // state
  m.push16(0x9999);
}

test("loc_0d71: positive-X move, both counters expire -> advance state; 322 T", () => {
  const rom = new Uint8Array(0x4000);
  rom[0x1e00] = 0x03; // Y delta
  rom[0x1e01] = 0x02; // X delta
  const m = mk(rom);
  seed(m);
  loc_0d71(m);
  assert.equal(m.cycles, 322, "sum of all instr T-states on this path");
  assert.deepEqual(m.calls, [], "no external calls");
  assert.equal(m.mem.read8(0x42b0 + 0x03), 0x63, "(ix+3) Y += 0x03");
  assert.equal(m.mem.read8(0x42b0 + 0x04), 0x52, "(ix+4) X += 0x02");
  assert.equal(m.mem.read8(0x42b0 + 0x13), 0x02, "cursor advanced by 2");
  assert.equal(m.mem.read8(0x42b0 + 0x10), 0x04, "step counter reloaded");
  assert.equal(m.mem.read8(0x42b0 + 0x05), 0x3f, "speed decremented");
  assert.equal(m.mem.read8(0x42b0 + 0x11), 0x00, "leg counter hit 0");
  assert.equal(m.mem.read8(0x42b0 + 0x02), 0x02, "state advanced 1 -> 2");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0d71.js
//   find: regs.add(mem.read8(regs.hl));  (the Y delta, at 0x0d7a)  repl: drop it
//   expect: FAIL -- (ix+3) stays 0x60 instead of 0x63; caught by the Y assert.
test("loc_0d71: the contract catches a dropped Y delta", () => {
  const rom = new Uint8Array(0x4000);
  rom[0x1e00] = 0x03; rom[0x1e01] = 0x02;
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.l = mem.read8((regs.ix + 0x13) & 0xffff); m.step(0x0d74, 19);
    regs.h = 0x1e; m.step(0x0d76, 7);
    regs.a = mem.read8((regs.ix + 0x03) & 0xffff); m.step(0x0d79, 19);
    m.step(0x0d7a, 7); // MUTANT: dropped `add a,(hl)` (Y delta)
    mem.write8((regs.ix + 0x03) & 0xffff, regs.a); m.step(0x0d7d, 19);
  };
  const m = mk(rom);
  seed(m);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x42b0 + 0x03), 0x63));
});
