// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_9f, loc_159, loc_164, loc_169, loc_202, loc_28a, loc_29f, loc_2df, loc_3ab,
} from "./names.js";
import { loc_9c99 } from "./loc_9c58.js";
import { loc_9f5f } from "./loc_9f5f.js";
import { loc_9f81, loc_9f8a } from "./loc_9f81.js";

// Per-slot(x) mover. loc_28a,x bit7 set -> RE-SEEK: re-seek the slot the SUB way (with Y = 0x04) then
// dispatch on its returned high byte (A < 0x80 -> fire step; else bit6 of loc_159 selects one of two seek
// steps). bit7 clear -> ADVANCE: the 16-bit coordinate (low loc_29f,x / high loc_2df,x) += the per-frame
// delta (low loc_164 / high loc_169, with carry); a new hi below the floor loc_202 is clamped to it. A
// carry then selects the terminal step: it is produced only when loc_3ab != 0 and either zp loc_9f >= 0x11
// or the new hi >= 0x20; the clamp arm always leaves it clear. carry set -> fire step; carry clear ->
// loc_159 bit7 picks one of the two seek steps. loc_3ab == 0 returns early (A = new hi, Y = 0). Every
// non-early path tail-delegates, so its register state belongs to the chosen callee.
export function loc_9ef1(m, x = m.regs.x) {
  const { mem8 } = m;

  if (mem8[u16(loc_28a + x)] & 0x80) {
    // RE-SEEK: the sub-step returns the new high byte in A (Y is still 0x04 from entry).
    const a = loc_9c99(m, x, 0x04);
    if (a < 0x80) return loc_9f5f(m, x);
    if ((mem8[loc_159] & 0x40) === 0) return loc_9f8a(m, x);
    return loc_9f81(m, x);
  }

  // ADVANCE: 16-bit coordinate += per-frame delta.
  const loSum = mem8[u16(loc_29f + x)] + mem8[loc_164]; // clc: carry-in 0
  mem8[u16(loc_29f + x)] = loSum;
  const carryIn = loSum > 0xff ? 1 : 0;
  const hi = u8(mem8[u16(loc_2df + x)] + mem8[loc_169] + carryIn);
  mem8[u16(loc_2df + x)] = hi;

  const floor = mem8[loc_202];
  let fire; // the carry that selects the fire step
  if (hi >= floor) {
    // keep the new hi
    if (mem8[loc_3ab] === 0) { m.regs.y = 0x00; return (m.regs.a = hi); } // beq -> early rts
    fire = (mem8[loc_9f] >= 0x11) ? 1 : (hi >= 0x20 ? 1 : 0); // cpy #0x11 / cmp #0x20
  } else {
    mem8[u16(loc_2df + x)] = floor; // clamp the hi byte to the floor
    fire = 0;
  }

  if (fire) return loc_9f5f(m, x);              // carry set -> fire step
  if (mem8[loc_159] & 0x80) return loc_9f81(m, x); // loc_159 sign set -> seek step
  return loc_9f8a(m, x);                          // loc_159 sign clear -> the other seek step
}
