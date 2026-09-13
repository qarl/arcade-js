// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_160, loc_165, loc_202, loc_283, loc_28a, loc_29f, loc_2df,
} from "./names.js";
import { loc_9d06 } from "./loc_9d06.js";
import { loc_a06f } from "./loc_a06f.js";

// Step slot x's 16-bit tube coordinate (low loc_29f,x / high loc_2df,x) by the per-segment delta from
// the loc_160/loc_165 table, indexed by the slot's segment (loc_283,x & 7). Direction is the sign of
// loc_28a,x: bit7 clear -> add, bit7 set -> subtract. The selector seats the segment index in Y
// before delegating, so the paths read the delta at that index.
export function loc_9c58(m, x = m.regs.x) {
  const { mem8 } = m;
  const seg = mem8[u16(loc_283 + x)] & 0x07;
  if (mem8[u16(loc_28a + x)] & 0x80) return loc_9c99(m, x, (m.regs.y = seg));
  return loc_9c63(m, x, (m.regs.y = seg));
}

// ADD path: coordinate += delta (16-bit, with carry). Then on the new hi byte: reaching loc_202 (or
// below) steps the slot via the equal/over handler; otherwise a hi that stays under 0x20 with an armed
// (loc_28a,x & 3) gate retires/replaces the slot (called with the slot as both index args, so X and A
// come back as the slot index).
export function loc_9c63(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;
  const loSum = mem8[u16(loc_29f + x)] + mem8[u16(loc_160 + y)]; // clc: carry-in 0
  mem8[u16(loc_29f + x)] = loSum;
  const carry = loSum > 0xff ? 1 : 0;
  const hi = u8(mem8[u16(loc_2df + x)] + mem8[u16(loc_165 + y)] + carry);
  mem8[u16(loc_2df + x)] = hi;

  if (hi <= mem8[loc_202]) { loc_9d06(m, x); return; } // at/below the floor: step the slot (A/Y incidental)
  if (hi >= 0x20) return (m.regs.a = hi);              // above 0x20 -> done, A live-out is the new hi
  if ((mem8[u16(loc_28a + x)] & 0x03) === 0) return (m.regs.a = 0x00); // gate clear -> done, A = 0
  loc_a06f(m, x, x);
  return (m.regs.a = x); // retire done -> A and X come back as the slot index
}

// SUB path: coordinate -= delta (16-bit, with borrow). If the new hi underflows past 0xf0 (>= 0xf0
// after the subtract, the bcc NOT taken) floor it to 0xf2. A live-out is the new hi, or 0xf2 on the floor.
export function loc_9c99(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;
  const loDiff = mem8[u16(loc_29f + x)] - mem8[u16(loc_160 + y)]; // sec: borrow-in 0
  mem8[u16(loc_29f + x)] = loDiff;
  const borrow = loDiff < 0 ? 1 : 0;
  const hi = u8(mem8[u16(loc_2df + x)] - mem8[u16(loc_165 + y)] - borrow);
  mem8[u16(loc_2df + x)] = hi;

  if (hi < 0xf0) return (m.regs.a = hi); // bcc taken -> no floor
  mem8[u16(loc_2df + x)] = 0xf2;
  return (m.regs.a = 0xf2);
}
