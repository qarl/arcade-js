// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2593 (ROM 0x2593-0x259d): push de; ld de,0xffdf; call 0x25a0; add a,0xfc; jr 0x258c.
// Contract: 57 T (11+10+17+7+12), calls [0x25a0, 0x258c], DE=0xffdf, original DE pushed for loc_258c,
// A = (A + 2 from 25a0) + 0xfc.  NOTE: 0x258c is currently INLINED in loc_2585 -- the real run needs it
// carved out as loc_258c before this delegate resolves (see blockers); here it is stubbed.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2593 } from "../loc_2593.js";

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

// 0x25a0 stub: pops its pushed return addr (real loc_25a0 rets cleanly) and bumps A by 2 like the primitive.
const call25a0 = (mm) => { mm.pop16(); mm.regs.a = (mm.regs.a + 2) & 0xff; };

function run() {
  const m = mk({ 0x25a0: call25a0, 0x258c: () => "TAIL" });
  m.regs.a = 0x2e;    // seed as from loc_2591
  m.regs.de = 0x1234; // proves ld de overwrites it and the push preserves the original for loc_258c
  const ret = loc_2593(m);
  return { m, ret };
}

test("loc_2593: 2x2-up block draw; 57 T, calls 25a0 then tails to 258c", () => {
  const { m, ret } = run();
  assert.equal(m.cycles, 57, "11+10+17+7+12");
  assert.deepEqual(m.calls, [0x25a0, 0x258c], "top pair via 25a0, then tail to 258c");
  assert.equal(m.regs.de, 0xffdf, "ld de,0xffdf (-33 upward stride)");
  assert.equal(m.mem.read16(m.regs.sp), 0x1234, "original DE pushed, awaiting loc_258c's pop de");
  // A: 0x2e --(25a0 +2)--> 0x30 --(add a,0xfc == -4)--> 0x2c
  assert.equal(m.regs.a, 0x2c, "add a,0xfc after the +2 from 25a0");
  assert.equal(ret, "TAIL", "tail-jump result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2593.js
//   find: regs.add(0xfc);
//   repl: regs.add(0xfd);
//   expect: FAIL (A ends 0x2d not 0x2c; caught by the A assert)
test("loc_2593: the contract catches a wrong add-a constant", () => {
  const m = mk({ 0x25a0: call25a0, 0x258c: () => "TAIL" });
  m.regs.a = 0x2e; m.regs.de = 0x1234;
  const mutant = (mm) => {
    const { regs } = mm;
    mm.push16(regs.de); mm.step(0x2594, 11);
    regs.de = 0xffdf; mm.step(0x2597, 10);
    mm.push16(0x259a); mm.step(0x25a0, 17); mm.call(0x25a0);
    regs.add(0xfd); mm.step(0x259c, 7); // MUTANT: 0xfd instead of 0xfc
    mm.step(0x258c, 12); return mm.call(0x258c);
  };
  mutant(m);
  assert.throws(() => assert.equal(m.regs.a, 0x2c));
});
