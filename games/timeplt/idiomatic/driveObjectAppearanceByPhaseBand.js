// SPDX-License-Identifier: GPL-3.0-only
/**
 * driveObjectAppearanceByPhaseBand — drive one object's appearance from a phase byte in its own record, in three bands.
 *
 * At 42+ only the tint moves: the sprite's top two attribute bits are kept and a free-running
 * counter's low nibble dropped beneath them, cycling sixteen tints while the shape holds.
 * Between 10 and 41 the phase is halved into a step that picks a shape from a sixteen-entry table
 * (one fixed tint), so shapes advance at half the phase's speed.
 * Below 10 the object lives only while CLAIM_TOKEN names it — top bit set and low seven bits
 * matching this record's number, else it is retired; while named the phase advances unless FRAME_TICK's low three bits
 * are zero, a fixed shape and tint hold, and only the pass on which the phase reads 1 (the countdown's last value) posts a command and clears the token,
 * consuming it once. LIVE-OUT: memory-only.
 *
 * ROM 0x2C31-0x2C93 (frozen lift loc_2c31). Grounding: [seen] (names.js ROUTINES 0x2C31).
 *
 * Role in the machine: the "phase" is the object's state byte, the first byte of its object
 * record. names.js places this routine on the path a slot takes once that byte is neither free,
 * live nor held — in practice a craft that has been shot down, whose state byte is a death
 * countdown that stepDyingObjectState steps down each pass (mechanisms.md). So this is the wreck's
 * animation: high counts flicker through tints, mid counts step through a sixteen-entry
 * explosion shape table, and below ten the wreck is removed at once — except for the one wreck
 * that holds the wave's claim token.
 *
 * The claim token: the kill that empties the wave's kill countdown writes its own slot ordinal,
 * top bit set, into CLAIM_TOKEN (0xA821) [seen]. The record numbered to match is the formation
 * bonus wreck: it holds a fixed shape and tint, and because this routine bumps its count back up
 * on most passes while stepDyingObjectState steps it down every pass, it lingers on
 * screen. On the pass its count reads 1 it posts command 4 with argument 12 — score award
 * index 12, 2,000 points (mechanisms.md, scoring) — and clears the token so the award is paid once.
 *
 * Parameters: `object` is the object record (IX in the ROM); `sprite` is its sprite entry (IY in
 * the ROM), whose +1 is the shape code and +0x30 the attribute (tint) byte.
 */

import { fetchTableByte } from "./fetchTableByte.js";
import { postCommand } from "./postCommand.js";
import { retireSlotAndSubPixel } from "./retireSlotAndSubPixel.js";
import { u8 } from "../../../core/int.js";
import { CLAIM_TOKEN, FRAME_TICK, OBJECT_PHASE_SHAPE_TABLE } from "./names.js";

// Offsets into the object record (IX) and the sprite entry (IY).
const PHASE = 0; // (ix+0x00): the state byte
const RECORD_NUMBER = 15; // (ix+0x0f): the slot ordinal stamped into every record
const SHAPE = 1; // (iy+0x01): sprite shape code
const ATTRIBUTE = 0x30; // (iy+0x30): sprite attribute / tint

// Band edges and masks, from the ROM's compares and ANDs.
const TINT_ONLY_FROM = 42; // cp 0x2a
const SHAPE_RUN_FROM = 10; // cp 0x0a
const PHASES_PER_STEP = 2; // sub 0x0a / rrca / and 0x0f: halve the phase above 10
const MIRROR_BITS = 0xc0; // and 0xc0: the attribute's top two bits survive
const CYCLED_TINT_BITS = 0x0f; // and 0x0f on FRAME_TICK: sixteen cycling tints
const REQUEST_PRESENT = 0x80; // bit 7,a on CLAIM_TOKEN
const REQUEST_NUMBER = 0x7f; // res 7,a: the claimant's slot ordinal
const HOLD_ONE_FRAME_IN = 0x07; // and 0x07 on FRAME_TICK: zero one frame in eight

// Fixed values the ROM stores (ld (iy+..),n) and posts (ld de,0x040c).
const SHAPE_RUN_TINT = 60; // 0x3c
const HELD_SHAPE = 252; // 0xfc
const HELD_TINT = 108; // 0x6c
const FINAL_PHASE = 1; // cp 0x01
const COMMAND = 4; // ring command 4: awardScoreToPlayer
const ARGUMENT = 12; // award index 12: 2,000 points

export function driveObjectAppearanceByPhaseBand(m, object = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;
  const phase = mem8[object + PHASE];

  /* Band 1, phase 42 and up (ROM jp nc,0x2c71 -> 0x2C71-0x2C81): keep the shape, recolour only.
   * The attribute's top two bits are kept and FRAME_TICK's (0xA980 [seen], one step per frame)
   * low nibble goes under them, so the tint steps through sixteen values, one per frame. */
  if (phase >= TINT_ONLY_FROM) {
    const flipBits = mem8[sprite + ATTRIBUTE] & MIRROR_BITS;
    mem8[sprite + ATTRIBUTE] = flipBits + (mem8[FRAME_TICK] & CYCLED_TINT_BITS);
    return;
  }

  /* Band 2, phase 10 to 41 (ROM jr nc,0x2c82 -> 0x2C82-0x2C93): (phase - 10) / 2 is a step 0-15
   * into OBJECT_PHASE_SHAPE_TABLE (0x2C94), fetched with rst 0x08 (fetchTableByte). Halving means
   * each shape shows for two counts. The tint is pinned to 0x3C. */
  if (phase >= SHAPE_RUN_FROM) {
    const step = Math.floor(u8(phase - SHAPE_RUN_FROM) / PHASES_PER_STEP);
    mem8[sprite + SHAPE] = shapeForStep(m, step);
    mem8[sprite + ATTRIBUTE] = SHAPE_RUN_TINT;
    return;
  }

  /* Band 3, phase below 10: is this record the one CLAIM_TOKEN names? The ROM tests bit 7 of the
   * token (jp z,0x2bde when clear) and then compares its low seven bits with the record's
   * +0x0F ordinal (jp nz,0x2bde on mismatch). Either failure tail-jumps to retireSlotAndSubPixel
   * (0x2BDE), which takes the object out of play and zeroes its coordinates. */
  const request = mem8[CLAIM_TOKEN];
  const named = (request & REQUEST_PRESENT) !== 0 &&
    (request & REQUEST_NUMBER) === mem8[object + RECORD_NUMBER];
  if (!named) {
    retireSlotAndSubPixel(m, object, sprite);
    return;
  }

  /* The named wreck. Bump its count on most passes (inc (ix+0x00) unless FRAME_TICK's
   * low three bits are zero) — against the per-pass decrement elsewhere this makes it linger —
   * and hold the fixed shape 0xFC with tint 0x6C (ROM 0x2C50-0x2C62). */
  if ((mem8[FRAME_TICK] & HOLD_ONE_FRAME_IN) !== 0) mem8[object + PHASE] = u8(phase + 1);
  mem8[sprite + SHAPE] = HELD_SHAPE;
  mem8[sprite + ATTRIBUTE] = HELD_TINT;
  /* Pay the bonus once: only when the count reads exactly 1 after the bump (ret nz otherwise)
   * post command 4 / argument 12 on the command ring (rst 0x38, postCommand) and zero the token,
   * so no later frame can name this record again. postCommand drops the pair if the ring cell
   * is still occupied; the token is cleared either way. */
  if (mem8[object + PHASE] !== FINAL_PHASE) return;
  postCommand(m, COMMAND, ARGUMENT);
  mem8[CLAIM_TOKEN] = 0;
}

/** Band-2 shape: entry `step` of OBJECT_PHASE_SHAPE_TABLE, via fetchTableByte (rst 0x08). */
function shapeForStep(m, step) {
  return fetchTableByte(m, OBJECT_PHASE_SHAPE_TABLE, step);
}
