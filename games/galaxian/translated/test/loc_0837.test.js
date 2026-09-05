// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for the MERGED loc_0837 (ROM 0x0837-0x0897): object move dispatch. Active-flag gate on
// (0x4200) bit0 selects the 0x0877 arm; else the movement byte comes from (0x423f)/(0x4011)/(0x4010) per
// (0x4006)/(0x4018) bit0. All interior arms (0x0850 clamp, 0x0865 negate, 0x086b writer, 0x0877/0x0882/
// 0x088c/0x0892) are inlined as JS control flow -- the routine runs to its own ret and makes NO m.calls.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0837 } from "../loc_0837.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.push16(0x9999); // return address for the routine's own ret
  return m;
}

// Assert the 0x4054-0x405b staging block holds 4 interleaved (a,c) pairs.
function assertPairs(m, a, c) {
  for (let i = 0; i < 4; i++) {
    assert.equal(m.mem.read8(0x4054 + 2 * i), a, `pair ${i} A cell`);
    assert.equal(m.mem.read8(0x4055 + 2 * i), c, `pair ${i} C cell`);
  }
}

test("loc_0837: active + IN0 fall-through -> clamp/negate/writer/ret; 332 T; no m.calls", () => {
  const m = mk();
  m.mem.write8(0x4200, 0x01); // active
  m.mem.write8(0x4006, 0x01); // bit0 set -> jp nc NOT taken
  m.mem.write8(0x4018, 0x00); // bit0 clear -> jr c NOT taken
  m.mem.write8(0x4010, 0x00); // IN0 = 0 -> bit3=0 (no dec), bit2=0 (no inc)
  m.mem.write8(0x4202, 0x50); // position cell
  loc_0837(m);
  assert.equal(m.cycles, 332, "head 101 + clamp 44 + negate 25 + writer/ret 162");
  assert.equal(m.mem.read8(0x4202), 0x50, "no dec/inc: position untouched");
  assertPairs(m, 0x2f, 0x06); // A = ~0x50 + 0x80 = 0x2f, pair-code C=0x06
  assert.equal(m.regs.c, 0x06, "negate set pair-code 0x06");
  assert.equal(m.regs.b, 0x00, "writer loop drained B");
  assert.equal(m.regs.hl, 0x405c, "HL past the staging block");
  assert.equal(m.regs.fZ, false, "flags from the final inc l (0x5b->0x5c): Z clear");
  assert.deepEqual(m.calls, [], "fully inlined -- delegates to nothing");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0837: (0x4006) bit0 clear -> 0x0892 arm A=(0x423f); bit3 drives dec clamp; 345 T", () => {
  const m = mk();
  m.mem.write8(0x4200, 0x01);
  m.mem.write8(0x4006, 0x00); // bit0 clear -> jp nc taken -> 0x0892
  m.mem.write8(0x423f, 0x08); // bit3 set -> decrement request
  m.mem.write8(0x4202, 0x50); // >= 0x17 -> cp sets NC -> dec runs
  loc_0837(m);
  assert.equal(m.cycles, 345, "0x0892 head 87 + dec-clamp 71 + negate 25 + writer/ret 162");
  assert.equal(m.mem.read8(0x4202), 0x4f, "dec (HL): 0x50 -> 0x4f");
  assert.equal(m.regs.c, 0x06);
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0x9999);
});

test("loc_0837: clamp floor is carry-gated -- value 0x16 (< 0x17) is NOT decremented; 339 T", () => {
  const m = mk();
  m.mem.write8(0x4200, 0x01);
  m.mem.write8(0x4006, 0x00); // -> 0x0892 arm
  m.mem.write8(0x423f, 0x08); // bit3 set -> decrement request
  m.mem.write8(0x4202, 0x16); // < 0x17 -> cp sets C -> jr c taken, dec SKIPPED
  loc_0837(m);
  assert.equal(m.mem.read8(0x4202), 0x16, "carry flag gated off the dec");
  assert.equal(m.cycles, 339, "0x0892 head 87 + clamp-no-dec 65 + negate 25 + writer/ret 162");
});

test("loc_0837: (0x4018) bit0 set -> 0x088c arm A=(0x4011); bit2 drives inc clamp; 374 T", () => {
  const m = mk();
  m.mem.write8(0x4200, 0x01);
  m.mem.write8(0x4006, 0x01); // jp nc NOT taken
  m.mem.write8(0x4018, 0x01); // bit0 set -> jr c taken -> 0x088c
  m.mem.write8(0x4011, 0x04); // bit2 set -> increment request (bit3 clear -> no dec)
  m.mem.write8(0x4202, 0x50); // < 0xe9 -> cp sets C -> inc runs
  loc_0837(m);
  assert.equal(m.cycles, 374, "0x088c head 116 + inc-clamp 71 + negate 25 + writer/ret 162");
  assert.equal(m.mem.read8(0x4202), 0x51, "inc (HL): 0x50 -> 0x51");
  assert.equal(m.regs.c, 0x06);
  assert.deepEqual(m.calls, []);
});

test("loc_0837: inactive -> 0x0877 arm, bit0 clear -> zero cell then negate (jp 0x0865); 268 T", () => {
  const m = mk();
  m.mem.write8(0x4200, 0x00); // inactive -> jr z 0x0877 taken
  m.mem.write8(0x4201, 0x00); // bit0 clear -> jr nz 0x0882 NOT taken
  loc_0837(m);
  assert.equal(m.cycles, 268, "head+arm 81 + negate 25 + writer/ret 162");
  assert.equal(m.mem.read8(0x4202), 0x00, "ld (hl),0x00 cleared the cell");
  assertPairs(m, 0x7f, 0x06); // A = ~0x00 + 0x80 = 0x7f, C=0x06 from the negate
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0x9999);
});

test("loc_0837: inactive -> 0x0877 -> 0x0882 sub-arm jumps straight to writer (C=0x07, negate skipped); 263 T", () => {
  const m = mk();
  m.mem.write8(0x4200, 0x00); // inactive
  m.mem.write8(0x4201, 0x01); // bit0 set -> jr nz 0x0882 taken
  m.mem.write8(0x4202, 0x30); // read by 0x0882
  loc_0837(m);
  assert.equal(m.cycles, 263, "head+arm 101 + writer/ret 162 (clamp AND negate skipped)");
  assertPairs(m, 0x4f, 0x07); // A = ~0x30 + 0x80 = 0x4f; C=0x07 proves the negate did NOT run
  assert.equal(m.regs.c, 0x07, "0x0882 set C=0x07; entry=writer bypassed the negate's C=0x06");
  assert.deepEqual(m.calls, []);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0837.js
//   find: regs.c = 0x06; (the 0x0865 negate pair-code)
//   repl: regs.c = 0x07;
//   expect: FAIL (the writer stamps 0x07 into the odd staging cells on the fall-through path;
//           caught by the pair C-cell assert)
test("loc_0837: contract catches a wrong negate pair-code", () => {
  const m = mk();
  const { regs, mem } = m;
  mem.write8(0x4202, 0x50);
  // fall-through path with both clamp bits clear, C mutated to 0x07 in the negate:
  regs.hl = 0x4200; m.step(0x083a, 10);
  regs.bit(0, 0x01); m.step(0x083c, 12); // active (skip the Z branch)
  m.step(0x083e, 7);
  regs.l = regs.inc8(regs.l); m.step(0x083f, 4);
  regs.l = regs.inc8(regs.l); m.step(0x0840, 4); // HL=0x4202
  regs.a = 0x01; regs.rrca(); m.step(0x0844, 4); // (0x4006) bit0 set -> carry -> jp nc not taken
  m.step(0x0847, 10);
  regs.a = 0x00; regs.rrca(); m.step(0x084b, 4); // (0x4018) bit0 clear -> jr c not taken
  m.step(0x084d, 7);
  regs.a = mem.read8(0x4010); m.step(0x0850, 13); // A=IN0=0
  regs.b = regs.a; m.step(0x0851, 4);
  regs.bit(3, regs.a); m.step(0x085b, 12); // bit3=0 -> jr z 0x085b
  regs.bit(2, regs.b); m.step(0x0865, 12); // bit2=0 -> jr z 0x0865
  regs.a = mem.read8(regs.hl); regs.cpl(); regs.add(0x80); m.step(0x0869, 18);
  regs.c = 0x07; m.step(0x086b, 7); // MUTANT: pair-code 0x07 instead of 0x06
  regs.hl = 0x4054; m.step(0x086e, 10);
  regs.b = 0x04; m.step(0x0870, 7);
  for (;;) {
    mem.write8(regs.hl, regs.a); m.step(0x0871, 7);
    regs.l = regs.inc8(regs.l); m.step(0x0872, 4);
    mem.write8(regs.hl, regs.c); m.step(0x0873, 7);
    regs.l = regs.inc8(regs.l); m.step(0x0874, 4);
    if (regs.djnz() !== 0) { m.step(0x0870, 13); continue; }
    m.step(0x0876, 8); break;
  }
  m.ret();
  assert.throws(() => assert.equal(m.mem.read8(0x4055), 0x06));
});
