// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_08e5 (ROM 0x08e5-0x08f1): if flag (0x420b) bit0 set, clear flag (0x420b) and gate
// (0x4208); else ret untouched. No m.call (rets). Contract: 62 T (set path), RAM cleared.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_08e5 } from "../loc_08e5.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  return m;
}

function run(fn, cells = {}) {
  const m = mk();
  m.regs.sp = 0x4400; // stack in WRAM so the pushed return is observable
  for (const [a, v] of Object.entries(cells)) m.mem.write8(Number(a), v);
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_08e5: flag bit0 set -> clears flag + gate; 62 T", () => {
  const m = run(loc_08e5, { 0x420b: 0x01, 0x4208: 0x55 });
  assert.equal(m.cycles, 62, "T-state total for the flag-set path");
  assert.equal(m.mem.read8(0x420b), 0x00, "flag (0x420b) cleared");
  assert.equal(m.mem.read8(0x4208), 0x00, "gate (0x4208) cleared");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_08e5: flag bit0 clear -> ret nc, nothing touched; 28 T", () => {
  const m = run(loc_08e5, { 0x420b: 0x02, 0x4208: 0x55 });
  assert.equal(m.cycles, 28, "T-state total for the early-ret path");
  assert.equal(m.mem.read8(0x4208), 0x55, "gate untouched when flag clear");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_08e5.js
//   find: mem.write8(0x4208, regs.a);
//   repl: (drop it -- gate never cleared)
//   expect: FAIL (0x4208 stays 0x55; caught by the gate-cleared assert)
//   verified-anchor: count == 1 (the sole "mem.write8(0x4208, regs.a)" in loc_08e5.js)
test("loc_08e5: the contract catches a dropped gate clear", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x420b); m.step(0x08e8, 13);
    regs.rrca(); m.step(0x08e9, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x08ea, 5);
    regs.xor(regs.a); m.step(0x08eb, 4);
    mem.write8(0x420b, regs.a); m.step(0x08ee, 13);
    m.step(0x08f1, 13); // MUTANT: dropped ld (0x4208),a
    m.ret();
  };
  const m = mk();
  m.regs.sp = 0x4400;
  m.mem.write8(0x420b, 0x01); m.mem.write8(0x4208, 0x55);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4208), 0x00));
});
