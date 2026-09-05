// SPDX-License-Identifier: GPL-3.0-only
// Ascending path-walk step for one object record. Adds the step-table byte at HL to the Y field and
// advances the walk cursor, then ticks the move throttle and, on throttle expiry, the leg counter.
// When a leg finishes it advances the dispatch state and reloads throttle, leg, angle and cursor.

// Field offsets within the object record addressed by `obj`.
const STATE = 0x02;           // dispatch state index
const Y_FIELD = 0x04;
const ANGLE = 0x05;           // signed heading
const MOVE_THROTTLE = 0x10;
const LEG_COUNTER = 0x11;
const WALK_CURSOR = 0x13;     // index into the step table

export function loc_1060(m, obj = m.regs.ix, ptr = m.regs.hl) {
  const { mem8 } = m;

  // Apply this step's Y delta and advance the cursor (the step pointer's low byte, +1, wrapping).
  mem8[obj + Y_FIELD] = mem8[obj + Y_FIELD] + mem8[ptr];
  mem8[obj + WALK_CURSOR] = ptr + 1;

  // Tick the move throttle; hold until it drains to zero.
  const throttle = (mem8[obj + MOVE_THROTTLE] - 1) & 0xff;
  mem8[obj + MOVE_THROTTLE] = throttle;
  if (throttle !== 0) return;

  // Throttle expired: reload it, step the heading, and tick the leg counter.
  mem8[obj + MOVE_THROTTLE] = 4;
  mem8[obj + ANGLE] = mem8[obj + ANGLE] + 1;
  const leg = (mem8[obj + LEG_COUNTER] - 1) & 0xff;
  mem8[obj + LEG_COUNTER] = leg;
  if (leg !== 0) return;

  // Leg finished: advance the state and reload the next leg's throttle, counter, heading and cursor.
  mem8[obj + STATE] = mem8[obj + STATE] + 1;
  mem8[obj + MOVE_THROTTLE] = 3;
  mem8[obj + LEG_COUNTER] = 12;
  mem8[obj + ANGLE] = 244;
  mem8[obj + WALK_CURSOR] = 0;
}
