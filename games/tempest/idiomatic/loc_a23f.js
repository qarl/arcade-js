// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_5, loc_29, loc_4d, loc_106, loc_135,
  loc_200, loc_201, loc_202, loc_2ad, loc_2b5, loc_2c0, loc_2d3, loc_2db, loc_2f2,
} from "./names.js";
import { loc_ccea } from "./loc_ccea.js";
import { loc_a463 } from "./loc_a463.js";

// Try to spawn into a free slot. Bails when loc_201 is negative. Then forms a gate: when loc_5 is
// negative the gate is loc_4d & 0x10, otherwise it seeds loc_29 from loc_106 and adds one per slot of
// loc_2b5 (x = 10..0, gated by loc_2db nonzero) whose value sits within 1 of loc_200. A zero gate bails.
// Otherwise it scans loc_2d3 (x = 7..0) for the first free (zero) slot, seeds that slot across loc_2d3/
// loc_2ad/loc_2c0/loc_2f2, bumps the live count loc_135, and fires the two spawn helpers.
export function loc_a23f(m) {
  const { mem8 } = m;

  if (mem8[loc_201] & 0x80) return;

  let gate;
  if (mem8[loc_5] & 0x80) {
    gate = mem8[loc_4d] & 0x10;
  } else {
    mem8[loc_29] = mem8[loc_106];
    for (let x = 10; x >= 0; x--) {
      if (mem8[u16(loc_2db + x)] === 0) continue;
      let delta = u8(mem8[u16(loc_2b5 + x)] - mem8[loc_200]);
      if (delta & 0x80) delta = u8((delta ^ 0xff) + 1); // abs of the signed difference
      if (delta < 2) mem8[loc_29] = u8(mem8[loc_29] + 1);
    }
    gate = mem8[loc_29];
  }

  if (gate === 0) return;

  for (let x = 7; x >= 0; x--) {
    if (mem8[u16(loc_2d3 + x)] !== 0) continue;
    mem8[loc_135] = u8(mem8[loc_135] + 1);
    mem8[u16(loc_2d3 + x)] = mem8[loc_202];
    mem8[u16(loc_2ad + x)] = mem8[loc_200];
    mem8[u16(loc_2c0 + x)] = mem8[loc_201];
    mem8[u16(loc_2f2 + x)] = 0;
    // The spawn/sound chain reads m.regs.x (stamping it into loc_31/loc_32); the slot index rides
    // the live X across the call, so seat regs.x from our local before delegating.
    m.regs.x = x;
    loc_ccea(m);
    loc_a463(m, mem8[loc_202], x);
    break; // only the first free slot is filled
  }
}
