// SPDX-License-Identifier: GPL-3.0-only
/** requestTwoSounds — request two sounds in a row, both admitted while a game is in progress or while the
 * cabinet may sound during its attract loop. Neither code is an immediate: each is fetched from
 * its own byte of the program image, and the two bytes are far apart, so this is a pair chosen
 * here and not a run walked through. LIVE-OUT: memory.
 *
 * ROM 0x5683-0x568D. Grounding: [seen].
 *
 * Role in the machine: the sound pair for combat impacts. Its callers
 * (advanceHitSoakingObjectThenAnimateDeath, countTheKillAndGrantTheSharedToken,
 * clampOneShotCountdownThenRequestTwoSounds, loc_43f0) are hit, kill and retire sites,
 * which is why the first code is named generically rather than "death". Both
 * codes go onto the shared sound queue; the queue's drain at 0x55D4 later takes each head code and
 * hands it to 0x55F8, which writes it to 0xC000 -- the sound-data latch -- and pulses the LS259
 * bit wired to the second (audio) Z80's interrupt, so these bytes end up as commands to another
 * processor rather than sitting in RAM.
 *
 * Twin: requestTwoSoundsWhilePlaying has the same two-fetch shape but goes through the
 * play-only door; this one uses the play-or-demo door, so the demo hears it too.
 *
 * LIVE-OUT: memory only -- the sound queue, up to two entries. */

import { enqueueSoundIfGameOrDemoSoundsOn } from "./enqueueSoundIfGameOrDemoSoundsOn.js";
import { TWO_SOUND_REQUEST_FIRST_CODE, TWO_SOUND_REQUEST_SECOND_CODE } from "./names.js";

export function requestTwoSounds(m) {
  const { mem8 } = m;
  // First code: the byte at 0x07A6 (TWO_SOUND_REQUEST_FIRST_CODE), handed to the door at
  // 0x5617 (enqueueSoundIfGameOrDemoSoundsOn) as an ordinary call. The door admits it while a game
  // is being played or the demo-sounds cell 0xA9C6 is set.
  enqueueSoundIfGameOrDemoSoundsOn(m, mem8[TWO_SOUND_REQUEST_FIRST_CODE]);
  // Second code: the byte at 0x4CDA (TWO_SOUND_REQUEST_SECOND_CODE), through the same door --
  // in the ROM a tail jump, so the door's own return ends this routine. Each request is judged
  // by the door on its own; neither depends on whether the other was admitted.
  enqueueSoundIfGameOrDemoSoundsOn(m, mem8[TWO_SOUND_REQUEST_SECOND_CODE]);
}
