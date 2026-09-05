// SPDX-License-Identifier: GPL-3.0-only
// Homing AI step: steers the object's 16-bit X position:subpixel toward the shared target by roughly
// four times the signed distance each frame, ticks its frame counter, and on the dwell timer reaching
// zero advances to the next state.
import { loc_4202 } from "./names.js";

// Field offsets within the object record addressed by `obj`.
const STATE = 2; // state index
const FRAME = 3; // per-frame counter
const POS_X = 4; // X position (high byte of the position:subpixel pair)
const POS_SUB = 9; // X subpixel (low byte)
const DWELL = 16; // frames left in this state

export function loc_0f3c(m, obj = m.regs.ix) {
  const { mem8 } = m;

  mem8[obj + FRAME] = mem8[obj + FRAME] + 1;

  // Signed distance to the target, and a ~4x step toward it carrying the hardware's rounding bias
  // (nothing when already on target, an extra count when overshooting from the far side).
  const dist = (mem8[obj + POS_X] - mem8[loc_4202]) & 0xff;
  const signed = dist < 128 ? dist : dist - 256;
  const bias = dist === 0 ? 0 : dist >= 128 ? 3 : 2;
  const step = 4 * signed + bias;

  const pos = ((mem8[obj + POS_X] << 8) | mem8[obj + POS_SUB]) - step; // may go negative
  mem8[obj + POS_X] = pos >> 8; // high byte; the byte store truncates
  mem8[obj + POS_SUB] = pos; // low byte

  mem8[obj + DWELL] = mem8[obj + DWELL] - 1;
  if (mem8[obj + DWELL] !== 0) return;
  mem8[obj + STATE] = mem8[obj + STATE] + 1;
}
