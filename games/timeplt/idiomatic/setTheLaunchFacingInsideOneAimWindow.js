// SPDX-License-Identifier: GPL-3.0-only
/** setTheLaunchFacingInsideOneAimWindow — the last gate before a launch: on one sprite-entry coordinate
 * the launcher must lie inside a window centred on the player's pinned native X 0x84, whose half-width is
 * ATTACKER_SPAWN_AIM_WINDOW_HALF (a setting, not baked in) -- outside it nothing launches; inside, the
 * other coordinate's side of the player's pinned native Y 0x78 is handed over as the facing bit.
 * LIVE-OUT: memory — inside the window, whatever the launcher writes; outside it, nothing. */
//
// ROM 0x429C-0x42B6, ending by transferring to 0x42B7 (commissionStagedAttackerByEra); lift:
// translated/loc_429c.js. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. A firing object launches by having a new object commissioned into a free slot
// the finder has staged; commissionStagedAttackerByEra (0x42B7) [seen] -- "the launcher" -- fits that
// new object out by era. Its one static entrant from outside is at 0x4296: when ERA_INDEX reads zero
// (the first era) the spawner comes HERE instead of going to 0x42B7 directly with the object's own
// heading, so in the first era the new object's facing is chosen by alignment and side rather than
// by heading. The launcher turns the 0/1 handed to it into a mirroring of the new object's sprite.
//
// The player's pinned coordinates 0x84 and 0x78 are immediates in the ROM (`ld a,0x84` at 0x42A2,
// `ld a,0x78` at 0x42AA). ATTACKER_SPAWN_AIM_WINDOW_HALF (0xA8E6) [seen] is one of the two aim-window
// half-widths that applyEraRungSettings scatters, so its width is a setting rather than a constant of
// this code.
//
// LIVE-OUT: memory only; outside the window nothing is written at all.

import { u8, u16 } from "../../../core/int.js";
import { commissionStagedAttackerByEra } from "./commissionStagedAttackerByEra.js";
import { ATTACKER_SPAWN_AIM_WINDOW_HALF } from "./names.js";

// The window's centre line on the entry's first coordinate (iy+0x00), and the facing line on its other
// coordinate (iy+0x31) -- the sprite entry's two coordinate bytes live 0x31 apart.
const WINDOW_CENTRE = 0x84;
const FACING_LINE = 0x78;

const ENTRY_OTHER_COORD = 0x31;

export function setTheLaunchFacingInsideOneAimWindow(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;
  // The window test, done in one unsigned byte compare as the ROM does it (`ld a,(0xa8e6) / ld d,a /
  // add a,a / ld c,a / ld a,0x84 / sub (iy+0x00) / add a,d / cp c / ret nc`): shift the distance from
  // the centre up by the half-width, and the object is inside exactly when that lands in 0..width-1.
  // Being byte arithmetic, a half-width of 0x00 or 0x80 doubles to zero and shuts the window entirely.
  const half = mem8[ATTACKER_SPAWN_AIM_WINDOW_HALF];
  const width = u8(half + half);
  const intoWindow = u8(WINDOW_CENTRE - mem8[entry] + half);
  if (intoWindow >= width) return; // outside the window nothing launches

  // Inside the window: which side of the facing line the other coordinate lies on. `sub (iy+0x31)` from
  // 0x78 borrows exactly when the coordinate is past the line, and the ROM then loads C with 1, else 0.
  const facing = mem8[u16(entry + ENTRY_OTHER_COORD)] > FACING_LINE ? 1 : 0;
  // Hand the facing to the launcher and continue straight into it.
  return commissionStagedAttackerByEra(m, record, entry, facing);
}
