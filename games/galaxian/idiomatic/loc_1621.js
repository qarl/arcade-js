// SPDX-License-Identifier: GPL-3.0-only
// Gated one-shot arm: only when both status gates have bit 0 set and the pending word is not
// already armed does it arm the pending-trigger word to 1. Any gate failing returns without a write.
import { loc_4220, loc_4222, loc_4225 } from "./names.js";

export function loc_1621(m) {
  const { mem8, mem16 } = m;

  // Both status gates must have bit 0 set...
  if (!(mem8[loc_4220] & 0x01)) return;
  if (!(mem8[loc_4225] & 0x01)) return;

  // ...and the pending word must not already be armed (bit 0 clear).
  if (mem8[loc_4222] & 0x01) return;

  // Arm it: low byte becomes the enable flag (1), high byte a zeroed countdown.
  mem16[loc_4222] = 1;
}
