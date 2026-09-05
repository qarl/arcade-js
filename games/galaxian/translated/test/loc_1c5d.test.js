// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1c5d (Galaxian/DK input scan, ROM 0x1C5D-0x1C67):
//   1c5d  78        ld a,b         ; A = IN0 (B set by caller)
//   1c5e  b1        or c           ; A = IN0 | IN1 (C set by loc_1c50)
//   1c5f  e6 0c     and 0x0c
//   1c61  28 05     jr z,0x1c68
//   1c63  3e 06     ld a,0x06
//   1c65  32 df 41  ld (0x41df),a
//   (falls through into loc_1c68)
// Contract:
//   * NZ path ((B|C)&0x0c != 0): 6 instr, 42 T (4+4+7+7+7+13); (0x41df)=0x06, delegates to 0x1c68.
//   * Z  path ((B|C)&0x0c == 0): 4 instr, 27 T (4+4+7+12); no write; delegates to 0x1c68.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1c5d } from "../loc_1c5d.js";

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

function run(b, c, stubs = { 0x1c68: "tail" }) {
  const m = mk(stubs);
  m.regs.b = b; m.regs.c = c;
  m.mem.write8(0x41df, 0x00);
  const ret = loc_1c5d(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a, w: m.mem.read8(0x41df) };
}

test("loc_1c5d: (B|C)&0x0c != 0 seeds (0x41df)=0x06 and delegates to 0x1c68; 42 T", () => {
  const res = run(0x04, 0x00);
  assert.equal(res.cycles, 42, "T-state total (4+4+7+7+7+13)");
  assert.deepEqual(res.calls, [0x1c68], "falls through into loc_1c68");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates");
  assert.equal(res.w, 0x06, "ld (0x41df),a wrote 0x06");
});

test("loc_1c5d: (B|C)&0x0c == 0 skips the write (jr z taken); 27 T", () => {
  const res = run(0x00, 0x00);
  assert.equal(res.cycles, 27, "T-state total (4+4+7+12)");
  assert.deepEqual(res.calls, [0x1c68], "falls through into loc_1c68");
  assert.equal(res.w, 0x00, "no write on the Z path");
});

test("loc_1c5d: the or c bit comes from C too (B clear, C set)", () => {
  const res = run(0x00, 0x08);
  assert.equal(res.w, 0x06, "bit 3 in C alone still triggers the seed");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1c5d.js
//   find: regs.and(0x0c);
//   repl: regs.and(0x08);
//   expect: FAIL  (misses bit 2 -- B=0x04,C=0 would take the Z path, no write)
test("loc_1c5d: the contract catches a wrong mask", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = regs.b;
    m.step(0x1c5e, 4);
    regs.or(regs.c);
    m.step(0x1c5f, 4);
    regs.and(0x08); // MUTANT: wrong mask (drops bit 2)
    m.step(0x1c61, 7);
    if (regs.fZ) { m.step(0x1c68, 12); return m.call(0x1c68); }
    m.step(0x1c63, 7);
    regs.a = 0x06;
    m.step(0x1c65, 7);
    mem.write8(0x41df, regs.a);
    m.step(0x1c68, 13);
    return m.call(0x1c68);
  };
  const m = mk({ 0x1c68: "tail" });
  m.regs.b = 0x04; m.regs.c = 0x00; // bit 2 set -- real routine writes, mutant skips
  m.mem.write8(0x41df, 0x00);
  mutant(m);
  assert.notEqual(m.mem.read8(0x41df), 0x06, "mutant took the wrong branch -- contract would fail");
});
