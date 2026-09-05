// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_10d8 — memory-equivalent to the frozen oracle at ROM 0x10d8 (object "settle field +4" handler).
 * GATE: crafted-entry. The routine takes the object record base in IX and either holds or increments
 * the +4 field, so a post-attract seed is cloned, IX pointed at a work-RAM scratch record, a return
 * address pushed for the oracle's `ret`, and the +4 byte poked to drive both paths: settled (value in
 * the [200,205) band -> no write) and moving (value outside it -> +4 incremented, including the 0xff
 * wrap). Live-out is memory only (A / flags are dead), so RAM is compared and the stack window masked.
 * Teeth: no-op, an always-increment twin (writes on a settled field), and a wrong-offset twin (+5).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { settleObjectXAtRest as cand } from "../settleObjectXAtRest.js";
import { loc_10d8 as oracle } from "../../translated/loc_10d8.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const OBJ = 0x4200;       // scratch object record base (work RAM, clear of the masked stack window)
const FIELD = OBJ + 4;    // the advancing field

// IX = the object base; push a return address so the oracle's `ret` has a target.
const withField = (v) => craft((mem, m) => { mem[FIELD] = v; m.regs.ix = OBJ; m.push16(0x9999); });

// Settled values (inside [200,205)) hold; moving values step +1 (0x00 wraps from 0xff).
const SETTLED = [200, 201, 204];
const MOVING = [0, 100, 199, 205, 255];

test("EQUAL (crafted): loc_10d8 == oracle on settled and moving fields", { skip }, () => {
  for (const v of [...SETTLED, ...MOVING]) {
    assert.equal(ramDiff(oracle, cand, withField(v)), null, `field=${v} diverged`);
  }
  // Positive control: settled holds, moving increments, and the wrap is exercised.
  const held = withField(200); oracle(held);
  assert.equal(held.mem8[FIELD], 200, "control: a settled field (200) is left untouched");
  const moved = withField(100); oracle(moved);
  assert.equal(moved.mem8[FIELD], 101, "control: a moving field (100) steps to 101");
  const wrapped = withField(255); oracle(wrapped);
  assert.equal(wrapped.mem8[FIELD], 0, "control: 255 wraps to 0 on the step");
  console.log("  EQUAL: settled {200,201,204} hold; moving {0,100,199,205,255} step +1 (255->0)");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const alwaysInc = (m) => { const { mem8 } = m; mem8[m.regs.ix + 4] = (mem8[m.regs.ix + 4] + 1) & 0xff; }; // ignores the band
  const wrongOffset = (m) => { // increments +5 instead of +4 (correct guard, wrong cell)
    const { mem8 } = m; const f = mem8[m.regs.ix + 4];
    if (((f - 200) & 0xff) < 5) return;
    mem8[m.regs.ix + 5] = (mem8[m.regs.ix + 5] + 1) & 0xff;
  };
  assert.ok(MOVING.some((v) => ramDiff(oracle, noOp, withField(v))), "no-op twin escaped");
  assert.ok(SETTLED.some((v) => ramDiff(oracle, alwaysInc, withField(v))), "always-increment twin escaped");
  assert.ok(MOVING.some((v) => ramDiff(oracle, wrongOffset, withField(v))), "wrong-offset twin escaped");
  console.log("  TEETH: no-op, always-increment, wrong-offset all caught by the RAM diff");
});
