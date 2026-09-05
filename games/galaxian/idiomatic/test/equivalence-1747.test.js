// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1747 — memory-equivalent to the frozen oracle at ROM 0x1747.
 * The request-gated sequence arm: it fires ONLY when the request byte 0x41d1 holds exactly 1 (the ROM's
 * `dec a; ret nz`), and when it fires it consumes the request (0x41d1 -> 0), raises the track flag
 * (0x41d2 -> 1) and its companion (0x41d6 -> 1), and points the 16-bit sequence pointer (0x41d3) at the
 * data table 0x1e68. Two seeds exercise both arms: a request-pending seed (0x41d1 = 1, full write path)
 * and an idle seed (0x41d1 = 5, no writes). Live-out is RAM only; the pushed word feeds the oracle's ret.
 * Teeth: a no-op twin and a wrong-value twin against the firing seed, plus a no-gate twin (arms
 * unconditionally) against the idle seed to prove the gate itself has bite.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_1747 as cand } from "../loc_1747.js";
import { loc_1747 as oracle } from "../../translated/loc_1747.js";

const REQUEST = 0x41d1; // arm-request gate: fires only when it holds 1, then cleared to 0
const TRACK = 0x41d2; // track sequence-active flag, raised to 1 on fire
const COMPANION = 0x41d6; // companion flag, raised to 1 on fire
const PTR_LO = 0x41d3; // 16-bit sequence-data pointer (low byte)
const PTR_HI = 0x41d4; // ...high byte
const SEQ_DATA = 0x1e68; // the data table the pointer is aimed at
const SENTINEL = 0xaa;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// Request pending (0x41d1 == 1): the full arm-and-consume write path runs.
function seedFire() {
  return craft((mem8, m) => {
    mem8[REQUEST] = 1;
    mem8[TRACK] = SENTINEL;
    mem8[COMPANION] = SENTINEL;
    mem8[PTR_LO] = SENTINEL;
    mem8[PTR_HI] = SENTINEL;
    m.push16(0x9999); // ret target for the oracle's `ret`
  });
}

// No request (0x41d1 != 1): the gate returns immediately and writes nothing.
function seedIdle() {
  return craft((mem8, m) => {
    mem8[REQUEST] = 5;
    mem8[TRACK] = SENTINEL;
    mem8[COMPANION] = SENTINEL;
    mem8[PTR_LO] = SENTINEL;
    mem8[PTR_HI] = SENTINEL;
    m.push16(0x9999);
  });
}

test("EQUAL: loc_1747 == oracle (fire path and idle path)", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, seedFire()), null, "loc_1747 diverged on the firing path");
  assert.equal(ramDiff(oracle, cand, seedIdle()), null, "loc_1747 diverged on the idle path");

  // Positive control: on the firing seed the oracle really consumes the request and arms the sequence.
  const e = seedFire();
  oracle(e);
  assert.equal(e.mem8[REQUEST], 0, "positive control: request 1 -> 0 (consumed)");
  assert.equal(e.mem8[TRACK], 1, "positive control: track flag raised");
  assert.equal(e.mem8[COMPANION], 1, "positive control: companion flag raised");
  assert.equal(e.mem8[PTR_LO], SEQ_DATA & 0xff, "positive control: pointer low = data table");
  assert.equal(e.mem8[PTR_HI], (SEQ_DATA >> 8) & 0xff, "positive control: pointer high = data table");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongValue = (m) => {
    const { mem8 } = m;
    if (mem8[REQUEST] !== 1) return;
    mem8[REQUEST] = 0;
    mem8[TRACK] = 2; // WRONG: flag should be 1
    mem8[COMPANION] = 1;
    m.mem16[PTR_LO] = SEQ_DATA;
  };
  const noGate = (m) => {
    const { mem8 } = m;
    mem8[REQUEST] = 0; // WRONG: arms unconditionally, ignoring the request gate
    mem8[TRACK] = 1;
    mem8[COMPANION] = 1;
    m.mem16[PTR_LO] = SEQ_DATA;
  };
  assert.notEqual(ramDiff(oracle, noOp, seedFire()), null, "the no-op twin escaped (test is vacuous)");
  assert.notEqual(ramDiff(oracle, wrongValue, seedFire()), null, "the wrong-value twin escaped");
  assert.notEqual(ramDiff(oracle, noGate, seedIdle()), null, "the no-gate twin escaped");
});
