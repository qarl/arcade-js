// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1146 (ROM 0x1146): a lone `ret` (null dispatch entry). Contract: 10 T, ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1146 } from "../loc_1146.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  return m;
}

test("loc_1146: rets to caller; 10 T", () => {
  const m = mk();
  m.push16(0x9999);
  loc_1146(m);
  assert.equal(m.pc, 0x9999, "ret popped the caller PC");
  assert.equal(m.cycles, 10, "single ret");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1146.js
//   find: m.ret();
//   repl: m.step(0x1147, 10);   // falls through instead of returning
//   expect: FAIL (pc lands at 0x1147, not the caller)
test("loc_1146: contract catches a fall-through instead of ret", () => {
  const m = mk();
  m.push16(0x9999);
  const mutant = (mm) => { mm.step(0x1147, 10); }; // MUTANT: no ret
  mutant(m);
  assert.throws(() => assert.equal(m.pc, 0x9999));
});
