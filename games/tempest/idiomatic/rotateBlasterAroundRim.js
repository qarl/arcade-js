// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import { STATUS_FLAGS, SPINNER_ACCUM, RIM_ROT_OFFSET, loc_2a, loc_2b, COORD_LIST_PTR_LO, TUBE_GEOM_FLAG, PLAYER_SEGMENT, PLAYER_FINE_ANGLE } from "./names.js";
import { aimSpinnerAtNearestEnemy } from "./aimSpinnerAtNearestEnemy.js";
import { cueRimRotationSound } from "./cueRimRotationSound.js";

/**
 * rotateBlasterAroundRim -- turn the frame's rotation input into the player Blaster's new rim position.
 * ROM 0x9749.
 *
 * Role in the machine: the player's ship rides the rim of the tube, and this routine advances its angle
 * once per frame. It takes a rotation delta -- either the manual spinner reading or, in attract/aim mode,
 * an auto-aim toward the nearest enemy -- subtracts it into a running rim offset, converts that offset into
 * a coarse lane (PLAYER_SEGMENT) plus a fine angle (PLAYER_FINE_ANGLE), and rings the movement sound cue
 * when the player crosses into a new lane.
 *
 * Behavior: bail out immediately while PLAYER_FINE_ANGLE ($201) bit7 is set (rotation still pending/locked).
 * Otherwise pick the delta: when STATUS_FLAGS ($5) bit7 is set (manual play) read SPINNER_ACCUM ($50) and
 * clamp it into the band [0xe1, 0x1f] -- positive values cap at 0x1f, negative floor at 0xe1 -- then zero
 * SPINNER_ACCUM to consume the reading; when bit7 is clear, take the auto-aim code from
 * aimSpinnerAtNearestEnemy instead. Stash the delta in work cell loc_2b ($2b), then compute the new offset
 * c = RIM_ROT_OFFSET ($51) - a (via the +1 two's-complement form) into COORD_LIST_PTR_LO ($2c). On a live
 * board (TUBE_GEOM_FLAG $111 != 0) cap c to 0xef and, when the new offset's sign disagrees with BOTH the
 * delta and the old offset (an over-rotation past an end), saturate it to the correct extreme (0xef or 0x00
 * by the old offset's sign). The offset's high nibble becomes the coarse angle loc_2a ($2a) and (hi+1)&0x0f
 * the fine angle loc_2b; a changed coarse angle vs PLAYER_SEGMENT ($200) rings cueRimRotationSound. Finally
 * commit coarse -> PLAYER_SEGMENT, fine -> PLAYER_FINE_ANGLE, and the offset -> RIM_ROT_OFFSET.
 *
 * Live-out: PLAYER_SEGMENT ($200) new lane, PLAYER_FINE_ANGLE ($201) new fine angle, RIM_ROT_OFFSET ($51)
 * carried offset; scratch loc_2a/loc_2b ($2a/$2b) and COORD_LIST_PTR_LO ($2c) left as working residue;
 * SPINNER_ACCUM ($50) consumed to 0 on the manual path. Returns the exit [X, Y] the ROM leaves. Y is the
 * auto-aim's segment delta when the aim found a target, else the incoming y untouched. X is TUBE_GEOM_FLAG,
 * which the ROM loads for the end-of-rim test, when the rotation ran, else the incoming x untouched. The rim
 * sound's loader stashes the incoming y in loc_32 on the manual path. On the aim path the cue is muted, and
 * the caller carries the returned Y on to the next pass.
 * Grounding: [seen].
 */
export function rotateBlasterAroundRim(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;
  if (mem8[PLAYER_FINE_ANGLE] & 0x80) return [x, y]; // rotation pending/locked -- do nothing this frame

  let a;
  if (mem8[STATUS_FLAGS] & 0x80) {
    a = mem8[SPINNER_ACCUM];                   // manual play: raw spinner delta
    if ((a & 0x80) === 0) {
      if (a >= 0x1f) a = 0x1f;      // positive: cap
    } else if (a < 0xe1) {
      a = 0xe1;                     // negative: floor
    }
    mem8[SPINNER_ACCUM] = 0x00;           // consume the raw reading
  } else {
    let yAim;
    [a, yAim] = aimSpinnerAtNearestEnemy(m);   // aim mode: auto-aim delta toward nearest enemy
    if (yAim !== undefined) y = yAim;          // a found target leaves its segment delta in Y
  }

  mem8[loc_2b] = a;                            // stash the chosen delta for the sign-flip test below
  let c = u8((a ^ 0xff) + mem8[RIM_ROT_OFFSET] + 1); // $51 - a
  mem8[COORD_LIST_PTR_LO] = c;                 // provisional new rim offset

  if (mem8[TUBE_GEOM_FLAG] !== 0) {            // live board: apply end-of-rim clamps
    if (c >= 0xf0) { c = 0xef; mem8[COORD_LIST_PTR_LO] = c; } // cap to the top lane
    if ((c ^ mem8[loc_2b]) & 0x80 && (c ^ mem8[RIM_ROT_OFFSET]) & 0x80) {
      // sign disagrees with both delta and old offset -> over-rotated past an end; saturate to that end
      mem8[COORD_LIST_PTR_LO] = mem8[RIM_ROT_OFFSET] & 0x80 ? 0xef : 0x00;
    }
  }

  const hi = mem8[COORD_LIST_PTR_LO] >> 4;     // high nibble of the offset = coarse lane
  mem8[loc_2a] = hi;
  mem8[loc_2b] = (hi + 1) & 0x0f;              // paired fine angle

  if (mem8[loc_2a] !== mem8[PLAYER_SEGMENT]) cueRimRotationSound(m, mem8[TUBE_GEOM_FLAG], y); // crossed a lane

  mem8[PLAYER_SEGMENT] = mem8[loc_2a];         // commit coarse lane
  mem8[PLAYER_FINE_ANGLE] = mem8[loc_2b];      // commit fine angle
  mem8[RIM_ROT_OFFSET] = mem8[COORD_LIST_PTR_LO]; // carry the offset to next frame
  return [mem8[TUBE_GEOM_FLAG], y];
}
