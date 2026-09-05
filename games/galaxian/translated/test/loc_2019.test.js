// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2019 (Galaxian slot decode, ROM 0x2019-0x202b):
//   2019  e6 0f     and 0x0f          ; handler index (low nibble)
//   201b  4f        ld c,a
//   201c  06 00     ld b,0x00         ; BC = index
//   201e  36 ff     ld (hl),0xff      ; retire slot byte
//   2020  2c        inc l
//   2021  5e        ld e,(hl)         ; E = second byte
//   2022  36 ff     ld (hl),0xff      ; retire it too
//   2024  2c        inc l
//   2025  7d        ld a,l            ; advanced pointer
//   2026  fe c0     cp 0xc0
//   2028  30 02     jr nc,0x202c
//   202a  3e c0     ld a,0xc0         ; wrap below 0xc0
// Contract (A=0x35, HL=0x4080, mem[0x4081]=0x77): not-taken path, 78 T, A wraps to 0xc0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2019 } from "../loc_2019.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function checkSpec(m, ret) {
  assert.equal(m.cycles, 78, "T-state total (base 64 + jr-nc-not-taken 7 + ld a,0xc0 7)");
  assert.deepEqual(m.calls, [0x202c], "falls into loc_202c");
  assert.equal(ret, "TAIL", "the fall-through callee result propagates");
  assert.equal(m.mem.read8(0x4080), 0xff, "first slot byte retired");
  assert.equal(m.mem.read8(0x4081), 0xff, "second slot byte retired");
  assert.equal(m.regs.e, 0x77, "E = second byte read BEFORE it was overwritten");
  assert.equal(m.regs.c, 0x05, "C = A(0x35) & 0x0f");
  assert.equal(m.regs.b, 0x00, "B cleared");
  assert.equal(m.regs.l, 0x82, "L advanced past both bytes");
  assert.equal(m.regs.a, 0xc0, "L(0x82) < 0xc0 -> A wrapped to 0xc0");
}

test("loc_2019: decodes the slot and wraps the pointer; 78 T", () => {
  const m = mk({ 0x202c: "tail" });
  m.regs.a = 0x35; m.regs.hl = 0x4080;
  m.mem.write8(0x4081, 0x77); // E source
  checkSpec(m, loc_2019(m));
});

test("loc_2019: pointer >= 0xc0 keeps A=L (jr-nc taken); 76 T", () => {
  const m = mk({ 0x202c: "tail" });
  m.regs.a = 0x35; m.regs.hl = 0x40be; // after two inc l -> L=0xc0
  m.mem.write8(0x40bf, 0x77);
  const ret = loc_2019(m);
  assert.equal(m.cycles, 76, "base 64 + jr-nc-taken 12");
  assert.deepEqual(m.calls, [0x202c]);
  assert.equal(m.regs.a, 0xc0, "A = L (>= 0xc0), no wrap load");
  assert.equal(ret, "TAIL");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2019.js
//   find: regs.a = 0xc0;
//   repl: regs.a = 0xc1;
//   expect: FAIL  (wrong wrap base, caught by regs.a == 0xc0 in the not-taken path)
test("loc_2019: the contract catches a wrong wrap value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.and(0x0f); m.step(0x201b, 7);
    regs.c = regs.a; m.step(0x201c, 4);
    regs.b = 0x00; m.step(0x201e, 7);
    mem.write8(regs.hl, 0xff); m.step(0x2020, 10);
    regs.l = regs.inc8(regs.l); m.step(0x2021, 4);
    regs.e = mem.read8(regs.hl); m.step(0x2022, 7);
    mem.write8(regs.hl, 0xff); m.step(0x2024, 10);
    regs.l = regs.inc8(regs.l); m.step(0x2025, 4);
    regs.a = regs.l; m.step(0x2026, 4);
    regs.cp(0xc0); m.step(0x2028, 7);
    if (regs.fNC) { m.step(0x202c, 12); return m.call(0x202c); }
    m.step(0x202a, 7);
    regs.a = 0xc1; m.step(0x202c, 7); // MUTANT
    return m.call(0x202c);
  };
  const m = mk({ 0x202c: "tail" });
  m.regs.a = 0x35; m.regs.hl = 0x4080; m.mem.write8(0x4081, 0x77);
  assert.throws(() => checkSpec(m, mutant(m)));
});
