// SPDX-License-Identifier: GPL-3.0-only
// Path-move step for one object: walks a per-object cursor through the step table, adding the next
// delta pair to the object's Y then X. Stepping off the near edge drops it to the fall-away state;
// when the throttle and leg counters both expire, it advances to the next path state.
import { PATH_STEP_TABLE } from "./names.js";

// Field offsets within the object record addressed by `obj`.
const STATE = 2; // path state index
const POS_Y = 3; // takes the first step delta
const POS_X = 4; // takes the second (direction-controlled) step delta; bounds-checked
const CROSS_STEP = 5; // nudged one count per leg
const DIR_FLAG = 6; // bit0: X moves toward the far edge
const THROTTLE = 16; // frames between cursor advances
const LEGS = 17; // legs remaining before the state advances
const CURSOR = 19; // read cursor into the step table

const NEAR_EDGE = 14; // X (plus a 7px margin) below this is off the near side

export function loc_0d71(m, obj = m.regs.ix) {
  const { mem8 } = m;

  let cursor = mem8[obj + CURSOR];
  mem8[obj + POS_Y] = mem8[obj + POS_Y] + mem8[PATH_STEP_TABLE + cursor];

  cursor = (cursor + 1) & 0xff; // second byte of the pair is the X delta
  const xStep = mem8[PATH_STEP_TABLE + cursor];
  const goingFar = mem8[obj + DIR_FLAG] & 0x01;

  const x = (goingFar ? mem8[obj + POS_X] - xStep : mem8[obj + POS_X] + xStep) & 0xff;
  mem8[obj + POS_X] = x;

  if (((x + 7) & 0xff) < NEAR_EDGE) { mem8[obj + STATE] = 5; return; } // off the near edge

  mem8[obj + CURSOR] = cursor + 1; // step past the pair (byte store wraps)

  mem8[obj + THROTTLE] = mem8[obj + THROTTLE] - 1;
  if (mem8[obj + THROTTLE] !== 0) return;
  mem8[obj + THROTTLE] = 4;

  mem8[obj + CROSS_STEP] = mem8[obj + CROSS_STEP] + (goingFar ? 1 : -1);

  mem8[obj + LEGS] = mem8[obj + LEGS] - 1;
  if (mem8[obj + LEGS] !== 0) return;
  mem8[obj + STATE] = mem8[obj + STATE] + 1;
}
