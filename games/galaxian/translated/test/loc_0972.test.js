// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0972 (ROM 0x0972-0x097c): write A into the 9 even cells 0x4028,0x402a,...,0x4038
// (stride 2) via a djnz loop, then ret. Contract: 274 T, B drained to 0, HL past the block, odd cells
// untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0972 } from "../loc_0972.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.push16(0x9999);
  return m;
}

test("loc_0972: fills 9 even cells 0x4028..0x4038 with A; 274 T; ret", () => {
  const m = mk();
  m.regs.a = 0xab;
  loc_0972(m);
  assert.equal(m.cycles, 274, "head 17 + 9 iters (247) + ret 10");
  for (let i = 0; i < 9; i++) {
    assert.equal(m.mem.read8(0x4028 + 2 * i), 0xab, `even cell ${i} written`);
    assert.equal(m.mem.read8(0x4029 + 2 * i), 0x00, `odd cell ${i} untouched (stride 2)`);
  }
  assert.equal(m.regs.b, 0x00, "djnz drained B");
  assert.equal(m.regs.hl, 0x403a, "HL past the 9-entry block");
  assert.deepEqual(m.calls, [], "no delegates");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0972.js
//   find: regs.l = regs.inc8(regs.l);\n    m.step(0x097a, 4); // inc l -- stride 2
//   repl: (drop it -- stride becomes 1, writing consecutive cells)
//   expect: FAIL (0x4029 gets A instead of 0; caught by the odd-cell assert)
test("loc_0972: the contract catches a dropped second `inc l` (stride 1)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4028; m.step(0x0975, 10);
    regs.b = 0x09; m.step(0x0977, 7);
    for (;;) {
      mem.write8(regs.hl, regs.a); m.step(0x0978, 7);
      regs.l = regs.inc8(regs.l); m.step(0x0979, 4);
      // MUTANT: dropped second inc l
      if (regs.djnz() !== 0) { m.step(0x0977, 13); continue; }
      m.step(0x097c, 8); break;
    }
    m.ret();
  };
  const m = mk();
  m.regs.a = 0xab;
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4029), 0x00));
});
