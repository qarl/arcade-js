// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_191e (Galaxian bit7 branch, ROM 0x191e-0x1930):
//   191e  21 02 40  ld hl,0x4002
//   1921  7e        ld a,(hl)
//   1922  fe 63     cp 0x63
//   1924  d0        ret nc          ; at/above cap
//   1925  34        inc (hl)        ; 0x4002++
//   1926  3e 01 ... ld a,1 ; ld (0x41c9),a ; ld de,0x0701
//   192e  c3 f2 08  jp 0x08f2       ; enqueue command word
// Contract (0x4002 below cap): 80 T, tail-calls loc_08f2, 0x4002++, 0x41c9 = 1.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_191e } from "../loc_191e.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) routines.set(Number(a), () => k);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function checkSpec(r) {
  assert.equal(r.cycles, 80, "T-state total of the enqueue path");
  assert.deepEqual(r.calls, [0x08f2], "tail-jump into loc_08f2");
  assert.equal(r.ret, "Q", "the tail-jump's callee result propagates");
  assert.equal(r.c02, 0x11, "0x4002 incremented (0x10 -> 0x11)");
  assert.equal(r.flag, 0x01, "0x41c9 = 1");
}

test("loc_191e: below cap bumps 0x4002, sets 0x41c9, enqueues via loc_08f2; 80 T", () => {
  const m = mk({ 0x08f2: "Q" });
  m.mem.write8(0x4002, 0x10);
  const ret = loc_191e(m);
  checkSpec({ cycles: m.cycles, calls: m.calls, ret, c02: m.mem.read8(0x4002), flag: m.mem.read8(0x41c9) });
});

test("loc_191e: at cap returns via ret nc, no enqueue", () => {
  const m = mk();
  m.mem.write8(0x4002, 0x63);
  loc_191e(m);
  assert.equal(m.cycles, 10 + 7 + 7 + 11, "ld hl + ld a + cp + ret nc(taken)");
  assert.deepEqual(m.calls, [], "no enqueue when at cap");
  assert.equal(m.mem.read8(0x4002), 0x63, "counter untouched");
  assert.equal(m.mem.read8(0x41c9), 0x00, "flag untouched");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_191e.js
//   find: mem.write8(0x41c9, regs.a);
//   repl: mem.write8(0x41ca, regs.a);   (wrong flag cell)
//   expect: FAIL  (0x41c9 stays 0 -- caught by flag == 0x01)
//   verified-anchor: count == 1  (the sole 0x41c9 write in loc_191e.js)
test("loc_191e: the contract catches a wrong flag cell", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4002; m.step(0x1921, 10);
    regs.a = mem.read8(regs.hl); m.step(0x1922, 7);
    regs.cp(0x63); m.step(0x1924, 7);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x1925, 5);
    regs.incMem8(mem, regs.hl); m.step(0x1926, 11);
    regs.a = 0x01; m.step(0x1928, 7);
    mem.write8(0x41ca, regs.a); m.step(0x192b, 13); // MUTANT: wrong cell
    regs.de = 0x0701; m.step(0x192e, 10);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = mk({ 0x08f2: "Q" });
  m.mem.write8(0x4002, 0x10);
  const ret = mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, calls: m.calls, ret, c02: m.mem.read8(0x4002), flag: m.mem.read8(0x41c9) }));
});
