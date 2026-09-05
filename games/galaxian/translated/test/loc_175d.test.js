// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_175d (ROM 0x175d-0x176b):
//   175d  21 d2 41  ld hl,0x41d2
//   1760  cd 6c 17  call 0x176c
//   1763  21 cf 41  ld hl,0x41cf
//   1766  cd 6c 17  call 0x176c
//   1769  21 cd 41  ld hl,0x41cd
//   (fall-through into loc_176c)
// Contract: 64 T (10+17+10+17+10), calls [0x176c, 0x176c, 0x176c], HL = 0x41d2/0x41cf/0x41cd at each entry,
// the fall-through callee result propagates out.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_175d } from "../loc_175d.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x43f0;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// 0x176c stub: record the descriptor pointer in HL; the two interior calls also pop their pushed
// return frame. Last invocation is the tail fall-through -> return the sentinel.
function stub176c(m, seen) {
  let n = 0;
  m.routines.set(0x176c, (mm) => {
    seen.push(mm.regs.hl);
    if (++n < 3) { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; return; }
    return "TAIL";
  });
}

function checkSpec(m, seen, ret) {
  assert.equal(m.cycles, 64, "T-state total (10+17+10+17+10)");
  assert.deepEqual(m.calls, [0x176c, 0x176c, 0x176c], "three channel updates");
  assert.deepEqual(seen, [0x41d2, 0x41cf, 0x41cd], "descriptor pointers, in order");
  assert.equal(ret, "TAIL", "the fall-through callee result propagates");
}

test("loc_175d: updates three descriptors 0x41d2/0x41cf/0x41cd; 64 T", () => {
  const m = mk();
  const seen = [];
  stub176c(m, seen);
  const ret = loc_175d(m);
  checkSpec(m, seen, ret);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_175d.js
//   find: regs.hl = 0x41cf;
//   repl: regs.hl = 0x41ce;
//   expect: FAIL (second descriptor pointer wrong, caught by the seen sequence)
test("loc_175d: the contract catches a wrong second descriptor", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x41d2; m.step(0x1760, 10);
    m.push16(0x1763); m.step(0x176c, 17); m.call(0x176c);
    regs.hl = 0x41ce; m.step(0x1766, 10); // MUTANT
    m.push16(0x1769); m.step(0x176c, 17); m.call(0x176c);
    regs.hl = 0x41cd; m.step(0x176c, 10);
    return m.call(0x176c);
  };
  const m = mk();
  const seen = [];
  stub176c(m, seen);
  const ret = mutant(m);
  assert.throws(() => checkSpec(m, seen, ret));
});
