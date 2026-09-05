// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_25a9 (Galaxian/DK vertical tile-pair writer, ROM 0x25a9-0x25b3):
//   push de / ld de,0x20 / ld (hl),a / add a,0x02 / add hl,de / ld (hl),a / pop de / ret
// Writes (HL)=A and (HL+0x20)=A+2 (codes 0x20 apart). DE preserved.
// Contract: 8 instr, 73 T (11+10+7+7+11+7+10+10); (HL)=A, (HL+0x20)=A+2; HL += 0x20; DE kept; ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_25a9 } from "../loc_25a9.js";

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

test("loc_25a9: writes a vertical tile pair 0x20 apart, preserves DE; 73 T", () => {
  const m = mk();
  m.regs.sp = 0x4400;
  m.push16(0xcafe); // caller return address
  m.regs.hl = 0x5000; // VRAM dest
  m.regs.de = 0xbeef; // sentinel: must survive push/pop
  m.regs.a = 0x2c;
  loc_25a9(m);

  assert.equal(m.cycles, 73, "T total 11+10+7+7+11+7+10+10");
  assert.deepEqual(m.calls, [], "leaf routine -- no m.call");
  assert.equal(m.mem.read8(0x5000), 0x2c, "(HL)=A");
  assert.equal(m.mem.read8(0x5020), 0x2e, "(HL+0x20)=A+2");
  assert.equal(m.regs.hl, 0x5020, "HL advanced by 0x20");
  assert.equal(m.regs.de, 0xbeef, "push de/pop de preserved DE");
  assert.equal(m.pc, 0xcafe, "ret popped the caller return address");
  assert.equal(m.regs.sp, 0x4400, "stack balanced");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_25a9.js
//   find: regs.add(0x02);
//   repl: regs.add(0x01);
//   expect: FAIL  (second tile code A+1 not A+2 -- caught by (0x5020) == 0x2e)
test("loc_25a9: the contract catches a wrong second tile code", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(regs.de); m.step(0x25aa, 11);
    regs.de = 0x0020; m.step(0x25ad, 10);
    mem.write8(regs.hl, regs.a); m.step(0x25ae, 7);
    regs.add(0x01); m.step(0x25b0, 7); // MUTANT: A+1 instead of A+2
    regs.addHl(regs.de); m.step(0x25b1, 11);
    mem.write8(regs.hl, regs.a); m.step(0x25b2, 7);
    regs.de = m.pop16(); m.step(0x25b3, 10);
    m.ret();
  };
  const m = mk();
  m.regs.sp = 0x4400; m.push16(0xcafe);
  m.regs.hl = 0x5000; m.regs.a = 0x2c;
  mutant(m);
  assert.notEqual(m.mem.read8(0x5020), 0x2e, "mutant wrote 0x2d at HL+0x20");
});
