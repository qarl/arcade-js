// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_050f — memory-equivalent to the frozen oracle at ROM 0x050f.
 * GATE: crafted-entry. The routine stamps the +0x15 field of the 0x41a0 block (0x41b5) to 3. A
 * bounded-attract seed is cloned, a return address pushed for the oracle's ret, and 0x41b5 poked to a
 * sentinel so the store is observable; both sides must leave 0x41b5 == 3 and touch nothing else.
 * LIVE-OUT is memory-only (A=3 is dead — the caller reloads HL). Teeth: no-op, wrong value, wrong addr.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_050f as cand } from "../loc_050f.js";
import { loc_050f as oracle } from "../../translated/loc_050f.js";

const STATE_FIELD = 0x41b5;
const SENTINEL = 0xab;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A fresh attract seed with the field poked off-value and a ret target pushed for the oracle.
const seeded = () => craft((mem8, m) => { mem8[STATE_FIELD] = SENTINEL; m.push16(0x9999); });

const brokenNoOp = () => {};
const brokenWrongValue = (m) => { m.mem8[STATE_FIELD] = 4; };
const brokenWrongAddr = (m) => { m.mem8[STATE_FIELD + 1] = 3; };

test("EQUAL (crafted): loc_050f == oracle stamps 0x41b5 <- 3", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, seeded()), null, "loc_050f diverged from the oracle");
  assert.ok(ramDiff(oracle, brokenNoOp, seeded()), "vacuous: oracle changed nothing");
  console.log("  EQUAL: loc_050f == oracle, 0x41b5 <- 3");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, seeded()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, brokenWrongValue, seeded()), "the wrong-value twin escaped");
  assert.ok(ramDiff(oracle, brokenWrongAddr, seeded()), "the wrong-address twin escaped");
  console.log("  TEETH: no-op, wrong-value, wrong-address all caught");
});
