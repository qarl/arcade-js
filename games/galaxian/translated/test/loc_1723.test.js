// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1723 (Galaxian phase counter, ROM 0x1723-0x1732):
//   1723  3a cc 41  ld a,(0x41cc)   ; phase counter
//   1726  3d        dec a
//   1727  c2 33 17  jp nz,0x1733    ; still counting -> tail into loc_1733
//   172a  32 cc 41  ld (0x41cc),a   ; reached zero: store 0
//   172d  3e 08     ld a,0x08
//   172f  32 ce 41  ld (0x41ce),a   ; re-arm duration
//   1732  c9        ret
// Contract (0x41cc=1): 70 T (13+4+10+13+7+13+10), 0x41cc=0, 0x41ce=8, no tail.
// Branch (0x41cc=3): 27 T (13+4+10) then tail m.call([0x1733]).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1723 } from "../loc_1723.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, cc, stubs = {}) {
  const m = mk(stubs);
  m.regs.sp = 0x4400;
  m.mem.write8(0x41cc, cc);
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, cc: m.mem.read8(0x41cc), ce: m.mem.read8(0x41ce) };
}

function checkSpec(r) {
  assert.equal(r.cycles, 70, "T-state total of the zero path");
  assert.deepEqual(r.calls, [], "no tail: the self-contained re-arm path");
  assert.equal(r.cc, 0x00, "0x41cc stored back as 0");
  assert.equal(r.ce, 0x08, "0x41ce re-armed to 8");
}

test("loc_1723: counter hits zero -> re-arms 0x41ce=8; 70 T", () => {
  checkSpec(run(loc_1723, 0x01));
});

test("loc_1723: nonzero after dec -> tail-jumps into loc_1733", () => {
  const r = run(loc_1723, 0x03, { 0x1733: () => "TONE" });
  assert.equal(r.cycles, 27, "ld + dec + jp nz(taken)");
  assert.deepEqual(r.calls, [0x1733], "tail into the tone toggler");
  assert.equal(r.ret, "TONE", "the tail callee's result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1723.js
//   find: regs.a = 0x08;
//   repl: regs.a = 0x09;   (wrong re-arm value)
//   expect: FAIL  (0x41ce == 9 not 8 -- caught by ce == 0x08; cycles unchanged)
//   verified-anchor: count == 1  (the sole `regs.a = 0x08` in loc_1723.js)
test("loc_1723: the contract catches a wrong re-arm duration", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x41cc); m.step(0x1726, 13);
    regs.a = regs.dec8(regs.a); m.step(0x1727, 4);
    if (regs.fNZ) { m.step(0x1733, 10); return m.call(0x1733); }
    m.step(0x172a, 10);
    mem.write8(0x41cc, regs.a); m.step(0x172d, 13);
    regs.a = 0x09; // MUTANT: wrong duration
    m.step(0x172f, 7);
    mem.write8(0x41ce, regs.a); m.step(0x1732, 13);
    return m.ret();
  };
  const m = mk();
  m.regs.sp = 0x4400; m.mem.write8(0x41cc, 0x01);
  mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, calls: m.calls, cc: m.mem.read8(0x41cc), ce: m.mem.read8(0x41ce) }));
});
