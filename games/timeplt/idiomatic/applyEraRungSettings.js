// SPDX-License-Identifier: GPL-3.0-only
/**
 * applyEraRungSettings — ROM 0x1A9A [seen]
 *
 * WHAT IT IS. The difficulty loader. Time Pilot's play is shaped by the era (ERA_INDEX 0xAD04, the
 * manual's ROUND, 0-4) and by an escalation rung inside that era (ERA_RUNG 0xACC0) that climbs as the
 * round goes on. Each (era, rung) pair owns a ten-byte tuning row in ROM; this routine copies the
 * selected row into the work-RAM cells the spawners and launchers read.
 *
 * ROLE. Load a ten-byte row and scatter it over twelve fixed cells: two slot counts (bank launch
 * and attacker spawn), four half-width windows, two cooldown periods and their live countdowns, the
 * craft spawn slot count and the script-pick threshold (names.js). Eight
 * bytes go to one cell each and two go to two cells each -- a cooldown PERIOD and the live
 * COUNTDOWN that the vblank service runs down and other code reloads from that period -- so applying a row also
 * restarts both countdowns at the new period. It is reached from the life-start routine (0x19F0, by
 * fall-through) as well as from the escalation timer, so round start applies the row too.
 * Under MAME, as the rung climbed, each destination took a monotone ladder of values.
 *
 * LIVE-OUT: memory; nothing read back or returned.
 */

import { u8, u16 } from "../../../core/int.js";
import { ATTACKER_SPAWN_AIM_WINDOW_HALF, ATTACKER_SPAWN_COOLDOWN, ATTACKER_SPAWN_COOLDOWN_PERIOD, ATTACKER_SPAWN_SLOT_COUNT, ATTACKER_SPAWN_WINDOW_HALF, BANK_LAUNCH_COOLDOWN, BANK_LAUNCH_COOLDOWN_PERIOD, BANK_LAUNCH_HEADING_HALF_WIDTH, BANK_LAUNCH_NEAR_HALF_WIDTH, BANK_LAUNCH_SLOT_COUNT, ERA_INDEX, ERA_RUNG, CRAFT_SPAWN_SLOT_COUNT, SCRIPT_PICK_THRESHOLD, ERA_RUNG_SETTINGS_POINTER_TABLE } from "./names.js";
import { fetchTableWord } from "./fetchTableWord.js";

// Sixteen rungs per era: the era is the high nibble of the row index, the rung the low nibble.
const ROWS_PER_ERA = 16;

/** Where each byte of a row lands, in the order the row supplies them. */
// (ROM 0x1AAC-0x1AE3: bytes 0-2 -> 0xA844, 0xA837, 0xA827; byte 3 -> 0xA817 and 0xA814;
// bytes 4-8 -> 0xACC1, 0xACC4, 0xA8C6, 0xA8D6, 0xA8E6; byte 9 -> 0xA8F4 and 0xA8F6.)
const DESTINATIONS = [
  [BANK_LAUNCH_SLOT_COUNT], [BANK_LAUNCH_HEADING_HALF_WIDTH], [BANK_LAUNCH_NEAR_HALF_WIDTH], [BANK_LAUNCH_COOLDOWN, BANK_LAUNCH_COOLDOWN_PERIOD], [CRAFT_SPAWN_SLOT_COUNT],
  [SCRIPT_PICK_THRESHOLD], [ATTACKER_SPAWN_SLOT_COUNT], [ATTACKER_SPAWN_WINDOW_HALF], [ATTACKER_SPAWN_AIM_WINDOW_HALF], [ATTACKER_SPAWN_COOLDOWN, ATTACKER_SPAWN_COOLDOWN_PERIOD],
];

export function applyEraRungSettings(m) {
  const { mem8 } = m;
  // Build the row index (era << 4) + rung -- the ROM swaps the era's nibbles with four rlca and
  // masks 0xF0 -- and look it up in ERA_RUNG_SETTINGS_POINTER_TABLE (0x1B04). That table holds row
  // ADDRESSES, not rows, so fetchTableWord (rst 0x10) returns a pointer to the ten-byte row.
  let source = fetchTableWord(m, u8(ROWS_PER_ERA * (mem8[ERA_INDEX] % ROWS_PER_ERA) + mem8[ERA_RUNG]), ERA_RUNG_SETTINGS_POINTER_TABLE);
  // Copy the row out byte by byte, in row order; a paired destination receives the same byte
  // twice (the period and its live countdown).
  for (const cells of DESTINATIONS) {
    const value = mem8[source];
    for (const cell of cells) mem8[cell] = value;
    source = u16(source + 1);
  }
}
