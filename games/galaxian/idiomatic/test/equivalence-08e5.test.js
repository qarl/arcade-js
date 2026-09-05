// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_08e5 — memory-equivalent to the frozen oracle at ROM 0x08E5.
 * Conditional clear: if loc_420b (0x420b) bit 0 is set, zero both loc_420b and loc_4208 (0x4208); else
 * do nothing. Two crafted entries exercise both branches (taken: flag set + gate non-zero; not-taken:
 * flag bit 0 clear). LIVE-OUT is RAM only; the return-stack window is masked by ramDiff.
 * Teeth: no-op (taken), clear-flag-only, wrong-cell, and clear-always (which must be caught on the
 * not-taken branch, proving the guard).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { clearGateOnPendingRequest as cand } from "../clearGateOnPendingRequest.js";
import { loc_08e5 as oracle } from "../../translated/loc_08e5.js";

const FLAG = 0x420b; // loc_420b — request flag (bit 0 tested)
const GATE = 0x4208; // loc_4208 — state byte cleared on the taken branch
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// flag bit0 set (0x03) + gate non-zero -> the routine clears both.
function takenEntry() {
  return craft((mem8, m) => { m.push16(0x9999); mem8[FLAG] = 0x03; mem8[GATE] = 0x55; });
}
// flag bit0 clear (0x02) + gate non-zero -> the routine does nothing.
function untakenEntry() {
  return craft((mem8, m) => { m.push16(0x9999); mem8[FLAG] = 0x02; mem8[GATE] = 0x55; });
}

function brokenNoOp() {}
function brokenFlagOnly(m) { if (m.mem8[FLAG] & 1) m.mem8[FLAG] = 0; }
function brokenWrongCell(m) { if (m.mem8[FLAG] & 1) { m.mem8[FLAG] = 0; m.mem8[0x4207] = 0; } }
function brokenClearAlways(m) { m.mem8[FLAG] = 0; m.mem8[GATE] = 0; }

test("EQUAL: loc_08e5 == oracle on both branches", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, takenEntry()), null, "loc_08e5 diverged on the taken branch");
  assert.equal(ramDiff(oracle, cand, untakenEntry()), null, "loc_08e5 diverged on the not-taken branch");
  assert.ok(ramDiff(oracle, brokenNoOp, takenEntry()), "vacuous: oracle changed no RAM on the taken branch");
  console.log("  EQUAL: loc_08e5 == oracle (RAM), both branches");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, takenEntry()), "the no-op twin escaped (taken)");
  assert.ok(ramDiff(oracle, brokenFlagOnly, takenEntry()), "the clear-flag-only twin escaped");
  assert.ok(ramDiff(oracle, brokenWrongCell, takenEntry()), "the wrong-cell twin escaped");
  assert.ok(ramDiff(oracle, brokenClearAlways, untakenEntry()), "the clear-always twin escaped the guard");
  console.log("  TEETH: no-op, flag-only, wrong-cell, clear-always(guard) all caught");
});
