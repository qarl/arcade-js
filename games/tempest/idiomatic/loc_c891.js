// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import {
  loc_00, loc_1, loc_3, loc_5, loc_6, loc_9, loc_a, loc_c, loc_a2, loc_4e, loc_9f, loc_16c, loc_c00,
} from "./names.js";
import { loc_c81b } from "./loc_c81b.js";
import { loc_de1b } from "./loc_de1b.js";
import { loc_ccfa } from "./loc_ccfa.js";

// Per-frame dispatcher. A short setup decides the speed/mode cells (loc_00/loc_1/loc_a2) from the
// coin input, the mode flag loc_5, and the phase counters loc_a/loc_6, then a common tail advances
// the frame counter loc_3 and fires the periodic sub-steps. The slot index rides X and Y from one
// sub-step to the next (the setup step and the odd-frame step each leave a fresh pair) and into the
// sound-register call, so both are threaded as locals rather than through the register file.
export function loc_c891(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;

  let toC81b = false, toTail = false;
  if ((mem8[loc_c00] & 0x10) === 0) {           // coin input bit4 clear
    mem8[loc_00] = 0x22;
    toTail = true;
  } else if ((mem8[loc_5] & 0x40) !== 0) {      // mode flag bit6 set
    toTail = true;
  } else if ((mem8[loc_a] & 0x01) === 0) {      // even phase
    toC81b = true;
  } else {
    y = mem8[loc_6];
    if (y === 0) mem8[loc_a2] = 0x80;
    if ((mem8[loc_a2] & 0x80) === 0) {          // gate bit7 clear
      toC81b = true;
    } else if (y >= 2) {
      mem8[loc_00] = 0x14;
      mem8[loc_a2] = 0x00;
      toC81b = true;
    } else if (y !== 0) {                        // y === 1
      mem8[loc_1] = 0x16;
      mem8[loc_00] = 0x0a;
    }
  }

  if (!toTail) {
    if (toC81b && mem8[loc_6] !== 0) [x, y] = loc_c81b(m, x);
    if ((mem8[loc_9] & 0x03) === 0) mem8[loc_6] = 0x02;  // every fourth frame reseed
  }

  // Common tail.
  mem8[loc_3] = u8(mem8[loc_3] + 1);
  if ((mem8[loc_3] & 0x01) !== 0) [x, y] = loc_de1b(m, x, y);  // odd frames
  if (mem8[loc_c] !== 0) loc_ccfa(m, x, y);                    // live -> register the sound
  if (mem8[loc_16c] !== 0 && mem8[loc_9f] > 0x13) m.regs.sed();
  // Decimal mode is left set for the frozen sbc that runs after this dispatcher; it is not cleared here.
  if ((mem8[loc_4e] & 0x80) !== 0) mem8[loc_4e] = 0x00;
}
