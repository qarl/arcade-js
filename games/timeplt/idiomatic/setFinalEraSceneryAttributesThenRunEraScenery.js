// SPDX-License-Identifier: GPL-3.0-only
/**
 * setFinalEraSceneryAttributesThenRunEraScenery — fix the scenery attribute byte at 0x28, then set the scenery attributes to it and run
 * the era scenery.
 *
 * ROM 0x3156-0x315A (`ld a,0x28 / jp 0x30D1`). Grounding: [seen] (names.js ROUTINES 0x3156).
 *
 * WHAT IT IS. A two-instruction entry into the scenery attribute-and-run body at ROM 0x30D1
 * (setSceneryAttributesThenRunEraScenery). That body writes the byte carried in A into the attribute byte of the
 * eight scenery sprite entries (every second byte from 0xAA60) and then seats and runs the frame's scenery for the era. This entry
 * fixes that byte at 0x28 (decimal 40), and choosing that one
 * constant is its entire content -- whatever byte the caller carried in A is discarded.
 *
 * ROLE IN THE MACHINE. Reached from seatEraSceneryCodesThenSetAttributesAndRunScenery on its era-four path.
 * Control transfers to the body and does not come back here.
 *
 * PARAMETERS. `era` is the era the caller carried (the body branches on it), `entryCursor` and
 * `recordCursor` the sprite-entry and record cursors it carried (IY, IX); all pass straight through.
 *
 * LIVE-OUT: memory.
 */

import { setSceneryAttributesThenRunEraScenery } from "./setSceneryAttributesThenRunEraScenery.js";

// The attribute byte this entry seats (0x28).
const FILL_BYTE = 40;

export function setFinalEraSceneryAttributesThenRunEraScenery(m, era = m.regs.c, entryCursor = m.regs.iy, recordCursor = m.regs.ix) {
  // Tail into the body with the fixed attribute byte and the caller's era and cursors.
  return setSceneryAttributesThenRunEraScenery(m, FILL_BYTE, era, entryCursor, recordCursor);
}
