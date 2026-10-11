// SPDX-License-Identifier: GPL-3.0-only
/** mirrorTwoTileObjectByHeading — dress a two-entry object: give each of its two sprite entries one
 * of a consecutive pair of shape codes, and both of them the same attribute byte. Which entry takes
 * the lower code turns over with the object's heading, at the half-turn boundary, and the attribute
 * changes by exactly one bit at the same boundary — so the pair swaps ends together and still reads
 * as one object rather than two. The base of the pair steps in fours by how many hits the object
 * has left, counted from the most it can take, so it wears its damage; and one bit of the
 * free-running frame counter alternates it, so it switches between two shapes every two frames.
 * LIVE-OUT: memory only — four bytes.
 *
 * ROM 0x3CE9-0x3D24 (frozen lift translated/loc_3ce9.js). Grounding: [seen] (names.js ROUTINES 0x3ce9).
 *
 * Role in the machine: the "dressing" step for the big two-sprite object whose hit counter is
 * BOMBER_HITS_TO_ABSORB 0xA8DC [seen] -- names.js ties that counter to the second era's bomber, which is armed
 * with 3 and so absorbs three hits and dies on the fourth. A sprite entry only says where the object is;
 * dressing writes its shape code (+1) and its attribute -- colour and flip bits -- (+0x30), which
 * publishSpriteShadow later copies to the hardware (mechanisms.md, "Dressing a sprite for heading and
 * frame"). Its caller is advanceTwoTileObjectThenTryAimedSpawn.
 *
 * Why it is a MIRROR and not two poses: the two attribute values, 0x6D and 0xED, are the same colour
 * differing only in the flip-Y bit, and the swap falls at two opposite headings, 0x40 and 0xC0. Under
 * MAME each arm took 172 of 344 dispatches (names.js "why"). Unlike the finer heading dressers, the
 * heading is resolved here to one bit: which half of the circle.
 *
 * Parameters: object — the object's record (the ROM hands it in IX; its +2 byte is the heading);
 * entry — the first of its two sprite entries (in IY). The second entry's bytes sit two above the
 * first's: shapes at +1 and +3, attributes at +0x30 and +0x32.
 */

import { u8 } from "../../../core/int.js";
import { FRAME_TICK, BOMBER_HITS_TO_ABSORB } from "./names.js";

// Shape selection: FRAME_TICK bit 1 (adds 0 or 2; bit 1 of a per-frame counter changes every two frames),
// the largest hit count an object is armed with, four shape codes per damage block, and the first
// shape code of the undamaged block.
const ALTERNATE_BIT = 0x02;
const MOST_HITS = 3;
const SHAPES_PER_DAMAGE_STEP = 4;
const FIRST_SHAPE = 0xa0;

// Byte offsets: the heading within the object's record, and the shape and attribute bytes of the two
// sprite entries.
const HEADING = 2;
const FIRST_ENTRY_SHAPE = 1;
const SECOND_ENTRY_SHAPE = 3;
const FIRST_ENTRY_ATTRIBUTE = 0x30;
const SECOND_ENTRY_ATTRIBUTE = 0x32;

// Heading geometry (256 steps to the circle) and the two attribute bytes -- one colour, flip-Y
// toggled between them.
const HALF_TURN = 0x80;
const QUARTER_TURN = 0x40;
const ATTRIBUTE_FORWARD = 0xed;
const ATTRIBUTE_REVERSED = 0x6d;

export function mirrorTwoTileObjectByHeading(m, object = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;

  // Step 1 -- choose the shape pair. The ROM computes (3 - hits) * 4 + 0xA0 + (FRAME_TICK & 2) in
  // eight bits: a fresh object (3 hits left) draws from block 0xA0, each hit absorbed moves one
  // block of four further on, and FRAME_TICK [seen] bit 1 flips between the first and second pair of
  // the block so the sprite animates.
  const alternate = mem8[FRAME_TICK] & ALTERNATE_BIT;
  const damage = u8(MOST_HITS - mem8[BOMBER_HITS_TO_ABSORB]);
  const shape = u8(FIRST_SHAPE + SHAPES_PER_DAMAGE_STEP * damage + alternate);

  // Step 2 -- which half of the compass is the object heading in? The ROM's `add a,0x40 / cp 0x80`:
  // biasing by a quarter turn puts headings 0xC0..0xFF and 0x00..0x3F below a half turn. That half
  // is the "reversed" arm (the ROM's `jr c` path): the lower code goes into the SECOND entry and the
  // attribute is 0x6D; the other half puts the lower code first and uses 0xED.
  const reversed = u8(mem8[object + HEADING] + QUARTER_TURN) < HALF_TURN;
  const lower = reversed ? SECOND_ENTRY_SHAPE : FIRST_ENTRY_SHAPE;
  const upper = reversed ? FIRST_ENTRY_SHAPE : SECOND_ENTRY_SHAPE;
  const attribute = reversed ? ATTRIBUTE_REVERSED : ATTRIBUTE_FORWARD;

  // Step 3 -- write the four bytes: the consecutive shape codes into the two entries in the order
  // chosen above, and the same attribute into both, so the two halves flip together.
  mem8[entry + lower] = shape;
  mem8[entry + upper] = shape + 1;
  mem8[entry + FIRST_ENTRY_ATTRIBUTE] = attribute;
  mem8[entry + SECOND_ENTRY_ATTRIBUTE] = attribute;
}
