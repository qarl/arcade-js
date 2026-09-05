// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_20cd — crafted-entry equivalence vs the frozen tail at ROM 0x20cd.
 * It stamps three tilemap cells from HL stepping by DE (top = A+1, then two fixed tiles), then clears
 * the status flag at 0x40ab only when B bit 4 is clear AND the gate cell 0x4006 is zero. Registers A/HL
 * are dead-out (the return target overwrites them), so the whole live-out is RAM and ramDiff suffices.
 * Three entries exercise the branches: (1) B bit4 set, (2) bit4 clear but 0x4006 nonzero, (3) bit4 clear
 * and 0x4006 zero (the only path that clears 0x40ab). Cells and the flag are pre-dirtied with sentinels so
 * every write is observable. Teeth: no-op, wrong code, each missing tile, and a wrong flag on both gates.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_20cd as cand } from "../loc_20cd.js";
import { loc_20cd as oracle } from "../../translated/loc_20cd.js";

const CODE = 0x40;
const DEST = 0x5340; // VIDEO RAM; DEST, DEST+STRIDE, DEST+2*STRIDE all land in 0x5000-0x53ff
const STRIDE = 0x0020;
const GATE = 0x4006; // when zero (and B bit4 clear) the flag is cleared
const FLAG = 0x40ab; // the status flag the third path clears to 0
const SENTINEL = 0xaa; // pre-poked into the three tile cells (differs from every stamped value)
const FLAG_SENTINEL = 0x77; // pre-poked into the flag so clearing it to 0 is observable
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A crafted entry: A=code, HL=dest, DE=stride, B=flags, gate cell set, three cells + flag pre-dirtied.
function entry(flags, gate) {
  return craft((mem8, m) => {
    m.push16(0x9999); // for the oracle's ret
    m.regs.a = CODE;
    m.regs.hl = DEST;
    m.regs.de = STRIDE;
    m.regs.b = flags;
    mem8[GATE] = gate;
    mem8[FLAG] = FLAG_SENTINEL;
    mem8[DEST] = SENTINEL;
    mem8[(DEST + STRIDE) & 0xffff] = SENTINEL;
    mem8[(DEST + 2 * STRIDE) & 0xffff] = SENTINEL;
  });
}

const hideSet = () => entry(0x10, 5); // B bit4 set: paint only, leave the flag
const gateNonzero = () => entry(0x00, 5); // bit4 clear, gate nonzero: paint only, leave the flag
const clears = () => entry(0x00, 0); // bit4 clear, gate zero: paint AND clear the flag

// Twins: correct-paint-but-wrong-flag on the clearing path, and paint defects.
const brokenNoOp = () => {};
const brokenWrongCode = (m) => { m.mem8[DEST] = CODE; m.mem8[(DEST + STRIDE) & 0xffff] = 0x25; m.mem8[(DEST + 2 * STRIDE) & 0xffff] = 0x20; };
const brokenNoMid = (m) => { m.mem8[DEST] = CODE + 1; m.mem8[(DEST + 2 * STRIDE) & 0xffff] = 0x20; };
const brokenNoBottom = (m) => { m.mem8[DEST] = CODE + 1; m.mem8[(DEST + STRIDE) & 0xffff] = 0x25; };
const brokenNoClear = (m) => { m.mem8[DEST] = CODE + 1; m.mem8[(DEST + STRIDE) & 0xffff] = 0x25; m.mem8[(DEST + 2 * STRIDE) & 0xffff] = 0x20; }; // paints but skips the flag clear
const brokenOverClear = (m) => { cand(m); m.mem8[FLAG] = 0; }; // clears the flag even when it must not

test("EQUAL (crafted): loc_20cd == oracle across all three paths", { skip }, () => {
  for (const mk of [hideSet, gateNonzero, clears]) {
    assert.equal(ramDiff(oracle, cand, mk()), null, "loc_20cd RAM diverged");
  }
  // non-vacuous: the paint changes the sentinel cells, and the clearing path zeroes the sentinel flag.
  assert.ok(ramDiff(oracle, brokenNoOp, hideSet()), "vacuous: oracle changed no RAM");
  const c = clears().clone(); c.routines = STUBS;
  assert.equal(c.mem8[FLAG], FLAG_SENTINEL, "seed did not arm the flag");
  oracle(c);
  assert.equal(c.mem8[FLAG], 0, "oracle did not clear the flag on the zero-gate path");
  console.log("  EQUAL: 3 cells stamped on every path; flag cleared only when bit4 clear + gate zero");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, clears()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, brokenWrongCode, clears()), "wrong-code twin escaped");
  assert.ok(ramDiff(oracle, brokenNoMid, clears()), "missing-mid-tile twin escaped");
  assert.ok(ramDiff(oracle, brokenNoBottom, clears()), "missing-bottom-tile twin escaped");
  assert.ok(ramDiff(oracle, brokenNoClear, clears()), "no-clear twin escaped on the clearing path");
  assert.ok(ramDiff(oracle, brokenOverClear, hideSet()), "over-clear twin escaped on the leave-flag path");
  console.log("  TEETH: no-op, wrong-code, both missing tiles, no-clear, and over-clear all caught");
});
