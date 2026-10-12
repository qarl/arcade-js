// SPDX-License-Identifier: GPL-3.0-only
/** freeAndNumberEveryObjectSlot — lay out a run of twenty-three records, sixteen bytes apart from a fixed start:
 * each record's first byte is cleared and its sixteenth is stamped with that record's position
 * in the run, counting from one. Nothing is read, so the run comes out the same however it went
 * in, and the stamped byte is what tells one record from another. LIVE-OUT: memory, and the record
 * cursor the walk ends on -- one record past the run (the ROM leaves it in IX) -- returned.
 *
 * ROM 0x1AE4-0x1AFB (lift: translated/loc_1ae4.js). Grounding: [seen].
 *
 * Role in the machine: the game's moving objects each own a sixteen-byte record. The run from
 * ACTOR_RECORD_SLOT0 (0xA810) through 0xA970 is the actor band plus the scenery band — every slot
 * but the player's. Clearing +0 (the occupancy byte) frees every slot at once; the only caller is
 * the life-start routine resetPlayfieldForLifeStart, so this runs once per life, not per frame.
 *
 * Why stamp a number: the +0x0F byte is an IDENTITY other code selects by. When a kill empties the wave's kill countdown (0xA811),
 * countTheKillAndGrantTheSharedToken writes a record's own stamp (plus a top bit) into a shared
 * cell, and the code at 0x2C31 retires an object whose state byte is below 0x0A outright unless that cell's top bit is set and its low seven bits match
 * its stamp. Under MAME the twenty-three stamps read 1 through 23 on every dispatch.
 */

import { ACTOR_RECORD_SLOT0 } from "./names.js";
// Record size and count (`ld de,0x0010`, `ld b,0x17`), the occupancy byte (+0x00) and the stamp
// byte (+0x0F).
const RECORD_BYTES = 16;
const RECORDS = 23;
const STATE = 0;
const NUMBER = 15;

export function freeAndNumberEveryObjectSlot(m) {
  const { mem8 } = m;
  // One pass over the run: free the record (`ld (ix+0x00),0x00`) and stamp its 1-based position
  // (`ld (ix+0x0f),a / inc a`, A starting at 1).
  let record = ACTOR_RECORD_SLOT0;
  for (let i = 0; i < RECORDS; i++) {
    mem8[record + STATE] = 0;
    mem8[record + NUMBER] = i + 1;
    record += RECORD_BYTES;
  }
  // The walk's record cursor ends one record past the run (`add ix,de` after the last record).
  return record;
}
