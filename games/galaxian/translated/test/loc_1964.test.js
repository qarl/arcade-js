// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1964 (ROM 0x1964-0x1970):
//   1964 21 01 40  ld hl,0x4001
//   1967 cb 46     bit 0,(hl)
//   1969 28 06     jr z,0x1971      ; bit0 clear: set the flag
//   196b 36 00     ld (hl),0x00
//   196d 2c        inc l            ; HL -> 0x4002
//   196e c3 4f 19  jp 0x194f
// Contract: bit0 clear -> tail loc_1971 in 34 T (10+12+12); bit0 set -> clear 0x4001, HL=0x4002,
// tail loc_194f in 53 T (10+12+7+10+4+10).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1964 } from "../loc_1964.js";

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

test("loc_1964: 0x4001 bit0 clear -> tail loc_1971; 34 T", () => {
  const m = mk({ 0x1971: "tail" });
  m.regs.sp = 0x4400; m.mem.write8(0x4001, 0x00);
  const ret = loc_1964(m);
  assert.equal(m.cycles, 34, "T-state total 10+12+12");
  assert.deepEqual(m.calls, [0x1971], "jr z delegates to the set head");
  assert.equal(ret, "TAIL", "tail result propagates");
  assert.equal(m.mem.read8(0x4001), 0x00, "loc_1964 does not touch 0x4001 on this branch");
});

test("loc_1964: 0x4001 bit0 set -> clear 0x4001, HL=0x4002, tail loc_194f; 53 T", () => {
  const m = mk({ 0x194f: "tail" });
  m.regs.sp = 0x4400; m.mem.write8(0x4001, 0x01);
  loc_1964(m);
  assert.equal(m.cycles, 53, "T-state total 10+12+7+10+4+10");
  assert.deepEqual(m.calls, [0x194f], "jp delegates to the advance head");
  assert.equal(m.mem.read8(0x4001), 0x00, "ld (hl),0x00 cleared the flag");
  assert.equal(m.regs.hl, 0x4002, "inc l advanced HL to 0x4002");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1964.js
//   find: mem.write8(regs.hl, 0x00);
//   repl: mem.write8(regs.hl, 0x01);
//   expect: FAIL  (flag not cleared -- caught by 0x4001 == 0 on the set-branch)
//   verified-anchor: count == 1
test("loc_1964: contract catches a failure to clear 0x4001", () => {
  const m = mk({ 0x194f: "tail" });
  m.regs.sp = 0x4400; m.mem.write8(0x4001, 0x01);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.hl = 0x4001; mm.step(0x1967, 10);
    regs.bit(0, mem.read8(regs.hl)); mm.step(0x1969, 12);
    if (regs.fZ) { mm.step(0x1971, 12); return mm.call(0x1971); }
    mm.step(0x196b, 7);
    mem.write8(regs.hl, 0x01); mm.step(0x196d, 10); // MUTANT
    regs.l = regs.inc8(regs.l); mm.step(0x196e, 4);
    mm.step(0x194f, 10); return mm.call(0x194f);
  };
  mutant(m);
  assert.notEqual(m.mem.read8(0x4001), 0x00, "mutant leaves the flag set");
});
