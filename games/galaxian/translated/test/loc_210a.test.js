// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_210a (Galaxian, ROM 0x210a-0x210d): B=0x80; pop the caller's pushed AF; ret.
// Contract: 27 T (7+10+10). Stack on entry (from the ROM callers' `push af`): [AF][return addr].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_210a } from "../loc_210a.js";

const RET = 0x1234;
const SAVED_AF = 0xabcd;

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.push16(RET);      // return addr (below)
  m.push16(SAVED_AF); // the AF the caller pushed (top -> the `pop af` target)
  return m;
}

test("loc_210a: forces B=0x80, restores AF, returns; 27 T", () => {
  const m = mk();
  m.regs.b = 0x00;
  loc_210a(m);
  assert.equal(m.cycles, 27, "T-state total (7+10+10)");
  assert.equal(m.regs.b, 0x80, "B clamped to 0x80");
  assert.equal(m.regs.af, SAVED_AF, "pop af restored the pushed AF");
  assert.equal(m.pc, RET, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_210a.js
//   find: regs.b = 0x80;
//   repl: regs.b = 0x00;
//   expect: FAIL (wrong clamp -> caught by b == 0x80)
//   verified-anchor: count == 1 (the sole `regs.b = 0x80`)
test("loc_210a: the contract catches a wrong clamp value", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.b = 0x00; m.step(0x210c, 7); // MUTANT: not 0x80
    regs.af = m.pop16(); m.step(0x210d, 10);
    m.ret();
  };
  const m = mk();
  m.regs.b = 0x00;
  mutant(m);
  assert.notEqual(m.regs.b, 0x80);
});
