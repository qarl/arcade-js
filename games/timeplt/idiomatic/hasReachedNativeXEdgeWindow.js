// SPDX-License-Identifier: GPL-3.0-only
/** hasReachedNativeXEdgeWindow — answer whether the native-X byte at the head of the sprite entry a
 * caller points at has arrived at the wrap point. The test is a four-wide window that STRADDLES zero —
 * the two values just short of the wrap and the two from the wrap on — so it measures a wrapped
 * distance and not a range, which is what lets a byte stepping a few units at a time land inside it
 * instead of over it. Nothing is written. LIVE-OUT: the answer, returned (the ROM's carry, which its
 * readers take as the return: reached by the jp at 0x3CD6); memory untouched.
 *
 * ROM 0x3CE1-0x3CE8 (frozen lift translated/loc_3ce1.js): `ld a,(iy+0x00) / add a,0x02 / cp 0x04 / ret`.
 * Grounding: [seen] (names.js ROUTINES 0x3ce1).
 *
 * Role in the machine: one of the family of "has this object left the field?" tests that mechanisms.md
 * lists under "Retire lines and edge tests". Objects are tested by their SCREEN position (the whole
 * bytes of their sprite entry), never their world position, because the world has no edge. This one is
 * the second half of hasReachedBoundaryBandSelectedByHeading (0x3CC4) and hasDriftedOffTheField: when
 * their band test on the entry's +0x31 (native-Y) byte fails, they hand on to this window on the
 * entry's +0 (native-X) byte, so their carry is the OR of the two tests.
 *
 * Parameter: spriteEntry — the address of the sprite entry being tested; the ROM hands it in IY, and
 * only the entry's first byte (+0, native X) is read.
 */

import { u8 } from "../../../core/int.js";

// The window is four values wide and begins two short of the wrap: 254, 255, 0 and 1
// (mechanisms.md, "Retire lines and edge tests").
const WINDOW = 4;
const STARTS_BELOW_WRAP = 2;

export function hasReachedNativeXEdgeWindow(m, spriteEntry = m.regs.iy) {
  const { mem8 } = m;
  // Bias the byte by +2 in eight bits (the ROM's `add a,0x02`) so the four values 254..1 land on
  // 0..3, then one unsigned compare against 4 (`cp 0x04`) answers "inside the window". Because the
  // add wraps at 256, this is a wrapped distance from the wrap point, not a greater-than test.
  const arrived = u8(mem8[spriteEntry] + STARTS_BELOW_WRAP) < WINDOW;
  // The ROM's answer is the carry flag the `cp` leaves (set exactly when inside the window).
  return arrived;
}
