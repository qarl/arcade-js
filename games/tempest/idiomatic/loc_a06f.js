// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import {
  loc_29, loc_35, loc_2a, loc_2b, loc_2d, loc_108, loc_109, loc_10a, loc_10b,
  loc_111, loc_202, loc_283, loc_28a, loc_2b9, loc_2df, loc_142,
} from "./names.js";
import { loc_9b07 } from "./loc_9b07.js";
import { loc_994d } from "./loc_994d.js";

// Retire the enemy in slot Y: clear its active-table entry loc_2df,y and adjust an active-count
// cell -- when the slot value matches loc_202 and the slot's lane (loc_283,y & 7) is not 4 the
// per-type counter loc_109 drops, otherwise the total loc_108 drops -- then drop the per-lane
// counter loc_142 at that lane (X is parked in loc_35 and restored, so exit X == entry X). When
// (loc_28a,y & 3) is set, seat the draw cells loc_2b/loc_2a and spawn a replacement via the
// list-setup and draw handlers, and if that spawn took, spawn a second mirrored one.
export function loc_a06f(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;

  const slotVal = mem8[u16(loc_2df + y)];
  mem8[loc_29] = slotVal;
  let decTotal = true;
  if (slotVal === mem8[loc_202] && (mem8[u16(loc_283 + y)] & 0x07) !== 0x04) {
    mem8[loc_109] = mem8[loc_109] - 1;
    decTotal = false;
  }
  if (decTotal) mem8[loc_108] = mem8[loc_108] - 1;

  mem8[u16(loc_2df + y)] = 0x00;

  const lane = mem8[u16(loc_283 + y)] & 0x07;
  mem8[loc_35] = x; // park caller X; it is reloaded below, so exit X == entry X
  mem8[u16(loc_142 + lane)] = mem8[u16(loc_142 + lane)] - 1;

  const gate = mem8[u16(loc_28a + y)] & 0x03;
  if (gate === 0) return (m.regs.a = gate); // A live-out is the anded gate value (0)

  // Seat loc_2b from the gate: g-1, except g==3 wraps to 4.
  const g1 = gate - 1;
  mem8[loc_2b] = g1 === 0x02 ? 0x04 : g1;

  // Seat loc_2a from (loc_2b9,y - 1) & 0x0f, snapping 0x0f to 0 when loc_111 bit7 is set.
  let seat = (mem8[u16(loc_2b9 + y)] - 1) & 0x0f;
  if (seat === 0x0f && mem8[loc_111] & 0x80) seat = 0x00;
  mem8[loc_2a] = seat;

  // First draw: build the coordinate list, seed the lane counters, spawn.
  loc_9b07(m, y);
  mem8[loc_10b] = mem8[loc_2d];
  mem8[loc_10b] = mem8[loc_10b] - 1;
  mem8[loc_10a] = 0x00;
  const spawned = loc_994d(m, y);
  if (spawned === 0x00) return (m.regs.a = spawned); // no free slot -> done (A live-out is 0)

  // Second draw: advance loc_2a by 2 (snap 0x0f -> 0x0e on loc_111 bit7), set loc_2b bit6, spawn.
  let seat2 = (mem8[loc_2a] + 0x02) & 0x0f;
  if (seat2 === 0x0f && mem8[loc_111] & 0x80) seat2 = 0x0e;
  mem8[loc_2a] = seat2;
  mem8[loc_2b] = mem8[loc_2b] | 0x40;
  return loc_994d(m, y); // the final draw sets the A live-out
}
