// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1146 — memory-equivalent to the frozen oracle at ROM 0x1146.
 * The routine is a null dispatch handler: a lone `ret`, touching no memory. Both the idiomatic
 * candidate and the translated oracle must leave RAM/VRAM/OBJRAM exactly as the crafted seed left it
 * (the oracle's `ret` pops the pushed return word, which lives in the masked return-stack window).
 * Teeth: a mutant that writes any cell must break equivalence, proving the diff has bite.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { noopAnimDispatchSlot as loc_1146 } from "../noopAnimDispatchSlot.js";
import { loc_1146 as oracle } from "../../translated/loc_1146.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

test("loc_1146 is a no-op — memory-equivalent to the oracle", { skip }, () => {
  // The only input is the return address the oracle's `ret` will pop; poke nothing else.
  const entry = craft((mem8, m) => {
    m.push16(0x9999);
  });
  assert.equal(ramDiff(oracle, loc_1146, entry), null);
});

test("loc_1146 teeth: a handler that writes a cell diverges", { skip }, () => {
  const entry = craft((mem8, m) => {
    m.push16(0x9999);
  });
  const mutant = (m) => {
    m.mem8[0x4000] = 0xff; // the true no-op writes nothing, so any write must show up
  };
  assert.notEqual(ramDiff(oracle, mutant, entry), null);
});
