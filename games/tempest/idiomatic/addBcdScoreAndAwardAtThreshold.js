// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { bcdAddByte, bcdSubByte } from "../../../core/bcd.js";
import { STATUS_FLAGS, loc_29, loc_2a, loc_2b, loc_3d, loc_40, loc_41, loc_42, SLOT_COUNTDOWN, RIM_COLOR_ANIM, BONUS_LIFE_INTERVAL, SCORE_VALUE_LO, SCORE_VALUE_HI } from "./names.js";
import { requestSoundIfEnabled } from "./requestSoundIfEnabled.js";

/**
 * addBcdScoreAndAwardAtThreshold — add a BCD score amount and grant a bonus-life award on crossing the interval. ROM 0xca6c (score add + threshold award).
 *
 * Role in the machine: this is Tempest's central scoring routine. Whenever the player destroys
 * something in the tube — a Flipper walking the rim, a shot Tanker, a Spiker's stalk — the caller
 * hands over an index and this routine folds the matching point value into the running score and,
 * when the total rolls across the next bonus-life boundary, chimes and flags the extra life. The
 * score is stored as a three-byte packed-BCD triplet (loc_40/41/42, low-to-high); the two players'
 * scores sit in adjacent banks, so the active player (loc_3d) selects a +0 or +3 bank offset.
 *
 * Behavior: bail immediately unless scoring is armed (STATUS_FLAGS bit 7). Choose the bank offset
 * y from loc_3d, then add the three amount bytes into the score triplet with a BCD carry chain. For
 * a small index (x < 8) the amount is a fixed point value from the SCORE_VALUE_LO/HI tables with a
 * zero third byte; otherwise it is the live operand triplet loc_29/2a/2b. A threshold test then
 * decides whether a bonus-life boundary was crossed: it measures the high byte against the bonus
 * interval BONUS_LIFE_INTERVAL (a direct compare for tiny intervals, else repeated BCD subtraction),
 * and on an exact landing runs the award helper. The award bumps the per-slot counter
 * SLOT_COUNTDOWN+loc_3d while it is still under six, requests sound 0x4f, and sets RIM_COLOR_ANIM to
 * 0x20 to kick the rim's colour animation.
 *
 * Live-out: the score triplet loc_40/41/42(+y); and, on a qualifying award, the incremented
 * per-slot counter SLOT_COUNTDOWN+loc_3d, RIM_COLOR_ANIM = 0x20, and a queued sound request.
 * Returns the exit [X, Y] the ROM leaves, because bumpLevelEnemyQuota hands them straight to its own
 * award sound (whose loader stashes them in loc_31/loc_32): Y is the bank offset; X is loc_3d when the
 * award path ran, BONUS_LIFE_INTERVAL once the threshold test has loaded it, else the incoming x.
 * Unarmed, the ROM touches neither register: X is returned as passed and Y as undefined (unchanged).
 * Grounding: [seen].
 */
export function addBcdScoreAndAwardAtThreshold(m, x = m.regs.x) {
  const { mem8 } = m;
  if ((mem8[STATUS_FLAGS] & 0x80) === 0) return [x, undefined]; // gated off unless scoring is armed (STATUS_FLAGS bit 7)
  const y = mem8[loc_3d] === 0 ? 0 : 3;          // bank offset: 0 for player 1, 3 for player 2

  // Bump a per-slot counter when it is still under six, then chime and raise a flag.
  const doAward = () => {
    const sx = mem8[loc_3d];
    const cnt = mem8[u8(SLOT_COUNTDOWN + sx)];
    if (cnt >= 0x06) return [sx, y];
    mem8[u8(SLOT_COUNTDOWN + sx)] = cnt + 1;
    requestSoundIfEnabled(m, 0x4f, sx, y); // sound, threading this slot's index and y
    mem8[RIM_COLOR_ANIM] = 0x20;
    return [sx, y]; // the sound loader hands X/Y back unchanged
  };
  let xOut = x; // the X the ROM is left holding, for the caller

  // Add the low two BCD bytes of the amount into the score triplet, carrying the low add into the
  // mid add. Small indices draw the amount from the fixed SCORE_VALUE tables; large ones use the
  // live operand triplet loc_29/2a/2b that the caller staged.
  let a, carry, zSaved;
  if (x < 0x08) {
    // Fixed point value: low byte SCORE_VALUE_LO+x into loc_40, high byte SCORE_VALUE_HI+x into loc_41.
    const r0 = bcdAddByte(mem8[u16(SCORE_VALUE_LO + x)], mem8[u16(loc_40 + y)], 0);
    mem8[u16(loc_40 + y)] = r0.value;
    const r1 = bcdAddByte(mem8[u16(SCORE_VALUE_HI + x)], mem8[u16(loc_41 + y)], r0.carry);
    mem8[u16(loc_41 + y)] = r1.value;
    a = 0x00;              // fixed-table amount has no third byte
    carry = r1.carry;
    zSaved = true;         // pretend the third byte was zero (skips the compare arm below)
  } else {
    // Live operand: the three-byte amount is loc_29 (low) / loc_2a (mid) / loc_2b (high).
    const r0 = bcdAddByte(mem8[loc_29], mem8[u16(loc_40 + y)], 0);
    mem8[u16(loc_40 + y)] = r0.value;
    const r1 = bcdAddByte(mem8[loc_2a], mem8[u16(loc_41 + y)], r0.carry);
    mem8[u16(loc_41 + y)] = r1.value;
    a = mem8[loc_2b];      // third byte of the live amount
    carry = r1.carry;
    zSaved = a === 0;      // remember whether that third byte was zero
  }

  // Third BCD byte: the value updates the cell, but the branch below and the threaded
  // carry stay as they were before this add.
  const r2 = bcdAddByte(a, mem8[u16(loc_42 + y)], carry ? 1 : 0);
  mem8[u16(loc_42 + y)] = r2.value;
  a = r2.value;

  // Decide whether to run the threshold branch or award directly.
  if (!zSaved) {
    const hv = mem8[BONUS_LIFE_INTERVAL];
    xOut = hv; // the ROM loads the interval into X for this compare
    if (hv !== 0) {
      const cmpv = mem8[loc_2b];
      if (hv <= cmpv) return doAward();
      carry = true;
    }
  }

  // Threshold branch.
  if (!carry) return [xOut, y];
  const hi = mem8[BONUS_LIFE_INTERVAL];
  xOut = hi; // reloaded into X for the threshold arithmetic
  if (hi === 0) return [xOut, y];
  if (hi < 0x03) {
    if (hi !== 0x02) return doAward();
    if ((a & 0x01) === 0) return doAward();
    return [xOut, y];
  }
  // Repeatedly subtract the threshold; land the award on an exact multiple.
  for (;;) {
    const r = bcdSubByte(a, mem8[BONUS_LIFE_INTERVAL], 0);
    a = r.value;
    if (a === 0) return doAward();
    if (!r.carry) continue; // no borrow -> keep subtracting
    return [xOut, y];
  }
}
