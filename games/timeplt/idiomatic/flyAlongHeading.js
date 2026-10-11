// SPDX-License-Identifier: GPL-3.0-only
/** flyAlongHeading — fly one object a single step along the heading it holds, while the world scrolls
 * underneath it. That heading picks a pair of perpendicular components out of the speed
 * table the caller chose; each of the object's two coordinates then gains its own component PLUS
 * a displacement held in a fixed pair of cells, shared by every object rather than read
 * off this one. Each coordinate is 16 bits stored split: the whole part in the sprite entry, the
 * fraction in the record, so a component smaller than a pixel banks instead of vanishing.
 *
 * ROM 0x58BC-0x58FD (frozen lift translated/loc_58bc.js). Grounding: [seen] (names.js ROUTINES 0x58bc).
 *
 * Role in the machine: the common mover for objects that fly on a heading. Every entry into it is
 * a two-instruction shim that fixes one velocity table, so the table — and with it the speed — is
 * the only thing a caller chooses (names.js). The shared pair is the world scroll (WORLD_SCROLL_Y,
 * WORLD_SCROLL_X), the camera: because it is folded into the same add, no caller drifts the object
 * separately, and adding a drift beside this would apply the camera twice.
 *
 * `table` is the velocity table (HL on the Z80), `object` the record (IX), `sprite` the entry (IY).
 *
 * LIVE-OUT: memory only — the four coordinate bytes; nothing is clamped and nothing is returned. */

import { velocityForHeading } from "./velocityForHeading.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "./names.js";
import { addToCoordinate } from "./objectGeometry.js";

// Record +2: the heading the object flies on, one byte of a 256-step circle.
const CURRENT_HEADING = 2;

export function flyAlongHeading(m, table = m.regs.hl, object = m.regs.ix, sprite = m.regs.iy) {
  // The heading's sample and the sample a quarter turn back: the two perpendicular components of
  // the object's velocity at the speed this table sets (the ROM's first half is byte-identical to
  // velocityForHeading).
  const [alongFirstAxis, alongSecondAxis] = velocityForHeading(m, table, m.mem8[object + CURRENT_HEADING]);

  // First coordinate: whole at sprite +0x31, fraction at record +3, moved by the scroll that lands
  // on that byte (WORLD_SCROLL_Y) plus the first component. Second coordinate: whole at sprite
  // +0x00, fraction at record +5, moved by WORLD_SCROLL_X plus the second component.
  addToCoordinate(m, sprite + 49, object + 3, m.mem16[WORLD_SCROLL_Y] + alongFirstAxis);
  addToCoordinate(m, sprite, object + 5, m.mem16[WORLD_SCROLL_X] + alongSecondAxis);
}
