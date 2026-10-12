// SPDX-License-Identifier: GPL-3.0-only
/**
 * hasReachedBoundaryBandSelectedByHeading — answer whether an object has arrived at a boundary, choosing
 * WHICH boundary from the heading in its record.
 *
 * WHAT IT IS: ROM 0x3CC4-0x3CD8, tag [seen] (names.js ROUTINES 0x3cc4). The heading picks which of two
 * adjacent and disjoint three-wide bands is tested on the sprite entry's byte at +0x31. When that band
 * test misses, a second, four-wide window test on the same sprite entry's head byte
 * (hasReachedNativeXEdgeWindow) decides -- so the answer is the OR of the two tests.
 *
 * ROLE IN THE MACHINE: it has two callers, and both use it as a retire test. flyBomberThenTryAimedShot
 * (0x3B88) uses it for its two-tile object: on a yes the object is retired, otherwise it is dressed and
 * the bomber's aimed-shot attempt runs (names.js 0x3b77). dressSpriteForHeadingOrRetireAtEdge (0x4447) uses it
 * the same way for the Mother-Ship: on a yes the ship is retired, otherwise it is dressed.
 *
 * No memory is written. LIVE-OUT: the answer, returned (the ROM's carry).
 */

import { u8, u16 } from "../../../core/int.js";
import { hasDriftedOffTheField } from "./hasDriftedOffTheField.js";
import { hasReachedNativeXEdgeWindow } from "./hasReachedNativeXEdgeWindow.js";

/* The object's heading, a byte of a 256-step circle, at +0x02 of its record (`ld a,(ix+0x02)`). */
const HEADING_IN_RECORD = 2;
/* The sprite entry's coordinate byte this arm tests, at +0x31 (`ld a,(iy+0x31)`). */
const COORDINATE = 0x31;
/* The band is three values wide (`cp 0x03`). */
const BAND = 3;
/* The bias that moves the band's first value, 0xED, onto zero (`add a,0x13`). */
const STARTS_BELOW_WRAP = 19;
/* A quarter of the heading circle (`add a,0x40`). */
const QUARTER_TURN = 64;
/* Bit 7 of the turned heading marks its upper half (`bit 7,a`). */
const HALF_A_TURN = 128;

/* `object` is the record (the ROM's IX), `spriteEntry` its sprite entry (the ROM's IY). */
export function hasReachedBoundaryBandSelectedByHeading(m, object = m.regs.ix, spriteEntry = m.regs.iy) {
  const { mem8 } = m;
  /*
   * Split the compass in half: add a quarter turn to the heading and look at bit 7. Headings 0x40-0xBF
   * set it, the other half of the circle does not. The set half hands the whole question to
   * hasDriftedOffTheField (the ROM's tail `jp nz,0x3cd9`), which tests ITS band on the same +0x31 byte
   * (values 0xF0-0xF2, bias 16) and, failing that, the four-wide head-byte window.
   */
  const turned = u8(mem8[u16(object + HEADING_IN_RECORD)] + QUARTER_TURN);
  if (turned >= HALF_A_TURN) return hasDriftedOffTheField(m, spriteEntry);

  /*
   * The other half tests the band directly below that one: the +0x31 byte biased by 0x13 is under 3
   * exactly when the byte is 0xED, 0xEE or 0xEF. A hit answers yes at once (the ROM's `ret c`); a miss
   * passes the question to the four-wide window test on the head byte (the ROM's tail `jp 0x3ce1`).
   * So the side the object is coming from picks its own line.
   */
  const biased = u8(mem8[u16(spriteEntry + COORDINATE)] + STARTS_BELOW_WRAP);
  if (biased >= BAND) return hasReachedNativeXEdgeWindow(m, spriteEntry);
  return true;
}
