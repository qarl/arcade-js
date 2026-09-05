// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_18b2 — memory-equivalent to the frozen oracle at ROM 0x18b2.
 * Broadcasts a level: 0x421f = A (work RAM), then the four lfo_freq latches 0x6004-0x6007 = A, ror(A),
 * ror(A,2), ror(A,3). The four latch writes hit the sound DEVICE, not RAM, so they are NOT in the state
 * dump — ramDiff verifies only the 0x421f store. A second arm reads mem.io.soundLfo (where the device
 * records the latch values) to verify the broadcast + rotation. Teeth: a no-op twin (caught on the 0x421f
 * RAM arm) and a no-rotate twin (caught on the LFO device arm).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_18b2 as cand } from "../loc_18b2.js";
import { loc_18b2 as oracle } from "../../translated/loc_18b2.js";

const LEVEL_CELL = 0x421f;
const LFO_BASE = 0x6004;
const LEVEL = 0xb1; // rotations 0xb1, 0xd8, 0x6c, 0x36 are all distinct — a sensitive LFO probe
const SENTINEL = 0xee;
const HL_BUS = 4;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function seed() {
  return craft((mem8, m) => {
    mem8[LEVEL_CELL] = SENTINEL;
    m.regs.a = LEVEL;
    m.push16(0x9999); // ret target for the oracle's `ret`
  });
}

// The four LFO latch values the sound device recorded after running `fn` from the seed.
function lfoAfter(fn, entry) {
  const x = entry.clone();
  fn(x);
  return Array.from(x.mem.io.soundLfo);
}

test("EQUAL: loc_18b2 == oracle (0x421f store + LFO broadcast)", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, seed()), null, "loc_18b2 diverged on the 0x421f store");
  const e = seed();
  assert.deepEqual(lfoAfter(cand, e), lfoAfter(oracle, e), "loc_18b2 diverged on the LFO latches");
});

test("TEETH: broken twins are caught", { skip }, () => {
  // no-op: leaves 0x421f at the sentinel — caught on the RAM arm.
  const noOp = () => {};
  assert.notEqual(ramDiff(oracle, noOp, seed()), null, "the no-op twin escaped the 0x421f RAM arm");

  // no-rotate: correct 0x421f but writes the same byte to every latch — invisible to ramDiff (device is
  // not in the state dump), caught only on the LFO device arm.
  const noRotate = (m, level = m.regs.a) => {
    const { mem, mem8 } = m;
    mem8[LEVEL_CELL] = level;
    for (let i = 0; i < 4; i++) mem.write8(LFO_BASE + i, level & 0xff, HL_BUS); // WRONG: no rrca
  };
  assert.equal(ramDiff(oracle, noRotate, seed()), null, "sanity: no-rotate matches on RAM (0x421f only)");
  const e = seed();
  assert.notDeepEqual(lfoAfter(noRotate, e), lfoAfter(oracle, e), "the no-rotate twin escaped the LFO arm");
});
