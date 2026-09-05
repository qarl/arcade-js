// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2256 (ROM 0x2256-0x2260): pick the VIDEORAM digit field IX, then fall through into
// loc_2261. A!=0 path (A=5): ld ix,0x5381 -> and a (Z clear) -> jr z not taken -> ld ix,0x5121 -> fall to
// loc_2261. Contract: 39 T (14+4+7+14), calls [0x2261], IX=0x5121, delegate result propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2256 } from "../loc_2256.js";

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

test("loc_2256: A!=0 selects IX=0x5121 and falls into loc_2261; 39 T", () => {
  const m = mk({ 0x2261: () => "REND" });
  m.regs.a = 5;
  const ret = loc_2256(m);
  assert.equal(m.cycles, 39, "14+4+7+14");
  assert.deepEqual(m.calls, [0x2261], "falls through into the render loop");
  assert.equal(m.regs.ix, 0x5121, "alternate VIDEORAM field");
  assert.equal(ret, "REND", "the fall-through callee result propagates out");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2256.js
//   find: regs.ix = 0x5121; // alternate VIDEORAM field
//   repl: (drop it -- IX stays 0x5381)
//   expect: FAIL (IX assert sees 0x5381)
test("loc_2256: the contract catches a dropped alternate-field IX", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.ix = 0x5381;
    m.step(0x225a, 14);
    regs.and(regs.a);
    m.step(0x225b, 4);
    m.step(0x225d, 7);
    m.step(0x2261, 14); // MUTANT: dropped `ld ix,0x5121`
    return m.call(0x2261);
  };
  const m = mk({ 0x2261: () => "REND" });
  m.regs.a = 5;
  mutant(m);
  assert.throws(() => assert.equal(m.regs.ix, 0x5121));
});
