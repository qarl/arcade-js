// SPDX-License-Identifier: GPL-3.0-only
import { GAME_MODE, INPUT_EDGE_FLAGS, DSW1_COINAGE } from "./names.js";
import { stepSpikeTableCollapse } from "./stepSpikeTableCollapse.js";
import { resetLevelPlayfieldSlots } from "./resetLevelPlayfieldSlots.js";
import { setupLevelTimers } from "./setupLevelTimers.js";
import { runPerFrameUpdates } from "./runPerFrameUpdates.js";
import { tickEnemyPacingCountdown } from "./tickEnemyPacingCountdown.js";
import { reloadPacingFromPeakSlot } from "./reloadPacingFromPeakSlot.js";
import { commitPendingModeAfterDelay } from "./commitPendingModeAfterDelay.js";
import { bumpLevelEnemyQuota } from "./bumpLevelEnemyQuota.js";
import { buildSortedSoundRequest } from "./buildSortedSoundRequest.js";
import { tickActiveSoundSlot } from "./tickActiveSoundSlot.js";
import { seedModeParamsFromMaskedFlags } from "./seedModeParamsFromMaskedFlags.js";
import { tickWaveSpawnCadence, reseedWaveWorkingSet } from "./selectWaveStartSlot.js";
import { autoAdvanceRimRotation } from "./autoAdvanceRimRotation.js";
import { seedModeParamsWithBounds } from "./seedModeParamsWithBounds.js";
import { seedModeParamsMinimal } from "./seedModeParamsMinimal.js";
import { runFrameStateUpdaters } from "./runFrameStateUpdaters.js";
import { armModeAndRebuildIfEnabled } from "./armModeAndRebuildIfEnabled.js";
import { stepEnemyFleetAndSpawn } from "./stepEnemyFleetAndSpawn.js";

/**
 * dispatchFramePhaseHandler -- the DSW-gated per-frame phase dispatcher. ROM 0xc7bd.
 *
 * Role in the machine: this is the first of the three per-update passes the main frame loop
 * (runMainFrameLoop) runs each ~26.5Hz tick. It drives whatever phase the game is in -- level setup,
 * per-frame play updates, enemy pacing, pending-mode commit, wave spawn cadence, rim rotation, the sound
 * queue, and the mode-param seeding variants -- by selecting the phase's handler from the mode cell.
 *
 * Behavior: first a DSW gate -- when the coinage dip (DSW1_COINAGE & 0x83) reads 0x82 the whole pass is
 * skipped and the routine returns doing nothing (a hardware config that disables this update). Otherwise it
 * runs a pre-pass, stepSpikeTableCollapse (the original's loc_a7d2), then sets bit7 of INPUT_EDGE_FLAGS
 * (0x4e) to mark this frame's edge state. It then reads GAME_MODE (0x0) as a byte offset and tail-calls
 * TABLE[offset>>1]. The 19-entry TABLE mirrors the original word table; slot index 6 (offset 0x0c) is an
 * unused/zero entry the caller never selects, kept here as null to preserve the offset>>1 indexing.
 *
 * Live-out: INPUT_EDGE_FLAGS bit7 set, plus all the frame-phase state the pre-pass and selected handler write.
 *
 * y and x are the Y and X the ROM enters with: the exit registers of the previous update's buildFrameVectors
 * (of resetBothPokeyChips on the first update). Several handlers carry Y down to the sound loader and object
 * insert (both stash it in RAM). It passes through the pre-pass, which may reload it, to the handler. The
 * ROM then loads X with the mode byte to index the table, so every handler is entered with X = GAME_MODE;
 * the handlers take (m, y, x). Returns the exit [X, Y] the ROM leaves, which the main loop hands to
 * seedFramePhaseAndTick: the handler's, or the incoming x and y when the DSW gate skips the pass.
 * Grounding: [seen].
 */
const TABLE = [
  resetLevelPlayfieldSlots, setupLevelTimers, runPerFrameUpdates, tickEnemyPacingCountdown, reloadPacingFromPeakSlot, commitPendingModeAfterDelay, null, bumpLevelEnemyQuota, buildSortedSoundRequest, tickActiveSoundSlot,
  seedModeParamsFromMaskedFlags, tickWaveSpawnCadence, autoAdvanceRimRotation, seedModeParamsWithBounds, reseedWaveWorkingSet, seedModeParamsMinimal, runFrameStateUpdaters, armModeAndRebuildIfEnabled, stepEnemyFleetAndSpawn,
];

export function dispatchFramePhaseHandler(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;
  if ((mem8[DSW1_COINAGE] & 0x83) === 0x82) return [x, y];
  y = stepSpikeTableCollapse(m, y);
  x = mem8[GAME_MODE];
  mem8[INPUT_EDGE_FLAGS] = mem8[INPUT_EDGE_FLAGS] | 0x80;
  return TABLE[x >> 1](m, y, x); // every handler returns its exit [X, Y]
}
