// SPDX-License-Identifier: GPL-3.0-only
/** loc_3e36 — run the same per-slot step over four slots in turn.
 *
 * ★ THE PARKED VALUE IS A DEBT, NOT A DESIGN. A slot whose record byte is not zero hands over,
 * through the step, to a tail that lifts one value off the stack before it finishes; a slot whose
 * record byte IS zero hands over to nothing and lifts nothing. So one value is parked for exactly
 * the slots that will take it, and the four parked values are the four resume points the same
 * hand-over would have carried. When that tail stops lifting, the park here goes with it.
 * LIVE-OUT: memory, plus the two cursors the fourth slot left. */

import { loc_3e63 } from "./loc_3e63.js";

const IDLE = 0;

const SLOTS = [
  [0xa810, 0xaa12, 0x3e41],
  [0xa820, 0xaa14, 0x3e4c],
  [0xa830, 0xaa16, 0x3e57],
  [0xa840, 0xaa18, 0x3e62],
];

export function loc_3e36(m) {
  for (const [record, entry, parked] of SLOTS) {
    m.regs.ix = record;
    m.regs.iy = entry;
    if (m.mem8[record] !== IDLE) m.push16(parked);
    loc_3e63(m);
  }
}
