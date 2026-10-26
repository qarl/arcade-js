// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { PLAYER_SHOT_DEPTH, loc_29, loc_2a, loc_2b, LEVEL_GEOM_SCALE, ZOOM_ACCUM_HI, PROJ_OFS_X_LO, PROJ_OFS_X_HI, DEPTH_HI, DEPTH_LO, DEPTH_TARGET, SPIKE_TABLE_GUARD, STATUS_FLAGS, GAME_MODE, loc_3d, loc_102, REDRAW_COUNTER } from "./names.js";
import { rotateBlasterAroundRim } from "./rotateBlasterAroundRim.js";

/**
 * autoAdvanceRimRotation — advance the tube-rim rotation from a fixed-stride position accumulator.
 * ROM 0x904b.
 *
 * Role in the machine: on levels whose geometry auto-scrolls, Tempest's playfield rim rotates on its own.
 * This routine is the per-frame auto-advance: it folds the level's geometry-scale delta into a long
 * position accumulator, steps a 16-bit position by a fixed stride, notices when it saturates or reaches
 * its target, and hands off to rotateBlasterAroundRim to actually place the blaster on the (now advanced)
 * rim. It is the "the tube turns even if you don't" driver.
 *
 * Behavior: set the shot-depth floor $202 = 0x10 (PLAYER_SHOT_DEPTH). Sign-extend the geometry-scale delta
 * $121 (LEVEL_GEOM_SCALE) across the work bytes $29/$2a/$2b (loc_29/2a/2b), then arithmetic-shift the
 * $2a:$29 pair right twice (preserving sign). Add the three work bytes with carry into the 24-bit running
 * total $122/$68/$69 (ZOOM_ACCUM_HI / PROJ_OFS_X_LO / PROJ_OFS_X_HI). Step the 16-bit position $5f:$5b
 * (DEPTH_HI:DEPTH_LO) by stride 0x18, arming the spike-table guard $115 (SPIKE_TABLE_GUARD) when the low
 * byte reaches >= 0xfc. Compute the high difference against target $5d (DEPTH_TARGET); when it collapses to
 * zero, snap the position to (target, 0xff), set the game mode $0 (GAME_MODE) to 0x04 or 0x08 by the sign
 * of $5 (STATUS_FLAGS bit 7), and clear $102[$3d] (loc_102 indexed by loc_3d). Finally mark the redraw
 * counter $114 = 0xff (REDRAW_COUNTER) and tail-call rotateBlasterAroundRim, forwarding Y.
 *
 * Live-out: $202, the 24-bit total $122/$68/$69, the stepped position $5f:$5b, $115 (maybe armed), and on
 * a target hit $0/$102[$3d]; $114 = 0xff. Returns whatever rotateBlasterAroundRim returns (the exit [X, Y]
 * the ROM leaves). The rotation is entered with this routine's y and with the X the ROM holds there: 0xff
 * (the two-step shift counts X past 0), or loc_3d when the target hit indexed loc_102 with it.
 * Grounding: [seen].
 */
export function autoAdvanceRimRotation(m, y = m.regs.y) {
  const { mem8 } = m;
  mem8[PLAYER_SHOT_DEPTH] = 0x10;

  // Sign-extend the raw delta across low/mid/high work bytes.
  mem8[loc_29] = 0x00;
  mem8[loc_2b] = 0x00;
  mem8[loc_2a] = mem8[LEVEL_GEOM_SCALE];
  if (mem8[LEVEL_GEOM_SCALE] & 0x80) mem8[loc_2b] = 0xff;

  let x = 0xff; // the ROM counts the two shifts in X, leaving it at 0xff
  // Arithmetic-shift the mid:low pair right twice, preserving the sign.
  for (let i = 0; i < 2; i++) {
    const hi = mem8[loc_2a];
    mem8[loc_2a] = (hi >> 1) | (hi & 0x80);
    mem8[loc_29] = (mem8[loc_29] >> 1) | ((hi & 1) << 7);
  }

  // 24-bit accumulate the work bytes into the running total.
  let s = mem8[loc_29] + mem8[ZOOM_ACCUM_HI];
  mem8[ZOOM_ACCUM_HI] = s;
  s = mem8[loc_2a] + mem8[PROJ_OFS_X_LO] + (s >> 8);
  mem8[PROJ_OFS_X_LO] = s;
  s = mem8[loc_2b] + mem8[PROJ_OFS_X_HI] + (s >> 8);
  mem8[PROJ_OFS_X_HI] = s;

  // 16-bit position += fixed stride; flag on high-byte saturation.
  let p = mem8[DEPTH_HI] + 0x18;
  mem8[DEPTH_HI] = p;
  p = mem8[DEPTH_LO] + (p >> 8);
  mem8[DEPTH_LO] = p;
  if (mem8[DEPTH_LO] >= 0xfc) mem8[SPIKE_TABLE_GUARD] = 0x01;

  // High difference against the target; a zero difference rebuilds the seeds.
  const borrow = mem8[DEPTH_HI] >= mem8[DEPTH_TARGET] ? 1 : 0;
  const highDiff = mem8[DEPTH_LO] === 0 ? 0 : (mem8[DEPTH_LO] - 0xff - (1 - borrow)) & 0xff;
  if (highDiff === 0) {
    mem8[DEPTH_HI] = mem8[DEPTH_TARGET];
    mem8[DEPTH_LO] = 0xff;
    mem8[GAME_MODE] = mem8[STATUS_FLAGS] & 0x80 ? 0x04 : 0x08;
    x = mem8[loc_3d];
    mem8[u16(loc_102 + x)] = 0x00;
  }

  mem8[REDRAW_COUNTER] = 0xff;
  return rotateBlasterAroundRim(m, y, x);
}
