// SPDX-License-Identifier: GPL-3.0-only
/** refreshSecondEraSpriteFromHeading — show an object pointing the way it is heading, in this family's own shape bank and
 * tint. The heading lookup supplies a shape and the byte that goes beside it; each is then shifted
 * by a fixed bias before it is stored, so the pair on the screen is a fixed distance from the pair
 * the lookup chose and the shift is the whole of what this entry adds. LIVE-OUT: the two cells
 * written.
 *
 * ROM 0x2A47-0x2A56 (frozen lift translated/loc_2a47.js). Grounding: [seen] (names.js ROUTINES
 * 0x2a47). Role in the machine: the heading-dressing step for the enemy craft of the SECOND era
 * (era index 1). The era dispatcher picks its arm by era index alone, and under MAME this entry
 * ran only at era 1, while a game held in the first era used refreshSpriteFromHeading (0x2A3C)
 * instead. It dresses the ordinary craft records 0xA850-0xA8B0 into sprite entries 0xAA1A-0xAA26
 * (names.js); the last two, 0xA8A0 and 0xA8B0, only while MOTHER_SHIP_ARMED (0xAD0D) is clear.
 *
 * `object` is the craft's record (IX), whose heading the lookup reads; `sprite` is its sprite
 * entry (IY).
 */

import { u8 } from "../../../core/int.js";
import { spriteForHeading } from "./spriteForHeading.js";

// Sprite-entry slots: +0x01 holds the shape (tile code) and +0x30 the attribute byte (flip bits
// plus colour), the same two slots refreshSpriteFromHeading writes. The biases are the ROM's
// `add a,0x10` on the shape and `add a,0x35` on the attribute.
const SHAPE = 1;
const ATTRIBUTE = 0x30;
const SHAPE_BIAS = 16;
const ATTRIBUTE_BIAS = 53;

export function refreshSecondEraSpriteFromHeading(m, object = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;
  /* Look up the heading's pair: `call 0x2a57`, spriteForHeading [seen], returns the shape and
   * the attribute byte that mirrors it, so a handful of shapes covers the whole circle. */
  const [shape, mirror] = spriteForHeading(m, object);
  /* Recolour: the attribute goes in shifted by 53. Every attribute the lookup returns carries
   * the same low colour field, so the add moves the colour and leaves the two flip bits — the
   * facing — alone; this era's craft wear their own colour (names.js). */
  mem8[sprite + ATTRIBUTE] = mirror + ATTRIBUTE_BIAS;
  /* Reshape: the shape goes in shifted by 16, into this era's own block of the sprite ROM. */
  const shifted = u8(shape + SHAPE_BIAS);
  mem8[sprite + SHAPE] = shifted;

}
