// SPDX-License-Identifier: GPL-3.0-only
// Service the timing block. GATE bit0 set: drain COUNTER by four and, while it lands in the borrow
// window, raise FLAG. GATE bit0 clear: reset COUNTER, then load FIELD from SOURCE when TRIGGER bit0
// is set, else zero it.
import { loc_4208, loc_4209, loc_420a, loc_420b, OBJ_ACTIVE_FLAG, loc_4202 } from "./names.js";

const GATE = loc_4208;
const COUNTER = loc_4209;
const FIELD = loc_420a;
const FLAG = loc_420b;
const TRIGGER = OBJ_ACTIVE_FLAG;
const SOURCE = loc_4202;

export function loc_08bc(m) {
  const { mem8 } = m;

  if (mem8[GATE] & 0x01) {
    mem8[COUNTER] -= 4;
    const drained = mem8[COUNTER];
    // Two chained subtractions borrow exactly across 14..17.
    if (drained >= 14 && drained <= 17) mem8[FLAG] = 1;
    return;
  }

  mem8[COUNTER] = 220;
  mem8[FIELD] = mem8[TRIGGER] & 0x01 ? mem8[SOURCE] : 0;
}
