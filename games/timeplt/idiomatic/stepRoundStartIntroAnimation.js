// SPDX-License-Identifier: GPL-3.0-only
/** stepRoundStartIntroAnimation — run one frame of the sub-step-14 band animation, and only on two frames of every four. The
 * animation's own step cell picks the arm: the early steps flash the player ship and advance two character-plane
 * animations, the last step hides every sprite, sets up the active player's turn and reloads the inner
 * sequence index to its reload sub-step. LIVE-OUT: memory.
 *
 * ROM 0x1323-0x1366 (frozen lift translated/loc_1323.js). Grounding: [seen] in names.js.
 *
 * Role in the machine: this is the sub-step-14 arm of the sequence machine's phase-3 table at
 * 0x0F29 — the between-eras band animation that plays after a round is won and before the next
 * round starts. armRoundWonBandAnimationThenStepSequence stocks its control block (0xA9F0-0xA9F8)
 * and seeds INTRO_ANIMATION_STEP (0xA9F0) to 0; each sub-animation below writes the step it hands
 * off to when it finishes (flash->1, band-to-2->2, colour-cycle->3, band-to-4->4, flood->5), so this
 * routine only reads the step and never advances it itself. */

import { flashPlayerWhiteEveryOtherFrame } from "./flashPlayerWhiteEveryOtherFrame.js";
import { hideAllSprites } from "./hideAllSprites.js";
import { advanceScriptedCharPlaneBandTo2 } from "./advanceScriptedCharPlaneBandTo2.js";
import { cyclePlayerSpriteColourThenAdvanceStepAtZero } from "./cyclePlayerSpriteColourThenAdvanceStepAtZero.js";
import { floodColourPlaneWithSavedPlayerColour } from "./floodColourPlaneWithSavedPlayerColour.js";
import { advanceScriptedCharPlaneBandTo4 } from "./advanceScriptedCharPlaneBandTo4.js";
import { loadActivePlayerContextAndPostRoundHud } from "./loadActivePlayerContextAndPostRoundHud.js";
import { FRAME_TICK, INTRO_ANIMATION_STEP, SEQUENCE_DELAY, SEQUENCE_SUBSTEP, INTRO_SUBSTEP_RELOAD } from "./names.js";

// `ld a,0x5a` at 0x1355: the sequence machine's one-shot delay (90 ticks, which arm 5 counts down on odd frames only) armed on the way out.
const WIND_DELAY = 90;

export function stepRoundStartIntroAnimation(m) {
  const { mem8 } = m;
  /* Pacing (0x1323-0x1328): FRAME_TICK (0xA980) advances once per vblank; its bit 1 is set on two
   * frames out of every four, and on those frames nothing happens (`and 0x02 / ret nz`). The whole
   * animation therefore runs at half the frame rate, in pairs of frames. */
  if (mem8[FRAME_TICK] & 2) return;

  /* Dispatch on INTRO_ANIMATION_STEP (0xA9F0). The ROM walks it with a chain of `dec a / jr nz`
   * tests (0x1329-0x1355); each arm is one or two calls and a return. */
  switch (mem8[INTRO_ANIMATION_STEP]) {
    case 0:
      // Step 0: flash the player's ship white and back (0x1367).
      flashPlayerWhiteEveryOtherFrame(m);
      return;
    case 1:
      // Step 1: keep flashing while the first scripted character-plane band animation runs (0x142A).
      flashPlayerWhiteEveryOtherFrame(m);
      advanceScriptedCharPlaneBandTo2(m);
      return;
    case 2:
      // Step 2: cycle the ship through two colours (0x1393) alongside the second band script (0x14C5).
      cyclePlayerSpriteColourThenAdvanceStepAtZero(m);
      advanceScriptedCharPlaneBandTo4(m);
      return;
    case 3:
      // Step 3: the second band script alone.
      advanceScriptedCharPlaneBandTo4(m);
      return;
    case 4:
      // Step 4: flood a fixed block of the colour plane with the saved player colour (0x13CC).
      floodColourPlaneWithSavedPlayerColour(m);
      return;
    default:
      /* Any later step (5, written by the flood): the animation is over — hand back to the sequence
       * machine (0x1355-0x1366). Arm SEQUENCE_DELAY (0xA9EB) at 90 for the round-intro hold; hide every sprite by
       * parking the vertical shadow band (hideAllSprites, 0x15B6); load the active player's saved
       * context and post the round HUD (0x4C75); then reload the inner sequence index SEQUENCE_SUBSTEP
       * (0xA9AC) from the ROM byte at 0x2750, which holds 3. */
      mem8[SEQUENCE_DELAY] = WIND_DELAY;
      hideAllSprites(m);
      loadActivePlayerContextAndPostRoundHud(m);
      mem8[SEQUENCE_SUBSTEP] = mem8[INTRO_SUBSTEP_RELOAD];
  }
}
