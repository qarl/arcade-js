// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_101f (ROM 0x101f-0x105f): path-walk handler. Non-branch path (bit0 of (ix+0x06)
// clear): subtract X and Y deltas from the ROM step table (0x1e00+cursor), advance the cursor, tick the
// throttle. Contract: 204 T, (ix+0x03)/(ix+0x04) updated, cursor (ix+0x13) advanced by 2, ret nz.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_101f } from "../loc_101f.js";

const noop = () => {}; // jr/jp target stub (nothing was pushed)

function mk(rom) {
  const routines = new Map([[0x1060, noop]]);
  const m = new Machine(rom, routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function romWithTable() {
  const rom = new Uint8Array(0x4000);
  rom[0x1e10] = 0x05; // X delta at cursor 0x10
  rom[0x1e11] = 0x03; // Y delta at cursor 0x11
  return rom;
}

test("loc_101f: descending path applies X+Y deltas, advances cursor, ret nz; 204 T", () => {
  const m = mk(romWithTable());
  m.mem.write8(0x4213, 0x10); // (ix+0x13) cursor
  m.mem.write8(0x4203, 0x80); // (ix+0x03) X
  m.mem.write8(0x4206, 0x00); // (ix+0x06) bit0 clear -> descending
  m.mem.write8(0x4204, 0x40); // (ix+0x04) Y
  m.mem.write8(0x4210, 0x03); // (ix+0x10) throttle
  m.push16(0x9999);
  loc_101f(m);
  assert.equal(m.mem.read8(0x4203), 0x7b, "X -= table[0x1e10]");
  assert.equal(m.mem.read8(0x4204), 0x3d, "Y -= table[0x1e11]");
  assert.equal(m.mem.read8(0x4213), 0x12, "cursor advanced by 2");
  assert.equal(m.mem.read8(0x4210), 0x02, "throttle decremented, still nonzero");
  assert.deepEqual(m.calls, [], "bit0 clear: no delegate to 0x1060");
  assert.equal(m.pc, 0x9999, "ret nz to caller");
  assert.equal(m.cycles, 204, "19+7+19+7+19+4+20+7+19+7+19+4+19+23+11");
});

test("loc_101f: bit0 set tail-branches to loc_1060; 107 T to the handoff", () => {
  const m = mk(romWithTable());
  m.mem.write8(0x4213, 0x10);
  m.mem.write8(0x4203, 0x80);
  m.mem.write8(0x4206, 0x01); // (ix+0x06) bit0 set -> ascending variant
  m.push16(0x9999);
  loc_101f(m);
  assert.deepEqual(m.calls, [0x1060], "jr nz,0x1060 delegate");
  assert.equal(m.mem.read8(0x4203), 0x7b, "X delta applied before the branch");
  assert.equal(m.cycles, 107, "19+7+19+7+19+4+20+12");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_101f.js
//   find (at 0x1027): regs.sub(mem.read8(regs.hl));   repl: regs.add(mem.read8(regs.hl));
//   expect: FAIL (X becomes 0x85 instead of 0x7b)
test("loc_101f: contract catches add-vs-sub on the X delta", () => {
  const m = mk(romWithTable());
  m.mem.write8(0x4213, 0x10);
  m.mem.write8(0x4203, 0x80);
  m.mem.write8(0x4206, 0x00);
  m.mem.write8(0x4204, 0x40);
  m.mem.write8(0x4210, 0x03);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.l = mem.read8(regs.ix + 0x13); mm.step(0x1022, 19);
    regs.h = 0x1e; mm.step(0x1024, 7);
    regs.a = mem.read8(regs.ix + 0x03); mm.step(0x1027, 19);
    regs.add(mem.read8(regs.hl)); mm.step(0x1028, 7); // MUTANT: add not sub
    mem.write8(regs.ix + 0x03, regs.a); mm.step(0x102b, 19);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4203), 0x7b));
});
