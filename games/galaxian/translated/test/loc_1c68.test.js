// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1c68 (Galaxian/DK input scan, ROM 0x1C68-0x1C72):
//   1c68  78        ld a,b         ; A = IN0 (B set by caller)
//   1c69  b1        or c           ; A = IN0 | IN1 (C set by loc_1c50)
//   1c6a  e6 10     and 0x10
//   1c6c  28 05     jr z,0x1c73
//   1c6e  3e 01     ld a,0x01
//   1c70  32 cc 41  ld (0x41cc),a
//   (falls through into loc_1c73)
// Contract:
//   * NZ path ((B|C)&0x10 != 0): 6 instr, 42 T (4+4+7+7+7+13); (0x41cc)=0x01, delegates to 0x1c73.
//   * Z  path ((B|C)&0x10 == 0): 4 instr, 27 T (4+4+7+12); no write; delegates to 0x1c73.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1c68 } from "../loc_1c68.js";

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

function run(b, c, stubs = { 0x1c73: "tail" }) {
  const m = mk(stubs);
  m.regs.b = b; m.regs.c = c;
  m.mem.write8(0x41cc, 0x00);
  const ret = loc_1c68(m);
  return { cycles: m.cycles, calls: m.calls, ret, w: m.mem.read8(0x41cc) };
}

test("loc_1c68: (B|C)&0x10 != 0 seeds (0x41cc)=0x01 and delegates to 0x1c73; 42 T", () => {
  const res = run(0x10, 0x00);
  assert.equal(res.cycles, 42, "T-state total (4+4+7+7+7+13)");
  assert.deepEqual(res.calls, [0x1c73], "falls through into loc_1c73");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates");
  assert.equal(res.w, 0x01, "ld (0x41cc),a wrote 0x01");
});

test("loc_1c68: (B|C)&0x10 == 0 skips the write (jr z taken); 27 T", () => {
  const res = run(0x00, 0x00);
  assert.equal(res.cycles, 27, "T-state total (4+4+7+12)");
  assert.deepEqual(res.calls, [0x1c73], "falls through into loc_1c73");
  assert.equal(res.w, 0x00, "no write on the Z path");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1c68.js
//   find: mem.write8(0x41cc, regs.a);
//   repl: mem.write8(0x41cd, regs.a);
//   expect: FAIL  (writes the wrong cell -- caught by (0x41cc) == 0x01)
test("loc_1c68: the contract catches a wrong store address", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = regs.b;
    m.step(0x1c69, 4);
    regs.or(regs.c);
    m.step(0x1c6a, 4);
    regs.and(0x10);
    m.step(0x1c6c, 7);
    if (regs.fZ) { m.step(0x1c73, 12); return m.call(0x1c73); }
    m.step(0x1c6e, 7);
    regs.a = 0x01;
    m.step(0x1c70, 7);
    mem.write8(0x41cd, regs.a); // MUTANT: wrong store address
    m.step(0x1c73, 13);
    return m.call(0x1c73);
  };
  const m = mk({ 0x1c73: "tail" });
  m.regs.b = 0x10; m.regs.c = 0x00;
  m.mem.write8(0x41cc, 0x00);
  mutant(m);
  assert.notEqual(m.mem.read8(0x41cc), 0x01, "mutant wrote elsewhere -- contract would fail");
});
