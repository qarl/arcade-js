// SPDX-License-Identifier: GPL-3.0-only
// Drive the two start-button lamps from the credit count, gated by bit 5 of the mode flag: gate clear ->
// both lamps off; else no credits -> leave them; one credit -> lamp 0 on; two or more -> both on.
import { loc_425f, loc_4002, START_LAMP_0, START_LAMP_1 } from "./names.js";

export function loc_0473(m) {
  const { mem8 } = m;

  if ((mem8[loc_425f] & 0x20) === 0) { // bit 5 clear: lamps disabled
    mem8[START_LAMP_0] = 0;
    mem8[START_LAMP_1] = 0;
    return;
  }

  const credits = mem8[loc_4002];
  if (credits === 0) return; // no credits: leave the lamps as they are
  mem8[START_LAMP_0] = 1; // at least one credit
  if (credits >= 2) mem8[START_LAMP_1] = 1; // two or more
}
