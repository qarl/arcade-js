// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_116b (ROM 0x116b-0x11af): 16-bit vector integrator over ((ix+0x18)&3)+1 iterations
// on H:D / L:E accumulators, written back to (ix+0x19..0x1c). Contract below is one iteration (B=1) with a
// hand-traced input: 339 T, no m.calls.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_116b } from "../loc_116b.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  return m;
}

// Struct: B=1 (0x4218&3==0 -> +1); H0=0x22 L0=0x40 D0=0x00 E0=0x00.
// Hand trace of one iteration -> H=0x22, L=0x3F, D=0x80, E=0xBC.
function seed(m) {
  m.mem.write8(0x4218, 0x00); // (ix+0x18)
  m.mem.write8(0x4219, 0x22); // (ix+0x19) H
  m.mem.write8(0x421a, 0x40); // (ix+0x1a) L
  m.mem.write8(0x421b, 0x00); // (ix+0x1b) D
  m.mem.write8(0x421c, 0x00); // (ix+0x1c) E
}

test("loc_116b: one iteration integrates H:D/L:E and writes back; 339 T", () => {
  const m = mk();
  seed(m);
  m.push16(0x9999);
  loc_116b(m);
  assert.equal(m.mem.read8(0x4219), 0x22, "(ix+0x19) H");
  assert.equal(m.mem.read8(0x421a), 0x3f, "(ix+0x1a) L");
  assert.equal(m.mem.read8(0x421b), 0x80, "(ix+0x1b) D");
  assert.equal(m.mem.read8(0x421c), 0xbc, "(ix+0x1c) E");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.equal(m.cycles, 339, "hand-summed T-states for the B=1 path");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_116b.js
//   find: regs.neg(); m.step(0x1192, 8);   (the 0x1190 neg)
//   repl: m.step(0x1192, 8);               (drop the neg -- A stays 0x22)
//   expect: FAIL (no dec l, L stays 0x40, D/E differ)
test("loc_116b: contract catches a dropped `neg` (wrong L/E)", () => {
  const m = mk();
  seed(m);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.a = mem.read8(regs.ix + 0x18); mm.step(0x116e, 19);
    regs.and(0x03); mm.step(0x1170, 7);
    regs.a = regs.inc8(regs.a); mm.step(0x1171, 4);
    regs.b = regs.a; mm.step(0x1172, 4);
    regs.h = mem.read8(regs.ix + 0x19); mm.step(0x1175, 19);
    regs.l = mem.read8(regs.ix + 0x1a); mm.step(0x1178, 19);
    regs.d = mem.read8(regs.ix + 0x1b); mm.step(0x117b, 19);
    regs.e = mem.read8(regs.ix + 0x1c); mm.step(0x117e, 19);
    for (;;) {
      regs.a = regs.l; mm.step(0x117f, 4);
      regs.c = regs.h; mm.step(0x1180, 4);
      regs.add(regs.a); mm.step(0x1181, 4);
      if (regs.fNC) { mm.step(0x1184, 12); } else { mm.step(0x1183, 7); regs.h = regs.dec8(regs.h); mm.step(0x1184, 4); }
      regs.add(regs.d); mm.step(0x1185, 4);
      regs.d = regs.a; mm.step(0x1186, 4);
      regs.a = 0x00; mm.step(0x1188, 7);
      regs.adc(regs.h); mm.step(0x1189, 4);
      regs.cp(0x80); mm.step(0x118b, 7);
      if (regs.fNZ) { mm.step(0x118e, 12); } else { mm.step(0x118d, 7); regs.a = regs.c; mm.step(0x118e, 4); }
      regs.h = regs.a; mm.step(0x118f, 4);
      regs.c = regs.l; mm.step(0x1190, 4);
      mm.step(0x1192, 8); // MUTANT: dropped `neg`
      regs.add(regs.a); mm.step(0x1193, 4);
      if (regs.fNC) { mm.step(0x1196, 12); } else { mm.step(0x1195, 7); regs.l = regs.dec8(regs.l); mm.step(0x1196, 4); }
      regs.add(regs.e); mm.step(0x1197, 4);
      regs.e = regs.a; mm.step(0x1198, 4);
      regs.a = 0x00; mm.step(0x119a, 7);
      regs.adc(regs.l); mm.step(0x119b, 4);
      regs.cp(0x80); mm.step(0x119d, 7);
      if (regs.fNZ) { mm.step(0x11a0, 12); } else { mm.step(0x119f, 7); regs.a = regs.c; mm.step(0x11a0, 4); }
      regs.l = regs.a; mm.step(0x11a1, 4);
      if (regs.djnz() !== 0) { mm.step(0x117e, 13); continue; }
      mm.step(0x11a3, 8); break;
    }
    mem.write8(regs.ix + 0x19, regs.h); mm.step(0x11a6, 19);
    mem.write8(regs.ix + 0x1a, regs.l); mm.step(0x11a9, 19);
    mem.write8(regs.ix + 0x1b, regs.d); mm.step(0x11ac, 19);
    mem.write8(regs.ix + 0x1c, regs.e); mm.step(0x11af, 19);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x421a), 0x3f));
});
