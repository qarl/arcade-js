// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import { GAME_MODE, MODE_DISPATCH_SEL, GAME_MODE_PENDING, MODE_DELAY_TIMER, loc_3d, ACTIVE_SLOT_COUNT, LEVEL_ID, PLAYER_LEVEL_TBL, SLOT_COUNTDOWN, SLOT_COUNTDOWN_HI } from "./names.js";
import { reloadPacingFromPeakSlot } from "./reloadPacingFromPeakSlot.js";

/**
 * tickEnemyPacingCountdown -- tick the enemy-pacing countdown and pick the next slot. ROM 0xc9af.
 *
 * Role in the machine: Tempest paces how fast it releases enemies with a two-byte countdown pair. This
 * routine ticks the currently selected slot's countdown once per call; when the whole pair is spent the
 * wave's pacing is reloaded from the peak slot, otherwise it toggles to the next non-empty pacing slot,
 * arms that slot's timer, and requests the pacing game-mode. It is the metronome that decides when the
 * next enemy is due.
 *
 * Behavior: clear MODE_DELAY_TIMER (0x4). Index by loc_3d and decrement the active slot's low countdown
 * byte SLOT_COUNTDOWN (0x48)+x. If the SLOT_COUNTDOWN | SLOT_COUNTDOWN_HI (0x48|0x49) pair is now fully
 * zero, finalize via reloadPacingFromPeakSlot and return. Re-read loc_3d; if this tick drove the active
 * countdown to 0, raise the dispatch flag MODE_DISPATCH_SEL (0x1) = 0x0c and set MODE_DELAY_TIMER = 0x28.
 * Then loop: while ACTIVE_SLOT_COUNT is nonzero, toggle LEVEL_ID (0x3f) bit 0 to flip between slots, and
 * break once the toggled slot's countdown SLOT_COUNTDOWN+x is nonzero (a non-empty slot). Finally arm the
 * new slot: y = PLAYER_LEVEL_TBL (0x46),x + 1; write GAME_MODE_PENDING (0x2) = 0x1c when that wrapped to
 * 0, else 0x02; and request GAME_MODE (0x0) = 0x0a.
 *
 * Live-out: MODE_DELAY_TIMER, the decremented SLOT_COUNTDOWN pair, MODE_DISPATCH_SEL (conditionally),
 * the toggled LEVEL_ID, GAME_MODE_PENDING, and GAME_MODE.
 *
 * Returns the exit [X, Y] the ROM leaves: reloadPacingFromPeakSlot's when the pair is spent, else the chosen
 * slot and its incremented PLAYER_LEVEL_TBL byte. Grounding: [seen].
 */
export function tickEnemyPacingCountdown(m) {
  const { mem8 } = m;
  mem8[MODE_DELAY_TIMER] = 0;
  // Tick the active slot's low countdown byte.
  let x = mem8[loc_3d];
  const cur = u8(SLOT_COUNTDOWN + x);
  mem8[cur] = mem8[cur] - 1;
  // Whole two-byte pair spent -> reload the wave's pacing and stop.
  if ((mem8[SLOT_COUNTDOWN] | mem8[SLOT_COUNTDOWN_HI]) === 0) {
    return reloadPacingFromPeakSlot(m);
  }
  // This tick zeroed the active slot -> flag the dispatch and set the mode delay.
  x = mem8[loc_3d];
  if (mem8[u8(SLOT_COUNTDOWN + x)] === 0) {
    mem8[MODE_DISPATCH_SEL] = 0x0c;
    mem8[MODE_DELAY_TIMER] = 0x28;
  }
  // Toggle to the next non-empty pacing slot.
  for (;;) {
    if (mem8[ACTIVE_SLOT_COUNT] !== 0) mem8[LEVEL_ID] ^= 0x01;
    x = mem8[LEVEL_ID];
    if (mem8[u8(SLOT_COUNTDOWN + x)] !== 0) break;
  }
  // Arm the chosen slot's timer (0x1c on wrap, else 0x02) and request the pacing mode.
  const y = u8(mem8[u8(PLAYER_LEVEL_TBL + x)] + 1);
  mem8[GAME_MODE_PENDING] = y === 0 ? 0x1c : 0x02;
  mem8[GAME_MODE] = 0x0a;
  return [x, y];
}
