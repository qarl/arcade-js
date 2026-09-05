// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1971 — memory-equivalent to the frozen oracle at ROM 0x1971.
 * The routine sets the flag cell at HL to 1. The seed pokes HL to the live cell 0x4001 (bit 0 clear)
 * and both candidate and oracle must leave it holding 1. The oracle's `ret` pops the pushed return
 * word from the masked return-stack window.
 * Teeth: a mutant that writes the wrong flag value must break equivalence.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { setCoinPhaseFlag as loc_1971 } from "../setCoinPhaseFlag.js";
import { loc_1971 as oracle } from "../../translated/loc_1971.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

test("loc_1971 sets the HL flag cell to 1 — memory-equivalent to the oracle", { skip }, () => {
  const entry = craft((mem8, m) => {
    m.push16(0x9999); // return address for the oracle's `ret`
    m.regs.hl = 0x4001; // the live flag pointer
    mem8[0x4001] = 0x00; // flag currently off
  });
  assert.equal(ramDiff(oracle, loc_1971, entry), null);
});

test("loc_1971 teeth: writing the wrong flag value diverges", { skip }, () => {
  const entry = craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.hl = 0x4001;
    mem8[0x4001] = 0x00;
  });
  const mutant = (m, cell = m.regs.hl) => {
    m.mem8[cell] = 0; // leaves the flag off instead of raising it to 1
  };
  assert.notEqual(ramDiff(oracle, mutant, entry), null);
});
