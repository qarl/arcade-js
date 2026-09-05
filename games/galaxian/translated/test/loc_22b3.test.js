// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_22b3 (ROM 0x22b3-0x22cf): draw the marker row at 0x539e -- B marker tiles via 0x2593,
// then blank the rest via 0x2591 until slot counter C < 0 (ret m). Path (0x4200)==0, B=2: 252 T, calls
// [0x2593,0x2593,0x2591,0x2591,0x2591], HL=0x539e.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_22b3 } from "../loc_22b3.js";

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
// 0x2593/0x2591 draw helpers: pop the pushed return and do nothing else (they write VRAM, out of range).
const drawStub = (mm) => { mm.pop16(); };

test("loc_22b3: (0x4200)==0, B=2 -> 2 markers + 3 blanks; 252 T", () => {
  const m = mk({ 0x2593: drawStub, 0x2591: drawStub });
  m.mem.write8(0x4200, 0x00);   // draw all B markers
  m.regs.b = 0x02;
  m.push16(0x9999);
  loc_22b3(m);
  assert.equal(m.cycles, 252, "full-path T-total");
  assert.equal(m.regs.hl, 0x539e, "HL = marker-row VRAM cell");
  assert.deepEqual(m.calls, [0x2593, 0x2593, 0x2591, 0x2591, 0x2591], "2 marker draws + 3 blanks");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_22b3.js
//   find: if (regs.fM) {   repl: if (regs.fZ) {
//   expect: FAIL -- blank loop would stop at C==0 not C<0, one fewer 0x2591 draw (caught by the calls assert)
test("loc_22b3: contract catches the wrong blank-loop terminator", () => {
  const m = mk({ 0x2593: drawStub, 0x2591: drawStub });
  m.mem.write8(0x4200, 0x00);
  m.regs.b = 0x02;
  m.push16(0x9999);
  const { regs, mem } = m;
  regs.hl = 0x539e; m.step(0x22b6, 10);
  regs.c = 0x05; m.step(0x22b8, 7);
  regs.a = mem.read8(0x4200); m.step(0x22bb, 13);
  regs.and(regs.a); m.step(0x22bc, 4);
  m.step(0x22c1, 12); // jr z taken
  for (;;) {
    regs.a = 0x66; m.step(0x22c3, 7);
    m.push16(0x22c6); m.step(0x2593, 17); m.call(0x2593);
    regs.c = regs.dec8(regs.c); m.step(0x22c7, 4);
    if (regs.djnz() !== 0) { m.step(0x22c1, 13); continue; }
    m.step(0x22c9, 8); break;
  }
  for (;;) {
    regs.c = regs.dec8(regs.c); m.step(0x22ca, 4);
    if (regs.fZ) { m.ret(11); break; } // MUTANT: fZ instead of fM
    m.step(0x22cb, 5);
    m.push16(0x22ce); m.step(0x2591, 17); m.call(0x2591);
    m.step(0x22c9, 12);
  }
  assert.throws(() => assert.deepEqual(m.calls, [0x2593, 0x2593, 0x2591, 0x2591, 0x2591]));
});
