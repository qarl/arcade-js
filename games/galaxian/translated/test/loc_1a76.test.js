// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a76 (Galaxian cold-boot 0x6000-block latch-clear loop, ROM 0x1A76-0x1A7C):
//   1a76  77     ld (hl),a   ; hw latch write (busOffset 4)
//   1a77  23     inc hl
//   1a78  10 fc  djnz 0x1a76 ; 4 latches: 0x6000-0x6003
//   1a7a  3c     inc a
//   1a7b  06 04  ld b,0x04
// Contract (enter HL=0x6000, A=0, B=4): 3*(7+6+13) + (7+6+8) + 4 + 7 = 110 T; writes 0 to the four
// latches (start_lamp0/1, coin_lock, coin_count_0); ends HL=0x6004, A=1, B=4; tail-falls into loc_1a7d.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a76 } from "../loc_1a76.js";

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

function run(fn, stubs = { 0x1a7d: "tail" }) {
  const m = mk(stubs);
  m.regs.hl = 0x6000;
  m.regs.a = 0x00;
  m.regs.b = 0x04;
  // pre-set the latches so the A=0 writes are observable as a clear
  m.io.startLamp = [1, 1];
  m.io.coinLock = 1;
  m.io.coinCounter = [1, 0];
  const ret = fn(m);
  return {
    cycles: m.cycles, calls: m.calls, ret,
    a: m.regs.a, hl: m.regs.hl, b: m.regs.b,
    lamp0: m.io.startLamp[0], lamp1: m.io.startLamp[1],
    coinLock: m.io.coinLock, coinCount0: m.io.coinCounter[0],
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 110, "T-state total (3*26 + 21 + 4 + 7)");
  assert.deepEqual(res.calls, [0x1a7d], "tail-falls into the 0x6004-block set loop 0x1a7d");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates out");
  assert.equal(res.lamp0, 0, "0x6000 <- 0 clears start_lamp0");
  assert.equal(res.lamp1, 0, "0x6001 <- 0 clears start_lamp1");
  assert.equal(res.coinLock, 0, "0x6002 <- 0 clears coin_lock");
  assert.equal(res.coinCount0, 0, "0x6003 <- 0 clears coin_count_0");
  assert.equal(res.hl, 0x6004, "ends HL=0x6004 (next latch block)");
  assert.equal(res.a, 0x01, "inc a -> A=1 (fill value for 0x6004-0x6007)");
  assert.equal(res.b, 0x04, "ld b,0x04 -> B=4");
}

test("loc_1a76: clears the four 0x6000-block latches, falls into 0x1a7d; 110 T", () => {
  checkSpec(run(loc_1a76));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a76.js
//   find: regs.a = regs.inc8(regs.a);
//   repl: /* removed inc a */ void 0;
//   expect: FAIL  (A must be bumped to 1 for the next latch pass -- caught by a == 1)
//   verified-anchor: count == 1  (the sole "regs.inc8(regs.a)" in loc_1a76.js)
test("loc_1a76: the contract catches a dropped inc a", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, regs.a, 4);
      m.step(0x1a77, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x1a78, 6);
      if (m.regs.djnz() !== 0) { m.step(0x1a76, 13); continue; }
      m.step(0x1a7a, 8);
      break;
    }
    void 0; // MUTANT: dropped inc a
    m.step(0x1a7b, 4);
    regs.b = 0x04;
    m.step(0x1a7d, 7);
    return m.call(0x1a7d);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
