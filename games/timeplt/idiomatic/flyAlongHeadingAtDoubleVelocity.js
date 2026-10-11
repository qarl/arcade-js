// SPDX-License-Identifier: GPL-3.0-only
/** flyAlongHeadingAtDoubleVelocity — fly one object a DOUBLE step along the heading it holds, while the world scrolls
 * underneath it. The heading picks a pair of perpendicular components out of the speed table the
 * caller chose; each of the object's two coordinates then gains TWICE its own component plus the
 * per-frame displacement every object shares, which is added once rather than twice — so doubling
 * moves the object faster through the world without moving the world. Each coordinate is 16 bits
 * stored split, the whole part in the sprite entry and the fraction in the record, so a component
 * smaller than half a pixel still banks.
 *
 * ROM 0x58FE-0x5941 (frozen lift translated/loc_58fe.js). Grounding: [seen] (names.js ROUTINES 0x58fe).
 *
 * Role in the machine: the fast twin of flyAlongHeading. The two ROM bodies are byte-identical
 * except for two inserted `add hl,de` / `add hl,bc`, each placed right after a velocity term is
 * added and neither after the scroll load — which is why only the velocity doubles. Like its twin
 * it is entered only through two-instruction shims that fix a velocity table; names.js records it
 * dispatched in quantity on a run holding the era at 4, and zero times on two tapes held in eras 0-1.
 *
 * `table` is the velocity table (HL on the Z80), `object` the record (IX), `sprite` the entry (IY).
 *
 * LIVE-OUT: memory only — the four coordinate bytes. */

import { velocityForHeading } from "./velocityForHeading.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "./names.js";
import { addToCoordinate } from "./objectGeometry.js";

// Record +2 holds the heading. The two coordinates are split: the first is whole at sprite +0x31
// (the native-Y byte WORLD_SCROLL_Y lands in) with its fraction at record +3; the second is whole
// at sprite +0x00 (native X, WORLD_SCROLL_X's byte) with its fraction at record +5.
const CURRENT_HEADING = 2;
const FIRST_AXIS_WHOLE = 49;
const FIRST_AXIS_FRACTION = 3;
const SECOND_AXIS_WHOLE = 0;
const SECOND_AXIS_FRACTION = 5;

export function flyAlongHeadingAtDoubleVelocity(m, table = m.regs.hl, object = m.regs.ix, sprite = m.regs.iy) {
  // The heading's two perpendicular components at the speed this table sets.
  const [alongFirstAxis, alongSecondAxis] = velocityForHeading(m, table, m.mem8[object + CURRENT_HEADING]);

  // First coordinate: scroll once, component twice (the ROM loads the scroll word into HL, then
  // adds DE two times before adding the coordinate).
  addToCoordinate(
    m,
    sprite + FIRST_AXIS_WHOLE,
    object + FIRST_AXIS_FRACTION,
    m.mem16[WORLD_SCROLL_Y] + 2 * alongFirstAxis,
  );
  // Second coordinate: the same shape with the other scroll word and BC as the component.
  addToCoordinate(
    m,
    sprite + SECOND_AXIS_WHOLE,
    object + SECOND_AXIS_FRACTION,
    m.mem16[WORLD_SCROLL_X] + 2 * alongSecondAxis,
  );
}
