// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_14f3 (ROM 0x14f3-0x1514): gated prescaler cascade for the 0x421a counter.
// Deep inc path (both prescalers wrap, counter<7): 165 T, reloads 0x4218=0x3c/0x4219=0x14, 0x421a += 1.
// Clamp path (counter>7): 169 T, 0x421a=7. Gate-closed bail: 28 T, no writes.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_14f3 } from "../loc_14f3.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function gateOpen(m) {
  m.mem.write8(0x4200, 0x01); // bit0 set -> gate open
  m.mem.write8(0x422b, 0x00); // bit0 clear -> not inhibited
}

test("loc_14f3: both prescalers wrap, counter<7 -> inc; reloads; 165 T", () => {
  const m = mk();
  gateOpen(m);
  m.mem.write8(0x4218, 0x01); // dec -> 0, wraps
  m.mem.write8(0x4219, 0x01); // dec -> 0, wraps
  m.mem.write8(0x421a, 0x03);
  m.push16(0x9999);
  loc_14f3(m);
  assert.equal(m.cycles, 165, "T-state total (deep inc path)");
  assert.deepEqual(m.calls, [], "no subroutine calls");
  assert.equal(m.mem.read8(0x4218), 0x3c, "outer prescaler reloaded");
  assert.equal(m.mem.read8(0x4219), 0x14, "inner prescaler reloaded");
  assert.equal(m.mem.read8(0x421a), 0x04, "counter incremented 3->4");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_14f3: counter>7 clamps to 7; 169 T", () => {
  const m = mk();
  gateOpen(m);
  m.mem.write8(0x4218, 0x01);
  m.mem.write8(0x4219, 0x01);
  m.mem.write8(0x421a, 0x09);
  m.push16(0x9999);
  loc_14f3(m);
  assert.equal(m.cycles, 169, "T-state total (clamp path)");
  assert.equal(m.mem.read8(0x421a), 0x07, "counter clamped 9->7");
});

test("loc_14f3: gate closed (0x4200 bit0 clear) bails immediately; 28 T", () => {
  const m = mk();
  m.mem.write8(0x4200, 0x00);
  m.mem.write8(0x4218, 0x05);
  m.push16(0x9999);
  loc_14f3(m);
  assert.equal(m.cycles, 28, "ld a(13)+rrca(4)+ret nc taken(11)");
  assert.equal(m.mem.read8(0x4218), 0x05, "prescaler untouched");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_14f3.js
//   find: regs.incMem8(mem, regs.hl);\n  m.step(0x1511, 11); // inc (0x421a)
//   repl: m.step(0x1511, 11); (drop the inc -- counter never advances)
//   expect: FAIL (0x421a stays 3; caught by the counter==4 assert)
test("loc_14f3: contract catches a dropped counter inc", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4200); m.step(0x14f6, 13);
    regs.rrca(); m.step(0x14f7, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x14f8, 5);
    regs.a = mem.read8(0x422b); m.step(0x14fb, 13);
    regs.rrca(); m.step(0x14fc, 4);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x14fd, 5);
    regs.hl = 0x4218; m.step(0x1500, 10);
    regs.decMem8(mem, regs.hl); m.step(0x1501, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x1502, 5);
    mem.write8(regs.hl, 0x3c); m.step(0x1504, 10);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x1505, 6);
    regs.decMem8(mem, regs.hl); m.step(0x1506, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x1507, 5);
    mem.write8(regs.hl, 0x14); m.step(0x1509, 10);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x150a, 6);
    regs.a = mem.read8(regs.hl); m.step(0x150b, 7);
    regs.cp(0x07); m.step(0x150d, 7);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x150e, 5);
    if (regs.fNC) { m.step(0x1512, 12); mem.write8(regs.hl, 0x07); m.step(0x1514, 10); m.ret(); return; }
    m.step(0x1510, 7);
    m.step(0x1511, 11); // MUTANT: dropped inc (0x421a)
    m.ret();
  };
  const m = mk();
  gateOpen(m);
  m.mem.write8(0x4218, 0x01);
  m.mem.write8(0x4219, 0x01);
  m.mem.write8(0x421a, 0x03);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x421a), 0x04));
});
