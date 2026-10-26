// SPDX-License-Identifier: GPL-3.0-only
import { SPIKED_SEGMENT_COUNT, RIM_COLOR_ANIM, ENEMY_ANIM_ACCUM } from "./names.js";
import { clearActiveShots } from "./clearActiveShots.js";
import { clearShotTableAndStateFlags } from "./clearShotTableAndStateFlags.js";
import { seedSlotRandomTags } from "./seedSlotRandomTags.js";
import { clearEightByteTableAndFlag } from "./clearEightByteTableAndFlag.js";
import { clearByte50 } from "./clearByte50.js";
import { buildLevelLayout } from "./buildLevelLayout.js";

/**
 * resetWorkingRamForStateEntry — master state-entry sweep. ROM 0x902b.
 *
 * Role in the machine: this is the top-level "wipe working RAM for a fresh state" routine run on
 * wave/level entry (called from runWaveInit and as runLevelInit's tail). Rather than clear cells
 * itself it drives six subsystem-reset leaves back to back — player shots, the shot table + state
 * flags, the per-slot random tags, an eight-byte table + its flag, a single scratch byte, and the
 * level layout rebuild — then seeds three animation/counter cells to their entry values.
 *
 * Behavior: it calls, in order, clearActiveShots, clearShotTableAndStateFlags, seedSlotRandomTags,
 * clearEightByteTableAndFlag, clearByte50, and buildLevelLayout. It then arms the two animation
 * cursors RIM_COLOR_ANIM ($124) and ENEMY_ANIM_ACCUM ($148) to 0xff and clears the spiked-segment
 * count SPIKED_SEGMENT_COUNT ($123).
 *
 * Live-out: whatever the six leaves clear/seed, plus RIM_COLOR_ANIM=0xff, ENEMY_ANIM_ACCUM=0xff, and
 * SPIKED_SEGMENT_COUNT=0.
 *
 * Returns the exit [X, Y] the ROM leaves: buildLevelLayout's (the closing stores write no register).
 * Grounding: [seen].
 */
export function resetWorkingRamForStateEntry(m) {
  const { mem8 } = m;
  // Six subsystem-reset leaves, in ROM order.
  clearActiveShots(m);
  clearShotTableAndStateFlags(m);
  seedSlotRandomTags(m);
  clearEightByteTableAndFlag(m);
  clearByte50(m);
  const exit = buildLevelLayout(m);
  // Arm the two animation cursors high; clear the spiked-segment count.
  mem8[RIM_COLOR_ANIM] = 0xff;
  mem8[ENEMY_ANIM_ACCUM] = 0xff;
  mem8[SPIKED_SEGMENT_COUNT] = 0x00;
  return exit;
}
