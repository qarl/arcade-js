// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_207d (ROM 0x207d-0x2088):
//   push bc; push hl; ld a,l; bit 0,(hl); jr nz,0x2089; call 0x205e; [0x2087 jr 0x2094]
// bit0 set -> save BC/HL, tail into loc_2089 (50 T). bit0 clear -> call 0x205e, then the 0x2087 jr delegates
// to loc_2094 (the shared epilogue, its own second-entry file; pop/advance/djnz/ret lives there).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_207d } from "../loc_207d.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const tail = () => "TAIL";
const balance = (mm) => { mm.pop16(); }; // a called routine that returns: pop its pushed return

test("loc_207d bit0 set: save BC/HL, tail into loc_2089; 50 T", () => {
  const m = mk({ 0x2089: tail });
  m.regs.bc = 0x0610; m.regs.hl = 0x4120;
  m.mem.write8(0x4120, 0x01); // bit 0 set
  const ret = loc_207d(m);
  assert.equal(m.cycles, 50, "11+11+4+12+12");
  assert.deepEqual(m.calls, [0x2089]);
  assert.equal(ret, "TAIL");
  assert.equal(m.regs.sp, 0x43fc, "bc+hl still on the stack (loc_2089 pops them)");
  assert.equal(m.mem.read16(0x43fc), 0x4120, "pushed HL");
  assert.equal(m.mem.read16(0x43fe), 0x0610, "pushed BC");
  assert.equal(m.regs.a, 0x20, "ld a,l -- slot index arg");
});

test("loc_207d bit0 clear: call 0x205e then delegate to loc_2094 (shared epilogue); 74 T to the delegation", () => {
  const m = mk({ 0x205e: balance, 0x2094: () => "EPI" });
  m.regs.bc = 0x0110; m.regs.hl = 0x4130;
  m.mem.write8(0x4130, 0x00); // bit 0 clear
  const ret = loc_207d(m);
  assert.equal(m.cycles, 74, "11+11+4+12+7 + 17(call 0x205e) + 12(jr 0x2094)");
  assert.deepEqual(m.calls, [0x205e, 0x2094], "call 0x205e, then delegate to the loc_2094 epilogue");
  assert.equal(ret, "EPI", "delegates to loc_2094");
  assert.equal(m.regs.a, 0x30, "ld a,l -- slot index arg (loc_2094 advances L, not loc_207d)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_207d.js
//   find: regs.bit(0, mem.read8(regs.hl));
//   repl: regs.bit(1, mem.read8(regs.hl));
//   expect: FAIL (tests the wrong bit -> bit0-set input reads as clear, takes the 0x205e/0x2094 path;
//           caught by calls == [0x2089])
test("loc_207d: the contract catches testing the wrong flag bit", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(regs.bc); m.step(0x207e, 11);
    m.push16(regs.hl); m.step(0x207f, 11);
    regs.a = regs.l; m.step(0x2080, 4);
    regs.bit(1, mem.read8(regs.hl)); m.step(0x2082, 12); // MUTANT
    if (regs.fNZ) { m.step(0x2089, 12); return m.call(0x2089); }
    m.step(0x2084, 7);
    m.push16(0x2087); m.step(0x205e, 17); m.call(0x205e);
    m.step(0x2094, 12); return m.call(0x2094);
  };
  const m = mk({ 0x2089: tail, 0x205e: balance, 0x2094: () => "EPI" });
  m.regs.bc = 0x0110; m.regs.hl = 0x4120;
  m.mem.write8(0x4120, 0x01); // bit0 set, bit1 clear
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x2089]));
});
