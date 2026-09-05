// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_18e8 — memory-equivalent to the frozen oracle at ROM 0x18e8.
 * The routine decrements the counter byte at (HL); while it stays nonzero it returns, and on the exact
 * zero-crossing it also clears MESSAGE_SCROLL_ENABLE (0x40b0). HL is a live-in pointer that varies at
 * runtime, so we point it at a seeded work-RAM cell and drive BOTH exits: counter=3 -> stays nonzero
 * (only the counter changes), counter=1 -> hits zero (counter AND the enable flag change). We push a
 * return address for the oracle's `ret`. Live-out is memory-only. Teeth: a twin that never clears the
 * flag, and one that always clears it, each diverge on one of the two branches.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { endMessageScrollOnExpiry as cand } from "../endMessageScrollOnExpiry.js";
import { loc_18e8 as oracle } from "../../translated/loc_18e8.js";

const COUNTER = 0x4300; // seeded countdown cell (work RAM, outside the masked stack window)
const MESSAGE_SCROLL_ENABLE = 0x40b0;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function seed(counter) {
  return (mem8, m) => {
    m.push16(0x9999); // return address the oracle's `ret` pops
    m.regs.hl = COUNTER;
    mem8[COUNTER] = counter;
    mem8[MESSAGE_SCROLL_ENABLE] = 0x01; // scroller active; only the finish branch should clear it
  };
}

test("EQUAL (crafted): loc_18e8 still counting (counter > 1)", { skip }, () => {
  const entry = craft(seed(3));
  assert.equal(ramDiff(oracle, cand, entry), null);
});

test("EQUAL (crafted): loc_18e8 finishing (counter == 1)", { skip }, () => {
  const entry = craft(seed(1));
  assert.equal(ramDiff(oracle, cand, entry), null);
});

// TEETH: a twin that never clears the flag must diverge on the finishing branch.
function brokenNeverClears(m, counterPtr = m.regs.hl) {
  m.mem8[counterPtr] = (m.mem8[counterPtr] - 1) & 0xff; // BUG: drops the clear-on-zero
}
// TEETH: a twin that always clears the flag must diverge on the still-counting branch.
function brokenAlwaysClears(m, counterPtr = m.regs.hl) {
  m.mem8[counterPtr] = (m.mem8[counterPtr] - 1) & 0xff;
  m.mem8[MESSAGE_SCROLL_ENABLE] = 0; // BUG: clears unconditionally
}

test("TEETH: never-clears diverges when the counter finishes", { skip }, () => {
  const entry = craft(seed(1));
  assert.notEqual(ramDiff(oracle, brokenNeverClears, entry), null);
});

test("TEETH: always-clears diverges while still counting", { skip }, () => {
  const entry = craft(seed(3));
  assert.notEqual(ramDiff(oracle, brokenAlwaysClears, entry), null);
});
