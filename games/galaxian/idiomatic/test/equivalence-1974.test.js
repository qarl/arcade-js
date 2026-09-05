// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1974 — crafted-entry equivalence vs the frozen coin-counter-pulse leaf at ROM 0x1974.
 * The routine rotates A right three times (bit 3 -> bit 0), stores the result to the 0x6003 coin_count_0
 * latch, then decrements the byte at HL. The latch write is memory-mapped I/O (routed by write8 to
 * io.setCoinCounter, NOT part of dumpState), so EQUAL asserts THREE live-outs: the decremented counter
 * cell at HL (ramDiff), register A (the rotated byte), and the coin-counter latch (io.coinCounter[0]).
 * Non-vacuous: the oracle steps 0x4003 from 0x05 to 0x04 and drives coin_count_0 D0 to 1. Teeth: no-op,
 * wrong-step, wrong-cell (RAM), no-rotate (register A), and no-latch (io) twins.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff, STUBS } from "./_bootSetup.js";
import { pulseCoinCounter as cand } from "../pulseCoinCounter.js";
import { loc_1974 as oracle } from "../../translated/loc_1974.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const COUNTER = 0x4003; // the shipped-game counter cell HL points at (work RAM, captured by dumpState)
const START = 0x05;     // seeded counter value; the oracle's `dec (hl)` must leave 0x04
const A_IN = 0x88;      // incoming A; rrca x3 (rotate right 3) -> 0x11, latched to 0x6003 D0=1

// A crafted entry: return word for the oracle's ret, A = the byte to rotate/latch, HL = the counter
// pointer, and the counter cell pre-seeded so the decrement is observable.
function entry(aIn = A_IN, start = START) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.a = aIn;
    m.regs.hl = COUNTER;
    mem8[COUNTER] = start;
  });
}

// null == equivalent on register A (the rotated byte) after running from the same entry.
function aDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  return a.regs.a === b.regs.a ? null : `A: 0x${a.regs.a.toString(16)} vs 0x${b.regs.a.toString(16)}`;
}

// The coin-counter output is a board latch (not in dumpState); read it off the io device directly.
function coinAfter(fn, e) {
  const m = e.clone(); m.routines = STUBS; fn(m); return m.mem.io.coinCounter[0];
}

test("EQUAL (crafted): loc_1974 == oracle on the counter cell, register A and the coin latch", { skip }, () => {
  const cases = [[0x88, 0x05], [0x08, 0x40], [0x00, 0x01], [0xff, 0x80]];
  for (const [aIn, start] of cases) {
    assert.equal(ramDiff(oracle, cand, entry(aIn, start)), null,
      `loc_1974 RAM diverged (A=0x${aIn.toString(16)} start=0x${start.toString(16)})`);
    assert.equal(aDiff(cand, entry(aIn, start)), null,
      `loc_1974 register A diverged (A=0x${aIn.toString(16)})`);
    assert.equal(coinAfter(cand, entry(aIn, start)), coinAfter(oracle, entry(aIn, start)),
      `loc_1974 coin latch diverged (A=0x${aIn.toString(16)})`);
  }
  // non-vacuous: the oracle steps the counter 0x05->0x04 and drives coin_count_0 D0 to 1.
  const a = entry().clone(); a.routines = STUBS; oracle(a);
  assert.equal(a.mem8[COUNTER], 0x04, "oracle did not decrement the counter cell");
  assert.equal(coinAfter(oracle, entry()), 1, "oracle did not pulse coin_count_0 to 1");
  console.log("  EQUAL: loc_1974 == oracle; 0x4003 decremented, A rotated, coin latch pulsed");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};                                                        // never decrements
  const wrongStep = (m) => { m.mem8[COUNTER] = (m.mem8[COUNTER] - 2) & 0xff; }; // decrements by 2
  const wrongCell = (m) => { m.mem8[(COUNTER + 1) & 0xffff] = 0x00; };          // touches the wrong cell
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongStep, entry()), "the wrong-step twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, entry()), "the wrong-cell twin escaped");
  // register-A teeth: a twin that skips the rotate leaves A unrotated.
  const noRotate = (m) => { m.mem8[COUNTER] = (m.mem8[COUNTER] - 1) & 0xff; };  // decrements but leaves A
  assert.ok(aDiff(noRotate, entry()), "the no-rotate twin escaped on register A");
  // io teeth: a twin that decrements + rotates A but never pulses the coin latch leaves it at 0.
  const noLatch = (m) => { m.mem8[COUNTER] = (m.mem8[COUNTER] - 1) & 0xff; m.regs.a = 0x11; };
  assert.notEqual(coinAfter(noLatch, entry()), coinAfter(oracle, entry()), "the no-latch twin escaped (io)");
  console.log("  TEETH: no-op, wrong-step, wrong-cell (RAM), no-rotate (A), no-latch (io) all caught");
});
