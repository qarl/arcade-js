// SPDX-License-Identifier: GPL-3.0-only
// Object move dispatch: when active, nudges the object's position by the selected movement bits
// (AI command, or one of the two input ports); when inactive, either parks the position at zero or
// stages it under an alternate code. Then writes the negated position as four (value, code) pairs.
import {
  OBJ_ACTIVE_FLAG, loc_4202, OBJ_MOVE_CMD, OBJ_STAGE_BLOCK,
  IN0_SHADOW, IN1_SHADOW, loc_4006, loc_4018, loc_4201,
} from "./names.js";

// Position -> staged value: one's-complement, then offset by 128 into a byte.
function negatePos(pos) {
  return (~pos + 128) & 0xff;
}

export function loc_0837(m) {
  const { mem8 } = m;

  let value, code;

  if (mem8[OBJ_ACTIVE_FLAG] & 1) {
    // Active: pick the movement bits, then step the position toward its floor/ceiling.
    const move = (mem8[loc_4006] & 1) === 0 ? mem8[OBJ_MOVE_CMD]   // auto/AI command
               : (mem8[loc_4018] & 1)       ? mem8[IN1_SHADOW]     // second input port
               :                              mem8[IN0_SHADOW];    // first input port
    let pos = mem8[loc_4202];
    if (move & 0x08 && pos >= 23) pos -= 1;  // bit3: step down while above the floor
    if (move & 0x04 && pos < 233) pos += 1;  // bit2: step up while below the ceiling
    mem8[loc_4202] = pos;
    value = negatePos(pos);
    code = 6;
  } else if (mem8[loc_4201] & 1) {
    // Inactive, alternate mode: stage the current position under the alternate code, no clamp.
    value = negatePos(mem8[loc_4202]);
    code = 7;
  } else {
    // Inactive: park the position at zero.
    mem8[loc_4202] = 0;
    value = negatePos(0);
    code = 6;
  }

  // Stage four interleaved (value, code) pairs.
  for (let i = 0; i < 4; i++) {
    mem8[OBJ_STAGE_BLOCK + 2 * i] = value;
    mem8[OBJ_STAGE_BLOCK + 2 * i + 1] = code;
  }
}
