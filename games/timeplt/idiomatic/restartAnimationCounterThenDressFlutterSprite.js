// SPDX-License-Identifier: GPL-3.0-only
/** restartAnimationCounterThenDressFlutterSprite — close out one object's animation and dress its sprite entry. The counter the caller
 * carries is read without the top bit that selected this path; once what is left has reached three
 * the counter cell in the object's record is put back to zero, and below three it is left alone.
 * Either way both attribute slots of the sprite entry take the one code fixed here, and the two
 * shape codes are then chosen by the flutter this hands on to.
 * LIVE-OUT: memory — the counter cell, the two attributes, and the pair of shapes.
 *
 * ROM 0x44C9-0x44DB, falling through into 0x44DC (frozen lift translated/loc_44c9.js).
 * Grounding: [seen] (names.js ROUTINES 0x44c9). The name deliberately says only what this body
 * does: what the object ends up looking like is settled one routine further on, and the counter
 * it may clear lives in a record whose owner it never reads (names.js).
 *
 * Parameters: `counter` is the value the caller carries in C, whose top bit chose this path;
 * `record` is the object's record (IX); `sprite` is its sprite entry (IY).
 */

import { u16 } from "../../../core/int.js";
import { dressSpriteFlutterShapesByFrameTickBit } from "./dressSpriteFlutterShapesByFrameTickBit.js";

// Constants off the ROM: `and 0x7f` drops the selector bit, `cp 0x03` is the restart threshold,
// `ld (ix+0x06),0x00` names the record's counter cell, and `ld (iy+0x30),0x51` /
// `ld (iy+0x32),0x51` are the two attribute slots and the code they receive.
const SELECTOR_BIT = 0x80;
const RESTART_AT = 3;
const COUNTER_SLOT = 6;
const ATTRIBUTE_SLOTS = [0x30, 0x32];
const ATTRIBUTE = 0x51;

export function restartAnimationCounterThenDressFlutterSprite(m, counter = m.regs.c, record = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;
  /* Restart the counter. With the selector bit masked off, a remaining value of three or more
   * (`jr c` NOT taken) clears the record's counter cell at +6; below three it is left as is. */
  if ((counter & ~SELECTOR_BIT) >= RESTART_AT) mem8[u16(record + COUNTER_SLOT)] = 0;
  /* Dress the attributes unconditionally, on either branch: the slots at +0x30 and +0x32 of the
   * sprite pointer both take the fixed code 0x51. */
  for (const slot of ATTRIBUTE_SLOTS) mem8[u16(sprite + slot)] = ATTRIBUTE;
  /* The ROM runs straight on into 0x44DC, dressSpriteFlutterShapesByFrameTickBit [seen], which
   * picks the two shapes of a two-frame flutter from one bit of a counter cell. */
  return dressSpriteFlutterShapesByFrameTickBit(m, sprite);
}
