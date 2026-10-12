// SPDX-License-Identifier: GPL-3.0-only
/** flyAlongBallisticArc — move one object a frame's worth along both axes and retire it once it has left the
 * picture. Each coordinate is 16 bits stored split, the whole part in the sprite entry and the
 * fraction in the record. Across, the object takes a fixed step whose direction is a byte of its
 * own record. Along the other axis it takes a step it does not hold constant: a second 16-bit
 * number in the record grows by a fixed amount every frame and is what gets added, so the object
 * accelerates. Both axes also take the frame's shared displacement, so the object moves with the
 * world on top of its own motion. The two whole parts are then tested against fixed limits — a
 * narrow wrapped window on the first axis, an upper limit (0xF8) on the second — and either one
 * puts the slot out of play.
 *
 * ROM 0x4017-0x406B (frozen lift translated/loc_4017.js). Grounding: [seen] (names.js ROUTINES 0x4017).
 *
 * Role in the machine: one of the per-era object movers, the one that throws an object on an arc.
 * names.js records that it is dispatched only while the first era is being played (its caller's
 * era gate), and that the spawner seeds the growing velocity pointing away from the direction it
 * then grows in, so the object first moves against the pull, stalls and comes back — a thrown
 * arc — while the sideways flag leans it toward the player. Leaving the field on either axis hands the slot to retireSlot.
 *
 * `record` is the object's record (IX on the Z80), `entry` its sprite entry (IY).
 *
 * LIVE-OUT: memory. */

import { u8, u16 } from "../../../core/int.js";
import { retireSlot } from "./retireSlot.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "./names.js";

// Byte offsets. The "across" coordinate is whole at entry +0x31 (the sprite's native-Y byte) with
// its fraction at record +3; the "along" coordinate is whole at entry +0x00 (native X) with its
// fraction at record +5 — the pairing names.js records for every reader of the scroll cells.
const WHOLE_ACROSS = 49;
const FRACTION_ACROSS = 3;
const WHOLE_ALONG = 0;
const FRACTION_ALONG = 5;
// Record +1: the sideways direction flag, zero for the positive step. Record +7/+8: the growing
// 16-bit velocity on the along axis, low byte first.
const DIRECTION = 1;
const SPEED_LOW = 7;
const SPEED_HIGH = 8;

// 0x0180 = one and a half pixels a frame sideways (8.8 fixed point); 0x0009 is added to the along
// velocity every frame — the constant pull that bends the path.
const STEP_ACROSS = 384;
const SPEED_GAIN = 9;

// Off-field limits: across is out when (whole + 0x10) wraps below 0x20, i.e. within sixteen of the
// wrap either side; along is out at 0xF8 and above.
const OFF_ACROSS_LEAD = 16;
const OFF_ACROSS_BAND = 32;
const OFF_ALONG_FROM = 248;

// Read a split coordinate as one 16-bit 8.8 number: whole part high, fraction low.
const split = (mem8, whole, fraction) => (mem8[whole] << 8) + mem8[fraction];

export function flyAlongBallisticArc(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8, mem16 } = m;

  // Across: the fixed sideways step, signed by the record's flag (0x0180 or 0xFE80 in the ROM),
  // plus the world scroll that lands on this axis (WORLD_SCROLL_Y), then split back into the two
  // bytes it came from.
  const acrossWhole = entry + WHOLE_ACROSS;
  const acrossFraction = record + FRACTION_ACROSS;
  const step = mem8[record + DIRECTION] === 0 ? STEP_ACROSS : -STEP_ACROSS;
  const across = u16(split(mem8, acrossWhole, acrossFraction) + step + mem16[WORLD_SCROLL_Y]);
  mem8[acrossWhole] = across >> 8;
  mem8[acrossFraction] = across;

  // Accelerate: the along velocity gains its fixed amount and is stored back BEFORE it is used, so
  // this frame moves at the new speed (the ROM adds 0x0009 and writes +7/+8 before its next add).
  const speed = u16(split(mem8, record + SPEED_HIGH, record + SPEED_LOW) + SPEED_GAIN);
  mem8[record + SPEED_LOW] = speed;
  mem8[record + SPEED_HIGH] = speed >> 8;

  // Along: the coordinate gains that velocity plus the world scroll for this axis (WORLD_SCROLL_X).
  const alongWhole = entry + WHOLE_ALONG;
  const alongFraction = record + FRACTION_ALONG;
  const along = u16(split(mem8, alongWhole, alongFraction) + speed + mem16[WORLD_SCROLL_X]);
  mem8[alongWhole] = along >> 8;
  mem8[alongFraction] = along;

  // Off the side: the biased across byte falls in the wrapped window around the wrap point. The
  // ROM tail-jumps to retireSlot (0x40AB) here, so the along test is not reached.
  if (u8(mem8[acrossWhole] + OFF_ACROSS_LEAD) < OFF_ACROSS_BAND) {
    retireSlot(m, record, entry);
    return;
  }
  // Off the far end of the along axis: retire as well; otherwise the object flies on next frame.
  if (mem8[alongWhole] >= OFF_ALONG_FROM) retireSlot(m, record, entry);
}
