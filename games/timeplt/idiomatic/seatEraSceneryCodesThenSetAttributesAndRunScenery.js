// SPDX-License-Identifier: GPL-3.0-only
/** seatEraSceneryCodesThenSetAttributesAndRunScenery — seat one era-keyed object band, then hand the frame's scenery on. A fixed run is
 * summed against a constant as a tamper tripwire whose answer is dropped, eight bytes of the row the
 * era indexes are copied into a stride-two cell run, and control transfers into the scenery attribute set +
 * run: at era four with the attribute byte 0x28, otherwise 0xCC. The era and the entry cursor ride into the
 * chain as arguments; the cursor is the era-object entry its one caller has just cleared through (the
 * original leaves it standing in IY), and the chain writes through it only if the scenery guard fails.
 * LIVE-OUT: memory (the seated band and whatever the scenery chain leaves); control leaves through the
 * tail and does not come back here. */

/*
 * ROM 0x30A5-0x30D0 (then into 0x30D1 / 0x3156), grounding [seen] (names.js ROUTINES 0x30a5).
 *
 * ROLE. Part of the playfield reset at every life start: its one caller, resetPlayfieldForLifeStart
 * (0x19F0), calls it once the object slots are retired. It gives the eight scenery sprites the shape
 * codes of the current era and then runs the era's scenery setup.
 *
 * PARAMETERS. `entryCursor` is the sprite-entry pointer the caller leaves behind (IY in the ROM,
 * defaulting to ERA_OBJECT_ENTRY_SLOT0, 0xAA28, where the caller last pointed it); `recordCursor` is
 * the record pointer the caller leaves behind (IX; resetPlayfieldForLifeStart's numbering walk ends
 * it one record past the object run). Both are only passed on to the scenery chain, where only the
 * seed step's tamper divert reads them.
 */

import { sumByteRunAndCompareToExpected } from "./sumByteRunAndCompareToExpected.js";
import { offsetAddress } from "./offsetAddress.js";
import { setFinalEraSceneryAttributesThenRunEraScenery } from "./setFinalEraSceneryAttributesThenRunEraScenery.js";
import { setSceneryAttributesThenRunEraScenery } from "./setSceneryAttributesThenRunEraScenery.js";
import { u8, u16 } from "../../../core/int.js";
import { SCENERY_SPRITE_CODE_SLOT0, ERA_INDEX, COPYRIGHT_CAPTION_RECORD, ERA_OBJECT_ENTRY_SLOT0, ERA_SCENERY_ROW_TABLE } from "./names.js";

// The tamper sum: sixteen bytes (`ld b,0x10`) compared against 0x22 (`ld c,0x22`).
const CHECK_LEN = 0x10;
const CHECK_EXPECTED = 0x22;
// Each era's row in the 0x3176 table is eight bytes, one shape code per scenery sprite.
const ROW_STRIDE = 8;
// The scenery sprite entries are two bytes apart, so the codes land in every other cell.
const SEAT_STRIDE = 2;
const SEAT_COUNT = 8;
// The era (ERA_INDEX value) that takes the other attribute byte.
const ERA_FOUR = 0x04;
const FILL_BYTE = 0xcc;

export function seatEraSceneryCodesThenSetAttributesAndRunScenery(m, entryCursor = ERA_OBJECT_ENTRY_SLOT0, recordCursor = m.regs.ix) {
  const { mem8 } = m;

  // Anti-tamper tripwire. The ROM sums the first 16 bytes of the copyright caption record at 0x086B
  // (COPYRIGHT_CAPTION_RECORD, [seen]) with sumByteRunAndCompareToExpected (0x0B4C) and compares the
  // total with 0x22; the answer is left in the flags and nothing here tests it, so on any image the
  // routine carries on. It is kept because it is part of what the ROM does.
  sumByteRunAndCompareToExpected(m, COPYRIGHT_CAPTION_RECORD, CHECK_LEN, CHECK_EXPECTED); // tamper checksum; its answer is discarded here

  // Seat the era's scenery shape codes. The row is at 0x3176 + 8*era: the ROM forms 8*era with three
  // `add a,a` (an eight-bit value, hence u8) and adds it to the table base with RST 0x18
  // (offsetAddress). Its eight bytes go to SCENERY_SPRITE_CODE_SLOT0 (0xAA31, [seen]) and every
  // second byte after it -- the code/shape byte of each of the eight scenery sprite entries.
  const era = mem8[ERA_INDEX];
  let src = offsetAddress(m, ERA_SCENERY_ROW_TABLE, u8(era * ROW_STRIDE)); // row table + 8*era
  let dst = SCENERY_SPRITE_CODE_SLOT0;
  for (let n = SEAT_COUNT; n !== 0; n--) {
    mem8[dst] = mem8[src];
    src = u16(src + 1);
    dst = u16(dst + SEAT_STRIDE);
  }

  // Hand on to the scenery attribute set + run (0x30D1), which sets the eight scenery attribute bytes (stride two from 0xAA60)
  // to that byte and then sets up the era's scenery by era. Era 4 enters via
  // setFinalEraSceneryAttributesThenRunEraScenery (0x3156), whose only job is to choose 0x28; every
  // other era falls into 0x30D1 with 0xCC. Both are ROM jumps, so control does not come back here.
  // attribute byte 0x28 at era four, else 0xCC
  if (era === ERA_FOUR) return setFinalEraSceneryAttributesThenRunEraScenery(m, era, entryCursor, recordCursor);
  return setSceneryAttributesThenRunEraScenery(m, FILL_BYTE, era, entryCursor, recordCursor);
}
