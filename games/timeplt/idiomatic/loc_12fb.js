// SPDX-License-Identifier: GPL-3.0-only
/** loc_12fb — restart the outer sequence from a standing start.
 *
 * The in-play flag, the inner step index and the active-player index are cleared, then the outer phase
 * is set from a byte of the program image rather than from an immediate. A fold over two more
 * program bytes then writes the inner index a SECOND time: an address is stepped by one byte,
 * the low half of where it landed is combined with the high half and a constant is taken off.
 * On an unaltered image that fold comes back to zero and the second write agrees with the first;
 * on an image whose bytes have moved it does not, and the sequence restarts at some other step.
 * LIVE-OUT: memory only. */

import { u8 } from "../../../core/int.js";
import { PLAY_ACTIVE, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, ACTIVE_PLAYER } from "./names.js";
import { offsetAddress } from "./offsetAddress.js";

const PHASE_SOURCE = 0x16d3;
const FOLD_STEP = 0x4901;
const FOLD_BASE = 0x4902;
const FOLD_BIAS = 155;

export function loc_12fb(m) {
  const { regs, mem8, mem16 } = m;
  mem8[PLAY_ACTIVE] = 0;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[ACTIVE_PLAYER] = 0;
  mem8[SEQUENCE_PHASE] = mem8[PHASE_SOURCE];

  regs.a = mem8[FOLD_STEP];
  regs.hl = mem16[FOLD_BASE];
  offsetAddress(m);
  mem8[SEQUENCE_SUBSTEP] = u8(regs.a ^ (regs.hl >> 8)) - FOLD_BIAS;
}
