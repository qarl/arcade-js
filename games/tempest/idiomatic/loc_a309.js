// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { loc_2d, loc_37, loc_2b9, loc_2f2, loc_60da } from "./names.js";
import { loc_a3ca } from "./loc_a3ca.js";
import { loc_a06f } from "./loc_a06f.js";
import { loc_ca6c } from "./loc_ca6c.js";

// Spawn/award for enemy slot X on lane Y: mark slot X active (loc_2f2,x = 0xff), stash the
// (Y-4)-indexed geometry byte in loc_2d, clamp the POKEY random register's low three bits to under 3 (else 0),
// run the insert+retire chain with that clamp+2, then award via the score-award helper indexed by clamp+5.
// X is saved in loc_37 and left unchanged for the caller.
export function loc_a309(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;

  mem8[loc_37] = x;
  mem8[u16(loc_2f2 + x)] = 0xff;

  const laneIndex = u8(y - 4);
  mem8[loc_2d] = mem8[u16(loc_2b9 + laneIndex)];

  const masked = mem8[loc_60da] & 0x07;
  const clamp = masked < 3 ? masked : 0;

  loc_a3ca(m, clamp + 2, x, laneIndex);
  loc_a06f(m, laneIndex, x);
  loc_ca6c(m, clamp + 5);
}
