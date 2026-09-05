// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0515 — memory-equivalent to the frozen oracle at ROM 0x0515.
 * GATE: crafted-entry. The routine stamps the +0x15 field of the 0x4180 block (0x4195) to 3. A
 * bounded-attract seed is cloned, a return address pushed for the oracle's ret, and 0x4195 poked to a
 * sentinel so the store is observable; both sides must leave 0x4195 == 3 and touch nothing else.
 * LIVE-OUT is memory-only (A=3 is dead — the caller xors A). Teeth: no-op, wrong value, wrong addr.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_0515 as cand } from "../loc_0515.js";
import { loc_0515 as oracle } from "../../translated/loc_0515.js";

const STATE_FIELD = 0x4195;
const SENTINEL = 0xab;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A fresh attract seed with the field poked off-value and a ret target pushed for the oracle.
const seeded = () => craft((mem8, m) => { mem8[STATE_FIELD] = SENTINEL; m.push16(0x9999); });

const brokenNoOp = () => {};
const brokenWrongValue = (m) => { m.mem8[STATE_FIELD] = 4; };
const brokenWrongAddr = (m) => { m.mem8[STATE_FIELD + 1] = 3; };

test("EQUAL (crafted): loc_0515 == oracle stamps 0x4195 <- 3", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, seeded()), null, "loc_0515 diverged from the oracle");
  assert.ok(ramDiff(oracle, brokenNoOp, seeded()), "vacuous: oracle changed nothing");
  console.log("  EQUAL: loc_0515 == oracle, 0x4195 <- 3");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, seeded()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, brokenWrongValue, seeded()), "the wrong-value twin escaped");
  assert.ok(ramDiff(oracle, brokenWrongAddr, seeded()), "the wrong-address twin escaped");
  console.log("  TEETH: no-op, wrong-value, wrong-address all caught");
});
