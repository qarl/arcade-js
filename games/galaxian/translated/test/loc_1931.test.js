// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1931 (Galaxian 0x4003/0x4004 timer tick, ROM 0x1931-0x194e):
//   1931  21 03 40  ld hl,0x4003 ; ld a,(hl) ; and a
//   1936  20 3c     jr nz,0x1974     ; timer not expired
//   1938  2c b6 c8  inc l ; or (hl) ; ret z   ; 0x4004 == 0 -> ret
//   193b  35 2d ... dec (hl) ; dec l ; ld (hl),0x0f  ; 0x4004-- , reload 0x4003
//   193f  3a 00 40  ld a,(0x4000) ; cp 0x03 ; ret z   ; mode 3
//   1945  3d 28 1c  dec a ; jr z,0x1964            ; mode 1
//   1948  21 02 40  ld hl,0x4002 ; dec a            ; Z when mode 2
//   194c  cc 4f 19  call z,0x194f  ; then falls through into loc_194f (runs twice on mode 2)
// Contract (mode 2, 0x4003=0, 0x4004=5): 136 T, calls [0x194f, 0x194f], 0x4004->4, 0x4003->0x0f.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1931 } from "../loc_1931.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, spec] of Object.entries(stubs)) routines.set(Number(a), spec);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

const RET = (v) => (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; return v; }; // stub subroutine that rets

function checkSpec(r) {
  assert.equal(r.cycles, 136, "T-state total of the mode-2 call-z path");
  assert.deepEqual(r.calls, [0x194f, 0x194f], "call z,0x194f THEN fall-through: loc_194f runs twice");
  assert.equal(r.c04, 0x04, "0x4004 decremented (5 -> 4)");
  assert.equal(r.c03, 0x0f, "0x4003 reloaded to 0x0f");
}

test("loc_1931: mode 2 runs loc_194f twice (call z + fall-through); 136 T", () => {
  const m = mk({ 0x194f: RET("R") });
  m.mem.write8(0x4003, 0x00); m.mem.write8(0x4004, 0x05); m.mem.write8(0x4000, 0x02);
  loc_1931(m);
  checkSpec({ cycles: m.cycles, calls: m.calls, c04: m.mem.read8(0x4004), c03: m.mem.read8(0x4003) });
});

test("loc_1931: 0x4003 nonzero tail-branches to loc_1974", () => {
  const m = mk({ 0x1974: () => "T1974" });
  m.mem.write8(0x4003, 0x05);
  const ret = loc_1931(m);
  assert.equal(m.cycles, 10 + 7 + 4 + 12, "ld hl + ld a + and a + jr nz(taken)");
  assert.deepEqual(m.calls, [0x1974], "jr nz,0x1974");
  assert.equal(ret, "T1974", "tail-branch result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1931.js
//   find: if (regs.fZ) {\n    m.push16(0x194f); // call z,0x194f (taken)
//   repl: if (regs.fNZ) {   (wrong call-z condition)
//   expect: FAIL  (mode 2 no longer takes the call -> loc_194f runs ONCE, 129 T)
//   verified-anchor: count == 1  (the sole call-z condition guarding push16(0x194f))
test("loc_1931: the contract catches a wrong call-z condition", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4003; m.step(0x1934, 10);
    regs.a = mem.read8(regs.hl); m.step(0x1935, 7);
    regs.and(regs.a); m.step(0x1936, 4);
    if (regs.fNZ) { m.step(0x1974, 12); return m.call(0x1974); }
    m.step(0x1938, 7);
    regs.l = regs.inc8(regs.l); m.step(0x1939, 4);
    regs.or(mem.read8(regs.hl)); m.step(0x193a, 7);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x193b, 5);
    regs.decMem8(mem, regs.hl); m.step(0x193c, 11);
    regs.l = regs.dec8(regs.l); m.step(0x193d, 4);
    mem.write8(regs.hl, 0x0f); m.step(0x193f, 10);
    regs.a = mem.read8(0x4000); m.step(0x1942, 13);
    regs.cp(0x03); m.step(0x1944, 7);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x1945, 5);
    regs.a = regs.dec8(regs.a); m.step(0x1946, 4);
    if (regs.fZ) { m.step(0x1964, 12); return m.call(0x1964); }
    m.step(0x1948, 7);
    regs.hl = 0x4002; m.step(0x194b, 10);
    regs.a = regs.dec8(regs.a); m.step(0x194c, 4);
    if (regs.fNZ) { m.push16(0x194f); m.step(0x194f, 17); m.call(0x194f); } // MUTANT: wrong condition
    else { m.step(0x194f, 10); }
    return m.call(0x194f);
  };
  const m = mk({ 0x194f: RET("R") });
  m.mem.write8(0x4003, 0x00); m.mem.write8(0x4004, 0x05); m.mem.write8(0x4000, 0x02);
  mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, calls: m.calls, c04: m.mem.read8(0x4004), c03: m.mem.read8(0x4003) }));
});
