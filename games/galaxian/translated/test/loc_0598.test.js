// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0598 (ROM 0x0598-0x05a4): copy B=0x20 bytes from (HL) to 0x4021, stride 2, ret.
// Contract: 10+7 setup + 31*41 (djnz taken) + 36 (last) + 10 ret = 1334 T; only even-offset dest cells
// (0x4021,0x4023,...0x405f) written, the interleaved 0x4022,0x4024,... untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0598 } from "../loc_0598.js";

const SRC = 0x4300; // work-RAM source region (avoids ROM/stack/dest)

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.push16(0x9999); // caller return
  m.regs.hl = SRC;
  for (let i = 0; i < 0x20; i++) m.mem.write8(SRC + i, 0x40 + i); // distinct source bytes
  return m;
}

test("loc_0598: copies 0x20 bytes stride 2 into 0x4021; 1334 T", () => {
  const m = mk();
  loc_0598(m);
  assert.equal(m.cycles, 1334, "setup + 32-iter loop + ret");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.equal(m.mem.read8(0x4021), 0x40, "entry 0 -> 0x4021");
  assert.equal(m.mem.read8(0x4023), 0x41, "entry 1 -> 0x4023 (stride 2)");
  assert.equal(m.mem.read8(0x405f), 0x5f, "entry 31 -> 0x405f");
  assert.equal(m.mem.read8(0x4022), 0x00, "0x4022 skipped by the stride");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0598.js
//   find: the SECOND `regs.e = regs.inc8(regs.e);` block   repl: (drop it)   (stride 1 not 2)
//   expect: FAIL (0x4022 gets written; dest becomes contiguous)
test("loc_0598: contract catches a lost stride (single inc e)", () => {
  const m = mk();
  const { regs, mem } = m;
  regs.de = 0x4021; m.step(0x059b, 10);
  regs.b = 0x20; m.step(0x059d, 7);
  for (;;) {
    regs.a = mem.read8(regs.hl); m.step(0x059e, 7);
    mem.write8(regs.de, regs.a); m.step(0x059f, 7);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x05a0, 6);
    regs.e = regs.inc8(regs.e); m.step(0x05a1, 4); // MUTANT: only one inc e
    if (regs.djnz() !== 0) { m.step(0x059d, 13); continue; }
    m.step(0x05a4, 8); break;
  }
  m.ret();
  assert.throws(() => assert.equal(m.mem.read8(0x4022), 0x00));
});
