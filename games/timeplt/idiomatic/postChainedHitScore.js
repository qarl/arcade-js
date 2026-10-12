// SPDX-License-Identifier: GPL-3.0-only
/** postChainedHitScore — post the next entry of an eight-long climbing chain, one entry per call, and
 * re-arm the window that keeps the chain alive. A call arriving while the window cell still
 * holds a count advances the step cell and posts a value that climbs with it, wrapping back to
 * the first entry after the eighth; a call arriving once the window has run down to zero posts
 * the first entry and leaves the step cell alone. Both paths re-arm the window, so closely
 * spaced calls climb and an isolated call starts over. LIVE-OUT: memory-only.
 *
 * ROM 0x51DE-0x5204 (frozen lift translated/loc_51de.js). Grounding: [seen] (names.js ROUTINES
 * 0x51de). Role in the machine: this is how a shot-down enemy craft or a ramming contact is paid
 * for (mechanisms.md, scoring). It does not add to the score itself; it posts a scoring command
 * to the command ring, and the ring's command-4 handler does the award. Hits in quick succession
 * therefore pay 100, 200 … 800 and then wrap to 100 (mechanisms.md).
 *
 * The other half of the chain lives elsewhere: expireHitChain, in the round engine's service
 * block, counts CHAIN_WINDOW [seen] down once per pass and clears CHAIN_STEP [seen] once the
 * window is empty. Without that outside reset the climb would never restart.
 */

import { postCommand } from "./postCommand.js";
import { u8 } from "../../../core/int.js";
import { CHAIN_WINDOW, CHAIN_STEP } from "./names.js";

// Ring command 4 is the scoring command; its argument selects the award (lift: `ld d,0x04`).
// The step is masked to three bits (`and 0x07`), so the ladder has eight rungs and wraps rather
// than caps. The window reload is `ld a,0x1e` — thirty round-engine passes, not frames.
const CHAIN_COMMAND = 4;
const CHAIN_LENGTH = 8;
const WINDOW_RELOAD = 30;

export function postChainedHitScore(m) {
  const { mem8 } = m;
  /* Is a chain still running? `ld a,(0xa99d) / and a / jr z` at 0x51DF: an empty window means
   * the previous hit is too long ago, so this one starts the ladder again at its first rung
   * (`ld de,0x0401`, argument 1). CHAIN_STEP is not touched on this path. */
  if (mem8[CHAIN_WINDOW] === 0) {
    postCommand(m, CHAIN_COMMAND, 1);
  } else {
    /* The window is still open: climb one rung. `ld a,(0xa99e) / inc a / ld (0xa99e),a` stores
     * the stepped count back unmasked (its observed values reach past 8, names.js), and only the
     * posted argument is folded to 1..8 by `and 0x07 / inc a`. */
    const step = u8(mem8[CHAIN_STEP] + 1);
    mem8[CHAIN_STEP] = step;
    postCommand(m, CHAIN_COMMAND, (step % CHAIN_LENGTH) + 1);
  }
  /* Both paths end with `ld a,0x1e / ld (0xa99d),a`: every hit re-opens the window, so the next
   * hit landing within thirty passes continues the chain. postCommand drops the pair if the
   * ring slot is still occupied, so a hit on a full ring is not paid. */
  mem8[CHAIN_WINDOW] = WINDOW_RELOAD;
}
