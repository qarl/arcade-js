// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1c50 (Galaxian/DK input scan, ROM 0x1C50-0x1C5C):
//   1c50  3a 00 68  ld a,(0x6800)  ; A = IN1
//   1c53  4f        ld c,a         ; C = IN1 (full byte)
//   1c54  e6 03     and 0x03
//   1c56  28 05     jr z,0x1c5d
//   1c58  3e 16     ld a,0x16
//   1c5a  32 df 41  ld (0x41df),a
//   (falls through into loc_1c5d)
// Contract:
//   * NZ path (IN1&3 != 0): 6 instr, 51 T (13+4+7+7+7+13); C=IN1, (0x41df)=0x16, delegates to 0x1c5d.
//   * Z  path (IN1&3 == 0): 4 instr, 36 T (13+4+7+12); no write; delegates to 0x1c5d.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1c50 } from "../loc_1c50.js";

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

function run(in1, stubs = { 0x1c5d: "tail" }) {
  const m = mk(stubs);
  m.io.in1 = in1;
  m.mem.write8(0x41df, 0x00); // clear the target so a write is observable
  const ret = loc_1c50(m);
  return { cycles: m.cycles, calls: m.calls, ret, c: m.regs.c, w: m.mem.read8(0x41df) };
}

test("loc_1c50: IN1&3 != 0 seeds (0x41df)=0x16 and delegates to 0x1c5d; 51 T", () => {
  const res = run(0x01);
  assert.equal(res.cycles, 51, "T-state total (13+4+7+7+7+13)");
  assert.deepEqual(res.calls, [0x1c5d], "falls through into loc_1c5d");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates");
  assert.equal(res.c, 0x01, "ld c,a -- C holds the full IN1 byte");
  assert.equal(res.w, 0x16, "ld (0x41df),a wrote 0x16");
});

test("loc_1c50: IN1&3 == 0 skips the write (jr z taken) and delegates to 0x1c5d; 36 T", () => {
  const res = run(0x00);
  assert.equal(res.cycles, 36, "T-state total (13+4+7+12)");
  assert.deepEqual(res.calls, [0x1c5d], "falls through into loc_1c5d");
  assert.equal(res.c, 0x00, "C = IN1 = 0");
  assert.equal(res.w, 0x00, "no write on the Z path");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1c50.js
//   find: regs.a = 0x16;
//   repl: regs.a = 0x17;
//   expect: FAIL  (writes 0x17 -- caught by (0x41df) == 0x16)
test("loc_1c50: the contract catches a wrong seed value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x6800);
    m.step(0x1c53, 13);
    regs.c = regs.a;
    m.step(0x1c54, 4);
    regs.and(0x03);
    m.step(0x1c56, 7);
    if (regs.fZ) { m.step(0x1c5d, 12); return m.call(0x1c5d); }
    m.step(0x1c58, 7);
    regs.a = 0x17; // MUTANT: wrong seed value
    m.step(0x1c5a, 7);
    mem.write8(0x41df, regs.a);
    m.step(0x1c5d, 13);
    return m.call(0x1c5d);
  };
  const m = mk({ 0x1c5d: "tail" });
  m.io.in1 = 0x01;
  mutant(m);
  assert.notEqual(m.mem.read8(0x41df), 0x16, "mutant wrote the wrong value -- contract would fail");
});
