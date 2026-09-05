// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0341 — memory-equivalent to the frozen oracle at ROM 0x0341.
 * Initialises one 32-byte descriptor slot from the number at (HL): index = number-1 picks the slot at
 * 0x4330 + index*32, then stamps [0]=1, [2]=0x0d, [5]=0x0c, [7]=index and clears [1]/[4] ([3],[6] left).
 * The caller consumes no register (A is discarded, HL/DE restored across the exx), so the live-out is RAM
 * only. Numbers 1..6 keep every slot inside the captured work-RAM dump and clear of the masked stack
 * window. Teeth: no-op, wrong field value, wrong index, and a twin that clobbers a supposedly-skipped cell.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_0341 as cand } from "../loc_0341.js";
import { loc_0341 as oracle } from "../../translated/loc_0341.js";

const SLOT_TABLE = 0x4330;
const SLOT_SIZE = 32;
const PTR = 0x4010; // holds the descriptor number; work RAM, clear of every slot used here
const SENTINEL = 0xaa; // pre-poked across the slot so each write is observable
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function slotBase(number) { return SLOT_TABLE + (number - 1) * SLOT_SIZE; }

function entry(number) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    mem8[PTR] = number;
    m.regs.hl = PTR;
    const base = slotBase(number);
    for (let i = 0; i < SLOT_SIZE; i++) mem8[base + i] = SENTINEL;
  });
}

test("EQUAL: loc_0341 == oracle across slots 1..6 (RAM)", { skip }, () => {
  for (let n = 1; n <= 6; n++) {
    assert.equal(ramDiff(oracle, cand, entry(n)), null, `loc_0341 diverged for descriptor number ${n}`);
  }
  // positive control: the oracle overwrites the sentinels with the fixed init fields for slot 3.
  const a = entry(3); oracle(a);
  const base = slotBase(3);
  assert.equal(a.mem8[base], 1, "positive control: [0] init to 1");
  assert.equal(a.mem8[base + 2], 0x0d, "positive control: [2] init to 0x0d");
  assert.equal(a.mem8[base + 5], 0x0c, "positive control: [5] init to 0x0c");
  assert.equal(a.mem8[base + 7], 2, "positive control: [7] holds the index (number-1)");
  console.log("  EQUAL: loc_0341 == oracle (RAM), descriptor slots 1..6 initialised");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const N = 4;
  const base = slotBase(N);
  const idx = N - 1;
  const good = (m) => {
    m.mem8[base] = 1; m.mem8[base + 1] = 0; m.mem8[base + 2] = 0x0d;
    m.mem8[base + 4] = 0; m.mem8[base + 5] = 0x0c; m.mem8[base + 7] = idx;
  };
  const noOp = () => {};
  const wrongField = (m) => { good(m); m.mem8[base + 2] = 0x0e; };  // [2] should be 0x0d
  const wrongIndex = (m) => { good(m); m.mem8[base + 7] = idx + 1; }; // [7] should be the index
  const clobberSkip = (m) => { good(m); m.mem8[base + 3] = 0; };      // [3] must stay the sentinel

  assert.ok(ramDiff(oracle, noOp, entry(N)), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongField, entry(N)), "the wrong-field twin escaped");
  assert.ok(ramDiff(oracle, wrongIndex, entry(N)), "the wrong-index twin escaped");
  assert.ok(ramDiff(oracle, clobberSkip, entry(N)), "the clobbered-skip-cell twin escaped");
  console.log("  TEETH: no-op, wrong-field, wrong-index, clobbered-skip-cell all caught");
});
