// SPDX-License-Identifier: GPL-3.0-only
import { FRAME_COUNTER, MODE_DELAY_GUARD, MODE_DELAY_TIMER, GAME_MODE, GAME_MODE_PENDING } from "./names.js";
import { rotateBlasterAroundRim } from "./rotateBlasterAroundRim.js";

/**
 * commitPendingModeAfterDelay — run down the mode-change delay and commit the pending mode. ROM 0xc800.
 *
 * Role in the machine: Tempest holds the game in a top-level mode cell ($00 GAME_MODE) — attract, play,
 * end-of-level, high-score entry, and so on. When something requests a mode change it does not switch
 * immediately; it stashes the target in GAME_MODE_PENDING ($02) and arms a short countdown so the current
 * screen lingers for a beat. This routine, called every frame, is what actually retires that countdown and
 * flips the live mode over once the delay expires. It runs on the spinner-service path, so no matter which
 * branch it takes it finishes by updating the player's blaster position around the rim of the tube.
 *
 * Behavior: first the guard test — while the frame-counter bit selected by MODE_DELAY_GUARD ($16b) reads
 * back set (loc_3 & loc_16b), the countdown is suppressed and it does nothing but delegate the spinner.
 * Otherwise it decrements the delay timer ($04) toward zero (clamped, never underflowing past 0). On the
 * exact frame the timer reaches zero it copies the pending mode into the live GAME_MODE cell and clears the
 * guard ($16b := 0) so the arming is spent. Every path tail-calls rotateBlasterAroundRim to move the shooter.
 *
 * Live-out: MODE_DELAY_TIMER ($04) decremented; on expiry GAME_MODE ($00) := GAME_MODE_PENDING ($02) and
 * MODE_DELAY_GUARD ($16b) := 0. Returns the spinner update's result, the exit [X, Y] the ROM leaves: no path
 * here loads X or Y, so the spinner update is entered with this routine's y and x. Grounding: [seen].
 */
export function commitPendingModeAfterDelay(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;
  // Guard still set: this frame is not eligible to run the countdown; just service the spinner and leave.
  if ((mem8[FRAME_COUNTER] & mem8[MODE_DELAY_GUARD]) !== 0) return rotateBlasterAroundRim(m, y, x);

  // Tick the delay timer down, clamped at zero (no wrap past 0x00).
  let count = mem8[MODE_DELAY_TIMER];
  if (count !== 0) {
    count = (count - 1) & 0xff;
    mem8[MODE_DELAY_TIMER] = count;
  }
  // The frame it lands on zero: commit the pending mode as the live mode and disarm the guard.
  if (count === 0) {
    mem8[GAME_MODE] = mem8[GAME_MODE_PENDING];
    mem8[MODE_DELAY_GUARD] = 0x00;
  }
  return rotateBlasterAroundRim(m, y, x); // every path ends by advancing the blaster around the tube rim
}
