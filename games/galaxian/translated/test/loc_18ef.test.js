// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_18ef (Galaxian mode-gated status fold, ROM 0x18ef-0x1916):
//   18ef  3a 00 40  ld a,(0x4000)   ; mode
//   18f2  fe 03     cp 0x03
//   18f4  28 21     jr z,0x1917     ; mode 3
//   18f6  21 10 40  ld hl,0x4010
//   18f9  7e ...    fold 0x4010|0x4013, cpl, &0x4015, &0x4016
//   1904  cb 7f     bit 7,a
//   1906  20 16     jr nz,0x191e    ; bit7 set
//   1908  e6 03     and 0x03 ; ret z ; 0x4004++ ; bit0 ; ret z ; and 0x02 ; ret z ; 0x4004++ ; ret
// Contract (mode 0; fold -> A=0x03, bit7 clear, both low bits set): 187 T, no calls, 0x4004 += 2.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_18ef } from "../loc_18ef.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) routines.set(Number(a), () => k);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; // RAM so m.ret's pop lands in work RAM
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function seedFold(m, { mode = 0, c10 = 0x00, c13 = 0x00, c15 = 0x03, c16 = 0x03, c04 = 0x00 } = {}) {
  m.mem.write8(0x4000, mode);
  m.mem.write8(0x4010, c10);
  m.mem.write8(0x4013, c13);
  m.mem.write8(0x4015, c15);
  m.mem.write8(0x4016, c16);
  m.mem.write8(0x4004, c04);
}

function checkSpec(r) {
  assert.equal(r.cycles, 187, "T-state total of the full both-bits path");
  assert.deepEqual(r.calls, [], "no tail-branch: straight-line to ret");
  assert.equal(r.c04, 0x02, "0x4004 incremented twice (bit0 and bit1 both set)");
}

test("loc_18ef: full fold path bumps 0x4004 twice; 187 T", () => {
  const m = mk();
  seedFold(m);
  loc_18ef(m);
  checkSpec({ cycles: m.cycles, calls: m.calls, c04: m.mem.read8(0x4004) });
});

test("loc_18ef: mode 3 tail-branches to loc_1917", () => {
  const m = mk({ 0x1917: "M1917" });
  seedFold(m, { mode: 0x03 });
  const ret = loc_18ef(m);
  assert.equal(m.cycles, 13 + 7 + 12, "ld + cp + jr z(taken)");
  assert.deepEqual(m.calls, [0x1917], "jr z,0x1917");
  assert.equal(ret, "M1917", "tail-branch result propagates");
});

test("loc_18ef: bit7 set tail-branches to loc_191e", () => {
  const m = mk({ 0x191e: "M191E" });
  seedFold(m, { c15: 0xff, c16: 0xff }); // fold -> 0xFF, bit7 set
  const ret = loc_18ef(m);
  assert.deepEqual(m.calls, [0x191e], "jr nz,0x191e");
  assert.equal(ret, "M191E", "tail-branch result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_18ef.js
//   find: regs.and(0x02);\n  m.step(0x1914, 7);
//   repl: regs.and(0x04);\n  m.step(0x1914, 7);   (tests wrong bit -> bit1 double-inc lost)
//   expect: FAIL  (A=0x03 & 0x04 = 0 -> ret z taken -> 0x4004 bumped once, 184 T)
//   verified-anchor: count == 1  (the sole "regs.and(0x02)" in loc_18ef.js)
test("loc_18ef: the contract catches a wrong bit1 mask", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4000); m.step(0x18f2, 13);
    regs.cp(0x03); m.step(0x18f4, 7);
    if (regs.fZ) { m.step(0x1917, 12); return m.call(0x1917); }
    m.step(0x18f6, 7);
    regs.hl = 0x4010; m.step(0x18f9, 10);
    regs.a = mem.read8(regs.hl); m.step(0x18fa, 7);
    regs.l = regs.inc8(regs.l); m.step(0x18fb, 4);
    regs.l = regs.inc8(regs.l); m.step(0x18fc, 4);
    regs.l = regs.inc8(regs.l); m.step(0x18fd, 4);
    regs.or(mem.read8(regs.hl)); m.step(0x18fe, 7);
    regs.l = regs.inc8(regs.l); m.step(0x18ff, 4);
    regs.l = regs.inc8(regs.l); m.step(0x1900, 4);
    regs.cpl(); m.step(0x1901, 4);
    regs.and(mem.read8(regs.hl)); m.step(0x1902, 7);
    regs.l = regs.inc8(regs.l); m.step(0x1903, 4);
    regs.and(mem.read8(regs.hl)); m.step(0x1904, 7);
    regs.bit(7, regs.a); m.step(0x1906, 8);
    if (regs.fNZ) { m.step(0x191e, 12); return m.call(0x191e); }
    m.step(0x1908, 7);
    regs.and(0x03); m.step(0x190a, 7);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x190b, 5);
    regs.hl = 0x4004; m.step(0x190e, 10);
    regs.incMem8(mem, regs.hl); m.step(0x190f, 11);
    regs.bit(0, regs.a); m.step(0x1911, 8);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x1912, 5);
    regs.and(0x04); m.step(0x1914, 7); // MUTANT: wrong bit
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x1915, 5);
    regs.incMem8(mem, regs.hl); m.step(0x1916, 11);
    return m.ret();
  };
  const m = mk();
  seedFold(m);
  mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, calls: m.calls, c04: m.mem.read8(0x4004) }));
});
