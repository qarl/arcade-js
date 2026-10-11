// SPDX-License-Identifier: GPL-3.0-only
/** releaseHeldObject — release a held object once its delay runs out. A countdown in the object
 * record's fifteenth byte ticks down by one per entry, and while it is still running that
 * tick is the whole effect; on the tick that lands it on zero the record's first byte —
 * the code a slot is held in — steps on by one, and the countdown cell reloads with 128.
 * LIVE-OUT: memory only — one cell every entry, two on the entry that releases.
 *
 * ROM: 0x2B52. Tag [seen] (names.js). Role in the machine: the waiting stage of an enemy-craft slot.
 * Its five callers, the per-era slot services serviceEra0EnemyCraftSlot through serviceEra4EnemyCraftSlot,
 * come here only when the slot's state byte holds exactly the held value, so the step on
 * the state byte always turns held into live, never an open-ended bump.
 *
 * Parameter: `slot` is the object record's address (the ROM's IX).
 */

import { u8 } from "../../../core/int.js";

// Record offsets and values: the countdown sits at +0x0E, and is re-armed with 0x80 on release.
const RELEASE_DELAY = 14;
const RELEASED_FROM_HOLD_MARK = 128;

export function releaseHeldObject(m, slot = m.regs.ix) {
  const { mem8 } = m;
  // One tick of the delay (ROM: dec (ix+0x0e)); while it has not reached zero, that is all.
  const remaining = u8(mem8[slot + RELEASE_DELAY] - 1);
  mem8[slot + RELEASE_DELAY] = remaining;
  if (remaining !== 0) return;

  // Expired: step the state byte from held to live (inc (ix+0x00)), and reload the same cell with
  // 128 (ld (ix+0x0e),0x80); names.js records other routines re-arming this cell as a cooldown.
  mem8[slot] = mem8[slot] + 1;
  mem8[slot + RELEASE_DELAY] = RELEASED_FROM_HOLD_MARK;
}
