// SPDX-License-Identifier: GPL-3.0-only
/** setSceneryAttributesThenRunEraScenery — set the attribute (colour and flip) byte of eight scenery sprite entries, stride two, to the byte the caller hands in A,
 * then branch on the era and two runtime guards. Below era four one path seats and runs the whole
 * frame's scenery; at era four and up, when the guard pair reads its expected values a second packed
 * table fills eight entry cells before the scenery runs; a guard that reads wrong transfers into a
 * data table and faults. LIVE-OUT: memory. The attribute loop's stride and its spent count are handed to
 * the seed step below era four, because its guard-fail divert stores the one and counts down the
 * other (the original leaves them in E and B); every other register the body touches is scratch.
 *
 * ROM 0x30D1-0x3113 (frozen lift translated/loc_30d1.js). Grounding: [seen] in names.js.
 *
 * Role in the machine: part of setting up the scenery (the backdrop objects that scroll past the
 * ship — clouds in the sky eras, asteroids in space, per gameplay.md) for the era being entered. Its caller, seatEraSceneryCodesThenSetAttributesAndRunScenery
 * (0x30A5), has just copied the era's row from the 0x3176 table and tails in here with the era in C
 * and the attribute byte in A (0x28 at era four, else 0xCC).
 *
 * The guard pair is an anti-tamper check: TAMPER_GLYPH_KONAMI (0xACC7) holds a glyph sampled from the
 * "(c) KONAMI 1982" caption, and the byte after it its companion. A genuine image reads 0x3B and
 * then 0x05 or 0x10; anything else sends the machine through loc_315b into 0x3176, a data table
 * executed as code, which is how the ROM derails a tampered copy.
 *
 * Parameters: `fillByte` (A) and `era` (C) come from the caller as above; `entryCursor` (IY) and
 * `recordCursor` (IX) are passed on unchanged to the below-era-four seed step. */

import { u16 } from "../../../core/int.js";
import { seedSceneryEntriesThenRunScenery } from "./seedSceneryEntriesThenRunScenery.js";
import { loc_315b } from "./loc_315b.js";
import { runSceneryForEra } from "./runSceneryForEra.js";
import { SCENERY_ENTRY_SLOT0, SCENERY_SPRITE_ATTRIBUTE_SLOT0, TAMPER_GLYPH_KONAMI, ERA4_SCENERY_SEED_TABLE } from "./names.js";

// The attribute loop: eight attribute cells, every second byte, starting at 0xAA60 (`ld b,0x08` / `ld de,0x0002`).
const CLEAR_COUNT = 8;
const CLEAR_STRIDE = 2;
// `cp 0x04` on the era: eras 0-3 take the seed path at 0x3117.
const ERA_FLOOR = 0x04;
// The guard values a genuine image holds: 0x3B at 0xACC7, then 0x05 or 0x10 at 0xACC8.
const GUARD_OK = 0x3b;
const SUBGUARD_A = 0x05;
const SUBGUARD_B = 0x10;
// The era-four seed: eight two-byte records from 0x315E.
const SEAT_COUNT = 8;
const SEAT_SHADOW = 0x31; // byte0 of each packed pair lands at the entry cell +0x31
const CLEAR_SPENT = 0; // the attribute loop runs its count down to nothing

export function setSceneryAttributesThenRunEraScenery(m, fillByte = m.regs.a, era = m.regs.c, entryCursor = m.regs.iy, recordCursor = m.regs.ix) {
  const { mem8 } = m;

  /* Step 1 (0x30D1-0x30DC): set eight attribute bytes, stride two, to the caller's byte. They start at
   * SCENERY_SPRITE_ATTRIBUTE_SLOT0 (0xAA60), the scenery sprite entries' attribute (colour + flip)
   * band, so all eight attribute bytes take the caller's byte. */
  // set eight scenery attribute bytes, stride two, to the caller's byte
  let clearAddr = SCENERY_SPRITE_ATTRIBUTE_SLOT0;
  for (let n = CLEAR_COUNT; n !== 0; n--) {
    mem8[clearAddr] = fillByte;
    clearAddr = u16(clearAddr + CLEAR_STRIDE);
  }

  /* Step 2 (0x30DE-0x30E2): eras 0-3 go on to seedSceneryEntriesThenRunScenery (0x3117, a tail
   * jump), which seats four objects from its own packed table and runs the scenery. The stride and
   * spent count are handed over so its own guard-fail divert sees what the ROM leaves in E and B. */
  if (era < ERA_FLOOR) return seedSceneryEntriesThenRunScenery(m, era, entryCursor, CLEAR_STRIDE, CLEAR_SPENT, recordCursor);

  /* Step 3 (0x30E3-0x30F7): era four checks the tamper guard pair first; a wrong value tails into
   * loc_315b and never returns here. */
  let guardAddr = TAMPER_GLYPH_KONAMI;
  if (mem8[guardAddr] !== GUARD_OK) return loc_315b(m);
  guardAddr = u16(guardAddr + 1);
  const sub = mem8[guardAddr];
  if (sub !== SUBGUARD_A && sub !== SUBGUARD_B) return loc_315b(m);

  /* Step 4 (0x30F8-0x3110): seed eight scenery entries from ERA4_SCENERY_SEED_TABLE (0x315E), inline
   * data right after loc_315b's jump. Each two-byte record gives the entry's +0x31 byte (its Y, in
   * the entry layout) and then its +0x00 byte (its X); entries are two bytes apart from
   * SCENERY_ENTRY_SLOT0 (0xAA30). */
  // era-four seed: eight packed pairs fill each entry's Y (+0x31) and then its X (+0x00)
  let src = ERA4_SCENERY_SEED_TABLE;
  let entry = SCENERY_ENTRY_SLOT0;
  for (let n = SEAT_COUNT; n !== 0; n--) {
    mem8[u16(entry + SEAT_SHADOW)] = mem8[src];
    src = u16(src + 1);
    mem8[entry] = mem8[src];
    src = u16(src + 1);
    entry = u16(entry + 2);
  }

  /* Step 5 (0x3111): run the era's scenery (runSceneryForEra, 0x2CBC, a tail jump). */
  return runSceneryForEra(m);
}
