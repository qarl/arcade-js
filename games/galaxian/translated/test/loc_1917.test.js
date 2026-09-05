// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1917 (Galaxian mode-3 store, ROM 0x1917-0x191d):
//   1917  21 00 09  ld hl,0x0900
//   191a  22 01 40  ld (0x4001),hl   ; 0x4001/0x4002 = 0x0900
//   191d  c9        ret
// Contract: 36 T (10+16+10), no calls, read16(0x4001) == 0x0900.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1917 } from "../loc_1917.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function checkSpec(r) {
  assert.equal(r.cycles, 36, "T-state total (10+16+10)");
  assert.deepEqual(r.calls, [], "straight-line store + ret");
  assert.equal(r.word, 0x0900, "0x4001 word = 0x0900");
}

test("loc_1917: stores 0x0900 into 0x4001; 36 T", () => {
  const m = mk();
  loc_1917(m);
  checkSpec({ cycles: m.cycles, calls: m.calls, word: m.mem.read16(0x4001) });
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1917.js
//   find: mem.write16(0x4001, regs.hl);
//   repl: mem.write16(0x4003, regs.hl);   (wrong destination cell)
//   expect: FAIL  (0x4001 stays 0 -- caught by word == 0x0900)
//   verified-anchor: count == 1  (the sole write16 in loc_1917.js)
test("loc_1917: the contract catches a wrong destination", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x0900; m.step(0x191a, 10);
    mem.write16(0x4003, regs.hl); m.step(0x191d, 16); // MUTANT: wrong cell
    return m.ret();
  };
  const m = mk();
  mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, calls: m.calls, word: m.mem.read16(0x4001) }));
});
