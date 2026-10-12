// SPDX-License-Identifier: GPL-3.0-only
/** requestDestructionOrRoundEndSoundPair — request two particular sounds in turn, and only while the cabinet may make them.
 * Neither code is an immediate: each is fetched from a byte of the program image, and choosing
 * that pair is the whole of this entry — whatever a caller held is discarded. Both go through the
 * same permission test, so both can be refused together. LIVE-OUT: memory.
 *
 * ROM 0x56E4-0x56EF (frozen lift loc_56e4). Grounding: [seen] (names.js ROUTINES 0x56E4).
 *
 * Role in the machine: the sound pair that closes every destruction burst (the player's explosion,
 * the Mother-Ship's death sweep) and marks the end of the round-won band. It is reached as a call from
 * advanceScriptedCharPlaneBandTo4 (when band-to-4 reaches its lower sentinel and sets step 4) and
 * by falling out of the bottom of requestDestructionSoundBurst. It has the same shape as
 * requestTwoSounds (0x5683), with a different pair of program bytes.
 *
 * The codes are DESTRUCTION_OR_ROUND_END_SOUND_1 (0x27CB) and DESTRUCTION_OR_ROUND_END_SOUND_2 (0x33A0). Both go through
 * enqueueSoundIfGameOrDemoSoundsOn, which admits them while PLAY_ACTIVE is set or while
 * DEMO_SOUNDS_ENABLE (the attract-sound setting) is set — so, unlike the in-play-only requests,
 * this pair can be heard in the attract demo.
 */

import { enqueueSoundIfGameOrDemoSoundsOn } from "./enqueueSoundIfGameOrDemoSoundsOn.js";
import { DESTRUCTION_OR_ROUND_END_SOUND_1, DESTRUCTION_OR_ROUND_END_SOUND_2 } from "./names.js";

export function requestDestructionOrRoundEndSoundPair(m) {
  const { mem8 } = m;
  /* First code: ld a,(0x27cb) / call 0x5617. The queue keeps arrival order, so this one is sent
   * to the audio board ahead of the second. */
  enqueueSoundIfGameOrDemoSoundsOn(m, mem8[DESTRUCTION_OR_ROUND_END_SOUND_1]);
  /* Second code: ld a,(0x33a0) / jp 0x5617 — a tail-jump, so the gate's return is ours. */
  enqueueSoundIfGameOrDemoSoundsOn(m, mem8[DESTRUCTION_OR_ROUND_END_SOUND_2]);
}
