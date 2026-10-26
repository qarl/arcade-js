// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  GAME_MODE, STATUS_FLAGS, DSW1_SNAPSHOT, loc_3d, loc_40, loc_42, SLOT_COUNTDOWN, INPUT_DEBOUNCED, DEPTH_LO, DEPTH_HI,
  ACTIVE_ENEMY_COUNT, SPIKE_ACTIVE_FLAG, ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT, loc_10f, REDRAW_COUNTER, TIMED_OBJECT_COUNT, PLAYER_SHAPE_SUM, ENEMY_SLOT_TOP,
  ACTIVE_OBJECT_COUNT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH, ENEMY_DEPTH, FIRE_GATE, loc_455,
} from "./names.js";
import { clearActiveShots } from "./clearActiveShots.js";
import { initWaveStateCountingSpikes } from "./initWaveStateCountingSpikes.js";

/**
 * ageShotsAndAdvanceFrameClock -- the per-frame shot ager, keyed on the sign of the
 * frame-control byte PLAYER_FINE_ANGLE (loc_201). ROM 0xa504.
 *
 * Role in the machine: Tempest runs its wave/shot bookkeeping once per frame off a single
 * control byte whose sign selects one of two jobs. While that byte is positive the routine
 * services the "still setting up" arm -- it nurses a per-slot timer and, when the board is
 * quiet, folds the wave state back to its start so a fresh wave can spawn. Once the byte
 * goes negative the routine flips to the "wind-down" arm: it ages every shot in flight, ticks
 * a frame/countdown clock, and when that clock crosses its marker it hands control off (sets
 * the game-mode cell to 6) and clamps a running enemy-budget total. Together the two arms are
 * what makes shots decay, waves recycle, and the between-wave timer march forward.
 *
 * Behavior: read PLAYER_FINE_ANGLE (loc_201). If < 0x80 (positive arm): when a gate cell pair
 * (loc_455 | PLAYER_SHAPE_SUM) is live and loc_42 > 0x17, bump timer cell GAME_MODE+loc_40
 * (loc_00 base) by one. Bail on an active spike. If FIRE_GATE|TIMED_OBJECT_COUNT is zero, scan
 * the ENEMY_DEPTH shot table from ENEMY_SLOT_TOP down looking for any live shot already grown
 * past 0x11; only if none is found re-init the wave (initWaveStateCountingSpikes) and clear
 * shots. Three further guards (INPUT_DEBOUNCED bits 0x60, STATUS_FLAGS bit 0x80, DSW1_SNAPSHOT
 * masked to 0x40) gate a second wave re-init. Negative arm: bail while any of ACTIVE_OBJECT_COUNT
 * / ACTIVE_ENEMY_COUNT / TIMED_OBJECT_COUNT is nonzero; otherwise age each live ENEMY_DEPTH shot
 * by +0x0f (snapping >= 0xf0 to 0). Then, keyed on SLOT_COUNTDOWN+loc_3d, either step
 * PLAYER_SHOT_DEPTH by +0x0f (proceed at >= 0xf0) or reset two flags and count the 16-bit
 * DEPTH_HI/DEPTH_LO clock down by 0x20 (proceed when the high byte hits 0xfa). On proceed:
 * GAME_MODE = 0x06, clear shots, and set FIRE_GATE = min(0x3f, ENEMY_TOTAL_COUNT +
 * ENEMY_TYPE_COUNT + FIRE_GATE).
 *
 * Live-out: the ENEMY_DEPTH shot table (aged), the per-slot timer cell GAME_MODE+loc_40,
 * PLAYER_SHOT_DEPTH / DEPTH_HI / DEPTH_LO (the clock), GAME_MODE (=0x06 on hand-off), FIRE_GATE
 * (the clamped enemy budget), loc_10f / REDRAW_COUNTER, and the wave state re-seeded by the
 * called routines.
 *
 * x and y are the X/Y the ROM enters with. Returns the exit [X, Y] the ROM leaves. X is loaded by the
 * timer bump (loc_40), the shot age walk (run past 0, then reloaded from loc_3d) and the two callees (each
 * leaves 0xff), so it is the last of those that ran, else the incoming x. Y is loaded only by the positive
 * arm's shot scan: the index of the first shot past the threshold, or 0xff when the scan runs out; else
 * the incoming y.
 *
 * Grounding: [seen].
 */
export function ageShotsAndAdvanceFrameClock(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;

  if (mem8[PLAYER_FINE_ANGLE] < 0x80) {
    // ----- positive arm -----
    // Bump the timer cell only when a gate is live and a limit is not yet reached.
    if ((mem8[loc_455] | mem8[PLAYER_SHAPE_SUM]) !== 0 && 0x17 < mem8[loc_42]) {
      x = mem8[loc_40];
      mem8[u8(GAME_MODE + x)] = u8(mem8[u8(GAME_MODE + x)] + 1);
    }
    if (mem8[SPIKE_ACTIVE_FLAG] !== 0) return [x, y];
    if ((mem8[FIRE_GATE] | mem8[TIMED_OBJECT_COUNT]) === 0) {
      // Reset unless any live shot has already grown past the threshold.
      y = mem8[ENEMY_SLOT_TOP];
      let anyBig = false;
      for (;;) {
        const v = mem8[u16(ENEMY_DEPTH + y)];
        if (v !== 0 && v >= 0x11) { anyBig = true; break; }
        y = u8(y - 1);
        if (y >= 0x80) break;
      }
      if (!anyBig) { initWaveStateCountingSpikes(m); x = clearActiveShots(m); }
    }
    if ((mem8[INPUT_DEBOUNCED] & 0x60) === 0) return [x, y];
    if ((mem8[STATUS_FLAGS] & 0x80) === 0) return [x, y];
    if ((mem8[DSW1_SNAPSHOT] & 0x43) !== 0x40) return [x, y];
    x = initWaveStateCountingSpikes(m);
    return [x, y];
  }

  // ----- negative arm -----
  if ((mem8[ACTIVE_OBJECT_COUNT] | mem8[ACTIVE_ENEMY_COUNT] | mem8[TIMED_OBJECT_COUNT]) !== 0) return [x, y];
  // Age each live shot by a fixed step, snapping to zero at the ceiling.
  for (x = mem8[ENEMY_SLOT_TOP]; ; ) {
    const cur = mem8[u16(ENEMY_DEPTH + x)];
    if (cur !== 0) {
      const v = cur + 0x0f;
      mem8[u16(ENEMY_DEPTH + x)] = v >= 0xf0 ? 0x00 : v;
    }
    x = u8(x - 1);
    if (x >= 0x80) break;
  }

  let proceed;
  x = mem8[loc_3d];
  if (mem8[u8(SLOT_COUNTDOWN + x)] !== 0x01) {
    // Advance one counter; proceed once it crosses the ceiling.
    const v = mem8[PLAYER_SHOT_DEPTH] + 0x0f;
    mem8[PLAYER_SHOT_DEPTH] = u8(v);
    proceed = v >= 0xf0;
  } else {
    // Reset two flags and step a 16-bit clock down; proceed at a marker value.
    mem8[loc_10f] = 0x00;
    mem8[REDRAW_COUNTER] = 0x01;
    const lo = mem8[DEPTH_HI] - 0x20;
    mem8[DEPTH_HI] = u8(lo);
    const hi = mem8[DEPTH_LO] - (lo < 0 ? 1 : 0);
    mem8[DEPTH_LO] = u8(hi);
    proceed = u8(hi) === 0xfa;
  }
  if (!proceed) return [x, y];

  mem8[GAME_MODE] = 0x06;
  x = clearActiveShots(m);
  const sum = u8(mem8[ENEMY_TOTAL_COUNT] + mem8[ENEMY_TYPE_COUNT] + mem8[FIRE_GATE]);
  mem8[FIRE_GATE] = sum >= 0x3f ? 0x3f : sum;
  return [x, y];
}
