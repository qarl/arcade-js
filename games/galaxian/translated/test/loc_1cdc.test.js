// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1cdc (Galaxian descriptor-record unstack, ROM 0x1cdc-0x1cea):
//   ld e,(hl)/inc hl/ld d,(hl)/inc hl/push de/djnz  ; push B(=2) 16-bit words from (HL)
//   ld b,(hl)                                        ; draw count = record's 5th byte
//   exx/pop hl/pop de/ld bc,0xffe0/exx               ; HL'=dest, DE'=source, BC'=-0x20, B=count
//   -> fall through into loc_1ceb
// Contract: record {word0,word1,count} at HL; after -> main B=count, HL=base+4; shadow HL'=word1 (dest),
//   DE'=word0 (source), BC'=0xffe0; 140 T; fall-through -> m.call(0x1ceb).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1cdc } from "../loc_1cdc.js";

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

// Record at 0x4100: word0=0x1234, word1=0x5678, count=0x10. SP into work RAM for the push/pop.
function run(fn, stubs = { 0x1ceb: "tail" }) {
  const m = mk(stubs);
  for (const [a, v] of [[0x4100, 0x34], [0x4101, 0x12], [0x4102, 0x78], [0x4103, 0x56], [0x4104, 0x10]])
    m.mem.write8(a, v);
  m.regs.hl = 0x4100; m.regs.b = 0x02; m.regs.sp = 0x4400;
  const ret = fn(m);
  const mainB = m.regs.b, mainHl = m.regs.hl, sp = m.regs.sp;
  m.regs.exx(); // peek the shadow bank the draw loop will run on
  return { cycles: m.cycles, calls: m.calls, ret, mainB, mainHl, sp,
    shHl: m.regs.hl, shDe: m.regs.de, shBc: m.regs.bc };
}

function checkSpec(res) {
  assert.equal(res.cycles, 140, "T-state total (50 + 45 + 45)");
  assert.deepEqual(res.calls, [0x1ceb], "falls through into loc_1ceb");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates out");
  assert.equal(res.mainB, 0x10, "main B = draw count (record byte 5)");
  assert.equal(res.mainHl, 0x4104, "HL advanced 2 words to the count byte");
  assert.equal(res.sp, 0x4400, "two pushes balanced by two pops");
  assert.equal(res.shHl, 0x5678, "shadow HL' = word1 (last pushed) = dest");
  assert.equal(res.shDe, 0x1234, "shadow DE' = word0 = source");
  assert.equal(res.shBc, 0xffe0, "shadow BC' = -0x20 column stride");
}

test("loc_1cdc: unstacks the record into the shadow bank, falls through to loc_1ceb; 140 T", () => {
  checkSpec(run(loc_1cdc));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1cdc.js
//   find: regs.bc = 0xffe0;\n  m.step(0x1cea, 10); // ld bc,0xffe0 -- BC' = -0x20 (one column up per write)
//   repl: regs.bc = 0x0020;\n  m.step(0x1cea, 10); // ld bc
//   expect: FAIL  (shadow BC' = +0x20; caught by the shBc assert)
//   verified-anchor: count == 1  (the sole "regs.bc = 0xffe0" in loc_1cdc.js)
test("loc_1cdc: the contract catches a wrong column stride", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      regs.e = mem.read8(regs.hl); m.step(0x1cdd, 7);
      regs.hl = (regs.hl + 1) & 0xffff; m.step(0x1cde, 6);
      regs.d = mem.read8(regs.hl); m.step(0x1cdf, 7);
      regs.hl = (regs.hl + 1) & 0xffff; m.step(0x1ce0, 6);
      m.push16(regs.de); m.step(0x1ce1, 11);
      if (regs.djnz() !== 0) { m.step(0x1cdc, 13); continue; }
      m.step(0x1ce3, 8); break;
    }
    regs.b = mem.read8(regs.hl); m.step(0x1ce4, 7);
    regs.exx(); m.step(0x1ce5, 4);
    regs.hl = m.pop16(); m.step(0x1ce6, 10);
    regs.de = m.pop16(); m.step(0x1ce7, 10);
    regs.bc = 0x0020; m.step(0x1cea, 10); // MUTANT: +0x20 stride
    regs.exx(); m.step(0x1ceb, 4);
    return m.call(0x1ceb);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
