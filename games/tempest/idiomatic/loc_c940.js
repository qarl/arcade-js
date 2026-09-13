// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import {
  loc_00, loc_1, loc_2, loc_4, loc_5, loc_3d, loc_3f, loc_46, loc_9f, loc_117,
} from "./names.js";
import { loc_92b2 } from "./loc_92b2.js";
import { loc_ca48 } from "./loc_ca48.js";
import { loc_9025 } from "./loc_9025.js";
import { loc_cd95 } from "./loc_cd95.js";

// Level-setup: seed the sizing/timer cells, and when the level id loc_3f has changed
// since last seen (loc_3d) and loc_5 is negative, install the new-level timers and swap
// the paired tables. Then converge: run the flag setup, index loc_46 by loc_3d into loc_9f,
// run startup init, and tail-delegate to the readout reset.
export function loc_c940(m) {
  const { mem8 } = m;

  mem8[loc_1] = 0;
  mem8[loc_00] = 30;
  mem8[loc_2] = 30;

  const level = mem8[loc_3f];
  if (level !== mem8[loc_3d]) {
    mem8[loc_3d] = level;
    if (mem8[loc_5] & 0x80) {
      mem8[loc_1] = 14;
      mem8[loc_00] = 10;
      mem8[loc_4] = mem8[loc_117] !== 0 ? 40 : 80;
      loc_92b2(m);
    }
  }

  loc_ca48(m);
  mem8[loc_9f] = mem8[u8(loc_46 + mem8[loc_3d])];
  loc_9025(m);
  return loc_cd95(m);
}
