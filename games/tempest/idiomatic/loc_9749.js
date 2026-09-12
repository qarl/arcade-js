// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import { loc_5, loc_50, loc_51, loc_2a, loc_2b, loc_2c, loc_111, loc_200, loc_201 } from "./names.js";
import { loc_97c5 } from "./loc_97c5.js";
import { loc_ccb5 } from "./loc_ccb5.js";

// Advance the spinner/rotation state: skip while the angle flag is still negative. Take a raw
// delta either from the aim scan or by clamping the manual delta into its band, fold it into the
// packed-angle work cells, and when the level gate is live cap the offset and saturate it toward
// the stored sign on a sign flip. The offset's high nibble seeds the coarse angle; a changed
// coarse angle rings the sound cue; then the new coarse/fine/offset commit to the angle state.
export function loc_9749(m, y = m.regs.y) {
  const { mem8 } = m;
  if (mem8[loc_201] & 0x80) return;

  let a;
  if (mem8[loc_5] & 0x80) {
    a = mem8[loc_50];
    if ((a & 0x80) === 0) {
      if (a >= 0x1f) a = 0x1f;      // positive: cap
    } else if (a < 0xe1) {
      a = 0xe1;                     // negative: floor
    }
    mem8[loc_50] = 0x00;           // consume the raw reading
  } else {
    a = loc_97c5(m);
  }

  mem8[loc_2b] = a;
  let c = u8((a ^ 0xff) + mem8[loc_51] + 1); // $51 - a
  mem8[loc_2c] = c;

  if (mem8[loc_111] !== 0) {
    if (c >= 0xf0) { c = 0xef; mem8[loc_2c] = c; }
    if ((c ^ mem8[loc_2b]) & 0x80 && (c ^ mem8[loc_51]) & 0x80) {
      mem8[loc_2c] = mem8[loc_51] & 0x80 ? 0xef : 0x00;
    }
  }

  const hi = mem8[loc_2c] >> 4;
  mem8[loc_2a] = hi;
  mem8[loc_2b] = (hi + 1) & 0x0f;

  if (mem8[loc_2a] !== mem8[loc_200]) loc_ccb5(m, mem8[loc_111], y);

  mem8[loc_200] = mem8[loc_2a];
  mem8[loc_201] = mem8[loc_2b];
  mem8[loc_51] = mem8[loc_2c];
}
