// SPDX-License-Identifier: GPL-3.0-only
import { loc_9a9d, loc_9aa9, loc_9ab3, loc_9ab7 } from "./loc_9a9d.js";
import { loc_9abb } from "./loc_9abb.js";

// Computed jump: the incoming value selects one of five list-setup entries and runs it.
const TABLE = [loc_9a9d, loc_9aa9, loc_9abb, loc_9ab7, loc_9ab3];
export function loc_9a88(m, a = m.regs.a) {
  return TABLE[a](m);
}
