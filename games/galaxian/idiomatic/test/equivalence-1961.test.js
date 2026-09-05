// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1961 — memory-equivalent to the frozen oracle at ROM 0x1961.
 * The routine clamps the counter cell at HL to its ceiling (99 / 0x63). The seed pokes HL to the live
 * cell 0x4002 and seeds it below the ceiling; candidate and oracle must both leave it at 99. The
 * oracle's `ret` pops the pushed return word from the masked return-stack window.
 * Teeth: a mutant that writes the wrong ceiling must break equivalence.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_1961 } from "../loc_1961.js";
import { loc_1961 as oracle } from "../../translated/loc_1961.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

test("loc_1961 clamps the HL cell to 99 — memory-equivalent to the oracle", { skip }, () => {
  const entry = craft((mem8, m) => {
    m.push16(0x9999); // return address for the oracle's `ret`
    m.regs.hl = 0x4002; // the live counter pointer
    mem8[0x4002] = 0x20; // some value below the ceiling
  });
  assert.equal(ramDiff(oracle, loc_1961, entry), null);
});

test("loc_1961 teeth: writing the wrong ceiling diverges", { skip }, () => {
  const entry = craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.hl = 0x4002;
    mem8[0x4002] = 0x20;
  });
  const mutant = (m, cell = m.regs.hl) => {
    m.mem8[cell] = 98; // 0x62 — one short of the real 0x63 ceiling
  };
  assert.notEqual(ramDiff(oracle, mutant, entry), null);
});
