// SPDX-License-Identifier: GPL-3.0-only
// Integrates and renders 7 moving-object records into the sprite shadow. Each 10-byte record holds two
// 5-byte sub-slots; a phase bit selects which sub-slot leads this frame (the other's sub-position is
// bumped +2). For the leading sub-slot, when active: advance its sub-position (deactivate on overflow),
// integrate the 16-bit position by twice the signed velocity, and deactivate when it leaves the vertical
// window. Deactivating zeros the active/sub-position/high bytes. The sprite's Y and code are then written
// from the sub-slot, mirrored by a direction flag, with a +/-1 code nudge on the first three records.
import { u16 } from "../../../core/int.js";
import { loc_425f, loc_4018, loc_4260, loc_4081 } from "./names.js";

// Sub-slot layout (5 bytes) addressed by `rec`.
const ACTIVE = 0; // bit0 = slot active
const SUBPOS = 1; // sub-position, the on-screen Y source
const POS_LO = 2; // integrated position, low byte
const POS_HI = 3; // integrated position, high byte
const VELOCITY = 4; // signed per-frame velocity
const SLOT_STRIDE = 5;

// Sprite-shadow entry layout addressed by `spr`.
const SPR_CODE = 0;
const SPR_Y = 2;
const SPR_STRIDE = 4;

const RECORD_COUNT = 7;

export function loc_0a74(m) {
  const { mem8 } = m;

  let rec = loc_4260;
  // Phase bit clear: bump the first sub-slot's sub-position and start on the second sub-slot.
  if ((mem8[loc_425f] & 0x01) === 0) {
    mem8[rec + SUBPOS] = mem8[rec + SUBPOS] + 2;
    rec = u16(rec + SLOT_STRIDE);
  }

  const mirrored = (mem8[loc_4018] & 0x01) === 0; // direction flag clear = mirror the sprite Y
  let spr = loc_4081;

  for (let n = RECORD_COUNT; n >= 1; n--) {
    let deactivate = false;

    if ((mem8[rec + ACTIVE] & 0x01) === 0) {
      deactivate = true; // inactive slot
    } else {
      const subPos = (mem8[rec + SUBPOS] + 2) & 0xff;
      mem8[rec + SUBPOS] = subPos;
      if (subPos + 4 > 0xff) {
        deactivate = true; // sub-position ran off the end
      } else {
        const vel = (mem8[rec + VELOCITY] << 24) >> 24; // sign-extend the velocity byte
        const pos = u16((mem8[rec + POS_LO] | (mem8[rec + POS_HI] << 8)) + vel * 2);
        mem8[rec + POS_LO] = pos;
        mem8[rec + POS_HI] = pos >> 8;
        if ((((pos >> 8) + 0x10) & 0xff) < 0x20) deactivate = true; // out of the vertical window
      }
    }

    if (deactivate) {
      mem8[rec + ACTIVE] = 0;
      mem8[rec + SUBPOS] = 0;
      mem8[rec + POS_HI] = 0;
    }

    // Emit sprite Y and code; the direction flag mirrors Y and flips the sign of the first-three nudge.
    let code;
    if (mirrored) {
      mem8[spr + SPR_Y] = (0xff ^ mem8[rec + SUBPOS]) - 1; // complement, minus one
      code = 0xff ^ mem8[rec + POS_HI];
      if (n >= 5) code = code + 1;
    } else {
      mem8[spr + SPR_Y] = mem8[rec + SUBPOS] - 4;
      code = 0xff ^ mem8[rec + POS_HI];
      if (n >= 5) code = code - 1;
    }
    mem8[spr + SPR_CODE] = code;

    // Step past the leading sub-slot, bump the trailing sub-slot, advance to the next record and sprite.
    rec = u16(rec + SLOT_STRIDE);
    mem8[rec + SUBPOS] = mem8[rec + SUBPOS] + 2;
    rec = u16(rec + SLOT_STRIDE);
    spr = u16(spr + SPR_STRIDE);
  }
}
