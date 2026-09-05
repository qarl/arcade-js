// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a90 (Galaxian cold-boot hardware wipe, ROM 0x1a90-0x1a99):
//   1a90  77        ld (hl),a      ; clear 0x7001..0x7008 control-latch block with A=0
//   1a91  23        inc hl
//   1a92  10 fc     djnz 0x1a90
//   1a94  3d        dec a          ; A = 0x00 - 1 = 0xFF
//   1a95  32 00 78  ld (0x7800),a  ; sound pitch latch = 0xFF
//   1a98  0e 20     ld c,0x20
//   -> fall through to loc_1a9a
// Contract (entry HL=0x7001, B=8, A=0): 227 T (loop 203, then dec 4 + ld (nn),a 13 + ld c 7 = 24),
// irq_enable/stars/flip_x/flip_y cleared, soundPitch=0xFF, exit HL=0x7009 / A=0xFF / C=0x20, tail-calls loc_1a9a.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a90 } from "../loc_1a90.js";

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

function run(fn, stubs = { 0x1a9a: "tail" }) {
  const m = mk(stubs);
  m.io.irqEnable = 1; m.io.starsEnable = 1; m.io.flipX = 1; m.io.flipY = 1; // pre-set so the clears show
  m.regs.hl = 0x7001; m.regs.b = 0x08; m.regs.a = 0x00; m.regs.c = 0x00;
  const ret = fn(m);
  return {
    cycles: m.cycles, calls: m.calls, ret,
    hl: m.regs.hl, a: m.regs.a, c: m.regs.c,
    irq: m.io.irqEnable, stars: m.io.starsEnable, flipX: m.io.flipX, flipY: m.io.flipY,
    pitch: m.io.soundPitchVal,
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 227, "T-state total (loop 203 + dec 4 + ld (nn),a 13 + ld c 7)");
  assert.deepEqual(res.calls, [0x1a9a], "tail-calls loc_1a9a");
  assert.equal(res.ret, "TAIL", "the tail-call result propagates out");
  assert.equal(res.irq, 0, "0x7001 write cleared irq_enable");
  assert.equal(res.stars, 0, "0x7004 write cleared stars_enable");
  assert.equal(res.flipX, 0, "0x7006 write cleared flip_x");
  assert.equal(res.flipY, 0, "0x7007 write cleared flip_y");
  assert.equal(res.pitch, 0xff, "dec a -> 0xFF stored to the 0x7800 sound pitch latch");
  assert.equal(res.hl, 0x7009, "exit HL=0x7009 (0x7001 + 8)");
  assert.equal(res.a, 0xff, "exit A=0xFF (dec a from 0)");
  assert.equal(res.c, 0x20, "exit C=0x20");
}

test("loc_1a90: clears the 0x7001 latch block, sets pitch=0xFF, tail-calls loc_1a9a; 227 T", () => {
  checkSpec(run(loc_1a90));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a90.js
//   find: regs.a = regs.dec8(regs.a);
//   repl: regs.a = regs.inc8(regs.a);
//   expect: FAIL  (inc not dec -> A=0x01, pitch=0x01 != 0xFF, caught by the pitch + A assertions)
//   verified-anchor: count == 1  (the sole dec8 in loc_1a90.js)
test("loc_1a90: the contract catches inc-instead-of-dec on A", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, regs.a, 4);
      m.step(0x1a91, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x1a92, 6);
      if (m.regs.djnz() !== 0) { m.step(0x1a90, 13); continue; }
      m.step(0x1a94, 8);
      break;
    }
    regs.a = regs.inc8(regs.a); // MUTANT: inc instead of dec
    m.step(0x1a95, 4);
    mem.write8(0x7800, regs.a, 10);
    m.step(0x1a98, 13);
    regs.c = 0x20;
    m.step(0x1a9a, 7);
    return m.call(0x1a9a);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
