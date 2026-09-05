// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0972 — memory-equivalent to the frozen oracle at ROM 0x0972.
 * A strided block writer: A -> 0x4028, 0x402a, ... 0x4038 (nine cells, stride 2). The crafted seed paints
 * the nine cells with a sentinel so every write is observable, sets A, and pushes a ret target. Live-out
 * is RAM only. Teeth: a no-op twin, a wrong-count twin (eight cells), and a wrong-stride twin (contiguous).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_0972 as cand } from "../loc_0972.js";
import { loc_0972 as oracle } from "../../translated/loc_0972.js";

const BASE = 0x4028;
const CELL_COUNT = 9;
const STRIDE = 2;
const VALUE = 0x77;
const SENTINEL = 0xee;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function seed() {
  return craft((mem8, m) => {
    for (let i = 0; i < CELL_COUNT; i++) mem8[BASE + i * STRIDE] = SENTINEL;
    m.regs.a = VALUE;
    m.push16(0x9999); // ret target for the oracle's `ret`
  });
}

test("EQUAL: loc_0972 == oracle (nine-cell stride-2 fill)", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, seed()), null, "loc_0972 diverged from the oracle");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongCount = (m, value = m.regs.a) => {
    const { mem8 } = m;
    for (let i = 0; i < CELL_COUNT - 1; i++) mem8[BASE + i * STRIDE] = value; // WRONG: eight cells
  };
  const wrongStride = (m, value = m.regs.a) => {
    const { mem8 } = m;
    for (let i = 0; i < CELL_COUNT; i++) mem8[BASE + i] = value; // WRONG: stride 1, not 2
  };
  assert.notEqual(ramDiff(oracle, noOp, seed()), null, "the no-op twin escaped (test is vacuous)");
  assert.notEqual(ramDiff(oracle, wrongCount, seed()), null, "the wrong-count twin escaped");
  assert.notEqual(ramDiff(oracle, wrongStride, seed()), null, "the wrong-stride twin escaped");
});
