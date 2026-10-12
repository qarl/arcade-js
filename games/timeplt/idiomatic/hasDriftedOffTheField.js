// SPDX-License-Identifier: GPL-3.0-only
/** hasDriftedOffTheField — answer whether one of an object's two sprite-entry coordinates has arrived in a
 * three-wide band that sits a little short of the wrap, and when it has NOT, hand the question on
 * to the same test taken on the other coordinate. So the answer is an OR of two windows on two
 * axes, and only the first of them is decided here. Nothing is written.
 *
 * ROM 0x3CD9-0x3CE8 (frozen lift translated/loc_3cd9.js). Grounding: [seen] (names.js ROUTINES 0x3cd9).
 *
 * Role in the machine: one arm of the heading-keyed boundary test at 0x3CC4, whose `jp nz,0x3cd9` is
 * its only inbound transfer; the two callers of that test, 0x3B77 and 0x4447, free an object's slot on
 * a yes (names.js). The byte tested here is the entry's +0x31 (native-Y) coordinate; the other half
 * of the OR is hasReachedNativeXEdgeWindow on the entry's +0x00 (native-X) byte, reached as a
 * fall-through.
 * `spriteEntry` is the object's sprite entry (IY on the Z80).
 *
 * LIVE-OUT: the answer, returned. */

import { u8, u16 } from "../../../core/int.js";
import { hasReachedNativeXEdgeWindow } from "./hasReachedNativeXEdgeWindow.js";

// Entry +0x31, native Y, is the coordinate tested. Adding 16 and asking for a result below 3 accepts the
// values 0xF0, 0xF1 and 0xF2 — the band sixteen short of the wrap.
const COORDINATE = 0x31;
const BAND = 3;
const STARTS_BELOW_WRAP = 16;

export function hasDriftedOffTheField(m, spriteEntry = m.regs.iy) {
  const { mem8 } = m;
  // Bias with eight-bit wrap, as the ROM's `add a,0x10` then `cp 0x03`.
  const coordinate = u8(mem8[u16(spriteEntry + COORDINATE)] + STARTS_BELOW_WRAP);
  // Outside the band: the answer is the native-X test (the ROM falls into 0x3CE1).
  if (coordinate >= BAND) return hasReachedNativeXEdgeWindow(m, spriteEntry);
  // Inside the band: off the field (the ROM's `ret c`, carry set).
  return true;
}
