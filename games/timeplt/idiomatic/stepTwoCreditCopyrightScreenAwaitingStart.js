// SPDX-License-Identifier: GPL-3.0-only
/** stepTwoCreditCopyrightScreenAwaitingStart — the copyright screen's await-start step: redraw the fixed caption, flash its line,
 * then dispatch on the start buttons — bit 4 (two-player, tested first) or bit 3 (one-player), and
 * with neither held return. LIVE-OUT: what the chosen start leaves, else memory only.
 *
 * ROM 0x188A-0x189D. Grounding: [seen] (names.js ROUTINES 0x188a).
 *
 * ROLE IN THE MACHINE. This is step 4 of phase 2 of the attract/credit sequence machine — the
 * "a credit is on the board, waiting for start" phase (mechanisms.md, "Phase 2"). Its caller is
 * dispatchSequencePhase2SubStepArm, which runs one arm per frame. postPushStartScreenCaptions (step 2)
 * steps straight to here when there are two or more credits; the one-credit wait
 * stepCopyrightScreenAwaitingStart (step 3) steps here when more credits arrive. So this arm runs
 * frame after frame, with at least two credits banked, until a start button is pressed.
 *
 * Nothing here advances the sequence step itself: with no button held it simply returns, and the
 * next frame the same arm runs again. Leaving the screen is entirely the job of the two start
 * routines, which (per names.js) send the sequence machine to its last phase.
 *
 * LIVE-OUT: whatever startTwoPlayerGame / startOnePlayerGame leave when a start is taken (both are
 * tail calls in the ROM: `jp nz,0x189e` / `jp nz,0x3215`); otherwise memory only.
 */

import { stampCopyrightStrip } from "./stampCopyrightStrip.js";
import { flashCopyrightLine } from "./flashCopyrightLine.js";
import { startTwoPlayerGame } from "./startTwoPlayerGame.js";
import { startOnePlayerGame } from "./startOnePlayerGame.js";
import { IN0_MIRROR } from "./names.js";

// The two start-button bits of IN0_MIRROR (0xA9AE). The vblank service complements the active-low
// IN0 port (coins, service and the start buttons) and latches it there each frame, so a set bit means
// the button is held now.
// Bit 4 (0x10) is the two-player start and bit 3 (0x08) the one-player start — the masks MAME's
// driver gives those buttons (names.js, startGameOnFreePlay: at mirror 0x08 only the one-player arm
// ran, at 0x10 only the two-player arm).
const TWO_PLAYER_START = 0x10;
const ONE_PLAYER_START = 0x08;

export function stepTwoCreditCopyrightScreenAwaitingStart(m) {
  // Step 1 — keep the screen dressed. ROM `call 0x0b06` then `call 0x0b39`.
  // stampCopyrightStrip [seen] writes the four fixed pieces of the copyright caption into the
  // display-list shadow; it reads nothing, so re-stamping every frame is harmless and guarantees
  // the caption is present. flashCopyrightLine [seen] requests the copyright line in one of two
  // colours chosen by the low bit of the frame counter, which is what makes the line flash.
  stampCopyrightStrip(m);
  flashCopyrightLine(m);

  // Step 2 — poll the start buttons. ROM `ld a,(0xa9ae)` then `bit 4,a` / `jp nz,0x189e` and
  // `bit 3,a` / `jp nz,0x3215`. Two-player is tested first, so with both held the two-player start
  // wins. Each start is a tail jump in the ROM, so the routine ends there. The one-credit wait
  // (step 3) tests only the one-player start; the charge (two credits vs one, packed BCD at 0xA986)
  // is made inside the start routine, not here.
  // With neither bit set the ROM falls through to `ret` at 0x189D and the screen waits a frame.
  const buttons = m.mem8[IN0_MIRROR];
  if (buttons & TWO_PLAYER_START) return startTwoPlayerGame(m);
  if (buttons & ONE_PLAYER_START) return startOnePlayerGame(m);
}
