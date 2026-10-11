// SPDX-License-Identifier: GPL-3.0-only
/** drawRandomByte — draw the next pseudo-random byte. A block of seventeen bytes is a shift
 * register: each byte moves one place along and the vacated head takes the exclusive-or of two taps
 * read AFTER the shift, so the feedback is over the bytes that were seventh and sixteenth. What is
 * handed back is that feedback PLUS the free-running frame counter, so two draws at different
 * moments differ even where the register has not moved. The register IS the state and every draw
 * advances it.
 *
 * ROM 0x4B4B-0x4B66 (frozen lift translated/loc_4b4b.js). Grounding: [seen] -- a MAME write tap on
 * the register found exactly two writers: this routine's feedback store and the seeder's block copy
 * (names.js).
 *
 * Role in the machine: the game's only random generator. RANDOM_REGISTER (0xAB30) is seeded by
 * seedRandomRegister from seventeen fixed program bytes at 0x4B84, at cold start and again at the
 * start of every attract demo (mechanisms.md "The random generator"). Its four callers --
 * driveEnemyWaveForLifePhase, spawnEnemyWaveIntoFreeSlots, spawnEnemyIntoFreeSlotElseStepSearch
 * and pickScriptAtRandomOrInTurn -- each use the draw at once and shape it differently. The ROM
 * brackets the body with `exx`, so the caller's main registers survive; only A carries the draw.
 *
 * LIVE-OUT: the drawn byte, returned, plus the shifted block in memory. */

import { u8 } from "../../../core/int.js";
import { FRAME_TICK, RANDOM_REGISTER } from "./names.js";

// 0xAB30..0xAB40.
const REGISTER_BYTES = 17;
// The taps, read after the shift: 0xAB37 (`ld a,(0xab37)`) and 0xAB40 (`xor (hl)` with HL=0xAB40).
const FIRST_TAP = 7;
const SECOND_TAP = 16;

export function drawRandomByte(m) {
  const { mem8 } = m;
  /* Shift the register one place toward the tail. The ROM does it as a 16-byte `lddr` copying 0xAB3F..0xAB30
   * onto 0xAB40..0xAB31, top byte first (so no byte is overwritten before it is copied); the oldest byte at 0xAB40 falls
   * off the end. Copying from the top down here keeps that same order. */
  for (let i = REGISTER_BYTES - 1; i > 0; i--) mem8[RANDOM_REGISTER + i] = mem8[RANDOM_REGISTER + i - 1];

  // Feedback: exclusive-or of the two taps, stored in the vacated head (`ld (0xab30),a`).
  const feedback = mem8[RANDOM_REGISTER + FIRST_TAP] ^ mem8[RANDOM_REGISTER + SECOND_TAP];
  mem8[RANDOM_REGISTER] = feedback;

  // The draw adds the free-running counter to the feedback; the sum's low byte is handed back.
  // (ROM `add a,(hl)` with HL = FRAME_TICK 0xA980, which advances once per vertical blank.)
  const drawn = u8(feedback + mem8[FRAME_TICK]);
  return drawn;
}
