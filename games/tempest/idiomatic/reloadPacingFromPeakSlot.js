// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import { GAME_MODE, STATUS_FLAGS, ACTIVE_SLOT_COUNT, PLAYER_LEVEL_TBL, WAVE_PEAK_SEED } from "./names.js";

/**
 * reloadPacingFromPeakSlot — finalize enemy pacing from the peak per-slot level. ROM 0xc9f1.
 *
 * Role in the machine: Tempest paces how fast enemies climb the tube from a bank of per-slot
 * level bytes (PLAYER_LEVEL_TBL, loc_46[]). When the active pacing pair is fully spent,
 * tickEnemyPacingCountdown (0xc9af) hands off here to reseed the wave's pacing floor and request
 * the next machine mode. The "peak slot" is whichever slot in the live window currently sits at
 * the highest level — pacing tracks the hardest slot so the whole wave keeps up with it.
 *
 * Behavior: scan the zero-page window loc_46[loc_3e .. 0] downward from the ACTIVE_SLOT_COUNT
 * cursor, keeping the maximum byte seen (>= so ties keep the lower index, matching the 6502
 * BCS). Store that maximum, decremented once when nonzero (0 stays 0), into WAVE_PEAK_SEED
 * (loc_126) — the reseeded pacing floor. Then set the mode-request cell GAME_MODE (loc_0) to
 * 0x14, or 0x10 when the status byte STATUS_FLAGS (loc_5) is negative (bit7 set).
 *
 * Live-out: WAVE_PEAK_SEED (loc_126) reloaded with peak-1; GAME_MODE (loc_0) set to the next
 * requested mode (0x14 / 0x10).
 *
 * Returns the exit [X, Y] the ROM leaves: X = 0xff (the scan runs X past 0) and Y = the peak, loaded before
 * the decrement. Grounding: [seen].
 */
export function reloadPacingFromPeakSlot(m) {
  const { mem8 } = m;
  let max = 0;
  // Cursor length of the live window; scan loc_46[x] from x=cursor down to 0.
  let x = mem8[ACTIVE_SLOT_COUNT];
  for (;;) {
    const v = mem8[u8(PLAYER_LEVEL_TBL + x)];
    if (v >= max) max = v;        // >= keeps the lowest-index tie (6502 BCS)
    if (x === 0) break;
    x = u8(x - 1);
  }
  // Reseed pacing floor with peak-1 (0 stays 0), then request the next mode.
  mem8[WAVE_PEAK_SEED] = max === 0 ? 0 : (max - 1) & 0xff;
  mem8[GAME_MODE] = (mem8[STATUS_FLAGS] & 0x80) ? 0x10 : 0x14; // 0x10 when loc_5 negative
  return [0xff, max];
}
