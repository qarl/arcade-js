// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0443 (ROM 0x0443-0x0472): rst-0x28 state idx 2. Two 0x1c-byte 0x10 fills through
// pointer (0x400b) with 4-byte gaps (pointer += 0x40), dec (0x4009); zero -> bump (0x400a), clear flip_x/
// flip_y + (0x4018), two loc_08f2 calls, fall through to loc_0473. Contract (zero path): 245 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0443 } from "../loc_0443.js";

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
// faithful rst-0x10 fill stub: pop return, write A into B bytes from HL (B==0 => 256), leave B=0.
const rst10 = (mm) => {
  mm.pop16();
  const { regs, mem } = mm;
  let n = regs.b === 0 ? 256 : regs.b;
  while (n-- > 0) { mem.write8(regs.hl, regs.a); regs.hl = (regs.hl + 1) & 0xffff; }
  regs.b = 0;
};
const pop = (mm) => { mm.pop16(); };

test("loc_0443: counter hits zero -> fills, flip clears, delegate to loc_0473; 245 T", () => {
  const m = mk({ 0x0010: rst10, 0x08f2: pop, 0x0473: pop });
  m.mem.write16(0x400b, 0x4100); // pointer p
  m.mem.write8(0x4009, 1);       // dec -> 0 (Z): take the completion path
  m.mem.write8(0x400a, 7);
  m.io.flipX = 1; m.io.flipY = 1; m.mem.write8(0x4018, 0xaa);
  m.push16(0x9999);
  loc_0443(m);
  assert.equal(m.cycles, 245, "completion-path T-states");
  assert.deepEqual(m.calls, [0x0010, 0x0010, 0x08f2, 0x08f2, 0x0473],
    "two fills, two loc_08f2, then fall-through delegate to loc_0473");
  assert.equal(m.mem.read16(0x400b), 0x4140, "pointer advanced by 0x40 (0x4100 -> 0x4140)");
  assert.equal(m.mem.read8(0x4100), 0x10, "run 1 start filled with 0x10");
  assert.equal(m.mem.read8(0x411b), 0x10, "run 1 end (p+0x1b) filled with 0x10");
  assert.equal(m.mem.read8(0x411c), 0x00, "4-byte gap untouched");
  assert.equal(m.mem.read8(0x4120), 0x10, "run 2 start (p+0x20) filled with 0x10");
  assert.equal(m.mem.read8(0x413b), 0x10, "run 2 end (p+0x3b) filled with 0x10");
  assert.equal(m.mem.read8(0x400a), 8, "(0x400a) bumped 7 -> 8");
  assert.equal(m.io.flipX, 0, "flip_screen_x cleared (0x7006 <- 0)");
  assert.equal(m.io.flipY, 0, "flip_screen_y cleared (0x7007 <- 0)");
  assert.equal(m.mem.read8(0x4018), 0, "(0x4018) cleared");
});

test("loc_0443: counter stays nonzero -> ret nz, no completion work", () => {
  const m = mk({ 0x0010: rst10, 0x08f2: pop, 0x0473: pop });
  m.mem.write16(0x400b, 0x4100);
  m.mem.write8(0x4009, 3);   // dec -> 2 (NZ): early ret
  m.mem.write8(0x400a, 7);
  m.io.flipX = 1;
  m.push16(0x9999);
  loc_0443(m);
  assert.deepEqual(m.calls, [0x0010, 0x0010], "only the two fills; no loc_08f2 / no delegate");
  assert.equal(m.mem.read8(0x400a), 7, "state NOT bumped on the nonzero path");
  assert.equal(m.io.flipX, 1, "flip_x untouched on the nonzero path");
  assert.equal(m.mem.read16(0x400b), 0x4140, "pointer still advanced by 0x40");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0443.js
//   find: mem.write8(0x7007, regs.a, 10);  (flip_screen_y_w clear)
//   repl: (drop it -- flip_y left set)
//   expect: FAIL (io.flipY stays 1; caught by the flipY==0 assert)
test("loc_0443: contract catches a dropped flip_y clear", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = mem.read16(0x400b); m.step(0x0446, 16);
    regs.b = 0x1c; m.step(0x0448, 7);
    regs.a = 0x10; m.step(0x044a, 7);
    m.push16(0x044b); m.step(0x0010, 11); m.call(0x0010);
    regs.de = 0x0004; m.step(0x044e, 10);
    regs.addHl(regs.de); m.step(0x044f, 11);
    regs.b = 0x1c; m.step(0x0451, 7);
    m.push16(0x0452); m.step(0x0010, 11); m.call(0x0010);
    regs.addHl(regs.de); m.step(0x0453, 11);
    mem.write16(0x400b, regs.hl); m.step(0x0456, 16);
    regs.hl = 0x4009; m.step(0x0459, 10);
    regs.decMem8(mem, regs.hl); m.step(0x045a, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x045b, 5);
    regs.l = regs.inc8(regs.l); m.step(0x045c, 4);
    regs.incMem8(mem, regs.hl); m.step(0x045d, 11);
    regs.xor(regs.a); m.step(0x045e, 4);
    mem.write8(0x7006, regs.a, 10); m.step(0x0461, 13);
    m.step(0x0464, 13); // MUTANT: dropped write to 0x7007 (flip_y)
    mem.write8(0x4018, regs.a); m.step(0x0467, 13);
    regs.de = 0x0702; m.step(0x046a, 10);
    m.push16(0x046d); m.step(0x08f2, 17); m.call(0x08f2);
    regs.de = 0x0601; m.step(0x0470, 10);
    m.push16(0x0473); m.step(0x08f2, 17); m.call(0x08f2);
    return m.call(0x0473);
  };
  const m = mk({ 0x0010: rst10, 0x08f2: pop, 0x0473: pop });
  m.mem.write16(0x400b, 0x4100);
  m.mem.write8(0x4009, 1);
  m.io.flipY = 1;
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.io.flipY, 0));
});
