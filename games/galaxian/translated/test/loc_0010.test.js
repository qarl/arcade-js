// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0010 (RST 10 vector, ROM 0x0010-0x0014): a memory FILL loop.
//   0010  77        ld (hl),a
//   0011  23        inc hl
//   0012  10 fc     djnz 0x0010
//   0014  c9        ret
// Contract (B=3, A=0xAB, HL=0x4100): writes 0xAB to 0x4100-0x4102, HL=0x4103, B=0,
// total 26*B+5 = 83 T (each iter 7+6, taken djnz 13 x(B-1), exit djnz 8, ret 10).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0010 } from "../loc_0010.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  return m;
}

function run(fn) {
  const m = mk();
  m.regs.hl = 0x4100;
  m.regs.b = 0x03;
  m.regs.a = 0xab;
  m.regs.sp = 0x4300;
  m.mem.write8(0x4300, 0x00); m.mem.write8(0x4301, 0x20); // ret -> 0x2000
  fn(m);
  return {
    cycles: m.cycles,
    hl: m.regs.hl,
    b: m.regs.b,
    pc: m.pc,
    fill: [m.mem.read8(0x4100), m.mem.read8(0x4101), m.mem.read8(0x4102), m.mem.read8(0x4103)],
  };
}

function checkSpec(r) {
  assert.equal(r.cycles, 83, "B=3: 26*3+5");
  assert.equal(r.hl, 0x4103, "HL advanced past the fill");
  assert.equal(r.b, 0x00, "B counted down to 0");
  assert.equal(r.pc, 0x2000, "ret to caller");
  assert.deepEqual(r.fill, [0xab, 0xab, 0xab, 0x00], "0x4100-0x4102 filled, 0x4103 untouched");
}

test("loc_0010: fills B bytes with A (B=3 -> 83 T)", () => {
  checkSpec(run(loc_0010));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0010.js
//   find: regs.hl = (regs.hl + 1) & 0xffff;\n    m.step(0x0012, 6); // inc hl
//   repl: m.step(0x0012, 6); // inc hl   (drops the pointer advance)
//   expect: FAIL  (all writes hit 0x4100; 0x4101/0x4102 stay 0, HL stays 0x4100)
//   verified-anchor: count == 1  (the sole `inc hl` in the loop)
test("loc_0010: the contract catches a missing inc hl", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, regs.a, 4);
      m.step(0x0011, 7);
      m.step(0x0012, 6); // MUTANT: no inc hl
      if (regs.djnz() !== 0) { m.step(0x0010, 13); continue; }
      m.step(0x0014, 8);
      break;
    }
    m.ret();
  };
  assert.throws(() => checkSpec(run(mutant)));
});
