// SPDX-License-Identifier: GPL-3.0-only
/** spawnEnemyWaveIntoFreeSlots — spawn a wave across a fixed bank of object slots. A count is read (the configured
 * wave size, or five while MOTHER_SHIP_ARMED is set, i.e. a large boss craft is present); the bank is then walked that many times and every
 * free slot is filled from a randomly-picked spawn record of ENEMY_SPAWN_RECORD_TABLE — its first two
 * bytes seat the sprite entry's two coordinates (a starting position) and its third both heading
 * bytes of the record — while an ordinal within the pass picks the slot's flight script, the
 * script position is primed, the script is stepped once, and the slot head is marked live. WAVE_CLAIM_TIMER
 * (0xA812) is preloaded to 0xE4 when the pass ends. LIVE-OUT: memory.
 *
 * ROM 0x386E-0x38D1. Grounding: [seen] (names.js ROUTINES 0x386e).
 *
 * ROLE IN THE MACHINE. This is the final era's (2001) wave spawner: driveEnemyWaveForLifePhase
 * sends era 4 here instead of to the free-slot search the other eras use. It fills the seven-slot
 * enemy-craft band -- records from CRAFT_RECORD_SLOT0 0xA850 [seen] at a sixteen-byte stride,
 * sprite entries from CRAFT_ENTRY_SLOT0 0xAA1A [seen] at a two-byte stride. While the Mother-Ship
 * is armed (MOTHER_SHIP_ARMED 0xAD0D [seen]) the walk is shortened to five slots, since the two
 * slots at MOTHER_SHIP_STATE are taken.
 *
 * Unlike the other wave fill, every craft here goes live at once with its personal timer (+0x0E)
 * at zero and no hold, and its coordinate fractions (+3/+5) are left as they were. mechanisms.md
 * draws the consequence: none of these craft carries the top bit that the kill-counting guard
 * needs, so as far as the code shows, era 4 has no formation bonus.
 */

import { drawRandomByte } from "./drawRandomByte.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { stepCraftFlightScript } from "./stepCraftFlightScript.js";
import { u8, u16 } from "../../../core/int.js";
import { CRAFT_ENTRY_SLOT0, CRAFT_RECORD_SLOT0, MOTHER_SHIP_ARMED, CRAFT_SPAWN_SLOT_COUNT, WAVE_CLAIM_TIMER, ENEMY_SPAWN_RECORD_TABLE, WAVE_RUN_SELECTOR_TABLE } from "./names.js";

// One record per sixteen bytes; five slots while the Mother-Ship holds the other two.
const SLOT_STRIDE = 0x10;
const DEFAULT_COUNT = 5;
// Loaded into WAVE_CLAIM_TIMER 0xA812 [seen] when the pass ends.
const CLAIM_WINDOW_FRAMES = 0xe4;

export function spawnEnemyWaveIntoFreeSlots(m) {
  const { mem8 } = m;
  // Step 1 -- how many slots to walk: the craft spawn slot count CRAFT_SPAWN_SLOT_COUNT 0xACC1 [seen],
  // or five while the Mother-Ship is armed.
  const configuredCount = mem8[CRAFT_SPAWN_SLOT_COUNT];
  const count = mem8[MOTHER_SHIP_ARMED] === 0 ? configuredCount : DEFAULT_COUNT;

  // Step 2 -- walk the band from its first slot, record and sprite entry in lockstep.
  let slot = CRAFT_RECORD_SLOT0;
  let entry = CRAFT_ENTRY_SLOT0;
  // A count of zero walks 256 slots, not none: the loop steps then wraps at 8 bits.
  let remaining = count;
  do {
    // A head byte of zero means the slot is free; a busy slot is skipped untouched.
    if (mem8[slot] === 0) {
      // Step 3 -- a random multiple of four picks one four-byte record of ENEMY_SPAWN_RECORD_TABLE
      // (ROM 0x3A3B). Byte 0 goes to the entry's +0x31 coordinate, byte 1 to its +0x00
      // coordinate, and byte 2 to both the aim heading (+1) and the current heading (+2).
      const pick = drawRandomByte(m) & 0xfc;
      const firstCoordinate = fetchTableByte(m, ENEMY_SPAWN_RECORD_TABLE, pick);
      const record = u16(ENEMY_SPAWN_RECORD_TABLE + pick);
      mem8[entry + 0x31] = firstCoordinate;
      mem8[entry] = mem8[record + 1];
      const startHeading = mem8[record + 2];
      mem8[slot + 0x01] = startHeading;
      mem8[slot + 0x02] = startHeading;

      // Step 4 -- the flight-script selector (+0x0A) comes from WAVE_RUN_SELECTOR_TABLE (ROM
      // 0x38D2) at this slot's ordinal, computed as the slot count minus the slots still to walk (the
      // ROM re-reads 0xACC1 here, so it uses that count even on a five-slot walk). The script
      // position (+9) starts at 0x20 (32).
      mem8[slot + 0x0a] = fetchTableByte(m, WAVE_RUN_SELECTOR_TABLE, u8(configuredCount - remaining));
      mem8[slot + 0x09] = 0x20;

      // Step 5 -- take one flight-script step, set +4 to 1 (the byte animateSelectedShapeCycle reads to pick this craft's four-shape block), clear
      // the personal timer, and turn the head from 0 to 0xFF: live immediately.
      stepCraftFlightScript(m, slot);
      mem8[slot + 0x04] = 0x01;
      mem8[slot + 0x0e] = 0x00;
      mem8[slot] = mem8[slot] - 1;
    }
    slot = u16(slot + SLOT_STRIDE);
    entry = u16(entry + 2);
    remaining = u8(remaining - 1);
  } while (remaining !== 0);

  // Step 6 -- arm the wave-claim window with its fixed starting value.
  mem8[WAVE_CLAIM_TIMER] = CLAIM_WINDOW_FRAMES;
}
