// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a87 (Galaxian cold-boot hardware wipe, ROM 0x1a87-0x1a8f):
//   1a87  77        ld (hl),a      ; clear 0x6800..0x6807 (sound_w registers) with A=0
//   1a88  23        inc hl
//   1a89  10 fc     djnz 0x1a87
//   1a8b  06 08     ld b,0x08
//   1a8d  21 01 70  ld hl,0x7001
//   -> fall through to loc_1a90
// Contract (entry HL=0x6800, B=8, A=0): 220 T (loop 8*13 + 7*13 + 8 = 203, then 7+10=17),
// soundReg[0..7]=0, exit HL=0x7001 / B=8 / A=0, tail-calls loc_1a90.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a87 } from "../loc_1a87.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, stubs = { 0x1a90: "tail" }) {
  const m = mk(stubs);
  m.io.soundReg.fill(0xff); // pre-dirty so the A=0 clear is observable
  m.regs.hl = 0x6800; m.regs.b = 0x08; m.regs.a = 0x00;
  const ret = fn(m);
  return {
    cycles: m.cycles, calls: m.calls, ret,
    hl: m.regs.hl, b: m.regs.b, a: m.regs.a,
    sound: Array.from(m.io.soundReg),
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 220, "T-state total (loop 203 + ld b 7 + ld hl 10)");
  assert.deepEqual(res.calls, [0x1a90], "tail-calls loc_1a90");
  assert.equal(res.ret, "TAIL", "the tail-call result propagates out");
  assert.deepEqual(res.sound, [0, 0, 0, 0, 0, 0, 0, 0], "cleared the eight 0x6800 sound_w registers");
  assert.equal(res.hl, 0x7001, "exit HL=0x7001 (reloaded for the control-latch clear)");
  assert.equal(res.b, 0x08, "exit B=8");
  assert.equal(res.a, 0x00, "exit A=0 (unchanged)");
}

test("loc_1a87: clears the 0x6800 sound_w regs, reloads for 0x7001, tail-calls loc_1a90; 220 T", () => {
  checkSpec(run(loc_1a87));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a87.js
//   find: regs.hl = 0x7001;
//   repl: regs.hl = 0x7000;
//   expect: FAIL  (wrong reload target -> exit HL != 0x7001, caught by the HL assertion)
//   verified-anchor: count == 1  (the sole "regs.hl = 0x7001" in loc_1a87.js)
test("loc_1a87: the contract catches a wrong HL reload", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, regs.a, 4);
      m.step(0x1a88, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x1a89, 6);
      if (m.regs.djnz() !== 0) { m.step(0x1a87, 13); continue; }
      m.step(0x1a8b, 8);
      break;
    }
    regs.b = 0x08;
    m.step(0x1a8d, 7);
    regs.hl = 0x7000; // MUTANT: wrong reload target
    m.step(0x1a90, 10);
    return m.call(0x1a90);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
