// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_18e7 (Galaxian scroller, ROM 0x18e7):
//   18e7  eb   ex de,hl        ; restore the countdown pointer from DE
//   (fall through to loc_18e8)
// Contract (DE=0x4200, HL=0x9999): after ex de,hl HL=0x4200 (DE=0x9999), then tail m.call([0x18e8]); 4 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_18e7 } from "../loc_18e7.js";

function mk(onE8) {
  const routines = new Map([[0x18e8, onE8]]);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn) {
  let seenHl = null;
  const m = mk((mm) => { seenHl = mm.regs.hl; return "E8"; });
  m.regs.de = 0x4200;
  m.regs.hl = 0x9999;
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, seenHl, de: m.regs.de };
}

function checkSpec(r) {
  assert.equal(r.cycles, 4, "ex de,hl");
  assert.deepEqual(r.calls, [0x18e8], "falls through into loc_18e8");
  assert.equal(r.ret, "E8", "callee result propagates");
  assert.equal(r.seenHl, 0x4200, "HL = old DE at the tail call");
  assert.equal(r.de, 0x9999, "DE = old HL");
}

test("loc_18e7: swaps DE<->HL then tails loc_18e8; 4 T", () => {
  checkSpec(run(loc_18e7));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_18e7.js
//   find: regs.exDeHl();\n  m.step(0x18e8, 4); // ex de,hl ...
//   repl: m.step(0x18e8, 4);   (drops the swap)
//   expect: FAIL  (HL stays 0x9999 -- caught by seenHl == 0x4200)
//   verified-anchor: count == 1  (the sole regs.exDeHl() in loc_18e7.js)
test("loc_18e7: the contract catches a missing ex de,hl", () => {
  const mutant = (m) => {
    m.step(0x18e8, 4); // MUTANT: no ex de,hl
    return m.call(0x18e8);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
