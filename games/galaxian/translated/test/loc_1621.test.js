// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1621 (ROM 0x1621-0x1636): gated one-shot. Returns early unless bit0 of (0x4220) and
// (0x4225) are set and bit0 of (0x4222) is clear; on pass sets (0x4222) word to 1. Contract path: all
// preconditions met -> (0x4222)=1; 102 T, no calls.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1621 } from "../loc_1621.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_1621: all gates pass -> (0x4222)=1; 102 T", () => {
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x4220, 0x01); // bit0 set (pass ret nc)
  m.mem.write8(0x4225, 0x01); // bit0 set (pass ret nc)
  m.mem.write8(0x4222, 0x00); // bit0 clear (pass ret c)
  loc_1621(m);
  assert.equal(m.cycles, 102, "13+4+5 +13+4+5 +13+4+5 +10+16+10");
  assert.deepEqual(m.calls, [], "no sub-calls");
  assert.equal(m.mem.read16(0x4222), 0x0001, "(0x4222) word armed to 1");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_1621: (0x4220) bit0 clear -> early ret, (0x4222) untouched; 28 T", () => {
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x4220, 0x00);
  m.mem.write8(0x4222, 0x00);
  loc_1621(m);
  assert.equal(m.cycles, 28, "13 + 4 + ret nc taken 11");
  assert.equal(m.mem.read16(0x4222), 0x0000, "flag not armed on early exit");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_1621: (0x4222) already bit0 set -> ret c, not re-armed", () => {
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x4220, 0x01);
  m.mem.write8(0x4225, 0x01);
  m.mem.write8(0x4222, 0x01); // already set -> ret c
  loc_1621(m);
  assert.equal(m.mem.read16(0x4222), 0x0001, "left as-is (high byte not zeroed)");
  assert.equal(m.regs.hl, 0x0000, "ld hl,0x0001 never executed");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1621.js
//   find: if (regs.fC) {  (the ret c gate on (0x4222))
//   repl: if (regs.fNC) {
//   expect: FAIL (with (0x4222) bit0 clear it would now bail instead of arming)
test("loc_1621: contract catches an inverted ret-c gate", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4220); m.step(0x1624, 13);
    regs.rrca(); m.step(0x1625, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x1626, 5);
    regs.a = mem.read8(0x4225); m.step(0x1629, 13);
    regs.rrca(); m.step(0x162a, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x162b, 5);
    regs.a = mem.read8(0x4222); m.step(0x162e, 13);
    regs.rrca(); m.step(0x162f, 4);
    if (regs.fNC) { m.ret(11); return; } // MUTANT: inverted (was fC)
    m.step(0x1630, 5);
    regs.hl = 0x0001; m.step(0x1633, 10);
    mem.write16(0x4222, regs.hl); m.step(0x1636, 16);
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x4220, 0x01); m.mem.write8(0x4225, 0x01); m.mem.write8(0x4222, 0x00);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read16(0x4222), 0x0001));
});
