// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { loc_15e, loc_969d } from "./names.js";
import { loc_96c7, loc_96c8 } from "./loc_96c7.js";
import { loc_96cb } from "./loc_96cb.js";

// Computed-jump dispatch. loc_15e is an even byte index selecting a target from a fixed
// handler set; the chosen handler is tail-called and consumes this routine's own caller's
// return. Before dispatching, A is seated to the low byte of the selected pointer: the two
// Y-only handlers leave A untouched, so that byte is the value the caller reads back.
const TABLE = [null, loc_96c8, loc_96cb, loc_96cb, loc_96c7, loc_96c8, loc_96c7];

export function loc_9683(m) {
  const { mem8 } = m;
  const index = mem8[loc_15e];
  m.regs.a = mem8[u16(loc_969d + index)]; // low pointer byte; live-out on the Y-only handlers
  return TABLE[index >> 1](m);
}
