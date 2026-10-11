// SPDX-License-Identifier: GPL-3.0-only
/** stepCraftFlightScript — count one record's step timer down and refresh that record's shape byte from the
 * step the new count selects.
 *
 * The count is not just a delay: it is also the index into a run of shape bytes, so counting down
 * walks the run backwards and reaching zero stops it. Which run is a second byte of the same
 * record, read through a table of run pointers, so a record can be pointed at a different run
 * without disturbing how far along it has got. A timer already at zero is left alone and nothing
 * at all is written, which is what makes the run stop on its last entry rather than wrap.
 * LIVE-OUT: the timer and the shape byte.
 *
 * ROM 0x323A-0x3251. Grounding: [seen] -- under MAME, one record's shape byte always equalled
 * the byte the run-pointer table at 0x3438 puts at the current count, across six distinct
 * (selector, count) pairs, which is what shows the count is the index and not only a delay.
 *
 * Parameter: `record` -- the object record being animated (IX in the ROM), supplied by the
 * caller. Fields used: +0x08 shape byte, +0x09 step timer, +0x0A run selector. */

import { fetchTableByte } from "./fetchTableByte.js";
import { fetchTableWord } from "./fetchTableWord.js";
import { CRAFT_FLIGHT_SCRIPT_TABLE } from "./names.js";

// Offsets within the object record (ROM `(ix+0x09)`, `(ix+0x0a)`, `(ix+0x08)`).
const STEP_TIMER = 9;
const RUN_SELECTOR = 10;
const SHAPE_BYTE = 8;

export function stepCraftFlightScript(m, record = m.regs.ix) {
  const { mem8 } = m;
  // A timer already at zero means the run has finished: return without writing anything, so
  // the shape stays on the last entry shown (ROM `and a` / `ret z`).
  const remaining = mem8[record + STEP_TIMER];
  if (remaining === 0) return;

  // Count down one and store it back; the NEW count is the index used below (ROM `dec a`,
  // store, and `ld c,a` keeps it for the byte fetch).
  const step = remaining - 1;
  mem8[record + STEP_TIMER] = step;

  // Find this record's run: the selector byte indexes the ROM word table at 0x3438
  // (CRAFT_FLIGHT_SCRIPT_TABLE, via the rst 0x10 word fetch), giving a pointer to a run of shape
  // bytes. Keeping the run choice in its own byte lets a caller swap runs mid-animation.
  const run = fetchTableWord(m, mem8[record + RUN_SELECTOR], CRAFT_FLIGHT_SCRIPT_TABLE);

  // Take the byte at index `step` in that run (rst 0x08 byte fetch) as the record's new shape.
  mem8[record + SHAPE_BYTE] = fetchTableByte(m, run, step);
}
