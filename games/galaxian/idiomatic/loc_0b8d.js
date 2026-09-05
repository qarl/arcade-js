// SPDX-License-Identifier: GPL-3.0-only
// Per-entry collision test: if the entry is active and its box overlaps the player,
// deactivate the entry and raise the hit-event flag. Reads the player X reference and
// branches on a near/far Y band; `e` is the caller's small bounding delta.
import { loc_4202, HIT_EVENT_FLAG } from "./names.js";

// Field offsets within the object entry addressed by `obj`.
const ACTIVE_BIT = 1; // low bit of the first byte: set = live entry
const ENTRY_Y = 1;
const ENTRY_X = 3;

export function loc_0b8d(m, obj = m.regs.ix, e = m.regs.e) {
  const { mem8 } = m;

  // Inactive entries never hit.
  if ((mem8[obj] & ACTIVE_BIT) === 0) return;

  const playerX = mem8[loc_4202];
  const dxBase = (playerX - mem8[obj + ENTRY_X]) & 0xff;
  const yShifted = (mem8[obj + ENTRY_Y] + 31) & 0xff;

  let hit;
  if (yShifted < e) {
    // Far band: X within `e` of the player (plus a 2-unit bias).
    hit = ((dxBase + 2) & 0xff) < e;
  } else {
    // Near band: entry Y must sit within 9 units, then X within 11 (biased by `e`).
    if (((yShifted - e) & 0xff) >= 9) return;
    hit = ((dxBase + e) & 0xff) < 11;
  }
  if (!hit) return;

  mem8[obj] = 0; // deactivate the struck entry
  mem8[HIT_EVENT_FLAG] = 1;
}
