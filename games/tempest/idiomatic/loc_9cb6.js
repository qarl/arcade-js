// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import {
  loc_148, loc_157, loc_200, loc_201, loc_28a, loc_2b9, loc_2cc, loc_2df, loc_3ab,
} from "./names.js";
import { loc_9c63, loc_9c99 } from "./loc_9c58.js";
import { loc_a347 } from "./loc_a343.js";

// Per-slot(x) steering step, keyed on loc_28a,x bit7.
//  - bit7 set: SUB-step; probe = loc_3ab!=0 ? the step's new hi : 0xff; if probe >= loc_157 flip bit7
//    of loc_28a,x. Y into the tail = loc_3ab.
//  - bit7 clear: ADD-step with y = (loc_2df,x >= loc_157 ? 0 : 1); Y into the tail = whatever the add
//    step LEFT (its deep arms overwrite the index, shallow arms keep it), read back from the register.
//  - common tail: with loc_148 bit7 clear AND loc_2df,x < loc_157 AND loc_200 == loc_2b9,x AND
//    loc_201 == loc_2cc,x, seed a fresh object with X = the slot and that Y (which the seed stores).
// X passes through; A on each tail exit is the last compare operand (incidental on the seed arm).
export function loc_9cb6(m, x = m.regs.x) {
  const { mem8 } = m;
  let y;
  if (mem8[u16(loc_28a + x)] & 0x80) {
    const stepped = loc_9c99(m, x, 1);
    y = mem8[loc_3ab]; // ldy loc_3ab -- persists as Y into the tail; Z of it picks the probe
    const probe = y !== 0 ? stepped : 0xff;
    if (probe >= mem8[loc_157]) mem8[u16(loc_28a + x)] ^= 0x80; // reached threshold -> flip direction
  } else {
    y = mem8[u16(loc_2df + x)] >= mem8[loc_157] ? 0 : 1;
    m.regs.y = y;      // enter the add step with the steering index in Y
    loc_9c63(m, x, y);
    y = m.regs.y;      // the tail's seed reads whatever the add step left in Y (no reload)
  }
  // common tail
  const c148 = mem8[loc_148];
  if (c148 & 0x80) return (m.regs.a = c148);
  const coord = mem8[u16(loc_2df + x)];
  if (coord >= mem8[loc_157]) return (m.regs.a = coord);
  const v200 = mem8[loc_200];
  if (v200 !== mem8[u16(loc_2b9 + x)]) return (m.regs.a = v200);
  const v201 = mem8[loc_201];
  if (v201 !== mem8[u16(loc_2cc + x)]) return (m.regs.a = v201);
  return loc_a347(m, x, y); // all four match -> seed the object (A left as the callee's leftover)
}
