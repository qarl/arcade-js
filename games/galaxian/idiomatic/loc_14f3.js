// SPDX-License-Identifier: GPL-3.0-only
// Gated prescaler cascade: when the enable gate is set and the inhibit flag clear, tick the
// outer prescaler; each time it wraps, reload it and tick the inner one; when that wraps too,
// step a 0..7 counter up by one, clamping at 7.
import { OBJ_ACTIVE_FLAG, loc_422b, loc_4218, loc_4219, loc_421a } from "./names.js";

export function loc_14f3(m) {
  const { mem8 } = m;

  // Enable gate (bit 0 set) and inhibit flag (bit 0 clear) must both allow the tick.
  if ((mem8[OBJ_ACTIVE_FLAG] & 1) === 0) return;
  if (mem8[loc_422b] & 1) return;

  // Outer prescaler: tick, bail unless it wrapped, then reload.
  const outer = (mem8[loc_4218] - 1) & 0xff;
  mem8[loc_4218] = outer;
  if (outer !== 0) return;
  mem8[loc_4218] = 60;

  // Inner prescaler: same one tier up.
  const inner = (mem8[loc_4219] - 1) & 0xff;
  mem8[loc_4219] = inner;
  if (inner !== 0) return;
  mem8[loc_4219] = 20;

  // Step the counter toward the ceiling of 7.
  const step = mem8[loc_421a];
  if (step === 7) return;
  mem8[loc_421a] = step > 7 ? 7 : step + 1;
}
