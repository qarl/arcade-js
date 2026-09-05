// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1876 (ROM 0x1876-0x1885):
//   1876  21 c9 41  ld hl,0x41c9
//   1879  7e        ld a,(hl)
//   187a  3d        dec a
//   187b  c2 86 18  jp nz,0x1886
//   187e  77        ld (hl),a
//   187f  21 20 00  ld hl,0x0020
//   1882  22 ca 41  ld (0x41ca),hl
//   1885  c9        ret
// Contract A (0x41c9 == 1): 74 T (10+7+4+10+7+10+16), 0x41c9=0, word 0x41ca=0x0020, ret, no m.call.
// Contract B (0x41c9 != 1): 31 T (10+7+4+10), delegate to loc_1886.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1876 } from "../loc_1876.js";

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
  m.regs.sp = 0x4380; m.mem.write16(0x4380, 0x1234);
  return m;
}

function runA(fn) {
  const m = mk();
  m.mem.write8(0x41c9, 0x01); // dec -> 0 -> jp nz not taken (expire path)
  fn(m);
  return {
    cycles: m.cycles, calls: m.calls,
    c9: m.mem.read8(0x41c9), caLo: m.mem.read8(0x41ca), caHi: m.mem.read8(0x41cb),
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 74, "T-state total (10+7+4+10+7+10+16+10)");
  assert.deepEqual(res.calls, [], "expire path is self-contained");
  assert.equal(res.c9, 0x00, "0x41c9 reset to 0");
  assert.equal(res.caLo, 0x20, "0x41ca low byte = 0x20 (word 0x0020)");
  assert.equal(res.caHi, 0x00, "0x41cb high byte = 0x00 (word 0x0020)");
}

test("loc_1876: counter expires -> 0x41c9=0, 0x41ca word=0x0020; 74 T", () => {
  checkSpec(runA(loc_1876));
});

test("loc_1876: counter not expired -> delegate loc_1886; 31 T", () => {
  const m = mk({ 0x1886: "tail" });
  m.mem.write8(0x41c9, 0x05); // dec -> 0x04 nonzero -> jp nz taken
  const ret = loc_1876(m);
  assert.equal(m.cycles, 31, "T-state total (10+7+4+10)");
  assert.deepEqual(m.calls, [0x1886], "tail into loc_1886");
  assert.equal(ret, "TAIL", "delegated result propagates out");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1876.js
//   find: regs.hl = 0x0020;
//   repl: regs.hl = 0x0021;   (wrong reload value)
//   expect: FAIL -- checkSpec asserts 0x41ca low byte == 0x20, mutant writes 0x21
test("loc_1876: the contract catches a wrong reload value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x41c9;
    m.step(0x1879, 10);
    regs.a = mem.read8(regs.hl);
    m.step(0x187a, 7);
    regs.a = regs.dec8(regs.a);
    m.step(0x187b, 4);
    if (regs.fNZ) { m.step(0x1886, 10); return m.call(0x1886); }
    m.step(0x187e, 10);
    mem.write8(regs.hl, regs.a);
    m.step(0x187f, 7);
    regs.hl = 0x0021; // MUTANT
    m.step(0x1882, 10);
    mem.write16(0x41ca, regs.hl);
    m.step(0x1885, 16);
    m.ret();
  };
  assert.throws(() => checkSpec(runA(mutant)));
});
