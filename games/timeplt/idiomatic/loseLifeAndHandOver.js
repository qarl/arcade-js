// SPDX-License-Identifier: GPL-3.0-only
/** loseLifeAndHandOver — one maintenance step per call: hide the sprite band, start the next round when a
 * flag is set, and queue the fixed transition sound stops. Then decrement the lives count at the
 * head of the live 16-byte context block and copy that block into whichever of two save slots the
 * active-player selector points at. If lives reached zero, hand off to the game-over banner and
 * stop. Otherwise flip the selector if the other player's slot still shows lives, and either way
 * stamp a constant into one cell and a program-image byte into another.
 *
 * ROM 0x11ED-0x123A (lift: translated/loc_11ed.js). Grounding: [seen] (names.js ROUTINES 0x11ED).
 *
 * ROLE IN THE MACHINE. This is what happens after the player's ship has died. The round engine
 * (serviceRoundThenResolvePlayerState) calls it as soon as PLAYER_STATE reads 0, i.e. the dying
 * sequence is over (mechanisms.md, "loseLifeAndHandOver runs as soon as PLAYER_STATE reads 0").
 * The "constant" and "program-image byte" above are the sequence machine's delay (90 frames) and
 * its sub-step (NEXT_LIFE_SUBSTEP_SEED, which reads 1), so the next life -- or the other player's
 * turn -- re-enters the sequence at step 1 after a short pause.
 *
 * The context block: each player's per-life state (lives, pen, ...) lives in a sixteen-byte block.
 * The LIVE copy is at 0xAD00 (LIVES_REMAINING [seen] is its first byte); player one's saved copy
 * is at 0xAD10 (PLAYER_ONE_LIVES [seen]) and player two's at 0xAD20 (PLAYER_TWO_LIVES [seen]).
 * ACTIVE_PLAYER 0xAD32 [seen] (0 or 1) says which save block is the live player's.
 * LIVE-OUT: memory. */

import { u8 } from "../../../core/int.js";
import { enqueueTransitionSoundStops } from "./enqueueTransitionSoundStops.js";
import { hideAllSprites } from "./hideAllSprites.js";
import { startNextRound } from "./startNextRound.js";
import { postGameOverBanner } from "./postGameOverBanner.js";
import { ROUND_TRANSITION_HOLD, LIVES_REMAINING, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES, ACTIVE_PLAYER, SEQUENCE_DELAY, SEQUENCE_SUBSTEP, NEXT_LIFE_SUBSTEP_SEED } from "./names.js";

// The context block is copied whole (`ld bc,0x0010` / ldir at 0x120E-0x1211).
const RECORD_LEN = 16;

// The sequence delay armed for the next life: 90 frames (`ld a,0x5a` at 0x122F).
const STAMP_VALUE = 90;

export function loseLifeAndHandOver(m) {
  const { mem8 } = m;

  /* Step 1 -- clear the stage (0x11ED-0x11FA). hideAllSprites parks every sprite off the visible screen
   * by zeroing its native-Y byte. If ROUND_TRANSITION_HOLD 0xACC6 [seen] is raised the round was
   * already won (the Mother-Ship's closing sequence raised it), so startNextRound banks it first: the
   * next life starts in the next era. Then the fixed transition sound stops are queued. */
  hideAllSprites(m);
  if (mem8[ROUND_TRANSITION_HOLD] !== 0) startNextRound(m);
  enqueueTransitionSoundStops(m);

  /* Step 2 -- take the life and checkpoint (0x11FD-0x1214). LIVES_REMAINING is decremented, then
   * the whole live block is copied out to the active player's save block, so the saved copy
   * carries the new count. */
  const count = u8(mem8[LIVES_REMAINING] - 1);
  mem8[LIVES_REMAINING] = count;
  const dest = mem8[ACTIVE_PLAYER] === 0 ? PLAYER_ONE_LIVES : PLAYER_TWO_LIVES;
  for (let i = 0; i < RECORD_LEN; i++) mem8[dest + i] = mem8[LIVES_REMAINING + i];

  /* Step 3 -- that was the last life (`jr z,0x1253`): hand to postGameOverBanner, which posts
   * PLAYER n and GAME OVER and arms the banner's hold (or, outside a game, restarts attract). */
  if (count === 0) return postGameOverBanner(m);

  /* Step 4 -- pass the turn (0x1216-0x122C). The OTHER player's saved lives decide: nonzero means
   * that player is still in the game, so ACTIVE_PLAYER flips. In a one-player game player two's
   * saved lives byte is zero and the flip never happens; in a two-player game the players alternate on
   * every death until one runs out. */
  const other = mem8[ACTIVE_PLAYER] === 0 ? PLAYER_TWO_LIVES : PLAYER_ONE_LIVES;
  if (mem8[other] !== 0) mem8[ACTIVE_PLAYER] = (mem8[ACTIVE_PLAYER] + 1) & 1;

  /* Step 5 -- rearm the sequence (0x122F-0x123A): SEQUENCE_DELAY 0xA9EB [seen] = 90 ticks and
   * SEQUENCE_SUBSTEP 0xA9AC [seen] from the program byte at 0x4B52 (NEXT_LIFE_SUBSTEP_SEED). */
  mem8[SEQUENCE_DELAY] = STAMP_VALUE;
  mem8[SEQUENCE_SUBSTEP] = mem8[NEXT_LIFE_SUBSTEP_SEED];
}
