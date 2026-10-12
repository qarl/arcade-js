// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceAttractTowardGameStart — ROM 0x0F54 [seen]
 *
 * WHAT IT IS. The fixed continuation of the round-engine phase's sequence step. Time Pilot runs its
 * top level as a two-level sequence machine: SEQUENCE_PHASE (0xA9AB) is the outer mode (0 boot wipe,
 * 1 attract, 2 credit / push-start, 3 round engine) and SEQUENCE_SUBSTEP (0xA9AC) the step inside
 * it. For phase 3, dispatchSequenceSubStepArm (0x0F1F) runs the arm the sub-step selects and then
 * ALWAYS continues here. Phase 3 is also what the attract demo runs, so this is the point where a
 * demo notices that a credit has arrived (or that free play and a start button allow a game).
 *
 * ROLE. Three outcomes, tested in order:
 *   1. a game is already being played -> nothing to do;
 *   2. there is a credit -> leave the demo for the credit / push-start phase;
 *   3. free play is on and a start button is held -> clear the picture's sprites and start a game.
 * The free-play arm was not observed under MAME (names.js); it is read from the ROM.
 *
 * LIVE-OUT: memory only; the accumulator and flags the original leaves on each bail are read by
 * nothing after it.
 */
import { hideAllSprites } from "./hideAllSprites.js";
import { startGameOnFreePlay } from "./startGameOnFreePlay.js";
import { CREDIT_COUNT, FREE_PLAY, IN0_MIRROR, PLAY_ACTIVE, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, SEQUENCE_PHASE_ON_CREDIT } from "./names.js";

export function advanceAttractTowardGameStart(m) {
  const { mem8 } = m;

  // PLAY_ACTIVE (0xAD30, [seen]) is the all-ones flag the start routines raise when a real game
  // begins. While it is set the round engine belongs to a player, not to the demo, so there is
  // nothing to hand over (ROM 0x0F54: ld a,(0xad30) / and a / ret nz).
  if (mem8[PLAY_ACTIVE] !== 0) return;

  // A nonzero packed-decimal credit count (CREDIT_COUNT 0xA986) means a coin has been inserted
  // during the demo. Restart the inner step at 0 and reload the outer phase from the ROM byte at
  // SEQUENCE_PHASE_ON_CREDIT (0x1736, which holds 0x02 = the credit / push-start phase), so the next
  // frame's dispatch runs the "push start" screen instead of the demo (ROM 0x0F70-0x0F7A).
  if (mem8[CREDIT_COUNT] !== 0) {
    mem8[SEQUENCE_SUBSTEP] = 0;
    mem8[SEQUENCE_PHASE] = mem8[SEQUENCE_PHASE_ON_CREDIT];
    return;
  }

  // No credit: a game can still start without one when the cabinet is on free play
  // (FREE_PLAY 0xA9C0, raised by the coinage unpack) -- otherwise stay in the demo.
  if (mem8[FREE_PLAY] === 0) return;
  // ... and only when a start button is held: bits 3-4 (mask 0x18) of IN0_MIRROR (0xA9AE), the
  // per-frame, already-complemented copy of the IN0 port, are the two start buttons that
  // startGameOnFreePlay tells apart (ROM 0x0F67: and 0x18 / ret z).
  if ((mem8[IN0_MIRROR] & 0x18) === 0) return;

  // hide the sprites, then start the game; the start is the tail, so its return is this arm's.
  // hideAllSprites (0x15B6) parks every sprite off the visible picture (native-Y bytes zeroed) so the
  // demo's craft vanish; startGameOnFreePlay (0x1690, reached by a tail jump) stocks the player
  // block(s) for one or two players by which button is held, charging no credit.
  hideAllSprites(m);
  return startGameOnFreePlay(m);
}
