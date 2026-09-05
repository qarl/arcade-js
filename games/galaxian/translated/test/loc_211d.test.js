// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_211d (Galaxian, ROM 0x211d-0x2130): saves AF; if B >= 0x70 tail-jumps to the
// clamp 0x210a, else B = (swap-nibbles(0x425f) + B + C) & 0x03, restores AF, ret.
// Contract: fall-through = 97 T, B folded; taken path = 34 T + m.call(0x210a).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_211d } from "../loc_211d.js";

const RET = 0x1234;

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) routines.set(Number(a), () => k);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; m.push16(RET);
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_211d: B<0x70 folds B=(nibbleswap(0x425f)+B+C)&3, restores AF; 97 T", () => {
  const m = mk();
  m.regs.b = 0x10; m.regs.c = 0x02; m.regs.a = 0x55; m.regs.f = 0x00;
  m.mem.write8(0x425f, 0x40); // swap-nibbles -> 0x04; +0x10 +0x02 = 0x16; &3 = 0x02
  const entryAf = m.regs.af;
  loc_211d(m);
  assert.equal(m.cycles, 97, "fall-through T-state total");
  assert.equal(m.pc, RET, "ret to caller");
  assert.equal(m.regs.b, 0x02, "B folded to 2 bits");
  assert.equal(m.regs.af, entryAf, "push/pop af preserved the caller's AF");
  assert.deepEqual(m.calls, [], "no tail-call on the fall-through path");
});

test("loc_211d: B>=0x70 tail-jumps to the clamp 0x210a; 34 T", () => {
  const m = mk({ 0x210a: "TAIL" });
  m.regs.b = 0x80; m.regs.a = 0x55; m.regs.f = 0x00;
  const r = loc_211d(m);
  assert.equal(m.cycles, 34, "push af + ld a,b + cp + jr taken");
  assert.deepEqual(m.calls, [0x210a], "tail-jump into the clamp");
  assert.equal(r, "TAIL", "callee result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_211d.js
//   find: regs.and(0x03);
//   repl: regs.and(0x07);
//   expect: FAIL (0x16 & 0x07 = 0x06 != 0x02 -> caught by b == 0x02)
//   verified-anchor: count == 1 (the sole `regs.and(0x03)`)
test("loc_211d: the contract catches a wrong fold mask", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(regs.af); m.step(0x211e, 11);
    regs.a = regs.b; m.step(0x211f, 4);
    regs.cp(0x70); m.step(0x2121, 7);
    if (regs.fNC) { m.step(0x210a, 12); return m.call(0x210a); }
    m.step(0x2123, 7);
    regs.a = mem.read8(0x425f); m.step(0x2126, 13);
    regs.rrca(); m.step(0x2127, 4);
    regs.rrca(); m.step(0x2128, 4);
    regs.rrca(); m.step(0x2129, 4);
    regs.rrca(); m.step(0x212a, 4);
    regs.add(regs.b); m.step(0x212b, 4);
    regs.add(regs.c); m.step(0x212c, 4);
    regs.and(0x07); m.step(0x212e, 7); // MUTANT: mask 0x07 not 0x03
    regs.b = regs.a; m.step(0x212f, 4);
    regs.af = m.pop16(); m.step(0x2130, 10);
    m.ret();
  };
  const m = mk();
  m.regs.b = 0x10; m.regs.c = 0x02; m.regs.a = 0x55; m.regs.f = 0x00;
  m.mem.write8(0x425f, 0x40);
  mutant(m);
  assert.notEqual(m.regs.b, 0x02);
});
