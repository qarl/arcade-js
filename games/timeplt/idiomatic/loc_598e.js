// SPDX-License-Identifier: GPL-3.0-only
/** loc_598e — hand back the doubled component pair an object's OWN heading calls for, at the pace
 * one fixed table of samples sets. Choosing that table is all this entry adds; the heading comes
 * off the record, and any pointer the caller was holding is discarded. LIVE-OUT: the pair.
 *
 * ROM 0x598E-0x5993 (frozen lift translated/loc_598e.js: `ld hl,0x59d7 / jp 0x599d`).
 * Grounding: [seen] (names.js ROUTINES 0x598e).
 *
 * ROLE IN THE MACHINE. A heading is a point on a 256-step circle, kept in byte +2 of an object's
 * record. doubledVelocityForHeading (0x59A0) turns a heading into two perpendicular 16-bit
 * velocity components, read from a table of samples and then doubled. On the Z80 this entry
 * loads the table address into HL and jumps to 0x599D (loc_599d), which reads the heading from
 * (IX+2) and falls into 0x59A0 — so the caller's HL is overwritten, which is what "any pointer the
 * caller was holding is discarded" means. The callers (commissionStagedAttackerByEra for an era-3
 * era weapon, and loc_43f0) bank the returned pair into the object's record.
 *
 * The table is SLOWEST_VELOCITY_TABLE (0x59D7), the ROM table of 256 16-bit velocity words that names.js lists
 * among its readers. loc_5994 is this entry byte-for-byte with the other table immediate; names.js
 * keeps the whole shim family hex because a shim cannot say what its pace means.
 *
 * `heading` defaults to the byte at the record the ROM's IX points at, offset HEADING_CELL; a
 * caller in this port may hand it in directly.
 */

import { doubledVelocityForHeading } from "./doubledVelocityForHeading.js";
import { SLOWEST_VELOCITY_TABLE as VELOCITY_TABLE } from "./names.js";

// Byte +2 of an object record: its heading (the ROM's `ld a,(ix+0x02)` at 0x599D).
const HEADING_CELL = 2;

export function loc_598e(m, heading = m.mem8[m.regs.ix + HEADING_CELL]) {
  // Seat the fixed table and do the doubled lookup; the pair comes back (and is left in DE/BC by
  // the lookup) for the caller to store.
  return doubledVelocityForHeading(m, VELOCITY_TABLE, heading);
}
