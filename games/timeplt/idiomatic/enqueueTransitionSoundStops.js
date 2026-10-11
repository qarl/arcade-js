// SPDX-License-Identifier: GPL-3.0-only
/**
 * enqueueTransitionSoundStops — queue seven sound-stop codes back to back.
 *
 * WHAT IT IS: ROM 0x5634-0x565E, tag [seen] (names.js ROUTINES 0x5634). The sound side of the game is
 * fed through a small queue of sound codes; this routine drops seven codes into it in one go. Six of the
 * codes are fixed, but none of them is written into the instructions as an immediate value: each is
 * FETCHED from its own byte of the program image (`ld a,(addr)`), so an edit to the image changes what
 * is asked for. The seventh is formed by adding the era index to a fixed base, so it is the one request
 * that differs from era to era.
 *
 * ROLE IN THE MACHINE: silencing sounds at a transition. Every one of the seven codes has bit 7 set on a
 * genuine image (0x86, 0x9C-0xA0, and 0x8C plus the era), and the audio processor's command handler takes
 * bit 7 as a stop: it finds the channel slot holding the low seven bits and clears it. So the routine cuts
 * off sounds 0x06, 0x1C-0x20 and the era's 0x0C-0x10 if they are playing, and starts none. Its four
 * callers are transitions: a lost life, a won round, the end of initials entry and the Mother-Ship's
 * death. Every code goes through enqueueSoundUnconditional (0x5628), the way into the sound queue that
 * does NOT test whether a game is being played -- so nothing here asks that question either, and the
 * stops are queued in the attract demo just as in play.
 *
 * LIVE-OUT: memory-only (the sound queue and its count).
 */

import { enqueueSoundUnconditional } from "./enqueueSoundUnconditional.js";
import {
  ERA_INDEX,
  TRANSITION_SOUND_CODE_CELL_167C,
  TRANSITION_SOUND_CODE_CELL_0A9C,
  TRANSITION_SOUND_CODE_CELL_1484,
  TRANSITION_SOUND_CODE_CELL_0C78,
  TRANSITION_SOUND_CODE_CELL_07D3,
  TRANSITION_SOUND_CODE_CELL_33B4,
} from "./names.js";
import { u8 } from "../../../core/int.js";

/*
 * The six image bytes read as sound codes, in the ROM's order. On a genuine image they hold: 0x167C = 0x86, 0x0A9C = 0x9C, 0x1484 = 0x9D, 0x0C78 = 0x9E, 0x07D3 = 0x9F and
 * 0x33B4 = 0xA0. Each is a names.js cell (TRANSITION_SOUND_CODE_CELL_*).
 */
const FIXED_CODE_SOURCES = [
  TRANSITION_SOUND_CODE_CELL_167C,
  TRANSITION_SOUND_CODE_CELL_0A9C,
  TRANSITION_SOUND_CODE_CELL_1484,
  TRANSITION_SOUND_CODE_CELL_0C78,
  TRANSITION_SOUND_CODE_CELL_07D3,
  TRANSITION_SOUND_CODE_CELL_33B4,
];
/* The base the era index is added to for the seventh code: the ROM's `add a,0x8c`. */
const ERA_CODE_BASE = 140;

export function enqueueTransitionSoundStops(m) {
  const { mem8 } = m;
  /*
   * Codes one to six: fetch each byte from the program image and queue it. The ROM does this as six
   * `ld a,(addr) / call 0x5628` pairs, one after another, with no test between them.
   */
  for (const source of FIXED_CODE_SOURCES) enqueueSoundUnconditional(m, mem8[source]);
  /*
   * Code seven: ERA_INDEX (0xAD04, which era is being played, 0-4) plus 0x8C, wrapped to a byte as the
   * Z80's 8-bit add wraps it. The ROM reaches the queue here by a tail jump (`jr 0x5628`) rather than a
   * call, so this last request finishes the routine.
   */
  enqueueSoundUnconditional(m, u8(mem8[ERA_INDEX] + ERA_CODE_BASE));
}
