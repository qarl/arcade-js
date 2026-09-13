// SPDX-License-Identifier: GPL-3.0-only
import { loc_00 } from "./names.js";
import { loc_db5a } from "./loc_db5a.js";
import { loc_dbf7 } from "./loc_dbf7.js";
import { loc_db84 } from "./loc_db84.js";
import { loc_db9a } from "./loc_db9a.js";
import { loc_db7e } from "./loc_db7e.js";
import { loc_db6f } from "./loc_db6f.js";
import { loc_db22 } from "./loc_db22.js";

// Computed dispatch: loc_00 holds a byte offset (0,2,4,6,8,10,12) into a 2-byte-per-entry table.
// An offset >= 0x0e is clamped to offset 2 and the clamp persisted to loc_00. Selects the per-frame
// draw handler at offset>>1 and tail-returns its result to this routine's own caller.
const TABLE = [loc_db5a, loc_dbf7, loc_db84, loc_db9a, loc_db7e, loc_db6f, loc_db22];

export function loc_db0f(m) {
  const { mem8 } = m;
  let i = mem8[loc_00];
  if (i >= 0x0e) { i = 0x02; mem8[loc_00] = 0x02; }
  return TABLE[i >> 1](m);
}
