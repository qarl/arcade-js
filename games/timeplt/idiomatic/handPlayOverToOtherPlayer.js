// SPDX-License-Identifier: GPL-3.0-only
/** handPlayOverToOtherPlayer — give the turn to the other player: flip the one-bit active-player
 * index, re-arm the shared sequence delay, reseat the inner sequence index from a program byte.
 * Flipping the index IS the hand-over: every per-player cell is reached through it, nothing is
 * copied, and the skip arm writes the other two cells too. LIVE-OUT: memory, three cells.
 *
 * ROM 0x1226-0x123A (lift: translated/loc_1226.js). Grounding: [seen].
 *
 * Role in the machine: in a two-player game, when a turn ends -- loseLifeAndHandOver falling through from 0x1224 after a death, or
 * passTurnToOtherPlayerIfLivesElseStepSequence (jp nz,0x1226 at 0x12F5) after a game over -- control comes here only if the first byte of the save block the index does NOT select is non-zero — a
 * one-player start writes zero there, so a one-player
 * game never reaches it (under MAME: nine dispatches with a two-player start, zero with one).
 * ACTIVE_PLAYER (0xAD32) is the whole of the two-player machinery: the save blocks, the score
 * triple, the score drawer and the turn caption are all reached through it, 0 naming player one.
 */

import { SEQUENCE_SUBSTEP, ACTIVE_PLAYER, SEQUENCE_DELAY, NEXT_LIFE_SUBSTEP_SEED } from "./names.js";

// The pause before the next sequence step runs: 90 ticks of SEQUENCE_DELAY (`ld a,0x5a`).
const HANDOVER_DELAY = 90;

export function handPlayOverToOtherPlayer(m) {
  const { mem8 } = m;
  // Flip the player: `ld a,(0xad32) / inc a / and 0x01 / ld (0xad32),a`.
  mem8[ACTIVE_PLAYER] = (mem8[ACTIVE_PLAYER] + 1) & 1;
  // Re-arm the sequence machine's shared one-shot delay (0xA9EB), so the next step waits.
  mem8[SEQUENCE_DELAY] = HANDOVER_DELAY;
  // Reseat the round engine's inner sequence index (0xA9AC) from the program byte at 0x4B52
  // (0x01 on this image) rather than an immediate, so the sequence resumes at that sub-step.
  mem8[SEQUENCE_SUBSTEP] = mem8[NEXT_LIFE_SUBSTEP_SEED];
}
