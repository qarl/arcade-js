// SPDX-License-Identifier: GPL-3.0-only
/** spawnEnemyIntoFreeSlotElseStepSearch — work one object slot in a downward search for a free one. A slot whose head byte is
 * already taken is left untouched and the turn is handed to the tail that steps to the next slot;
 * a free slot is claimed and stocked. Stocking draws a spawn direction from the player's heading jittered by a
 * random amount, reads a starting position (the sprite entry's two coordinate bytes) from two chained
 * tables through it, and seeds the record and
 * its paired entry with facing and a flight script started from its top. LIVE-OUT: memory. Every register the
 * body touches is dead-after-return scratch — the table walk holds its cursor and index in JS
 * locals, every arm hands on to a callee that reseats what it needs, and the four callers each
 * tail-return this result and read no register back, so nothing survives. The two cursors and the
 * count of turns still owed ride in as arguments and are handed on to the tail with the slot taken.
 * At most one slot is filled per search.
 *
 * ROM 0x37D6-0x382C. Grounding: [seen] (names.js ROUTINES 0x37d6).
 *
 * ROLE IN THE MACHINE. This is how ordinary enemy craft enter play one by one: under MAME it
 * fills the enemy-craft band (records from 0xA850) one slot at a time. The search is a loop made
 * of two routines -- this one and closeOneTurnOfTheFreeSlotSearch, which steps both cursors back
 * one slot, counts a turn off and comes back here -- entered from spawnEnemyCraftWhenBandUnderTwo,
 * gateTheFreeSlotSearchAndPickItsRun and loc_3793. Once a slot is filled the search ends, since
 * this arm returns instead of handing on to the tail.
 *
 * The record layout used here (mechanisms.md, "The record, byte by byte"): +0 head/life state,
 * +1 aim heading, +2 current heading, +3/+5 coordinate fractions, +9 flight-script position,
 * +0x0A flight-script selector, +0x0E the slot's personal timer. The sprite entry holds the two
 * native-axis coordinate bytes at +0x00 and +0x31.
 */

import { closeOneTurnOfTheFreeSlotSearch } from "./closeOneTurnOfTheFreeSlotSearch.js";
import { drawRandomByte } from "./drawRandomByte.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { pickScriptAtRandomOrInTurn } from "./pickScriptAtRandomOrInTurn.js";
import { stepCraftFlightScript } from "./stepCraftFlightScript.js";
import { u8, u16 } from "../../../core/int.js";
import { PLAYER_HEADING, ENEMY_SPAWN_DIRECTION_INDEX_TABLE, ENEMY_SPAWN_RECORD_TABLE, SPAWN_CLEARED_SPARE_BYTE } from "./names.js";

// 64 spawn directions (0-63).
const DIRECTION_MASK = 0x3f;
// Random jitter: the low nibble of a draw, minus 8, gives -8 .. +7 directions.
const JITTER_MASK = 0x0f;
const JITTER_BIAS = 0x08;
// ENEMY_SPAWN_RECORD_TABLE entries are four bytes each.
const RECORD_STRIDE = 4;
// Half of the 256-step circle: the new craft faces opposite the player's heading.
const FACING_BIAS = 0x80;

export function spawnEnemyIntoFreeSlotElseStepSearch(m, record = m.regs.ix, entry = m.regs.iy, count = m.regs.b) {
  const { mem8 } = m;

  // Step 1 -- a slot whose head byte is non-zero is in use: hand the turn to the search tail
  // (ROM `jp nz,0x3847`), which moves to the next slot down. A zero head is claimed at once by
  // decrementing it to 0xFF, the live code.
  if (mem8[record + 0x00] !== 0) return closeOneTurnOfTheFreeSlotSearch(m, record, entry, count);
  mem8[record + 0x00] = 0xff; // claim the slot for this turn

  // Step 2 -- a spawn direction: the player's heading PLAYER_HEADING 0xA802 [seen] cut from 256
  // steps to 64 (the ROM's two `rrca` and `and 0x3f`), jittered by a signed random amount from
  // drawRandomByte, and wrapped back into 0-63.
  const base = mem8[PLAYER_HEADING] >> 2;
  const jitter = (drawRandomByte(m) & JITTER_MASK) - JITTER_BIAS;
  const spawnDirection = (base + jitter) & DIRECTION_MASK;

  // Step 3 -- two chained tables. ENEMY_SPAWN_DIRECTION_INDEX_TABLE (ROM 0x39FB) turns the
  // direction into a record number, times four for ENEMY_SPAWN_RECORD_TABLE (ROM 0x3A3B). That
  // record's byte 0 goes to the entry's +0x31 coordinate and byte 1 to its +0x00 coordinate.
  const recordOffset = u8(fetchTableByte(m, ENEMY_SPAWN_DIRECTION_INDEX_TABLE, spawnDirection) * RECORD_STRIDE);
  const recordAddress = u16(ENEMY_SPAWN_RECORD_TABLE + recordOffset);
  mem8[entry + 0x31] = fetchTableByte(m, ENEMY_SPAWN_RECORD_TABLE, recordOffset);
  mem8[entry + 0x00] = mem8[u16(recordAddress + 1)];

  // Step 4 -- the craft's aim heading (+1) and current heading (+2) both start half a turn from
  // the player's heading.
  const facing = u8(mem8[PLAYER_HEADING] + FACING_BIAS);
  mem8[record + 0x01] = facing;
  mem8[record + 0x02] = facing;

  // Step 5 -- the flight-script selector (+0x0A) from pickScriptAtRandomOrInTurn; zero the work
  // cell SPAWN_CLEARED_SPARE_BYTE (0xACC5, which no code reads) and both coordinate fractions;
  // start the script position at 0x20 (32), take one script step, and clear the personal timer.
  mem8[record + 0x0a] = pickScriptAtRandomOrInTurn(m);
  mem8[SPAWN_CLEARED_SPARE_BYTE] = 0x00;
  mem8[record + 0x03] = 0x00;
  mem8[record + 0x05] = 0x00;
  mem8[record + 0x09] = 0x20;
  stepCraftFlightScript(m, record);
  mem8[record + 0x0e] = 0x00;
}
