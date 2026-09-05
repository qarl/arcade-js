// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0795 (ROM 0x0795-0x07e7): expand bitmask via loc_0646, ldir 8 bytes -> 0x4218, clear
// 0x425f/0x4220, and when (0x400f)!=0 stamp 0x4018 + flip latches (0x7006/0x7007). Interior loc_07ba advances
// (0x400a), arms timer 0x4009<-0x96, stores 0x0830 @0x4245; here (0x4006) bit0=0 so it rets (no sound).
// Contract (that path): 396 T, calls [0x0646].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0795 } from "../loc_0795.js";

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
const popStub = (mm) => { mm.pop16(); }; // loc_0646 rets cleanly

test("loc_0795: (0x400f)!=0 flip path, bit0 clear -> arm+ret; 396 T, flip latches set", () => {
  const m = mk({ 0x0646: popStub });
  m.mem.write8(0x400f, 0x01); // enable flip-screen stamp branch
  m.mem.write8(0x400a, 0x02); // sub-state before advance
  m.mem.write8(0x4006, 0x00); // bit0 clear -> ret nc (no sound)
  m.push16(0x9999);
  loc_0795(m);
  assert.equal(m.cycles, 396, "sum of the flip-path instr T-states incl 163T ldir(8)");
  assert.deepEqual(m.calls, [0x0646], "only the bitmask expander");
  assert.equal(m.io.flipX, 1, "flip_screen_x_w (0x7006) D0 <- (0x400f)");
  assert.equal(m.io.flipY, 1, "flip_screen_y_w (0x7007) D0 <- (0x400f)");
  assert.equal(m.mem.read8(0x4018), 0x01, "0x4018 <- (0x400f)");
  assert.equal(m.mem.read8(0x400a), 0x03, "(0x400a) sub-state advanced");
  assert.equal(m.mem.read8(0x4009), 0x96, "0x4009 state timer armed");
  assert.equal(m.mem.read16(0x4245), 0x0830, "0x4245 <- 0x0830 pointer");
  assert.equal(m.pc, 0x9999, "ret nc to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0795.js
//   find: mem.write8(0x7007, regs.a, 10); // flip_screen_y_w D0
//   repl: mem.write8(0x7007, 0, 10);       // stuck low
//   expect: FAIL (flipY stays 0; caught by the io.flipY assert)
test("loc_0795: the contract catches a dropped flip_screen_y latch write", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.de = 0x41a0; m.step(0x0798, 10);
    m.push16(0x079b); m.step(0x0646, 17); m.call(0x0646);
    regs.exDeHl(); m.step(0x079c, 4);
    regs.de = 0x4218; m.step(0x079f, 10);
    regs.bc = 0x0008; m.step(0x07a2, 10);
    m.ldirAt(0x07a2, 0x07a4);
    regs.xor(regs.a); m.step(0x07a5, 4);
    mem.write8(0x425f, regs.a); m.step(0x07a8, 13);
    mem.write8(0x4220, regs.a); m.step(0x07ab, 13);
    regs.a = mem.read8(0x400f); m.step(0x07ae, 13);
    regs.and(regs.a); m.step(0x07af, 4);
    m.step(0x07b1, 7); // not taken
    mem.write8(0x4018, regs.a); m.step(0x07b4, 13);
    mem.write8(0x7006, regs.a, 10); m.step(0x07b7, 13);
    mem.write8(0x7007, 0, 10); m.step(0x07ba, 13); // MUTANT: flipY stuck low
    // remainder irrelevant to the assert
  };
  const m = mk({ 0x0646: popStub });
  m.mem.write8(0x400f, 0x01);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.io.flipY, 1));
});
