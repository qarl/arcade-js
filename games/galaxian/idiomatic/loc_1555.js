// SPDX-License-Identifier: GPL-3.0-only
// Guarded two-tier timer/state updater. Bails unless three enable bits agree; then, keyed off a mode bit,
// either arms a fixed output triple on a cascade elapse, or derives the triple from two work-RAM word sums.
import {
  OBJ_ACTIVE_FLAG, loc_41ef, loc_422b, loc_4006, loc_4221,
  loc_4245, loc_4246, loc_4177, loc_421a, DELAYED_EVENT_TIMER, loc_424a, DELAYED_EVENT_ARMED,
} from "./names.js";

const OUTER_RELOAD = 60;

export function loc_1555(m) {
  const { mem8, mem16 } = m;

  // Three enable gates (all bit 0): the first two must be set, the third clear.
  if (!(mem8[OBJ_ACTIVE_FLAG] & 0x01)) return;
  if (!(mem8[loc_41ef] & 0x01)) return;
  if (mem8[loc_422b] & 0x01) return;

  // Mode bit clear -> fixed-arm path: tick the outer, then inner, timer; only a full cascade elapse arms.
  if (!(mem8[loc_4006] & 0x01)) {
    const outer = (mem8[loc_4245] - 1) & 0xff;
    mem8[loc_4245] = outer;
    if (outer !== 0) return;
    mem8[loc_4245] = OUTER_RELOAD;

    const inner = (mem8[loc_4246] - 1) & 0xff;
    mem8[loc_4246] = inner;
    if (inner !== 0) return;
    mem8[loc_4246] = 5;

    mem8[DELAYED_EVENT_TIMER] = 90;
    mem8[loc_424a] = 45;
    mem8[DELAYED_EVENT_ARMED] = 1;
    return;
  }

  // Mode bit set -> tick the outer timer; reload and pick a value on elapse.
  const outer = (mem8[loc_4245] - 1) & 0xff;
  mem8[loc_4245] = outer;
  if (outer !== 0) return;
  mem8[loc_4245] = OUTER_RELOAD;

  let value;
  if (mem8[loc_4221] & 0x01) {
    value = 2;
  } else {
    const inner = (mem8[loc_4246] - 1) & 0xff;
    mem8[loc_4246] = inner;
    if (inner !== 0) return;
    mem8[loc_4246] = 1; // restore the inner timer

    // c = low two bits of the byte-sum of the first word cell.
    const w1 = mem16[loc_4177];
    const c = ((w1 >> 8) + (w1 & 0xff)) & 0x03;

    // Second word cell's byte-sum; a zero sum aborts before any output is written.
    const w2 = mem16[loc_421a];
    const sum = ((w2 >> 8) + (w2 & 0xff)) & 0xff;
    if (sum === 0) return;

    value = ((~((sum >> 2) & 0x03) & 0xff) + 10 - c) & 0xff;
    mem8[loc_4246] = value;
  }

  // Fan the value into the output triple via left-rotations, then mark it ready.
  mem8[DELAYED_EVENT_TIMER] = (value << 2) | (value >> 6);
  mem8[loc_424a] = (value << 3) | (value >> 5);
  mem8[DELAYED_EVENT_ARMED] = 1;
}
