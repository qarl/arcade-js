// SPDX-License-Identifier: GPL-3.0-only
// Initialise one descriptor slot from the number held at (HL): index = number-1 selects the 32-byte slot,
// then stamp its fixed init fields and clear the rest ([3] and [6] are left untouched).
import { DESCRIPTOR_SLOT_TABLE } from "./names.js";

const SLOT_SIZE = 32;

export function loc_0341(m, ptr = m.regs.hl) {
  const { mem8 } = m;

  const index = (mem8[ptr] - 1) & 0xff; // descriptor number minus one
  const base = DESCRIPTOR_SLOT_TABLE + index * SLOT_SIZE;

  mem8[base] = 1; // [0] active flag
  mem8[base + 1] = 0;
  mem8[base + 2] = 13;
  mem8[base + 4] = 0;
  mem8[base + 5] = 12;
  mem8[base + 7] = index; // [7] slot index
}
