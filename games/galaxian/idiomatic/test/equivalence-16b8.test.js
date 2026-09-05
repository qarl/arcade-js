// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_16b8 — equivalent to the frozen oracle at ROM 0x16b8.
 * Live-outs: the flag byte 0x4224 (in the state dump) and three sound_w latches 0x6800-0x6802
 * (io.soundReg[0..2], device latches NOT in the dump). The routine sums a 6x10 grid at 0x4123
 * (seeded 1) and lights that many of the three latches, capped at three, zeroing the rest; 0x4224
 * becomes 1 when the final tally < 2. Paths:
 *   - RUN (tally 3): latches [1,1,0], flag 1.
 *   - HIGH (tally 6): latches [1,1,1], flag 0.
 *   - GATE CLOSED (0x4007 bit 0 set): returns before touching anything.
 * EQUAL asserts ramDiff==null on each AND io.soundReg[0..2] equality. Teeth: no-op + wrong-flag (RAM),
 * wrong-latch (io), gate-ignoring (RAM). Positive controls: the oracle moves the flag and the latches.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_16b8 as cand } from "../loc_16b8.js";
import { loc_16b8 as oracle } from "../../translated/loc_16b8.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const FRAME_GATE = 0x4007;
const GRID = 0x4123;
const FLAG = 0x4224;
const SOUND = [0x6800, 0x6801, 0x6802]; // -> io.soundReg[0..2]
const SENT = 0xaa;

// Zero the 6x10 grid (rows 0x4123 + row*16, 10 cells each), gate open, flag + latches sentinelled.
function base(mem, mm) {
  for (let a = GRID; a <= 0x417c; a++) mem[a] = 0;
  mem[FRAME_GATE] = 0x00;
  mem[FLAG] = SENT;
  for (const s of SOUND) mm.mem.io.soundReg[s & 7] = 0xff;
  mm.push16(0x9999);
}
const runEntry = () => craft((mem, mm) => { base(mem, mm); mem[GRID] = 2; });   // tally 1+2 = 3
const highEntry = () => craft((mem, mm) => { base(mem, mm); mem[GRID] = 5; });  // tally 1+5 = 6
const gateClosed = () => craft((mem, mm) => { base(mem, mm); mem[FRAME_GATE] = 0x01; });

// The three latch writes are board device latches (not in dumpState); read them off the io device.
function latchesAfter(fn, e) {
  const m = e.clone(); m.routines = STUBS; fn(m);
  return SOUND.map((s) => m.mem.io.soundReg[s & 7]);
}
const flagAfter = (fn, e) => { const m = e.clone(); m.routines = STUBS; fn(m); return m.mem8[FLAG]; };

const noOp = () => {};
const wrongFlag = (m) => { m.mem8[SOUND[0]] = 1; m.mem8[SOUND[1]] = 1; m.mem8[SOUND[2]] = 0; m.mem8[FLAG] = 0; };
const wrongLatch = (m) => { m.mem8[SOUND[0]] = 1; m.mem8[SOUND[1]] = 1; m.mem8[SOUND[2]] = 1; m.mem8[FLAG] = 1; };
const ignoreGate = (m) => { m.mem8[FLAG] = (m.mem8[FLAG] + 1) & 0xff; };

test("EQUAL (crafted): loc_16b8 == oracle lights a partial latch run (tally 3)", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, runEntry()), null, "loc_16b8 RAM diverged on the run path");
  assert.deepEqual(latchesAfter(cand, runEntry()), latchesAfter(oracle, runEntry()), "loc_16b8 latch writes diverged");
  assert.deepEqual(latchesAfter(oracle, runEntry()), [1, 1, 0], "positive control: oracle latches [1,1,0]");
  assert.equal(flagAfter(oracle, runEntry()), 1, "positive control: oracle raised the flag");
  console.log("  EQUAL: loc_16b8 == oracle (RAM + io.soundReg[0..2]), tally 3 -> latches [1,1,0], flag 1");
});

test("EQUAL (crafted): loc_16b8 == oracle lights all latches (tally 6)", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, highEntry()), null, "loc_16b8 RAM diverged on the high path");
  assert.deepEqual(latchesAfter(cand, highEntry()), latchesAfter(oracle, highEntry()), "loc_16b8 latch writes diverged");
  assert.deepEqual(latchesAfter(oracle, highEntry()), [1, 1, 1], "positive control: oracle latches [1,1,1]");
  assert.equal(flagAfter(oracle, highEntry()), 0, "positive control: oracle cleared the flag");
  console.log("  EQUAL: loc_16b8 == oracle, tally 6 -> latches [1,1,1], flag 0");
});

test("EQUAL (crafted): loc_16b8 == oracle bails on the closed frame gate", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, gateClosed()), null, "loc_16b8 diverged on the gate-closed path");
  assert.deepEqual(latchesAfter(cand, gateClosed()), latchesAfter(oracle, gateClosed()), "gate-closed latch mismatch");
  assert.equal(flagAfter(oracle, gateClosed()), SENT, "positive control: gate closed -> flag untouched");
  console.log("  EQUAL: loc_16b8 == oracle, gate closed -> nothing written");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, runEntry()), "the no-op twin escaped (RAM)");
  assert.ok(ramDiff(oracle, wrongFlag, runEntry()), "the wrong-flag twin escaped (RAM)");
  assert.notDeepEqual(latchesAfter(wrongLatch, runEntry()), latchesAfter(oracle, runEntry()), "the wrong-latch twin escaped (io)");
  assert.ok(ramDiff(oracle, ignoreGate, gateClosed()), "the gate-ignoring twin escaped (RAM)");
  console.log("  TEETH: no-op, wrong-flag (RAM), wrong-latch (io), gate-ignoring all caught");
});
