// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1733 (Galaxian tone toggler, ROM 0x1733-0x1746):
//   1733  3a ce 41  ld a,(0x41ce)   ; remaining duration
//   1736  a7        and a           ; Z when 0
//   1737  ca 43 17  jp z,0x1743     ; spent -> store A(=0)
//   173a  3d        dec a
//   173b  32 ce 41  ld (0x41ce),a   ; duration--
//   173e  3a 07 40  ld a,(0x4007)   ; frame flag
//   1741  ee 01     xor 0x01        ; toggle bit0
//   1743  32 05 68  ld (0x6805),a   ; sound_w reg5
//   1746  c9        ret
// Contract (0x41ce=5, 0x4007=0): 87 T (13+4+10+4+13+13+7+13+10), reg5 = 0^1 = 1, 0x41ce=4.
// Branch (0x41ce=0): 50 T (13+4+10+13+10), reg5 = 0, 0x41ce untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1733 } from "../loc_1733.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, { ce = 0x05, frame = 0x00 } = {}) {
  const m = mk();
  m.regs.sp = 0x4400;
  m.mem.write8(0x41ce, ce);
  m.mem.write8(0x4007, frame);
  fn(m);
  return { cycles: m.cycles, calls: m.calls, reg5: m.io.soundReg[5], ce: m.mem.read8(0x41ce) };
}

function checkSpec(r) {
  assert.equal(r.cycles, 87, "T-state total of the active path");
  assert.deepEqual(r.calls, [], "no subroutine calls");
  assert.equal(r.reg5, 0x01, "sound_w reg5 = frame flag(0) ^ 1");
  assert.equal(r.ce, 0x04, "0x41ce decremented");
}

test("loc_1733: active duration toggles bit0 of the frame flag into reg5; 87 T", () => {
  checkSpec(run(loc_1733));
});

test("loc_1733: spent duration (0) takes jp z and writes reg5=0", () => {
  const r = run(loc_1733, { ce: 0x00 });
  assert.equal(r.cycles, 50, "ld + and + jp z(taken) + store + ret");
  assert.equal(r.reg5, 0x00, "reg5 gets A(=0)");
  assert.equal(r.ce, 0x00, "0x41ce untouched on the spent path");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1733.js
//   find: regs.xor(0x01);
//   repl: regs.xor(0x00);   (no toggle)
//   expect: FAIL  (reg5 = 0 not 1 -- caught by reg5 == 0x01; cycles unchanged, xor n = 7 either way)
//   verified-anchor: count == 1  (the sole regs.xor(0x01) in loc_1733.js)
test("loc_1733: the contract catches a dropped bit0 toggle", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x41ce); m.step(0x1736, 13);
    regs.and(regs.a); m.step(0x1737, 4);
    if (regs.fNZ) {
      m.step(0x173a, 10);
      regs.a = regs.dec8(regs.a); m.step(0x173b, 4);
      mem.write8(0x41ce, regs.a); m.step(0x173e, 13);
      regs.a = mem.read8(0x4007); m.step(0x1741, 13);
      regs.xor(0x00); m.step(0x1743, 7); // MUTANT: no toggle
    } else {
      m.step(0x1743, 10);
    }
    mem.write8(0x6805, regs.a, 10); m.step(0x1746, 13);
    return m.ret();
  };
  const m = mk();
  m.regs.sp = 0x4400; m.mem.write8(0x41ce, 0x05); m.mem.write8(0x4007, 0x00);
  mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, calls: m.calls, reg5: m.io.soundReg[5], ce: m.mem.read8(0x41ce) }));
});
