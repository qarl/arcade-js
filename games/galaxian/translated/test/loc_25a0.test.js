// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_25a0 (Galaxian/DK tile-pair writer, ROM 0x25a0-0x25a6):
//   ld (hl),a / inc a / inc hl / ld (hl),a / inc a / add hl,de / ret
// Writes (HL)=A and (HL+1)=A+1, then HL+=DE and A+=2.
// Contract: 7 instr, 49 T (7+4+6+7+4+11+10); (HL)=A, (HL+1)=A+1; HL = start+1+DE; A += 2; ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_25a0 } from "../loc_25a0.js";

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

test("loc_25a0: writes a tile pair, advances HL by DE+1 and A by 2; 49 T", () => {
  const m = mk();
  m.regs.sp = 0x4400;
  m.push16(0xcafe); // caller return address
  m.regs.hl = 0x5000; // VRAM dest
  m.regs.de = 0x001f; // stride -> net +0x20 after the inc hl
  m.regs.a = 0x2c;
  loc_25a0(m);

  assert.equal(m.cycles, 49, "T total 7+4+6+7+4+11+10");
  assert.deepEqual(m.calls, [], "leaf routine -- no m.call");
  assert.equal(m.mem.read8(0x5000), 0x2c, "(HL)=A");
  assert.equal(m.mem.read8(0x5001), 0x2d, "(HL+1)=A+1");
  assert.equal(m.regs.hl, 0x5020, "HL = 0x5000 + 1 + 0x1f");
  assert.equal(m.regs.a, 0x2e, "A incremented twice");
  assert.equal(m.pc, 0xcafe, "ret popped the caller return address");
  assert.equal(m.regs.sp, 0x4400, "stack balanced");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_25a0.js
//   find: regs.addHl(regs.de);
//   repl: (deleted)
//   expect: FAIL  (HL not advanced -- caught by HL == 0x5020)
test("loc_25a0: the contract catches a missing HL advance", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8(regs.hl, regs.a); m.step(0x25a1, 7);
    regs.a = regs.inc8(regs.a); m.step(0x25a2, 4);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x25a3, 6);
    mem.write8(regs.hl, regs.a); m.step(0x25a4, 7);
    regs.a = regs.inc8(regs.a); m.step(0x25a5, 4);
    // MUTANT: add hl,de dropped
    m.step(0x25a6, 11);
    m.ret();
  };
  const m = mk();
  m.regs.sp = 0x4400; m.push16(0xcafe);
  m.regs.hl = 0x5000; m.regs.de = 0x001f; m.regs.a = 0x2c;
  mutant(m);
  assert.notEqual(m.regs.hl, 0x5020, "mutant leaves HL at 0x5001");
});
