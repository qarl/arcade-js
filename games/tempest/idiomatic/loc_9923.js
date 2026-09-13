// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { loc_29, loc_2a, loc_2f, loc_35, loc_203, loc_243, loc_3ab } from "./names.js";
import { loc_99a5 } from "./loc_99a5.js";
import { loc_994d } from "./loc_994d.js";

// Slot-timer expiry handler for slot X. Raises a spawn request (loc_29 = 0xf0), latches loc_203,x into
// loc_2a, saves X in loc_35, and runs the placement pass. If the request survived and the survival check
// allocates a free slot, it drops loc_3ab and clears the slot timer loc_243,x; otherwise it flags
// loc_2f = 0xff and re-arms the timer. X is preserved (via loc_35) and is the live-out register.
export function loc_9923(m, x = m.regs.x) {
  const { mem8 } = m;

  mem8[loc_29] = 0xf0;
  mem8[loc_2a] = mem8[u16(loc_203 + x)];
  mem8[loc_35] = x;

  loc_99a5(m);

  // the placement pass may relocate the saved slot index; reload it before touching the slot's timer.
  x = mem8[loc_35];

  // the survival check takes the free-slot scan index in Y (its own default); pass X explicitly, which it preserves.
  if (mem8[loc_29] !== 0 && loc_994d(m, undefined, x) !== 0) {
    mem8[loc_3ab] = mem8[loc_3ab] - 1;
    mem8[u16(loc_243 + x)] = 0x00;
    return (m.regs.x = x);
  }

  mem8[loc_2f] = 0xff;
  mem8[u16(loc_243 + x)] = mem8[u16(loc_243 + x)] + 1;
  return (m.regs.x = x);
}
