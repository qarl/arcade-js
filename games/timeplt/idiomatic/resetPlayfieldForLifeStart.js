// SPDX-License-Identifier: GPL-3.0-only
/** resetPlayfieldForLifeStart — reset the whole playfield at a life start: clear the scroll and control cells, seat
 * the ship sprite and shot slots, retire particular object slots in their own ways, free and renumber every slot, clear four sprite
 * entries, seat the era's scenery band, then scatter one era-and-rung-selected ten-byte record from a word
 * table into the spawner and launcher settings cells. LIVE-OUT: memory-only. */

/*
 * ROM 0x19F0-0x1AE3, grounding [seen] (names.js ROUTINES 0x19f0).
 *
 * ROLE. The playfield reset run at every life start: postLifeStartCaptionsAndResetPlayfield (the
 * life-start arm of the sequence machine) calls it after posting the life-start captions. It puts
 * the world, the player's ship and every object slot back to a clean start, and then loads the
 * difficulty settings for the current era and rung.
 *
 * LIVE-OUT: memory only.
 */

import { dressPlayerSpriteForHeading } from "./dressPlayerSpriteForHeading.js";
import { freeAllShotSlots } from "./freeAllShotSlots.js";
import { retireObjectAndHold } from "./retireObjectAndHold.js";
import { retireSlotIntoSharedCooldown } from "./retireSlotIntoSharedCooldown.js";
import { retireSlotIntoCooldown } from "./retireSlotIntoCooldown.js";
import { retireSlotAndSubPixel } from "./retireSlotAndSubPixel.js";
import { freeAndNumberEveryObjectSlot } from "./freeAndNumberEveryObjectSlot.js";
import { seatEraSceneryCodesThenSetAttributesAndRunScenery } from "./seatEraSceneryCodesThenSetAttributesAndRunScenery.js";
import { fetchTableWord } from "./fetchTableWord.js";
import { u8 } from "../../../core/int.js";
import { ATTACKER_SPAWN_AIM_WINDOW_HALF, ATTACKER_SPAWN_COOLDOWN, ATTACKER_SPAWN_COOLDOWN_PERIOD, ATTACKER_SPAWN_SLOT_COUNT, ATTACKER_SPAWN_WINDOW_HALF, BANK_LAUNCH_COOLDOWN, BANK_LAUNCH_COOLDOWN_PERIOD, BANK_LAUNCH_HEADING_HALF_WIDTH, BANK_LAUNCH_NEAR_HALF_WIDTH, BANK_LAUNCH_SLOT_COUNT, ERA_OBJECT_ENTRY_SLOT0, ERA_OBJECT_ENTRY_SLOT2, ERA_OBJECT_RECORD_SLOT0, ERA_OBJECT_RECORD_SLOT2, PARACHUTIST_ENTRY, PARACHUTIST_RECORD, PLAYER_ENTRY, PLAYER_SPRITE_Y, CRAFT_SPAWN_SLOT_COUNT, ROUND_TRANSITION_HOLD, SCRIPT_PICK_THRESHOLD, SHOT_BURST_PENDING, START_RUNG, ERA_INDEX, WORLD_SCROLL_Y, WORLD_SCROLL_X, LIFE_TICKS_MID, LIFE_TICKS_LOW, MOTHER_SHIP_ARMED, PARACHUTIST_RUNG, ERA_RUNG_TIMER, ERA_RUNG_PERIOD, ERA_RUNG, PLAYER_HEADING, PLAYER_STATE, PLAYER_RECORD_SPARE_BYTE, ERA_RUNG_SETTINGS_POINTER_TABLE } from "./names.js";

// The sub-pixel retire loop covers seven records (ROM `ld b,0x07` feeding the djnz at 0x1A6E),
// stepping one 16-byte object record and one two-byte sprite entry at a time.
const SUBPIXEL_SLOTS = 7;
const RECORD_STRIDE = 16;
const ENTRY_STRIDE = 2;

// Eight bytes zeroed relative to ERA_OBJECT_ENTRY_SLOT0 (the ROM's `ld (iy+d),0x00` run at
// 0x1A77-0x1A96 with IY = 0xAA28): four at +0..+6 and four at +0x31..+0x37.
const CLEARED_ENTRY_OFFSETS = [0, 2, 4, 6, 0x31, 0x33, 0x35, 0x37];

export function resetPlayfieldForLifeStart(m) {
  const { mem8, mem16 } = m;

  // World and life counters. Zero both world-scroll words (WORLD_SCROLL_Y 0xA808, WORLD_SCROLL_X
  // 0xA80A) so the world starts unscrolled, and the life's base-sixty work counter (LIFE_TICKS_MID
  // as a word with the high place, LIFE_TICKS_LOW). Clear MOTHER_SHIP_ARMED (0xAD0D) -- it stays up
  // after the mother ship is destroyed until a round or life turns over, and this is one of the
  // places that lower it -- and PARACHUTIST_RUNG (0xA8F7), so this life's first rescue award is paid
  // at the bottom rung.
  mem16[WORLD_SCROLL_Y] = 0;
  mem16[WORLD_SCROLL_X] = 0;
  mem16[LIFE_TICKS_MID] = 0;
  mem8[MOTHER_SHIP_ARMED] = 0;
  mem8[PARACHUTIST_RUNG] = 0;
  mem8[LIFE_TICKS_LOW] = 0;
  // Difficulty rung. Reload the rung timer from its period, and seat this life's rung ERA_RUNG
  // (0xACC0) from START_RUNG (0xAD0A), the active player's opening rung; it climbs from there as the
  // rung timer expires.
  mem8[ERA_RUNG_TIMER] = mem8[ERA_RUNG_PERIOD];
  mem8[ERA_RUNG] = mem8[START_RUNG];
  // No shots owed from a fire press, and no round/mother-ship transition underway.
  mem8[SHOT_BURST_PENDING] = 0;
  mem8[ROUND_TRANSITION_HOLD] = 0;
  // The player's ship: heading 0x80, the byte after the state cell cleared (PLAYER_RECORD_SPARE_BYTE, which no code
  // reads), state 0xFF (the life-start value), and the ship's sprite pinned at (0x84, 0x78) -- the ship stays at
  // that screen spot and the world scrolls past it.
  mem8[PLAYER_HEADING] = 0x80;
  mem8[PLAYER_RECORD_SPARE_BYTE] = 0;
  mem8[PLAYER_STATE] = 0xff;
  mem8[PLAYER_SPRITE_Y] = 0x78;
  mem8[PLAYER_ENTRY] = 0x84;

  // Draw the ship facing its new heading (dressPlayerSpriteForHeading, 0x20AF) and free all six
  // player shot slots (freeAllShotSlots, 0x2755).
  dressPlayerSpriteForHeading(m);
  freeAllShotSlots(m);
  // Retire the era-object bank. Slot 0 and the slot one stride on are taken out of play, and slot
  // 0's delay byte (+0x0E) is armed at 0x80 (retireObjectAndHold, 0x3C0D).
  retireObjectAndHold(m, ERA_OBJECT_RECORD_SLOT0, ERA_OBJECT_ENTRY_SLOT0);

  // Bank slot 2 is retired with its delay byte armed from one shared address
  // (retireSlotIntoSharedCooldown, 0x3DFB). (The ROM first seats IX/IY on the craft band's slot 0 at
  // 0x1A44-0x1A4B and overwrites both at once -- dead stores, not carried here.)
  retireSlotIntoSharedCooldown(m, ERA_OBJECT_RECORD_SLOT2, ERA_OBJECT_ENTRY_SLOT2);

  // The parachutist's slot is retired with its own delay byte armed, so it is held rather than
  // freed (retireSlotIntoCooldown, 0x48AD).
  retireSlotIntoCooldown(m, PARACHUTIST_RECORD, PARACHUTIST_ENTRY);

  // Then seven records from the parachutist's onward -- the ROM's IX/IY are still on it -- are
  // cleared of their occupancy byte, sub-pixel remainders (+3, +5) and sprite coordinates
  // (retireSlotAndSubPixel, 0x2BDE), one 16-byte record / two-byte entry apart.
  let record = PARACHUTIST_RECORD;
  let entry = PARACHUTIST_ENTRY;
  for (let i = 0; i < SUBPIXEL_SLOTS; i++) {
    retireSlotAndSubPixel(m, record, entry);
    record += RECORD_STRIDE;
    entry += ENTRY_STRIDE;
  }

  // Lay out the whole object array afresh: clear every record's occupancy byte and number each
  // record (freeAndNumberEveryObjectSlot, 0x1AE4); then zero the eight sprite-entry bytes listed in
  // CLEARED_ENTRY_OFFSETS.
  const recordCursor = freeAndNumberEveryObjectSlot(m);
  for (const off of CLEARED_ENTRY_OFFSETS) mem8[ERA_OBJECT_ENTRY_SLOT0 + off] = 0;

  // Seat the era's scenery band and run its scenery setup (0x30A5), handing on the two cursors the
  // ROM leaves standing here: the sprite-entry cursor just seated on the era-object bank, and the
  // record cursor the numbering walk ended on. Only the scenery seed's tamper divert reads them.
  seatEraSceneryCodesThenSetAttributesAndRunScenery(m, ERA_OBJECT_ENTRY_SLOT0, recordCursor);

  // Load the difficulty settings for the current era and rung. The settings table at 0x1B04 (ERA_RUNG_SETTINGS_POINTER_TABLE) holds
  // a pointer per (era, rung): the ROM builds the index (era << 4) + rung with four `rlca`,
  // `and 0xf0` and `add a,b` -- an eight-bit sum, hence u8 -- then RST 0x10 (fetchTableWord)
  // doubles it into a table offset and reads the word: the address of this era/rung's settings row.
  const band = (mem8[ERA_INDEX] & 0x0f) << 4; // era in the high nibble, index into the word table
  const src = fetchTableWord(m, u8(mem8[ERA_RUNG] + band), ERA_RUNG_SETTINGS_POINTER_TABLE);

  // Scatter the row, byte by byte, into the cells the spawners and launchers read:
  //   +0 BANK_LAUNCH_SLOT_COUNT     records the bank-launch arm scans (zero disables it)
  //   +1 BANK_LAUNCH_HEADING_HALF_WIDTH  its heading window   +2 BANK_LAUNCH_NEAR_HALF_WIDTH  its proximity window
  //   +3 BANK_LAUNCH_COOLDOWN_PERIOD and the live BANK_LAUNCH_COOLDOWN, both from one byte
  //   +4 CRAFT_SPAWN_SLOT_COUNT          slots a craft spawn pass walks
  //   +5 SCRIPT_PICK_THRESHOLD      random-vs-ordered movement-script choice
  //   +6 ATTACKER_SPAWN_SLOT_COUNT  the era-object slot count (also the bomber shot's seat choice)
  //   +7 ATTACKER_SPAWN_WINDOW_HALF +8 ATTACKER_SPAWN_AIM_WINDOW_HALF -- the era-weapon launch windows
  //      (+7 also gates the era-1 bomber's shot; +8 also seeds the era-4 countdown)
  //   +9 the live ATTACKER_SPAWN_COOLDOWN and its ATTACKER_SPAWN_COOLDOWN_PERIOD, both from one byte
  mem8[BANK_LAUNCH_SLOT_COUNT] = mem8[src];
  mem8[BANK_LAUNCH_HEADING_HALF_WIDTH] = mem8[src + 1];
  mem8[BANK_LAUNCH_NEAR_HALF_WIDTH] = mem8[src + 2];
  mem8[BANK_LAUNCH_COOLDOWN_PERIOD] = mem8[BANK_LAUNCH_COOLDOWN] = mem8[src + 3]; // one source byte into two cells
  mem8[CRAFT_SPAWN_SLOT_COUNT] = mem8[src + 4];
  mem8[SCRIPT_PICK_THRESHOLD] = mem8[src + 5];
  mem8[ATTACKER_SPAWN_SLOT_COUNT] = mem8[src + 6];
  mem8[ATTACKER_SPAWN_WINDOW_HALF] = mem8[src + 7];
  mem8[ATTACKER_SPAWN_AIM_WINDOW_HALF] = mem8[src + 8];
  mem8[ATTACKER_SPAWN_COOLDOWN] = mem8[ATTACKER_SPAWN_COOLDOWN_PERIOD] = mem8[src + 9]; // one source byte into two cells
}
