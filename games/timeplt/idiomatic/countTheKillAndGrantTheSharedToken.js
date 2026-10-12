// SPDX-License-Identifier: GPL-3.0-only
/**
 * countTheKillAndGrantTheSharedToken — the tick a hit object's death begins: ask for the death sounds,
 * take one off the round's kill quota, and, past three guards, grant this object the single-holder
 * "last of the wave" token.
 *
 * ROM 0x2BBA-0x2BDD. Grounding: [seen] (names.js ROUTINES 0x2BBA).
 *
 * ROLE IN THE MACHINE. Called from stepDyingObjectState, the per-object state step, on the paths where a
 * death begins (names.js notes a third static call site at 0x2A38 that is dead code). `object` is the base of
 * the dying object's sixteen-byte record (the ROM's IX).
 *
 * UNCONDITIONAL PART. The two death sounds are requested (requestTwoSounds, ROM 0x5683) and KILLS_REMAINING
 * (0xAD02) [seen] — the quota whose reaching zero brings on the Mother-Ship — is decremented, but floored at
 * zero rather than wrapped.
 *
 * THE TOKEN. A wave of craft carries a shared claim: when the wave spawns, WAVE_KILL_COUNTDOWN (0xA811) [seen]
 * is set to how many qualifying kills it takes and WAVE_CLAIM_TIMER (0xA812) [seen] opens a time window. Each
 * qualifying kill ticks the countdown; the kill that zeroes it writes its record's slot ordinal, with the top
 * bit set, into CLAIM_TOKEN (0xA821) [seen]. driveObjectAppearanceByPhaseBand later honours and consumes the
 * token (names.js CLAIM_TOKEN). The guards: the record's cooldown byte has its top bit set, and the window is
 * still open. The countdown is spent whenever those two pass, so every qualifying kill ticks it, not only the
 * winner.
 *
 * LIVE-OUT: memory.
 */

import { u8 } from "../../../core/int.js";
import { requestTwoSounds } from "./requestTwoSounds.js";
import { CLAIM_TOKEN, KILLS_REMAINING, WAVE_CLAIM_TIMER, WAVE_KILL_COUNTDOWN } from "./names.js";

/** Record offsets (ROM `ld a,(ix+0x0e)` / `ld a,(ix+0x0f)`): the cooldown byte and the slot ordinal. */
const RELEASE_DELAY = 0x0e;
const ORDINAL = 0x0f;
/** Top bit of the cooldown byte: this object may claim (ROM `bit 7,a; ret z`). */
const RELEASED_FROM_HOLD_MARK = 0x80;
/** Added to the ordinal to mark the token as held (ROM `add a,0x80`). */
const HOLDER_MARK = 0x80;

export function countTheKillAndGrantTheSharedToken(m, object = m.regs.ix) {
  const { mem8 } = m;
  // Death sounds, then the floored quota decrement (ROM `and a; jr z` skips the `dec (hl)` at zero).
  requestTwoSounds(m);

  if (mem8[KILLS_REMAINING] !== 0) mem8[KILLS_REMAINING] = mem8[KILLS_REMAINING] - 1;

  // Guards 1-2: this object is eligible, and the wave's claim window is open.
  if ((mem8[object + RELEASE_DELAY] & RELEASED_FROM_HOLD_MARK) === 0) return;
  if (mem8[WAVE_CLAIM_TIMER] === 0) return;

  // Guard 3: tick the wave's countdown; only the kill that brings it to zero goes on.
  mem8[WAVE_KILL_COUNTDOWN] = u8(mem8[WAVE_KILL_COUNTDOWN] - 1);
  if (mem8[WAVE_KILL_COUNTDOWN] !== 0) return;

  // Grant the token: this record's ordinal with the top bit set marks it as the holder.
  mem8[CLAIM_TOKEN] = u8(mem8[object + ORDINAL] + HOLDER_MARK);
}
