// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_184f (ROM 0x184f-0x185d):
//   184f  2a c7 41  ld hl,(0x41c7)
//   1852  cb 45     bit 0,l
//   1854  ca 5e 18  jp z,0x185e
//   1857  21 00 80  ld hl,0x8000
//   185a  22 c7 41  ld (0x41c7),hl
//   185d  c9        ret
// Contract A (bit0 set): 70 T (16+8+10+10+16+10), no m.call, the 0x41c7 word is reset to 0x8000, ret.
// Contract B (bit0 clear): 34 T (16+8+10), delegate to loc_185e.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_184f } from "../loc_184f.js";

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
  m.regs.sp = 0x4380; m.mem.write16(0x4380, 0x1234); // caller return slot for RET
  return m;
}

function runA(fn) {
  const m = mk();
  m.mem.write8(0x41c7, 0x01); m.mem.write8(0x41c8, 0x40); // word = 0x4001 (low byte odd)
  fn(m);
  return { cycles: m.cycles, calls: m.calls, lo: m.mem.read8(0x41c7), hi: m.mem.read8(0x41c8) };
}

function checkSpec(res) {
  assert.equal(res.cycles, 70, "T-state total (16+8+10+10+16+10)");
  assert.deepEqual(res.calls, [], "bit0 set: self-contained, no delegate");
  assert.equal(res.lo, 0x00, "0x41c7 low byte reset to 0x00 (word=0x8000)");
  assert.equal(res.hi, 0x80, "0x41c8 high byte reset to 0x80 (word=0x8000)");
}

test("loc_184f: bit0 set -> reset 0x41c7 word to 0x8000; 70 T", () => {
  checkSpec(runA(loc_184f));
});

test("loc_184f: bit0 clear -> delegate to loc_185e; 34 T", () => {
  const m = mk({ 0x185e: "tail" });
  m.mem.write8(0x41c7, 0x00); m.mem.write8(0x41c8, 0x03); // low byte even -> bit0 clear
  const ret = loc_184f(m);
  assert.equal(m.cycles, 34, "T-state total (16+8+10)");
  assert.deepEqual(m.calls, [0x185e], "tail into loc_185e");
  assert.equal(ret, "TAIL", "delegated result propagates out");
  assert.equal(m.mem.read8(0x41c7), 0x00, "word untouched on the delegate path");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_184f.js
//   find: regs.hl = 0x8000;
//   repl: regs.hl = 0x8001;   (wrong reset value)
//   expect: FAIL -- checkSpec asserts 0x41c7 low byte == 0x00, mutant leaves 0x01
test("loc_184f: the contract catches a wrong reset value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = mem.read16(0x41c7);
    m.step(0x1852, 16);
    regs.bit(0, regs.l);
    m.step(0x1854, 8);
    if (regs.fZ) { m.step(0x185e, 10); return m.call(0x185e); }
    m.step(0x1857, 10);
    regs.hl = 0x8001; // MUTANT
    m.step(0x185a, 10);
    mem.write16(0x41c7, regs.hl);
    m.step(0x185d, 16);
    m.ret();
  };
  assert.throws(() => checkSpec(runA(mutant)));
});
