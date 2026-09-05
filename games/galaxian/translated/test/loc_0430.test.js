// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0430 (ROM 0x0430-0x0442): rst-0x28 state idx 1. dec (0x4019); nonzero -> tail
// loc_0473; zero -> bump (0x400a), fill 0x80 bytes at 0x4100 <- 0, ret. Contract (zero path): 94 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0430 } from "../loc_0430.js";

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

test("loc_0430: counter hits zero -> bump state, fill 0x4100; 94 T", () => {
  const m = mk({ 0x0010: rst10, 0x0473: pop });
  m.mem.write8(0x4019, 1);   // dec -> 0 (Z): fall through
  m.mem.write8(0x400a, 3);
  m.mem.write8(0x4100, 0xff); m.mem.write8(0x417f, 0xff);
  m.push16(0x9999);
  loc_0430(m);
  assert.equal(m.cycles, 94, "fall-through path T-states");
  assert.deepEqual(m.calls, [0x0010], "just the fill; no tail to 0x0473");
  assert.equal(m.mem.read8(0x4019), 0, "(0x4019) decremented to 0");
  assert.equal(m.mem.read8(0x400a), 4, "(0x400a) bumped 3 -> 4");
  assert.equal(m.mem.read8(0x4100), 0, "0x4100 span filled with 0");
  assert.equal(m.mem.read8(0x417f), 0, "0x417f (last of 0x80 bytes) filled with 0");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0430: counter stays nonzero -> tail-jump to loc_0473, no state bump", () => {
  const m = mk({ 0x0010: rst10, 0x0473: pop });
  m.mem.write8(0x4019, 5);   // dec -> 4 (NZ): tail to loc_0473
  m.mem.write8(0x400a, 3);
  m.push16(0x9999);
  loc_0430(m);
  assert.deepEqual(m.calls, [0x0473], "tail to loc_0473");
  assert.equal(m.mem.read8(0x400a), 3, "state NOT bumped on the nonzero path");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0430.js
//   find: if (regs.fNZ) { ... m.step(0x0473, 10); return m.call(0x0473); }
//   repl: invert to `if (regs.fZ)` (branch on the wrong flag)
//   expect: FAIL (zero path then tail-jumps instead of filling; nonzero path bumps state) -- caught by
//           the nonzero-path assert (calls would be [0x0010] not [0x0473])
test("loc_0430: contract catches an inverted jp-nz condition", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4019; m.step(0x0433, 10);
    regs.decMem8(mem, regs.hl); m.step(0x0434, 11);
    if (regs.fZ) { m.step(0x0473, 10); return m.call(0x0473); } // MUTANT: fZ instead of fNZ
    m.step(0x0437, 10);
    regs.hl = 0x400a; m.step(0x043a, 10);
    regs.incMem8(mem, regs.hl); m.step(0x043b, 11);
    regs.hl = 0x4100; m.step(0x043e, 10);
    regs.b = 0x80; m.step(0x0440, 7);
    regs.xor(regs.a); m.step(0x0441, 4);
    m.push16(0x0442); m.step(0x0010, 11); m.call(0x0010);
    return m.ret();
  };
  const m = mk({ 0x0010: rst10, 0x0473: pop });
  m.mem.write8(0x4019, 5); // nonzero: correct code tails to 0x0473, mutant falls through
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x0473]));
});
