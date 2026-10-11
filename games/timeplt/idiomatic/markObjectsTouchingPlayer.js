// SPDX-License-Identifier: GPL-3.0-only
/** markObjectsTouchingPlayer — mark every object in a run that has come within reach of one fixed reference
 * position, and only while a guard byte reads all-ones.
 *
 * Reach is a box, and the caller owns its shape: each axis is measured as the reference minus the
 * object, shifted by an offset and compared against a width, both taken from registers, and the
 * arithmetic wraps at a byte so the test is a wrapped distance rather than a range. An object
 * whose own state byte is not all-ones is skipped without being measured, and one inside the box
 * on BOTH axes has that state byte replaced by a different value — the only thing written. The
 * two cursors advance independently: the state cursor in its low byte only, so the run stays inside
 * one page, and the coordinate cursor by an entry stride. A count of zero walks the whole 256, which
 * is what the count register means rather than a special case.
 *
 * The guard steps the reference's own state byte; a value that is not all-ones bails there,
 * touching nothing else.
 * LIVE-OUT: the state bytes.
 * ROM 0x51B3-0x51DD. Grounding: [seen] (names.js ROUTINES 0x51B3). */

import { u8, u16 } from "../../../core/int.js";
import { PLAYER_ENTRY, PLAYER_SPRITE_Y, PLAYER_STATE } from "./names.js";

const SECOND_AXIS_OFFSET = 49;
const ENTRY_STRIDE = 2;
const STATE_STRIDE = 16;
const IN_PLAY = 0xff;
const MARKED = 0xf0;
const PAGE_MASK = 0xff << 8;

export function markObjectsTouchingPlayer(m, offset = m.regs.l, width = m.regs.h, state = m.regs.de, entry = m.regs.iy, left = m.regs.b) {
  const { mem8 } = m;

  if (u8(mem8[PLAYER_STATE] + 1) !== 0) return;

  const withinReach = (reference, coordinate) =>
    u8(mem8[reference] - mem8[coordinate] + offset) < width;

  do {
    if (
      mem8[state] === IN_PLAY &&
      withinReach(PLAYER_ENTRY, entry) &&
      withinReach(PLAYER_SPRITE_Y, entry + SECOND_AXIS_OFFSET)
    ) {
      mem8[state] = MARKED;
    }
    // The state cursor steps a record in its low byte only, with no carry into the page, so a run
    // that starts near the end of a page wraps back to its first record.
    state = (state & PAGE_MASK) | u8(state + STATE_STRIDE);
    entry = u16(entry + ENTRY_STRIDE);
    left = u8(left - 1);
  } while (left !== 0);
}
