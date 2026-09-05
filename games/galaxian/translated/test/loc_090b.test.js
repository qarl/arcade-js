// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_090b (Galaxian enqueue exit, ROM 0x090b-0x090c):
//   090b  e1  pop hl   ; restore HL saved by loc_08f2's push
//   090c  c9  ret
// Contract: 2 instr, 20 T (10+10), HL = top-of-stack word, ret pops the next word into PC.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_090b } from "../loc_090b.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  return m;
}

function run() {
  const m = mk();
  m.regs.sp = 0x4300;
  m.mem.write8(0x4300, 0x11); m.mem.write8(0x4301, 0x22); // HL <- 0x2211
  m.mem.write8(0x4302, 0x55); m.mem.write8(0x4303, 0x1a); // ret addr 0x1a55
  loc_090b(m);
  return { cycles: m.cycles, hl: m.regs.hl, pc: m.pc, sp: m.regs.sp };
}

function checkSpec(r) {
  assert.equal(r.cycles, 20, "pop hl (10) + ret (10)");
  assert.equal(r.hl, 0x2211, "pop hl restored HL from the stack");
  assert.equal(r.pc, 0x1a55, "ret popped the return address into PC");
  assert.equal(r.sp, 0x4304, "SP advanced past both popped words");
}

test("loc_090b: pop hl + ret; 20 T", () => {
  checkSpec(run());
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_090b.js
//   find: regs.hl = m.pop16();
//   repl: m.pop16(); // pop but drop the value
//   expect: FAIL  (HL never restored -> stays 0, caught by hl == 0x2211; pc still correct)
//   verified-anchor: count == 1  (the sole pop in loc_090b.js)
test("loc_090b: the contract catches a dropped pop-hl", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.pop16(); // MUTANT: value discarded, HL not written
    m.step(0x090c, 10);
    m.ret();
  };
  const m = mk();
  m.regs.sp = 0x4300;
  m.mem.write8(0x4300, 0x11); m.mem.write8(0x4301, 0x22);
  m.mem.write8(0x4302, 0x55); m.mem.write8(0x4303, 0x1a);
  mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, hl: m.regs.hl, pc: m.pc, sp: m.regs.sp }));
});
