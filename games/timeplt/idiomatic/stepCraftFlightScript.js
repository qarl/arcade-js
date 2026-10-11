// SPDX-License-Identifier: GPL-3.0-only
/** stepCraftFlightScript — move one enemy craft one step through its flight script: count its script
 * position down and load the steering order at the new position.
 *
 * The position is not just a delay: it is also the index into the craft's 32-byte flight script,
 * so counting down walks the script backwards and reaching zero stops it. Which script is a second
 * byte of the same record, read through a table of script pointers. A position already at zero is
 * left alone and nothing at all is written, so the craft keeps whatever order it last took.
 * The order is not a picture: the re-aim pass (reaimEnemyCraftByFlightScriptOnPhaseTick) reads it
 * as hold the heading (0x10), turn away (0x11) or steer toward an aim point (any other value).
 * LIVE-OUT: the position and the steering order.
 *
 * ROM 0x323A-0x3251. Grounding: [seen] -- under MAME, one record's +0x08 byte always equalled
 * the byte the script-pointer table at 0x3438 puts at the current count, across six distinct
 * (selector, count) pairs, which is what shows the count is the index and not only a delay.
 *
 * Parameter: `record` -- the craft record being stepped (IX in the ROM), supplied by the
 * caller. Fields used: +0x08 steering order, +0x09 script position, +0x0A script selector. */

import { fetchTableByte } from "./fetchTableByte.js";
import { fetchTableWord } from "./fetchTableWord.js";
import { CRAFT_FLIGHT_SCRIPT_TABLE } from "./names.js";

// Offsets within the craft record (ROM `(ix+0x09)`, `(ix+0x0a)`, `(ix+0x08)`).
const SCRIPT_POSITION = 9;
const SCRIPT_SELECTOR = 10;
const STEERING_ORDER = 8;

export function stepCraftFlightScript(m, record = m.regs.ix) {
  const { mem8 } = m;
  // A position already at zero means the script has run out: return without writing anything
  // (ROM `and a` / `ret z`).
  const remaining = mem8[record + SCRIPT_POSITION];
  if (remaining === 0) return;

  // Count down one and store it back; the NEW count is the index used below (ROM `dec a`,
  // store, and `ld c,a` keeps it for the byte fetch).
  const step = remaining - 1;
  mem8[record + SCRIPT_POSITION] = step;

  // Find this craft's script: the selector byte indexes the ROM word table at 0x3438
  // (CRAFT_FLIGHT_SCRIPT_TABLE, via the rst 0x10 word fetch), giving a pointer to the script.
  const script = fetchTableWord(m, mem8[record + SCRIPT_SELECTOR], CRAFT_FLIGHT_SCRIPT_TABLE);

  // Take the byte at index `step` in that script (rst 0x08 byte fetch) as the craft's new order.
  mem8[record + STEERING_ORDER] = fetchTableByte(m, script, step);
}
