// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_258c (ROM 0x258c-0x2590): shared two-cell-writer tail — write the second cell via
// loc_25a0, pop the DE saved by the caller, ret. Contract: calls [0x25a0], DE restored from the stack slot
// below the return, 37 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_258c } from "../loc_258c.js";

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
const rst = (mm) => { mm.pop16(); };

test("loc_258c: second cell write + DE restore + ret; 37 T", () => {
  const m = mk({ 0x25a0: rst });
  m.push16(0x9999); // caller return
  m.push16(0x5555); // the DE the caller pushed before jumping here
  m.regs.de = 0x0000;
  loc_258c(m);
  assert.equal(m.cycles, 37, "call + pop de + ret");
  assert.deepEqual(m.calls, [0x25a0], "one cell write");
  assert.equal(m.regs.de, 0x5555, "pop de restores the caller-saved DE");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_258c.js
//   find: regs.de = m.pop16();   (pop de)
//   repl: m.pop16();             (drop the value; DE unchanged)
//   expect: FAIL (DE stays 0x0000; caught by the DE==0x5555 assert)
test("loc_258c: the contract catches a dropped pop de", () => {
  const m = mk({ 0x25a0: rst });
  m.push16(0x9999);
  m.push16(0x5555);
  m.regs.de = 0x0000;
  m.push16(0x258f); m.step(0x25a0, 17); m.call(0x25a0);
  m.pop16(); m.step(0x2590, 10); // MUTANT: pop discarded, DE not written
  m.ret();
  assert.throws(() => assert.equal(m.regs.de, 0x5555));
});
