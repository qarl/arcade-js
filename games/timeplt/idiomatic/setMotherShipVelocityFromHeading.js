// SPDX-License-Identifier: GPL-3.0-only
/**
 * setMotherShipVelocityFromHeading — ROM 0x46BA [seen]
 *
 * WHAT IT IS. Gives the Mother-Ship the velocity its current heading calls for, at the speed the
 * current era sets. loc_43f0 calls it with the Mother-Ship's record (under MAME every
 * dispatch had IX = 0xA8A0, MOTHER_SHIP_STATE; names.js).
 *
 * ROLE IN THE MACHINE. Speed is chosen by era and nothing else. The ROM pushes the address of the
 * block at 0x46CE as a return slot, masks ERA_INDEX (0xAD04) to three bits and dispatches through
 * the arm table right after `rst 0x30` at 0x46C4. Each of the five defined arms is a bare
 * `ld hl,<table>` into the shared sampler at 0x596E (velocityForHeading [seen]), so each arm here
 * is simply the table it names: 0x59D7, 0x5E00, 0x5E00, 0x2E3E, 0x08FA for eras 0-4 -- rungs of a
 * ladder of scaled copies of one waveform, i.e. speeds. The sampler reads the record's heading
 * (+0x02) and returns two perpendicular components: the word at the heading and the word a quarter
 * turn (0x40) behind it. The arm's `ret` then lands on 0x46CE (fileTwoPairsIntoObjectRecordHighByteFirst
 * [seen]), which files them into the record at +0x0C/+0x0D and +0x1C/+0x1D, high byte first, where
 * the Mother-Ship's motion reads them.
 *
 * The mask admits eight indices where the table defines five, so an index past the end reads the
 * first bytes of that block as though they were an entry: two of those words name no routine, and
 * the last names the six-digit painter with its cursor inside ROM. No writer of ERA_INDEX stores
 * anything above 4 (mechanisms.md), so these arms are not taken; they stop with NotImplemented. The
 * object's record is an argument (the ROM's IX). LIVE-OUT: memory.
 */

import { NotImplemented } from "../../../boards/timeplt/io.js";
import { ERA_INDEX, OPENING_ERA_VELOCITY_TABLE, VELOCITY_TABLE_08FA, SECOND_FASTEST_VELOCITY_TABLE, SLOWEST_VELOCITY_TABLE } from "./names.js";
import { fileTwoPairsIntoObjectRecordHighByteFirst } from "./fileTwoPairsIntoObjectRecordHighByteFirst.js";
import { velocityForHeading } from "./velocityForHeading.js";

// `and 0x07` at 0x46C1: three bits of the era index select the arm.
const ARM_MASK = 0x07;
// Record offset of the object's heading byte, the sampler's index into the velocity table.
const HEADING = 2;

// The five defined arms in index order, each as the velocity table it samples.
const ARM_TABLES = [
  SLOWEST_VELOCITY_TABLE,
  OPENING_ERA_VELOCITY_TABLE,
  OPENING_ERA_VELOCITY_TABLE,
  SECOND_FASTEST_VELOCITY_TABLE,
  VELOCITY_TABLE_08FA,
];

export function setMotherShipVelocityFromHeading(m, record = m.regs.ix) {
  // Step 1 -- choose the arm from the era (`ld a,(0xad04)` / `and 0x07`).
  const arm = m.mem8[ERA_INDEX] & ARM_MASK;

  // Step 2 -- a defined arm: sample its table at the heading, then file the two words into the record,
  // each split into its high and low byte (the ROM's D/E and B/C) in the order the filing block
  // expects. The filing is the return slot the ROM pushed, so its return is this routine's.
  if (arm < ARM_TABLES.length) {
    const [alongFirstAxis, alongSecondAxis] = velocityForHeading(m, ARM_TABLES[arm], m.mem8[record + HEADING]);
    return fileTwoPairsIntoObjectRecordHighByteFirst(
      m, record, alongFirstAxis >> 8, alongFirstAxis & 0xff, alongSecondAxis >> 8, alongSecondAxis & 0xff,
    );
  }

  // Indices 5-7 read the filing block's own bytes as arm words: 5 and 6 name no routine, and 7 names
  // the six-digit painter with its cursor inside ROM. A genuine era never selects them.
  throw new NotImplemented(`setMotherShipVelocityFromHeading: era arm ${arm} lies past the arm table`);
}
