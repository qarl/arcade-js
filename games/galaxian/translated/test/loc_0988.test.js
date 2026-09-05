// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0988 (ROM 0x0988-0x098d): load HL from the 0x420e word, tail-jump into loc_096f.
// Contract: 26 T charged here (ld hl,(nn) 16 + jp 10), HL=(0x420e), calls [0x096f], the tail result propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0988 } from "../loc_0988.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };

test("loc_0988: HL <- (0x420e); tail-jump loc_096f; 26 T", () => {
  const m = mk({ 0x096f: () => "TAIL" }); // no-op tail stub, adds no cycles
  wr(m, 0x420e, 0x34); wr(m, 0x420f, 0x12); // (0x420e) = 0x1234 (little-endian)
  const ret = loc_0988(m);
  assert.equal(m.cycles, 26, "ld hl,(nn) 16 + jp 10");
  assert.equal(m.regs.hl, 0x1234, "HL loaded from the 0x420e word");
  assert.deepEqual(m.calls, [0x096f], "tail-jump to loc_096f");
  assert.equal(ret, "TAIL", "the tail continuation's result propagates out");
});

// MUTATION-PATCH loc_0988.js: `mem.read16(0x420e)` -> `mem.read16(0x420c)`
//   HL would come from the wrong word; caught by the HL==0x1234 assert.
test("loc_0988: contract catches a wrong load address", () => {
  const m = mk({ 0x096f: () => {} });
  wr(m, 0x420e, 0x34); wr(m, 0x420f, 0x12);
  wr(m, 0x420c, 0x78); wr(m, 0x420d, 0x56);
  const mutant = (mm) => {
    mm.regs.hl = mm.mem.read16(0x420c); mm.step(0x098b, 16); // MUTANT: wrong word
    mm.step(0x096f, 10); return mm.call(0x096f);
  };
  mutant(m);
  assert.throws(() => assert.equal(m.regs.hl, 0x1234));
});
