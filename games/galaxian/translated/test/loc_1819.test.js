// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1819 (ROM 0x1819-0x1839):
//   1819  3a 06 40  ld a,(0x4006)
//   181c  0f        rrca            ; carry = 0x4006 bit0
//   181d  d0        ret nc          ; gate closed -> return
//   181e  3a df 41  ld a,(0x41df)
//   1821  fe 06     cp 0x06
//   1823  c2 3a 18  jp nz,0x183a    ; selector != 6 -> alternate arm
//   1826  3a cd 41  ld a,(0x41cd)
//   1829  0f        rrca            ; carry = 0x41cd bit0
//   182a  d8        ret c           ; already active -> return
//   182b  3e 01     ld a,0x01
//   182d  32 cf 41  ld (0x41cf),a   ; =1
//   1830  32 d6 41  ld (0x41d6),a   ; =1
//   1833  21 bd 1e  ld hl,0x1ebd
//   1836  22 d3 41  ld (0x41d3),hl  ; sequence pointer
//   1839  c9        ret
// Gate closed: 28 T (13+4+11). Dispatch: 52 T (13+4+5+13+7+10) -> loc_183a. Arm: 143 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1819 } from "../loc_1819.js";

function mk(stub183a) {
  const routines = new Map();
  if (stub183a) routines.set(0x183a, stub183a);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.mem.write8(0x4400, 0x34); m.mem.write8(0x4401, 0x12); // caller return = 0x1234
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_1819: 0x4006 bit0 clear -> ret nc; 28 T, no arm", () => {
  const m = mk();
  m.mem.write8(0x4006, 0x00); // bit0 = 0
  loc_1819(m);
  assert.equal(m.cycles, 28, "13 + 4 + 11");
  assert.equal(m.pc, 0x1234, "ret nc returned to the caller");
  assert.equal(m.mem.read16(0x41d3), 0, "no sequence armed");
});

test("loc_1819: selector != 6 -> tail to loc_183a with A; 52 T", () => {
  const seen = {};
  const m = mk((mm) => { seen.a = mm.regs.a; });
  m.mem.write8(0x4006, 0x01); // gate open
  m.mem.write8(0x41df, 0x16); // selector != 6
  loc_1819(m);
  assert.equal(m.cycles, 52, "13 + 4 + 5 + 13 + 7 + 10");
  assert.deepEqual(m.calls, [0x183a], "jp nz -> loc_183a");
  assert.equal(seen.a, 0x16, "A handed on = 0x41df (cp does not change A)");
});

test("loc_1819: selector 6 + inactive -> arm 0x1ebd sequence; 143 T", () => {
  const m = mk();
  m.mem.write8(0x4006, 0x01); // gate open
  m.mem.write8(0x41df, 0x06); // selector == 6
  m.mem.write8(0x41cd, 0x00); // bit0 clear -> not active
  loc_1819(m);
  assert.equal(m.cycles, 143, "full arm path");
  assert.equal(m.mem.read8(0x41cf), 1, "0x41cf = 1");
  assert.equal(m.mem.read8(0x41d6), 1, "0x41d6 = 1");
  assert.equal(m.mem.read16(0x41d3), 0x1ebd, "0x41d3 = sequence pointer 0x1ebd");
  assert.equal(m.pc, 0x1234, "ret to the caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1819.js
//   find: regs.hl = 0x1ebd;
//   repl: regs.hl = 0x1ebc;
//   expect: FAIL ((0x41d3) becomes 0x1ebc, caught by the 0x1ebd assert)
test("loc_1819: the contract catches a wrong sequence pointer", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4006); m.step(0x181c, 13);
    regs.rrca(); m.step(0x181d, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x181e, 5);
    regs.a = mem.read8(0x41df); m.step(0x1821, 13);
    regs.cp(0x06); m.step(0x1823, 7);
    if (regs.fNZ) { m.step(0x183a, 10); return m.call(0x183a); }
    m.step(0x1826, 10);
    regs.a = mem.read8(0x41cd); m.step(0x1829, 13);
    regs.rrca(); m.step(0x182a, 4);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x182b, 5);
    regs.a = 0x01; m.step(0x182d, 7);
    mem.write8(0x41cf, regs.a); m.step(0x1830, 13);
    mem.write8(0x41d6, regs.a); m.step(0x1833, 13);
    regs.hl = 0x1ebc; m.step(0x1836, 10); // MUTANT
    mem.write16(0x41d3, regs.hl); m.step(0x1839, 16);
    return m.ret();
  };
  const m = mk();
  m.mem.write8(0x4006, 0x01);
  m.mem.write8(0x41df, 0x06);
  m.mem.write8(0x41cd, 0x00);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read16(0x41d3), 0x1ebd));
});
