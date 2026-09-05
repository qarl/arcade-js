// SPDX-License-Identifier: GPL-3.0-only
// Arm the trigger flags when a masked input line reads active. Skips when the enable gate bit is
// clear or the armed flag is already set; a control bit then picks between an input-mask test (arms
// both flags) and a low-5-bits range test (arms one flag).
import { OBJ_ACTIVE_FLAG, loc_4208, loc_4006, loc_4018, loc_4013, IN0_SHADOW, loc_4014, IN1_SHADOW, loc_41cc, loc_425f } from "./names.js";

export function loc_0a32(m) {
  const { mem8 } = m;

  if ((mem8[OBJ_ACTIVE_FLAG] & 1) === 0) return; // enable gate closed
  if (mem8[loc_4208] & 1) return;         // already armed

  if ((mem8[loc_4006] & 1) === 0) {
    // range test: arm only when the low five bits are all clear
    if (mem8[loc_425f] & 0x1f) return;
    mem8[loc_4208] = 1;
    return;
  }

  // input-mask test: bit 4 set in the line and clear in its guard means active
  const alt = mem8[loc_4018] & 1;
  const line = alt ? mem8[IN1_SHADOW] : mem8[IN0_SHADOW];
  const guard = alt ? mem8[loc_4014] : mem8[loc_4013];
  if ((line & ~guard & 0x10) === 0) return; // no active line

  mem8[loc_4208] = 1;
  mem8[loc_41cc] = 1;
}
