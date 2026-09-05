// SPDX-License-Identifier: GPL-3.0-only
// Scan up to four two-byte slots for the first byte with bit 0 set, and store the resulting
// (slot index, base value) pair. The alt flag seeds slot 2 / base 157, else slot 1 / base 132.
import { loc_421b, ROW_OCCUPANCY, loc_4213 } from "./names.js";

const SLOT_COUNT = 4;

export function loc_15f4(m) {
  const { mem8 } = m;

  const alt = mem8[loc_421b] !== 0;
  let slot = alt ? 2 : 1;
  const base = alt ? 157 : 132;

  // Both bytes of a slot share its index; advance only when neither has bit 0 set.
  let p = ROW_OCCUPANCY;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (mem8[p] & 1 || mem8[p + 1] & 1) break;
    p += 2;
    slot++;
  }

  mem8[loc_4213] = slot;
  mem8[loc_4213 + 1] = base;
}
