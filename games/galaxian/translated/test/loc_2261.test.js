// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2261 (ROM 0x2261-0x2278): render 3 BCD bytes at (DE) as 6 digits into VIDEORAM (IX)
// via loc_2279, HL walking the source down. Contract with DE=0x40a4 in: DE becomes -0x20 stride (ex de,hl),
// HL ends at 0x40a1 (3x dec), six calls [0x2279], A = last (HL) read = mem[0x40a2]; 282 T; ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2261 } from "../loc_2261.js";

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
// loc_2279 pops the return address this routine pushed for each `call`, so the stack stays balanced.
const rst2279 = (mm) => { mm.pop16(); };

test("loc_2261: 3-byte BCD render loop -> six loc_2279 calls; 282 T", () => {
  const m = mk({ 0x2279: rst2279 });
  m.regs.de = 0x40a4; // caller's BCD source pointer
  m.mem.write8(0x40a4, 0x12);
  m.mem.write8(0x40a3, 0x34);
  m.mem.write8(0x40a2, 0x5a);
  m.push16(0x9999); // caller return for loc_2261's own ret
  loc_2261(m);
  assert.equal(m.cycles, 282, "setup 28 + 3 loops (83+83+78) + ret 10");
  assert.deepEqual(m.calls, [0x2279, 0x2279, 0x2279, 0x2279, 0x2279, 0x2279], "6 digits");
  assert.equal(m.regs.de, 0xffe0, "ex de,hl -> DE = -0x20 add-ix stride");
  assert.equal(m.regs.hl, 0x40a1, "HL walked down 3 bytes");
  assert.equal(m.regs.a, 0x5a, "A = last (HL) read = mem[0x40a2]");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2261.js
//   find: regs.b = 0x03;
//   repl: regs.b = 0x02;
//   expect: FAIL (only 4 loc_2279 calls; caught by the calls deepEqual)
test("loc_2261: the contract catches a wrong byte count", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0xffe0; m.step(0x2264, 10);
    regs.exDeHl(); m.step(0x2265, 4);
    regs.b = 0x02; m.step(0x2267, 7); // MUTANT: 2 bytes not 3
    regs.c = 0x04; m.step(0x2269, 7);
    for (;;) {
      regs.a = mem.read8(regs.hl); m.step(0x226a, 7);
      regs.rrca(); m.step(0x226b, 4);
      regs.rrca(); m.step(0x226c, 4);
      regs.rrca(); m.step(0x226d, 4);
      regs.rrca(); m.step(0x226e, 4);
      m.push16(0x2271); m.step(0x2279, 17); m.call(0x2279);
      regs.a = mem.read8(regs.hl); m.step(0x2272, 7);
      m.push16(0x2275); m.step(0x2279, 17); m.call(0x2279);
      regs.hl = (regs.hl - 1) & 0xffff; m.step(0x2276, 6);
      if (regs.djnz() !== 0) { m.step(0x2269, 13); continue; }
      m.step(0x2278, 8); break;
    }
    m.ret();
  };
  const m = mk({ 0x2279: rst2279 });
  m.regs.de = 0x40a4;
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x2279, 0x2279, 0x2279, 0x2279, 0x2279, 0x2279]));
});
