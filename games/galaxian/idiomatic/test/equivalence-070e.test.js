// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_070e — memory-equivalent to the frozen oracle at ROM 0x070e.
 * The routine is a leaf reached only from the mode-0x10 handler (entered at ROM 0x06d8 with
 * `ld hl,0x400a`), so on entry HL invariantly points at MODE_STATE (0x400a) and the ROM's `dec l`
 * steps to the neighbouring MODE_TIMER (0x4009). We craft an attract clone, poke HL=MODE_STATE and a
 * non-target byte into MODE_TIMER, push a return address for the oracle's `ret`, and compare RAM.
 * Live-out is memory-only (MODE_TIMER <- 0x50); registers/SP are not compared. Teeth: a twin that
 * writes the wrong constant diverges.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { reloadSequenceDwellTimer as cand } from "../reloadSequenceDwellTimer.js";
import { loc_070e as oracle } from "../../translated/loc_070e.js";

const MODE_STATE = 0x400a;
const MODE_TIMER = 0x4009;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

test("EQUAL (crafted): loc_070e re-arms MODE_TIMER to 0x50", { skip }, () => {
  const entry = craft((mem8, m) => {
    m.push16(0x9999); // return address the oracle's `ret` pops
    m.regs.hl = MODE_STATE; // callers always enter with HL = MODE_STATE (0x400a)
    mem8[MODE_TIMER] = 0x11; // pre-seed with a value != the reload so the write is observable
  });
  assert.equal(ramDiff(oracle, cand, entry), null);
});

// TEETH: a twin that stores the wrong reload value must be caught by the RAM diff.
function brokenWrongConst(m) {
  m.mem8[MODE_TIMER] = 0x51; // BUG: 0x51 instead of 0x50
}

test("TEETH: wrong reload constant diverges", { skip }, () => {
  const entry = craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.hl = MODE_STATE;
    mem8[MODE_TIMER] = 0x11;
  });
  assert.notEqual(ramDiff(oracle, brokenWrongConst, entry), null);
});
