// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0550 — equivalent to the frozen oracle at ROM 0x0550 (play-field init, an rst-28 state handler).
 * Clears four work-RAM spans (0x4100/128, 0x4200/23, 0x4218/24, 0x4260/70), sets 0x425f=0 and 0x4226=1,
 * bumps the sequence step (0x400a), arms the dwell timer (0x4009=0x20), and seeds the 16-bit VRAM cursor
 * (0x400b=0x5000). It also turns both start lamps off (write side of 0x6000/0x6001 -> io.startLamp[0/1],
 * board latches NOT in the state dump). Every span/cell is pre-poked with a sentinel so each write is
 * observable; EQUAL asserts ramDiff==null AND io.startLamp equality. Teeth: no-op, partial fill, missing
 * flag, missing sequence bump (RAM), and a no-lamp-clear twin (io).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_0550 as cand } from "../loc_0550.js";
import { loc_0550 as oracle } from "../../translated/loc_0550.js";

const SPANS = [[0x4100, 128], [0x4200, 23], [0x4218, 24], [0x4260, 70]];
const FLAG_425F = 0x425f;
const CELL_4226 = 0x4226;
const SEQ = 0x400a;
const DWELL = 0x4009;
const VPTR = 0x400b; // 16-bit
const LAMP0 = 0x6000, LAMP1 = 0x6001; // write side -> io.startLamp[0/1]
const SENTINEL = 0xaa;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function entry() {
  return craft((mem8, m) => {
    m.push16(0x9999);
    for (const [base, len] of SPANS) for (let i = 0; i < len; i++) mem8[base + i] = SENTINEL;
    for (const c of [FLAG_425F, CELL_4226, SEQ, DWELL, VPTR, VPTR + 1]) mem8[c] = SENTINEL;
    mem8[LAMP0] = 1; mem8[LAMP1] = 1; // lamps lit so the routine's clear is observable
  });
}

function lampsAfter(fn, e) {
  const m = e.clone(); m.routines = STUBS; fn(m);
  return [m.mem.io.startLamp[0], m.mem.io.startLamp[1]];
}

test("EQUAL: loc_0550 == oracle initialises the play field (RAM + io)", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_0550 diverged in work RAM");
  assert.deepEqual(lampsAfter(cand, entry()), lampsAfter(oracle, entry()), "loc_0550 lamp latches diverged");

  // positive controls: the oracle really moves each live-out off its sentinel.
  const a = entry(); oracle(a);
  assert.equal(a.mem8[0x4100], 0, "span 0x4100 cleared");
  assert.equal(a.mem8[0x417f], 0, "span 0x4100 cleared to its end");
  assert.equal(a.mem8[0x42a5], 0, "span 0x4260 cleared to its end");
  assert.equal(a.mem8[CELL_4226], 1, "0x4226 set to 1");
  assert.equal(a.mem8[SEQ], (SENTINEL + 1) & 0xff, "sequence step bumped");
  assert.equal(a.mem8[DWELL], 0x20, "dwell timer armed");
  assert.equal(a.mem8[VPTR], 0x00, "VRAM cursor low byte");
  assert.equal(a.mem8[VPTR + 1], 0x50, "VRAM cursor high byte");
  assert.deepEqual(lampsAfter(oracle, entry()), [0, 0], "both start lamps turned off");
  console.log("  EQUAL: loc_0550 == oracle (RAM + io.startLamp), play field initialised");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const partialFill = (m) => { cand(m); m.mem8[0x417f] = SENTINEL; };        // last cell of span 1 unfilled
  const missFlag = (m) => { cand(m); m.mem8[CELL_4226] = 0; };               // 0x4226 not set
  const missSeqBump = (m) => { cand(m); m.mem8[SEQ] = (m.mem8[SEQ] - 1) & 0xff; }; // no sequence bump
  const noLampClear = (m) => { cand(m); m.mem.io.startLamp[0] = 1; };        // lamp0 left lit

  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, partialFill, entry()), "the partial-fill twin escaped");
  assert.ok(ramDiff(oracle, missFlag, entry()), "the missing-flag twin escaped");
  assert.ok(ramDiff(oracle, missSeqBump, entry()), "the missing-sequence-bump twin escaped");
  const l = lampsAfter(noLampClear, entry());
  assert.notDeepEqual(l, lampsAfter(oracle, entry()), "the no-lamp-clear twin escaped (io)");
  console.log("  TEETH: no-op, partial-fill, missing-flag, missing-bump (RAM), no-lamp-clear (io) all caught");
});
