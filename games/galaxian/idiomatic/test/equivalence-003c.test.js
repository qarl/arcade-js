// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_003c — memory-equivalent to the frozen oracle at ROM 0x003C.
 * The RNG step reads/advances/stores RNG_SEED (0x401e). A crafted entry seeds that cell to a known byte
 * and seats a ret; both sides must leave the same new seed (seed*5+1 mod 256) in memory. LIVE-OUT also
 * includes register A, but the RAM diff is memory-only and the return-stack window is masked by ramDiff.
 * Teeth: no-op, wrong multiplier, wrong increment, wrong cell.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { advanceRandomSeed as cand } from "../advanceRandomSeed.js";
import { loc_003c as oracle } from "../../translated/loc_003c.js";

const RNG_SEED = 0x401e;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A crafted entry with RNG_SEED poked to `seed` and a return address on the stack for the oracle's ret.
function entry(seed) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    mem8[RNG_SEED] = seed;
  });
}

// Broken twins (each one wrong write/const) that must make the RAM diff non-null.
function brokenNoOp() {}
function brokenMul(m) { m.mem8[RNG_SEED] = (m.mem8[RNG_SEED] * 3 + 1) & 0xff; }
function brokenInc(m) { m.mem8[RNG_SEED] = (m.mem8[RNG_SEED] * 5 + 2) & 0xff; }
function brokenCell(m) { m.mem8[0x401f] = (m.mem8[RNG_SEED] * 5 + 1) & 0xff; }

test("EQUAL: loc_003c == oracle across several seeds", { skip }, () => {
  for (const seed of [0x00, 0x01, 0x37, 0x80, 0xff]) {
    assert.equal(ramDiff(oracle, cand, entry(seed)), null, `loc_003c diverged at seed 0x${seed.toString(16)}`);
  }
  assert.ok(ramDiff(oracle, brokenNoOp, entry(0x37)), "vacuous: oracle changed no RAM");
  console.log("  EQUAL: loc_003c == oracle (RAM), RNG_SEED advanced seed*5+1");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, entry(0x37)), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, brokenMul, entry(0x37)), "the wrong-multiplier twin escaped");
  assert.ok(ramDiff(oracle, brokenInc, entry(0x37)), "the wrong-increment twin escaped");
  assert.ok(ramDiff(oracle, brokenCell, entry(0x37)), "the wrong-cell twin escaped");
  console.log("  TEETH: no-op, wrong *mul, wrong +inc, wrong cell all caught");
});
