// SPDX-License-Identifier: GPL-3.0-only
// Gated countdown: only while the arm flag's bit 0 is set AND at least one activity
// gate is open, tick the counter; disarm the flag when the counter reaches zero.
import { loc_4221, loc_4224, loc_4226, loc_422b, loc_422c } from "./names.js";

export function loc_1688(m) {
  const { mem8 } = m;

  // Not armed -> nothing to do.
  if ((mem8[loc_422b] & 1) === 0) return;

  // Hold unless at least one activity gate is open (two whole-byte flags, one bit-0 flag).
  const active = mem8[loc_4224] !== 0 || mem8[loc_4221] !== 0 || (mem8[loc_4226] & 1) !== 0;
  if (!active) return;

  // Tick; disarm once the counter hits zero.
  const remaining = (mem8[loc_422c] - 1) & 0xff;
  mem8[loc_422c] = remaining;
  if (remaining === 0) mem8[loc_422b] = 0;
}
