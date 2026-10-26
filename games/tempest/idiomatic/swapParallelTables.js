// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { SWEEP_STAGE, loc_3bc } from "./names.js";

/**
 * swapParallelTables — exchange two parallel 18-entry tables slot-for-slot. ROM 0x92b2.
 *
 * Role in the machine: Tempest keeps certain per-lane state in two parallel tables based at SWEEP_STAGE
 * ($03aa) and loc_3bc ($03bc), and at level/wave transitions it needs to flip which table is "current"
 * versus "shadow". This routine performs that flip in place, exchanging the two tables entry for entry so
 * each slot ends up holding what its sibling slot held. setupLevelTimers ($c940) and the wave-reseed path
 * selectWaveStartSlot ($9108) call it while installing new-level state.
 *
 * Behavior: walk the 18 slots from index 0x11 down to 0; for each, read the SWEEP_STAGE entry and the
 * loc_3bc entry into temporaries and write each back into the other table's slot. A plain paired swap
 * across the whole width.
 *
 * Live-out: both 18-entry tables at SWEEP_STAGE and loc_3bc, with their contents exchanged.
 *
 * Returns the exit [X, Y] the ROM leaves: X = 0xff (the walk runs X past 0) and Y = slot 0's old loc_3bc
 * byte (the last value swapped through Y). Grounding: [seen].
 */
export function swapParallelTables(m) {
  const { mem8 } = m;
  let hi = 0;
  for (let x = 0x11; x >= 0; x--) { // 18 slots, high index down to 0
    const lo = mem8[u16(SWEEP_STAGE + x)]; // hold this slot's SWEEP_STAGE value
    hi = mem8[u16(loc_3bc + x)]; // hold this slot's loc_3bc value
    mem8[u16(loc_3bc + x)] = lo; // loc_3bc <- SWEEP_STAGE
    mem8[u16(SWEEP_STAGE + x)] = hi; // SWEEP_STAGE <- loc_3bc
  }
  return [0xff, hi];
}
