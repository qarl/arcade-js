// SPDX-License-Identifier: GPL-3.0-only
import { SLOWEST_VELOCITY_TABLE } from "./names.js";
/**
 * flyAtSlowestSpeed — fly one object a single step at the slowest of the velocity-table speeds.
 *
 * WHAT IT IS: ROM 0x5840-0x5845, tag [seen] (names.js ROUTINES 0x5840). The ROM routine is
 * `ld hl,0x59d7 / jp 0x58bc`: it fixes one table of velocity samples and hands over to the shared flier,
 * flyAlongHeading. Choosing that table is the whole of what this entry does, and it decides nothing else.
 *
 * WHY A SPEED: every entry into flyAlongHeading is a two-instruction shim fixing one table, and the
 * tables are one waveform scaled by its own peak, so magnitude is the only thing a shim chooses. This
 * entry's table, 0x59D7, sits below the slowest the player is ever given. Under MAME every dispatch here
 * was predicted by that table alone while a sibling shim ran a faster one on the SAME slot array, so an
 * entry selects a speed and not an object class. "Slowest" is a rank over the ROM tables (names.js "why"
 * for 0x5840).
 *
 * ROLE IN THE MACHINE: reached as a call from two per-slot actor handlers and as a tail jump from a third
 * (for example serviceEra2EnemyCraftSlot, whose active craft "flies at the slowest speed").
 *
 * LIVE-OUT: memory (the object's coordinates, written by the flier).
 */

import { flyAlongHeading } from "./flyAlongHeading.js";

/*
 * The table at ROM 0x59D7 (SLOWEST_VELOCITY_TABLE): 256 16-bit velocity words. The same address is
 * also the derail target of the whole-ROM checksum in clearScreenRamAndVerifyImageThenColdInit (names.js).
 */
const VELOCITY_TABLE = SLOWEST_VELOCITY_TABLE;

/*
 * `object` is the object's record (the ROM's IX) and `sprite` its sprite entry (the ROM's IY), passed
 * straight through to the flier, which reads the heading from the record and moves the sprite entry.
 */
export function flyAtSlowestSpeed(m, object = m.regs.ix, sprite = m.regs.iy) {
  flyAlongHeading(m, VELOCITY_TABLE, object, sprite);
}
