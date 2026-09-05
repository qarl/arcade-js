// SPDX-License-Identifier: GPL-3.0-only
// Copy 32 bytes from a source into every other cell of a work-RAM table
// (destination stride 2), seeding one field of a 32-entry table.
import { loc_4021 } from "./names.js";

// The copy runs over 32 entries.
const ENTRIES = 32;

export function seedObjectRamShadowField(m, srcPtr = m.regs.hl) {
  const { mem8 } = m;

  // Walk the source one byte at a time into every other destination cell.
  for (let i = 0; i < ENTRIES; i++) {
    mem8[loc_4021 + i * 2] = mem8[srcPtr + i];
  }
}
