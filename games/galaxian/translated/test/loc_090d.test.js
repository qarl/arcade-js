// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_090d (ROM 0x090d-0x096e): main-loop mover of the 16-bit word at 0x420e toward the
// bound pair (0x4210), throttled by (0x425f)&3 and steered by (0x420d). Covers the increasing arm (store +
// fall to loc_096f), the proximity-gate shortcut (delegate loc_0988), and the decreasing arm reaching the
// low bound (delegate loc_0983). Interior labels 093e/0953/095d/0965/096c are inlined.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_090d } from "../loc_090d.js";

function mk() {
  const routines = new Map();
  for (const a of [0x096f, 0x0988, 0x0983, 0x097d]) routines.set(a, () => {});
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.push16(0x9999);
  return m;
}

test("loc_090d: increasing arm stores 0x420e+1 and falls through to loc_096f; 181 T", () => {
  const m = mk();
  m.mem.write8(0x4208, 0x00); // proximity gate clear -> jr z,093e
  m.mem.write16(0x420e, 0x0010); // current word (h bit7 clear)
  m.mem.write16(0x4210, 0x0020); // bound: E=0x20 (> l) -> cp e sets C
  m.mem.write8(0x420d, 0x00); // direction 0 -> increasing arm
  m.mem.write8(0x425f, 0x00); // (0x425f)&3 == 0 -> throttle passes
  loc_090d(m);
  assert.equal(m.cycles, 181, "gate+093e+0953+096c straight path");
  assert.equal(m.mem.read16(0x420e), 0x0011, "inc hl then store: 0x0010 -> 0x0011");
  assert.deepEqual(m.calls, [0x096f], "falls through to genuine loc_096f");
});

test("loc_090d: proximity gate hit shortcuts to loc_0988; 208 T", () => {
  const m = mk();
  m.mem.write8(0x4208, 0x01); // gate bit0 set
  m.mem.write8(0x4209, 0x30); // (0x4209)-0x22 = 0x0e < 0x50 -> in window
  m.mem.write8(0x420a, 0x40);
  m.mem.write16(0x420e, 0x0040); // delta 0 -> nibble index 0
  m.mem.write8(0x41f0, 0x01); // 0x41f0+0 bit0 set -> jr nz,0988
  loc_090d(m);
  assert.equal(m.cycles, 208, "full gate scan then shortcut");
  assert.deepEqual(m.calls, [0x0988], "shortcut tail-jump to loc_0988");
});

test("loc_090d: direction-set arm at low bound delegates to loc_0983; 134 T", () => {
  const m = mk();
  m.mem.write8(0x4208, 0x00);
  m.mem.write16(0x420e, 0x8010); // h bit7 set -> negative branch in loc_095d
  m.mem.write8(0x4211, 0x20); // D = high bound 0x20 > l -> cp d sets C -> jr c,0983
  m.mem.write8(0x420d, 0x01); // direction set -> jr nz,095d
  loc_090d(m);
  assert.equal(m.cycles, 134, "gate + 093e + 095d to the C-branch");
  assert.deepEqual(m.calls, [0x0983], "reached bound -> loc_0983 clears the flag");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_090d.js
//   find: regs.hl = (regs.hl + 1) & 0xffff;\n      m.step(0x095a, 6); // inc hl -- step up
//   repl: (drop both lines -- the increasing arm never advances the word)
//   expect: FAIL (0x420e stays 0x0010 and cycles drop to 175; caught by the read16 + cycles asserts)
test("loc_090d: the contract catches a dropped `inc hl` on the increasing arm", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4208; m.step(0x0910, 10);
    regs.bit(0, mem.read8(regs.hl)); m.step(0x0912, 12);
    m.step(0x093e, 12); // jr z taken
    regs.hl = mem.read16(0x420e); m.step(0x0941, 16);
    regs.de = mem.read16(0x4210); m.step(0x0945, 20);
    regs.a = mem.read8(0x420d); m.step(0x0948, 13);
    regs.and(regs.a); m.step(0x0949, 4);
    m.step(0x094b, 7); // jr nz,095d not taken
    regs.bit(7, regs.h); m.step(0x094d, 8);
    m.step(0x094f, 7); // jr nz,0953 not taken
    regs.a = regs.l; m.step(0x0950, 4);
    regs.cp(regs.e); m.step(0x0951, 4);
    m.step(0x0953, 7); // jr nc,097d not taken
    regs.a = mem.read8(0x425f); m.step(0x0956, 13);
    regs.and(0x03); m.step(0x0958, 7);
    m.step(0x0959, 5); // ret nz not taken
    m.step(0x096c, 10); // MUTANT: dropped `inc hl`
    mem.write16(0x420e, regs.hl); m.step(0x096f, 16);
    return m.call(0x096f);
  };
  const m = mk();
  m.mem.write8(0x4208, 0x00);
  m.mem.write16(0x420e, 0x0010);
  m.mem.write16(0x4210, 0x0020);
  m.mem.write8(0x420d, 0x00);
  m.mem.write8(0x425f, 0x00);
  mutant(m);
  assert.throws(() => {
    assert.equal(m.cycles, 181);
    assert.equal(m.mem.read16(0x420e), 0x0011);
  });
});
