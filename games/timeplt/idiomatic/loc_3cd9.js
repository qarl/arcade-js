// SPDX-License-Identifier: GPL-3.0-only
/** loc_3cd9 — answer whether one of an object's two sprite-entry coordinates has arrived in a
 * three-wide band that sits a little short of the wrap, and when it has NOT, hand the question on
 * to the same test taken on the other coordinate. So the answer is an OR of two windows on two
 * axes, and only the first of them is decided here. Nothing is written.
 * LIVE-OUT: the answer, returned and mirrored into carry. */

import { u8, u16 } from "../../../core/int.js";
import { F_C } from "../../../core/cpu/z80.js";
import { loc_3ce1 } from "./loc_3ce1.js";

const COORDINATE = 0x31;
const BAND = 3;
const STARTS_BELOW_WRAP = 16;

export function loc_3cd9(m, spriteEntry = m.regs.iy) {
  const { mem8, regs } = m;
  const arrived = u8(mem8[u16(spriteEntry + COORDINATE)] + STARTS_BELOW_WRAP) < BAND;
  if (!arrived) return loc_3ce1(m, spriteEntry);
  regs.f |= F_C;
  return true;
}
