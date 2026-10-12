// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceSequenceElseStartFreePlayGame — ROM 0x167B [seen]
 *
 * WHAT IT IS. A shared tail of the two-level sequence machine. The machine's outer mode lives in
 * SEQUENCE_PHASE (0xA9AB) and the step inside that mode in SEQUENCE_SUBSTEP (0xA9AC); per names.js,
 * one outer mode's inner dispatcher runs the arm its inner index selects and then this tail.
 *
 * ROLE. It decides whether the machine leaves the current mode:
 *   - a nonzero credit count steps the outer phase on (advanceSequencePhase, 0x0F11, which also
 *     restarts the inner step at zero) and returns;
 *   - otherwise, only under free play and while a start button is held, it sweeps every sprite
 *     off the picture and starts a game charging no credit.
 * The body matches advanceAttractTowardGameStart (0x0F54) except that it has no "play active"
 * guard and steps the phase rather than reloading it from a ROM byte.
 *
 * LIVE-OUT: memory.
 */

import { advanceSequencePhase } from "./advanceSequencePhase.js";
import { hideAllSprites } from "./hideAllSprites.js";
import { startGameOnFreePlay } from "./startGameOnFreePlay.js";
import { CREDIT_COUNT, FREE_PLAY, IN0_MIRROR } from "./names.js";

// Bits 3 and 4 of IN0_MIRROR: the two start buttons that startGameOnFreePlay tells apart
// (ROM 0x168A: and 0x18).
const START_BUTTONS = 0x18;

export function advanceSequenceElseStartFreePlayGame(m) {
  const { mem8 } = m;
  // A credit is waiting (CREDIT_COUNT 0xA986, packed decimal): leave this mode for the next one.
  // The ROM tail-jumps to 0x0F11 (jp nz,0x0f11), so that routine's return is this one's.
  if (mem8[CREDIT_COUNT] !== 0) return advanceSequencePhase(m);
  // No credit: only a free-play cabinet (FREE_PLAY 0xA9C0) can start a game without one ...
  if (mem8[FREE_PLAY] === 0) return;
  // ... and only when a start button is held in IN0_MIRROR (0xA9AE), the per-frame complemented
  // copy of the IN0 port.
  if ((mem8[IN0_MIRROR] & START_BUTTONS) === 0) return;
  // Clear the picture's sprites (hideAllSprites 0x15B6 zeroes their native-Y bytes, parking them
  // off the visible picture),
  // then start a one- or two-player game by the held button (startGameOnFreePlay 0x1690, which
  // the ROM reaches by falling through after the call).
  hideAllSprites(m);
  return startGameOnFreePlay(m);
}
