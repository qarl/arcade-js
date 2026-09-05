// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0b8d — memory-equivalent to the frozen oracle at ROM 0x0b8d.
 * Per-entry collision test on the object at IX. Its only live-outs are RAM: on a hit it clears the
 * entry's active byte (ix+0) and raises the hit-event flag (0x4204) — both in the state dump. A is
 * left scratch and is NOT read back by the caller (the scan loop only advances IX and djnz's), so a
 * memory-only diff is the complete live-out. We exercise every branch:
 *   - PATH2 HIT: near Y-band, X within tolerance -> entry cleared + flag set.
 *   - PATH1 HIT: far Y-band (E large), X within tolerance -> entry cleared + flag set.
 *   - INACTIVE: active bit clear -> nothing touched.
 *   - PATH2 MISS: Y-band ok but X too far -> nothing touched.
 *   - Y-BAND OUT: entry outside the near Y-band -> nothing touched.
 * EQUAL asserts ramDiff==null on all five. Non-vacuous: on the hit paths the oracle really clears the
 * entry and sets the flag. Teeth: no-op, flag-only, clear-only, wrong-flag twins each diverge.
 * The return-stack window is masked by ramDiff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_0b8d as cand } from "../loc_0b8d.js";
import { loc_0b8d as oracle } from "../../translated/loc_0b8d.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const IX = 0x4260; // object-entry base (work RAM, in the state dump)
const PLAYER_X = 0x4202;
const HIT = 0x4204;

// A hit through the near-band path: E=5, entryY=0xe6 -> yShifted=5, in-band; entryX==playerX -> X overlaps.
const hitNear = () => craft((mem, mm) => {
  mm.push16(0x9999); mm.regs.ix = IX; mm.regs.de = 0x0005; // E=5
  mem[IX] = 0x01; mem[IX + 1] = 0xe6; mem[IX + 3] = 0x40; mem[PLAYER_X] = 0x40; mem[HIT] = 0x00;
});
// A hit through the far-band path: E=0x40 large -> yShifted(0x1f) < E; entryX==playerX -> X overlaps.
const hitFar = () => craft((mem, mm) => {
  mm.push16(0x9999); mm.regs.ix = IX; mm.regs.de = 0x0040; // E=0x40
  mem[IX] = 0x01; mem[IX + 1] = 0x00; mem[IX + 3] = 0x40; mem[PLAYER_X] = 0x40; mem[HIT] = 0x00;
});
// Active bit clear: the routine bails immediately.
const inactive = () => craft((mem, mm) => {
  mm.push16(0x9999); mm.regs.ix = IX; mm.regs.de = 0x0005;
  mem[IX] = 0x00; mem[IX + 1] = 0xe6; mem[IX + 3] = 0x40; mem[PLAYER_X] = 0x40; mem[HIT] = 0x00;
});
// In the near Y-band but the player X is far away -> no overlap.
const missX = () => craft((mem, mm) => {
  mm.push16(0x9999); mm.regs.ix = IX; mm.regs.de = 0x0005;
  mem[IX] = 0x01; mem[IX + 1] = 0xe6; mem[IX + 3] = 0x40; mem[PLAYER_X] = 0x80; mem[HIT] = 0x00;
});
// Outside the near Y-band -> ret before the X check.
const bandOut = () => craft((mem, mm) => {
  mm.push16(0x9999); mm.regs.ix = IX; mm.regs.de = 0x0005;
  mem[IX] = 0x01; mem[IX + 1] = 0x00; mem[IX + 3] = 0x40; mem[PLAYER_X] = 0x40; mem[HIT] = 0x00;
});

const noOp = () => {};
const clearOnly = (m) => { m.mem8[IX] = 0; };                    // clears entry but never sets the flag
const flagOnly = (m) => { m.mem8[HIT] = 1; };                    // sets flag but never clears the entry
const wrongFlag = (m) => { m.mem8[IX] = 0; m.mem8[HIT] = 2; };   // right cells, wrong flag value

test("EQUAL (crafted): loc_0b8d == oracle registers a hit on both Y bands", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, hitNear()), null, "loc_0b8d diverged on the near-band hit");
  assert.equal(ramDiff(oracle, cand, hitFar()), null, "loc_0b8d diverged on the far-band hit");
  // non-vacuous: the oracle actually clears the entry and raises the flag.
  const a = hitNear(); oracle(a);
  assert.equal(a.mem8[IX], 0, "positive control: oracle did not clear the struck entry");
  assert.equal(a.mem8[HIT], 1, "positive control: oracle did not raise the hit flag");
  console.log("  EQUAL: loc_0b8d == oracle (RAM), hit -> entry cleared + flag raised");
});

test("EQUAL (crafted): loc_0b8d == oracle leaves misses/inactive untouched", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, inactive()), null, "loc_0b8d diverged on the inactive entry");
  assert.equal(ramDiff(oracle, cand, missX()), null, "loc_0b8d diverged on the X-miss");
  assert.equal(ramDiff(oracle, cand, bandOut()), null, "loc_0b8d diverged outside the Y-band");
  const a = missX(); oracle(a);
  assert.equal(a.mem8[IX], 0x01, "positive control: a miss must leave the entry active");
  assert.equal(a.mem8[HIT], 0x00, "positive control: a miss must not raise the flag");
  console.log("  EQUAL: loc_0b8d == oracle (RAM), non-hit paths touch nothing");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, hitNear()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, clearOnly, hitNear()), "the clear-only twin escaped");
  assert.ok(ramDiff(oracle, flagOnly, hitNear()), "the flag-only twin escaped");
  assert.ok(ramDiff(oracle, wrongFlag, hitNear()), "the wrong-flag twin escaped");
  console.log("  TEETH: no-op, clear-only, flag-only, wrong-flag all caught (RAM)");
});
