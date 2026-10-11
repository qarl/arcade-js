// SPDX-License-Identifier: GPL-3.0-only
/**
 * askForSoundWhileTheGroupIsClear — from the third era on, ask for sound 6 to stop every thirty-second frame,
 * but only while none of the three era-object records is live. Any one test failing ends
 * the entry having done nothing at all.
 *
 * ROM 0x40B8-0x40D5. Grounding: [seen] (names.js ROUTINES 0x40B8).
 *
 * ROLE IN THE MACHINE. One entry of the round engine's service list (serviceRoundThenResolvePlayerState),
 * so it is consulted on every pass of the round engine. It sits immediately before the routine that walks
 * the same group of records from 0xA8C0 and carries the same era test (names.js "why"), so the pair is
 * one subsystem's motion and one subsystem's sound.
 *
 * The three records are the per-era special-object bank at ERA_OBJECT_RECORD_SLOT0 (0xA8C0) [seen], 0xA8D0
 * and 0xA8E0; a record's first byte is its state byte, and 0xFF there means the object is live.
 *
 * The code byte asked for is ROM[0x07FE] = 0x86, a stop code: with bit 7 set, the audio processor clears
 * the channel playing sound 0x06 rather than starting a sound. It is requested through
 * requestSoundSixStopWhilePlaying, which admits it only while a game is being played. Under MAME the
 * gate is the conjunction of every test (names.js "why": passes and refusals counted at the entry).
 *
 * LIVE-OUT: memory, through the request.
 */

import { ERA_INDEX, ERA_OBJECT_RECORD_SLOT0, ERA_OBJECT_RECORD_SLOT1, ERA_OBJECT_RECORD_SLOT2, FRAME_TICK } from "./names.js";
import { requestSoundSixStopWhilePlaying } from "./requestSoundSixStopWhilePlaying.js";

/** ERA_INDEX runs 0-4; 2 is the third era (ROM `cp 0x02; ret c`). */
const FIRST_ERA_THAT_ASKS = 2;
/** The ROM tests FRAME_TICK's low five bits (`and 0x1f; ret nz`): true once in every 32 frames. */
const ONE_FRAME_IN = 32;
const WATCHED = [ERA_OBJECT_RECORD_SLOT0, ERA_OBJECT_RECORD_SLOT1, ERA_OBJECT_RECORD_SLOT2];
/** The live value of a record's state byte; the ROM tests it with `inc a; ret z`. */
const ALL_ONES = 255;

export function askForSoundWhileTheGroupIsClear(m) {
  const { mem8 } = m;
  // Test 1: the era (ERA_INDEX 0xAD04 [seen]) must be at least the third.
  if (mem8[ERA_INDEX] < FIRST_ERA_THAT_ASKS) return;
  // Test 2: the free-running frame counter (FRAME_TICK 0xA980 [seen], advanced once per vblank) must be on
  // a multiple of 32, which paces the request to one frame in thirty-two rather than every pass.
  if (mem8[FRAME_TICK] % ONE_FRAME_IN !== 0) return;
  // Test 3: no record of the group may be live — any one live object silences the request.
  if (WATCHED.some((cell) => mem8[cell] === ALL_ONES)) return;
  // Every test passed: ask for sound 6 to stop (the ROM tail-jumps to 0x5679).
  requestSoundSixStopWhilePlaying(m);
}
