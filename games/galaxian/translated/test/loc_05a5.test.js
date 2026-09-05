// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_05a5 (ROM 0x05a5-0x05e1): board setup. call 0x0646; ldir 8 bytes -> 0x4218; zero
// 0x425f/0x4220/0x4018 + flip latches; inc (0x400a); (0x4009)=0x96; (0x4245)=0x0640; then flag tests on
// 0x4006/0x400e drive loc_08f2 + delegate to loc_05e2. Full path (0x4006 bit0 set, 0x400e bit0 clear) = 417 T,
// calls [0x0646, 0x08f2, 0x05e2].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_05a5 } from "../loc_05a5.js";

const ret0 = (mm) => { mm.pop16(); }; // stub for a called routine that rets cleanly

function mk() {
  const routines = new Map();
  routines.set(0x0646, ret0);
  routines.set(0x08f2, ret0);
  routines.set(0x05e2, () => {}); // delegate target (tail)
  routines.set(0x05fc, () => {}); // alt branch (not taken here)
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.io.flipX = 1; m.io.flipY = 1; // so the zero-writes are observable
  m.mem.write8(0x4006, 0x01); // bit0 set -> ret nc NOT taken
  m.mem.write8(0x400e, 0x00); // bit0 clear -> jr c NOT taken
  m.mem.write8(0x400a, 5);
  for (let i = 0; i < 8; i++) m.mem.write8(0x4180 + i, 0xa0 + i); // ldir source (0x0646 leaves DE=0x4180)
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_05a5: full setup path -> loc_08f2 + delegate to loc_05e2; 417 T", () => {
  const m = mk();
  loc_05a5(m);
  assert.equal(m.cycles, 417, "sum of all instr T-states (ldir=163, both branches not taken)");
  assert.deepEqual(m.calls, [0x0646, 0x08f2, 0x05e2], "0x0646, then sound enqueue, then delegate");
  assert.equal(m.mem.read8(0x4218), 0xa0, "ldir copied source[0] -> 0x4218");
  assert.equal(m.mem.read8(0x421f), 0xa7, "ldir copied source[7] -> 0x421f");
  assert.equal(m.mem.read8(0x425f), 0, "0x425f cleared");
  assert.equal(m.mem.read8(0x4220), 0, "0x4220 cleared");
  assert.equal(m.mem.read8(0x4018), 0, "0x4018 cleared");
  assert.equal(m.io.flipX, 0, "flip_x latch (0x7006) <- 0");
  assert.equal(m.io.flipY, 0, "flip_y latch (0x7007) <- 0");
  assert.equal(m.mem.read8(0x400a), 6, "inc (0x400a): 5 -> 6");
  assert.equal(m.mem.read8(0x4009), 0x96, "(0x4009) = 0x96");
  assert.equal(m.mem.read16(0x4245), 0x0640, "(0x4245) = 0x0640");
});

test("loc_05a5: 0x4006 bit0 clear -> early ret nc (no sound, no delegate)", () => {
  const m = mk();
  m.mem.write8(0x4006, 0x00); // bit0 clear -> ret nc TAKEN
  m.push16(0x9999); // caller return for the early ret
  loc_05a5(m);
  assert.deepEqual(m.calls, [0x0646], "only the 0x0646 copy ran before the ret");
  assert.equal(m.pc, 0x9999, "ret nc to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_05a5.js
//   find: mem.write8(regs.hl, 0x96);   repl: (drop it)   ((0x4009) never set)
//   expect: FAIL ((0x4009) stays 0, not 0x96)
test("loc_05a5: contract catches a dropped (0x4009)=0x96", () => {
  const m = mk();
  const { regs, mem } = m;
  regs.de = 0x4180; m.step(0x05a8, 10);
  m.push16(0x05ab); m.step(0x0646, 17); m.call(0x0646);
  regs.exDeHl(); m.step(0x05ac, 4);
  regs.de = 0x4218; m.step(0x05af, 10);
  regs.bc = 0x0008; m.step(0x05b2, 10);
  m.ldirAt(0x05b2, 0x05b4);
  regs.xor(regs.a); m.step(0x05b5, 4);
  mem.write8(0x425f, regs.a); m.step(0x05b8, 13);
  mem.write8(0x4220, regs.a); m.step(0x05bb, 13);
  mem.write8(0x7006, regs.a, 10); m.step(0x05be, 13);
  mem.write8(0x7007, regs.a, 10); m.step(0x05c1, 13);
  mem.write8(0x4018, regs.a); m.step(0x05c4, 13);
  regs.hl = 0x400a; m.step(0x05c7, 10);
  regs.incMem8(mem, regs.hl); m.step(0x05c8, 11);
  regs.l = regs.dec8(regs.l); m.step(0x05c9, 4);
  m.step(0x05cb, 10); // MUTANT: dropped (0x4009)=0x96
  regs.hl = 0x0640; m.step(0x05ce, 10);
  mem.write16(0x4245, regs.hl); m.step(0x05d1, 16);
  regs.a = mem.read8(0x4006); m.step(0x05d4, 13);
  regs.rrca(); m.step(0x05d5, 4);
  if (regs.fNC) { m.ret(11); }
  else {
    m.step(0x05d6, 5);
    regs.a = mem.read8(0x400e); m.step(0x05d9, 13);
    regs.rrca(); m.step(0x05da, 4);
    m.step(0x05dc, 7);
    regs.de = 0x0500; m.step(0x05df, 10);
    m.push16(0x05e2); m.step(0x08f2, 17); m.call(0x08f2);
    m.call(0x05e2);
  }
  assert.throws(() => assert.equal(m.mem.read8(0x4009), 0x96));
});
