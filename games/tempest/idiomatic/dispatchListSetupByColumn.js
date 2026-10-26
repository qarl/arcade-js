// SPDX-License-Identifier: GPL-3.0-only
import { dispatchCoordListSetup } from "./dispatchCoordListSetup.js";

/**
 * dispatchListSetupByColumn -- route to the coordinate-list setup entry for a given column. ROM 0x9a87.
 *
 * Role in the machine: when placeSpawnListForColumnDeficit tops up per-column enemy quotas, each column that
 * still owes enemies needs a spawn coordinate-list placed for it. This thin router takes the column number
 * in X and enters the shared list-setup computed jump so the right per-column setup entry runs.
 *
 * Behavior: copy X into the dispatch index and enter dispatchCoordListSetup, which routes by that value to
 * one of five coordinate-list setup entries; the same column also rides through in X, which entry 2
 * (selectClimberSpawnLane) reads as its slot index; the other entries ignore it. The selected entry's result
 * tail-returns to this routine's own caller (placeSpawnListForColumnDeficit).
 *
 * Live-out: whatever coordinate-list pointers/state the selected setup entry seats. Grounding: [seen].
 */
export function dispatchListSetupByColumn(m, x = m.regs.x) {
  // The ROM's txa leaves the column in BOTH A (the dispatch selector) and X, which entry 2 (selectClimberSpawnLane)
  // reads as its slot index; the other entries ignore it. Both are passed explicitly; leaving X off would let
  // the callee's X default fall back to whatever m.regs.x held.
  return dispatchCoordListSetup(m, x, x);
}
