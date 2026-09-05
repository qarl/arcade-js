// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0a74 (ROM 0x0a74-0x0b0a): per-object motion/sprite update, B=7 entries, IX walks
// object structs @0x4260 (stride +10), IY walks sprite shadow @0x4081 (stride +4). Active entry (bit0 of
// (ix+0)) advances sub-position (ix+1)+=2, integrates 16-bit (ix+2/3) += sign-extended (ix+4)<<1, window-
// checks the hi byte, and writes sprite Y (iy+2) and code (iy+0). No subroutine calls.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0a74 } from "../loc_0a74.js";

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
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };
const rd = (m, a) => m.mem.workRam[a & 0x3ff];

// entry 0 active + in window; direction bit clear; entries 1-6 inactive
function scene(m) {
  wr(m, 0x425f, 0x01); // bit0 set -> skip initial double-inc struct
  wr(m, 0x4018, 0x00); // (0x4018) bit0 clear -> normal (non-flipped) branch
  wr(m, 0x4260, 0x01); // entry0 active
  wr(m, 0x4261, 0x10); // sub-position (+2 -> 0x12)
  wr(m, 0x4262, 0x00); // pos lo
  wr(m, 0x4263, 0x15); // pos hi (in [0x10,0xef] window)
  wr(m, 0x4264, 0x00); // delta 0
}

test("loc_0a74: active entry0 updates struct + sprite shadow; 2661 T, no calls", () => {
  const m = mk();
  m.push16(0x9999);
  scene(m);
  loc_0a74(m);
  assert.equal(m.cycles, 2661, "7-entry loop, entry0 active + rest inactive");
  assert.deepEqual(m.calls, [], "no subroutine calls");
  assert.equal(rd(m, 0x4261), 0x12, "(ix+1) sub-position += 2");
  assert.equal(rd(m, 0x4263), 0x15, "(ix+3) pos hi unchanged (delta 0)");
  assert.equal(rd(m, 0x4083), 0xec, "sprite Y (iy+2) = ~(ix+1)-1 = ~0x12-1 = 0xec");
  assert.equal(rd(m, 0x4081), 0xeb, "sprite code (iy+0) = ~(ix+3)+1 (B>=5) = ~0x15+1 = 0xeb");
  assert.equal(m.regs.ix, 0x42a6, "IX advanced 7*10 from 0x4260");
  assert.equal(m.regs.iy, 0x409d, "IY advanced 7*4 from 0x4081");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0a74.js
//   find (normal branch, 0x0ad0/0x0ad1):  regs.a = regs.dec8(regs.a);\n      m.step(0x0ad1, 4);
//   repl: m.step(0x0ad1, 4);   (drop the `dec a` -- sprite Y loses the -1)
//   expect: FAIL (sprite Y (0x4083) = 0xed not 0xec)
test("loc_0a74: contract catches a dropped `dec a` on sprite Y", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.ix = 0x4260; m.step(0x0a78, 14);
    regs.a = mem.read8(0x425f); m.step(0x0a7b, 13);
    regs.rrca(); m.step(0x0a7c, 4);
    if (regs.fC) { m.step(0x0a89, 12); }
    else {
      m.step(0x0a7e, 7);
      regs.incMem8(mem, regs.ix + 0x01); m.step(0x0a81, 23);
      regs.incMem8(mem, regs.ix + 0x01); m.step(0x0a84, 23);
      regs.de = 0x0005; m.step(0x0a87, 10);
      regs.addIx(regs.de); m.step(0x0a89, 15);
    }
    regs.iy = 0x4081; m.step(0x0a8d, 14);
    regs.b = 0x07; m.step(0x0a8f, 7);
    for (;;) {
      regs.bit(0, mem.read8(regs.ix + 0x00), (regs.ix + 0x00) >> 8); m.step(0x0a93, 20);
      let doClear;
      if (regs.fZ) { m.step(0x0abc, 12); doClear = true; }
      else {
        m.step(0x0a95, 7);
        regs.a = mem.read8(regs.ix + 0x01); m.step(0x0a98, 19);
        regs.add(0x02); m.step(0x0a9a, 7);
        mem.write8(regs.ix + 0x01, regs.a); m.step(0x0a9d, 19);
        regs.add(0x04); m.step(0x0a9f, 7);
        if (regs.fC) { m.step(0x0abc, 12); doClear = true; }
        else {
          m.step(0x0aa1, 7);
          regs.l = mem.read8(regs.ix + 0x02); m.step(0x0aa4, 19);
          regs.h = mem.read8(regs.ix + 0x03); m.step(0x0aa7, 19);
          regs.e = mem.read8(regs.ix + 0x04); m.step(0x0aaa, 19);
          regs.e = regs.rl(regs.e); m.step(0x0aac, 8);
          regs.sbc(regs.a); m.step(0x0aad, 4);
          regs.d = regs.a; m.step(0x0aae, 4);
          regs.addHl(regs.de); m.step(0x0aaf, 11);
          mem.write8(regs.ix + 0x02, regs.l); m.step(0x0ab2, 19);
          mem.write8(regs.ix + 0x03, regs.h); m.step(0x0ab5, 19);
          regs.a = regs.h; m.step(0x0ab6, 4);
          regs.add(0x10); m.step(0x0ab8, 7);
          regs.cp(0x20); m.step(0x0aba, 7);
          if (regs.fNC) { m.step(0x0ac6, 12); doClear = false; }
          else { m.step(0x0abc, 7); doClear = true; }
        }
      }
      if (doClear) {
        regs.xor(regs.a); m.step(0x0abd, 4);
        mem.write8(regs.ix + 0x00, regs.a); m.step(0x0ac0, 19);
        mem.write8(regs.ix + 0x01, regs.a); m.step(0x0ac3, 19);
        mem.write8(regs.ix + 0x03, regs.a); m.step(0x0ac6, 19);
      }
      regs.a = mem.read8(0x4018); m.step(0x0ac9, 13);
      regs.rrca(); m.step(0x0aca, 4);
      if (regs.fC) {
        m.step(0x0af5, 12);
        regs.a = mem.read8(regs.ix + 0x01); m.step(0x0af8, 19);
        regs.sub(0x04); m.step(0x0afa, 7);
        mem.write8(regs.iy + 0x02, regs.a); m.step(0x0afd, 19);
        regs.a = mem.read8(regs.ix + 0x03); m.step(0x0b00, 19);
        regs.cpl(); m.step(0x0b01, 4);
        regs.c = regs.a; m.step(0x0b02, 4);
        regs.a = regs.b; m.step(0x0b03, 4);
        regs.cp(0x05); m.step(0x0b05, 7);
        if (regs.fC) { m.step(0x0adf, 12); }
        else { m.step(0x0b07, 7); regs.c = regs.dec8(regs.c); m.step(0x0b08, 4); m.step(0x0adf, 10); }
      } else {
        m.step(0x0acc, 7);
        regs.a = mem.read8(regs.ix + 0x01); m.step(0x0acf, 19);
        regs.cpl(); m.step(0x0ad0, 4);
        m.step(0x0ad1, 4); // MUTANT: dropped `dec a`
        mem.write8(regs.iy + 0x02, regs.a); m.step(0x0ad4, 19);
        regs.a = mem.read8(regs.ix + 0x03); m.step(0x0ad7, 19);
        regs.cpl(); m.step(0x0ad8, 4);
        regs.c = regs.a; m.step(0x0ad9, 4);
        regs.a = regs.b; m.step(0x0ada, 4);
        regs.cp(0x05); m.step(0x0adc, 7);
        if (regs.fC) { m.step(0x0adf, 12); }
        else { m.step(0x0ade, 7); regs.c = regs.inc8(regs.c); m.step(0x0adf, 4); }
      }
      mem.write8(regs.iy + 0x00, regs.c); m.step(0x0ae2, 19);
      regs.de = 0x0005; m.step(0x0ae5, 10);
      regs.addIx(regs.de); m.step(0x0ae7, 15);
      regs.incMem8(mem, regs.ix + 0x01); m.step(0x0aea, 23);
      regs.incMem8(mem, regs.ix + 0x01); m.step(0x0aed, 23);
      regs.addIx(regs.de); m.step(0x0aef, 15);
      regs.e = regs.dec8(regs.e); m.step(0x0af0, 4);
      regs.addIy(regs.de); m.step(0x0af2, 15);
      if (regs.djnz() !== 0) { m.step(0x0a8f, 13); continue; }
      m.step(0x0af4, 8); m.ret(); return;
    }
  };
  const m = mk();
  m.push16(0x9999);
  scene(m);
  mutant(m);
  assert.throws(() => assert.equal(rd(m, 0x4083), 0xec));
});
