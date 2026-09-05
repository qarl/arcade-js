// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0473 — equivalent to the frozen oracle at ROM 0x0473.
 * Drives the two start-button lamp latches (write side of 0x6000/0x6001 -> io.startLamp[0/1], board device
 * latches NOT in the state dump) from the credit count at 0x4002, gated on bit 5 of 0x425f. It writes NO
 * work RAM, so a memory-only check is vacuous: EQUAL compares io.startLamp across four paths and asserts
 * ramDiff==null only to catch a stray RAM write. Paths: gate clear -> both off; gate set + 0 credits ->
 * lamps left; +1 credit -> lamp0 on; +2 -> both on. Teeth: no-clear, no-lamp0, and both-when-one twins.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_0473 as cand } from "../loc_0473.js";
import { loc_0473 as oracle } from "../../translated/loc_0473.js";

const MODE_FLAG = 0x425f; // bit 5 gates the lamps
const CREDITS = 0x4002;
const LAMP0 = 0x6000; // write side -> io.startLamp[0]
const LAMP1 = 0x6001; // write side -> io.startLamp[1]
const GATE = 0x20; // bit 5
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// Craft an entry with the mode flag, credit count, and both lamp latches pre-seated.
function entry(mode, credits, lamp0, lamp1) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    mem8[MODE_FLAG] = mode;
    mem8[CREDITS] = credits;
    mem8[LAMP0] = lamp0;
    mem8[LAMP1] = lamp1;
  });
}

// The lamp writes are board device latches (not in dumpState); read them off the io device.
function lampsAfter(fn, e) {
  const m = e.clone(); m.routines = STUBS; fn(m);
  return [m.mem.io.startLamp[0], m.mem.io.startLamp[1]];
}
function lampsEqual(e) {
  const a = lampsAfter(oracle, e), b = lampsAfter(cand, e);
  return a[0] === b[0] && a[1] === b[1];
}

const gateClear = () => entry(0x00, 2, 1, 1); // bit 5 clear, lamps lit -> both cleared
const noCredit = () => entry(GATE, 0, 1, 1); // gate set, no credits -> lamps left lit
const oneCredit = () => entry(GATE, 1, 0, 0); // gate set, one credit -> lamp0 only
const twoCredit = () => entry(GATE, 2, 0, 0); // gate set, two credits -> both

test("EQUAL: loc_0473 == oracle drives the lamps across all four paths (io)", { skip }, () => {
  for (const [name, e] of [["gate-clear", gateClear()], ["no-credit", noCredit()],
                           ["one-credit", oneCredit()], ["two-credit", twoCredit()]]) {
    assert.equal(ramDiff(oracle, cand, e), null, `loc_0473 wrote work RAM on the ${name} path`);
    assert.ok(lampsEqual(e), `loc_0473 lamp latches diverged on the ${name} path`);
  }
  // positive controls: the oracle really moves the lamps where it should.
  assert.deepEqual(lampsAfter(oracle, gateClear()), [0, 0], "gate clear turns both lamps off");
  assert.deepEqual(lampsAfter(oracle, oneCredit()), [1, 0], "one credit lights lamp0 only");
  assert.deepEqual(lampsAfter(oracle, twoCredit()), [1, 1], "two credits light both lamps");
  assert.deepEqual(lampsAfter(oracle, noCredit()), [1, 1], "no credits leaves the lamps lit");
  console.log("  EQUAL: loc_0473 == oracle (io.startLamp), all four credit/gate paths");
});

test("TEETH: broken twins are caught (io)", { skip }, () => {
  const noClear = (m) => {}; // gate clear but leaves the lamps lit
  const noLamp0 = (m) => { if ((m.mem8[MODE_FLAG] & GATE) && m.mem8[CREDITS] >= 2) m.mem8[LAMP1] = 1; }; // never lamp0
  const bothWhenOne = (m) => { // lights both on a single credit
    if ((m.mem8[MODE_FLAG] & GATE) === 0) { m.mem8[LAMP0] = 0; m.mem8[LAMP1] = 0; return; }
    if (m.mem8[CREDITS] === 0) return;
    m.mem8[LAMP0] = 1; m.mem8[LAMP1] = 1;
  };
  const lamps = (fn, e) => lampsAfter(fn, e);
  const differs = (fn, e) => { const a = lamps(oracle, e), b = lamps(fn, e); return a[0] !== b[0] || a[1] !== b[1]; };

  assert.ok(differs(noClear, gateClear()), "the no-clear twin escaped");
  assert.ok(differs(noLamp0, oneCredit()), "the no-lamp0 twin escaped");
  assert.ok(differs(bothWhenOne, oneCredit()), "the both-when-one twin escaped");
  console.log("  TEETH: no-clear, no-lamp0, both-when-one all caught (io)");
});
