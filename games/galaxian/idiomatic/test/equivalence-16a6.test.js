// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_16a6 — memory-equivalent to the frozen oracle at ROM 0x16a6.
 * Two live-outs: the one-byte decrement of the sweep countdown (0x41df, in the state dump) and the
 * rotate-right-2 write to sound register 4 (0x6804 -> io.soundReg[4], memory-mapped I/O, NOT in the
 * state dump). We exercise three paths:
 *   - RUN: alternate-frame gate open (0x4007 bit 0 clear) and countdown nonzero -> decrement + reg write.
 *   - GATE CLOSED: 0x4007 bit 0 set -> both leave the countdown untouched and write nothing.
 *   - EXHAUSTED: countdown already 0 -> both leave it at 0 and write nothing.
 * EQUAL asserts ramDiff==null on all three AND io.soundReg[4] equality on the run path. Teeth: on the
 * run path a no-op, decrement-by-two, wrong-cell (RAM) and no-rotate (io) twin; on the gate-closed path
 * a gate-ignoring twin. The return-stack window is masked by ramDiff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_16a6 as cand } from "../loc_16a6.js";
import { loc_16a6 as oracle } from "../../translated/loc_16a6.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const FRAME_GATE = 0x4007;
const COUNTDOWN = 0x41df;
const SOUND_REG4 = 0x6804; // -> io.soundReg[4]
const START = 0x08;

// Gate open (bit 0 clear), countdown running.
const runEntry = () => craft((mem, mm) => { mm.push16(0x9999); mem[FRAME_GATE] = 0x00; mem[COUNTDOWN] = START; });
// Gate closed (bit 0 set): the routine must bail before touching the countdown.
const gateClosed = () => craft((mem, mm) => { mm.push16(0x9999); mem[FRAME_GATE] = 0x01; mem[COUNTDOWN] = START; });
// Countdown exhausted: gate open but nothing left to sweep.
const exhausted = () => craft((mem, mm) => { mm.push16(0x9999); mem[FRAME_GATE] = 0x00; mem[COUNTDOWN] = 0x00; });

// The sound-register write is a board device latch (not in dumpState); read it off the io device.
function reg4After(fn, e) {
  const m = e.clone(); m.routines = STUBS; fn(m); return m.mem.io.soundReg[4];
}

const noOp = () => {};
const decTwice = (m) => { m.mem8[COUNTDOWN] = (m.mem8[COUNTDOWN] - 2) & 0xff; };
const wrongCell = (m) => { m.mem8[COUNTDOWN + 1] = (m.mem8[COUNTDOWN + 1] - 1) & 0xff; };
const ignoreGate = (m) => { m.mem8[COUNTDOWN] = (m.mem8[COUNTDOWN] - 1) & 0xff; };
// Decrements correctly but writes the RAW countdown (not rotated right two) to the sound register.
const noRotate = (m) => { const cd = m.mem8[COUNTDOWN]; m.mem8[SOUND_REG4] = cd; m.mem8[COUNTDOWN] = (cd - 1) & 0xff; };

test("EQUAL (crafted): loc_16a6 == oracle ticks the countdown and writes the sweep value", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, runEntry()), null, "loc_16a6 diverged on the run path");
  assert.equal(reg4After(cand, runEntry()), reg4After(oracle, runEntry()), "loc_16a6 sound-reg write diverged");
  const a = runEntry(); oracle(a);
  assert.equal(a.mem8[COUNTDOWN], START - 1, "positive control: oracle really decremented the countdown");
  assert.equal(reg4After(oracle, runEntry()), (START >> 2) | ((START << 6) & 0xff),
    "positive control: oracle wrote the rotated sweep value to the sound register");
  console.log(`  EQUAL: loc_16a6 == oracle (RAM + io.soundReg[4]), countdown ${START}->${START - 1}`);
});

test("EQUAL (crafted): loc_16a6 == oracle bails on the closed frame gate", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, gateClosed()), null, "loc_16a6 diverged on the gate-closed path");
  const a = gateClosed(); oracle(a);
  assert.equal(a.mem8[COUNTDOWN], START, "positive control: gate closed -> countdown untouched");
  console.log("  EQUAL: loc_16a6 == oracle (RAM), gate closed -> no tick");
});

test("EQUAL (crafted): loc_16a6 == oracle leaves an exhausted countdown at 0", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, exhausted()), null, "loc_16a6 diverged on the exhausted path");
  const a = exhausted(); oracle(a);
  assert.equal(a.mem8[COUNTDOWN], 0, "positive control: exhausted -> stays 0");
  console.log("  EQUAL: loc_16a6 == oracle (RAM), countdown exhausted -> no tick");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, runEntry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, decTwice, runEntry()), "the decrement-by-two twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, runEntry()), "the wrong-cell twin escaped");
  assert.ok(ramDiff(oracle, ignoreGate, gateClosed()), "the gate-ignoring twin escaped");
  assert.notEqual(reg4After(noRotate, runEntry()), reg4After(oracle, runEntry()), "the no-rotate twin escaped (io)");
  console.log("  TEETH: no-op, decrement-by-two, wrong-cell, gate-ignoring (RAM), no-rotate (io) all caught");
});
