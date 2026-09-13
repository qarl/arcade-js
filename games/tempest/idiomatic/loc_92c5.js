// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_9f, loc_2b, loc_2c, loc_2d, loc_37, loc_38, loc_3b, loc_3c,
  loc_a7, loc_b3, loc_15e, loc_15b, loc_16a, loc_16d, loc_11a, loc_118, loc_120,
  loc_149, loc_14a, loc_151, loc_152, loc_153, loc_154, loc_155, loc_160, loc_161,
  loc_162, loc_163, loc_164, loc_165, loc_166, loc_167, loc_168, loc_169,
  loc_60da, loc_9604,
} from "./names.js";
import { loc_9677 } from "./loc_9677.js";
import { loc_9683 } from "./loc_9683.js";
import { loc_93e0 } from "./loc_93e0.js";

// State re-seed. Builds the search key loc_2b (loc_9f, or a fresh masked value when loc_9f is too large),
// then walks a 4-byte-record table for record index 111 down to 3 (step -4): each record
// gives a source list pointer (loc_2c/loc_2d) and a destination pointer (loc_3b/loc_3c). For each record it
// scans the source list for the range that brackets the key, storing the range's resolved byte (0 if the
// list runs out) through the destination pointer. Finally it rescales loc_160/loc_15b per loc_16a & 3 and
// re-scales three cells (loc_163, loc_120, loc_160) through the folding helper, seeding many loc_01xx cells.
export function loc_92c5(m) {
  const { mem8, mem16 } = m;

  // search key: loc_9f, unless >= 98 -> a fresh value from (the POKEY random register & 0x1f) | 0x40; then +1
  let key = mem8[loc_9f];
  if (key >= 98) key = (mem8[loc_60da] & 0x1f) | 0x40;
  mem8[loc_2b] = key;
  mem8[loc_2b] = mem8[loc_2b] + 1;

  // record index 111 -> 3, step -4 (stop when it underflows past 3 to 255)
  mem8[loc_37] = 111;
  while (true) {
    const index = mem8[loc_37];
    mem8[loc_3c] = mem8[u16(loc_9604 + index + 3)];
    mem8[loc_3b] = mem8[u16(loc_9604 + index + 2)];
    mem8[loc_2d] = mem8[u16(loc_9604 + index + 1)];
    mem8[loc_2c] = mem8[u16(loc_9604 + index)];
    mem8[loc_38] = 1;

    // scan the source list for the [lo, hi] range that brackets the search key
    let resolved = 0;
    let y = 0;
    while (true) {
      const listPtr = mem16[loc_2c];
      const entry = mem8[u16(listPtr + y)];
      mem8[loc_15e] = entry;
      if (entry === 0) { resolved = 0; break; } // list exhausted
      const k = mem8[loc_2b];
      y = u8(y + 1);
      const lo = mem8[u16(listPtr + y)];
      y = u8(y + 1);
      let advance = k < lo;
      if (!advance) {
        const hi = mem8[u16(listPtr + y)];
        advance = k > hi;
        if (!advance) {                     // lo <= key <= hi -> range hit
          y = u8(y + 1);
          m.regs.y = y;                     // cursor rides Y into the hit resolver
          const r = loc_9677(m);            // yields the byte to store (first element if it also returns an index)
          resolved = Array.isArray(r) ? r[0] : r;
          break;
        }
      }
      m.regs.y = y;                         // cursor rides Y into the step helper, which advances it
      loc_9683(m);
      y = m.regs.y;                         // continue from the advanced cursor (not a reset)
    }

    mem8[u16(mem16[loc_3b])] = resolved;    // store through the destination pointer

    mem8[loc_37] = u8(index - 4);
    if (mem8[loc_37] === 255) break;
  }

  // rescale on loc_16a & 3: 1 -> down, 2 -> up, else none
  const mode = mem8[loc_16a] & 0x03;
  if (mode === 1) {
    mem8[loc_11a] = u8(mem8[loc_11a] - 1);
    const v = mem8[loc_160];
    const inv = v ^ 0xff;
    mem8[loc_160] = (inv >> 3) + v + ((inv >> 2) & 1);
    if (mem8[loc_9f] < 17) mem8[loc_b3] = u8(mem8[loc_b3] - 1);
  } else if (mode === 2) {
    const bumped = u8(mem8[loc_11a] + 1);
    mem8[loc_11a] = bumped >= 3 ? 3 : bumped;
    const v = mem8[loc_160];
    mem8[loc_160] = ((v >> 3) | 0xe0) + v + ((v >> 2) & 1);
    const w = mem8[loc_15b];
    mem8[loc_15b] = (w >> 3) + w + ((w >> 2) & 1);
    mem8[loc_16d] = mem8[loc_16d] | 0x40;
  }

  // fold three cells through the helper (returns [A, X, Y]) and fan the results out
  const [a163, x163, y163] = loc_93e0(m, mem8[loc_163]);
  mem8[loc_163] = a163;
  mem8[loc_168] = y163;
  mem8[loc_154] = x163;

  const [a120, x120, y120] = loc_93e0(m, mem8[loc_120]);
  mem8[loc_120] = a120;
  mem8[loc_118] = y120;
  mem8[loc_a7] = x120;

  const [a160, x160, y160] = loc_93e0(m, mem8[loc_160]);
  mem8[loc_160] = a160;
  mem8[loc_162] = a160;
  mem8[loc_167] = y160;
  mem8[loc_165] = y160;
  mem8[loc_151] = x160;
  mem8[loc_153] = x160;
  mem8[loc_152] = x160;

  mem8[loc_164] = mem8[loc_160] << 1;               // shift left, carry out is bit 7
  mem8[loc_169] = (mem8[loc_165] << 1) | (mem8[loc_160] >> 7);

  mem8[loc_155] = 6;
  mem8[loc_161] = 160;
  mem8[loc_166] = 254;
  mem8[loc_14a] = 1;
  mem8[loc_149] = 1;
}
