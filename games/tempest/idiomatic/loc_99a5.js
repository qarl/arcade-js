// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_11c, loc_129, loc_12e, loc_13c, loc_13d, loc_13f, loc_140, loc_142,
  loc_28a, loc_2df, loc_29, loc_2a, loc_3ac, loc_60da, loc_61,
} from "./names.js";
import { loc_9a87 } from "./loc_9a87.js";

// Builds the five-column deficit table loc_13d[0..4] from loc_12e minus loc_142 (clamped nonnegative),
// deducts per active lane, and caps every column at (loc_11c + 1) minus the loc_142 total. Then, by how
// many columns remain nonzero, tries the list-setup dispatcher to place a list: on one column it scans loc_13d/loc_129;
// on two or more it scans a wider set including a loc_3ac-selected extra and a round-robin sweep. Any
// successful placement returns immediately; every exhausted path clears loc_29 before returning.
export function loc_99a5(m) {
  const { mem8 } = m;

  // Clear the deficit table, then seed each column with loc_12e - loc_142 where that is nonnegative.
  for (let x = 4; x >= 0; x--) mem8[loc_13d + x] = 0;
  for (let x = 4; x >= 0; x--) {
    const deficit = mem8[loc_12e + x] - mem8[loc_142 + x];
    if (deficit >= 0) mem8[loc_13d + x] = deficit;
  }

  // For each active lane (loc_2df set and loc_28a low two bits nonzero), deduct 2 from that column
  // (lane 3 remaps to column 5).
  for (let y = mem8[loc_11c]; y >= 0; y--) {
    if (mem8[u16(loc_2df + y)] === 0) continue;
    const lane = mem8[u16(loc_28a + y)] & 0x03;
    if (lane === 0) continue;
    const col = lane === 3 ? 5 : lane;
    mem8[loc_13c + col] = mem8[loc_13c + col] - 1;
    mem8[loc_13c + col] = mem8[loc_13c + col] - 1;
  }

  // Cap = (loc_11c + 1) - total of loc_142[0..4], wrapping as a byte; clamp every column down to it.
  let cap = u8(mem8[loc_11c] + 1);
  for (let x = 4; x >= 0; x--) cap = u8(cap - mem8[loc_142 + x]);
  for (let x = 4; x >= 0; x--) {
    if (cap < mem8[loc_13d + x]) mem8[loc_13d + x] = cap;
  }

  // Count the nonzero columns.
  let count = 0;
  for (let x = 4; x >= 0; x--) if (mem8[loc_13d + x] !== 0) count++;

  if (count === 1) {
    // One column active: place on the first column that has both a deficit and a loc_129 entry.
    for (let x = 4; x >= 0; x--) {
      if (mem8[loc_13d + x] === 0) continue;
      if (mem8[loc_129 + x] === 0) continue;
      if (loc_9a87(m, x) !== 0) return;
    }
  } else if (count >= 2) {
    mem8[loc_61] = count - 1;
    // Place on the first column whose loc_142 entry is below its loc_129 entry.
    for (let x = 4; x >= 0; x--) {
      if (mem8[loc_13d + x] === 0) continue;
      if (mem8[loc_142 + x] >= mem8[loc_129 + x]) continue;
      if (loc_9a87(m, x) !== 0) return;
    }
    // If columns 3 and 2 (loc_140/loc_13f) are both active, pick a column from the loc_3ac threshold.
    if (mem8[loc_140] !== 0 && mem8[loc_13f] !== 0) {
      let val = mem8[u16(loc_3ac + mem8[loc_2a])];
      if (val === 0) val = 0xff;
      const col = val >= 0xcc ? 3 : 2;
      if (loc_9a87(m, col) !== 0) return;
    }
    // Round-robin sweep of all five columns, starting just past the the POKEY random register low-two-bits index.
    let x = (mem8[loc_60da] & 0x03) + 1;
    for (let y = 4; y >= 0; y--) {
      if (mem8[loc_129 + x] !== 0 && mem8[loc_13d + x] !== 0) {
        if (loc_9a87(m, x) !== 0) return;
      }
      x = x - 1;
      if (x < 0) x = 4;
    }
  }

  // No placement (or no active column): clear the request flag.
  mem8[loc_29] = 0;
}
