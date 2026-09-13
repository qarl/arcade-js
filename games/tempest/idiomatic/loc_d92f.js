// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { loc_0 } from "./names.js";
import { loc_d931 } from "./loc_d931.js";

// Folds one table byte (through the zero-page pointer at loc_0, indexed by the incoming cursor) into
// the running byte, then continues into the tone-burst count path with that result.
export function loc_d92f(m, a = m.regs.a, y = m.regs.y) {
  const { mem8, mem16 } = m;
  const folded = u8(a ^ mem8[u16(mem16[loc_0] + y)]);
  return loc_d931(m, folded);
}
