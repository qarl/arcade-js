// SPDX-License-Identifier: GPL-3.0-only
/**
 * driveEnemyWaveForLifePhase — the enemy-wave step of the round engine.
 *
 * ROM 0x36AF. Grounding: [seen] (names.js ROUTINES 0x36af).
 *
 * WHAT IT IS. Enemy craft arrive in waves. How they arrive depends on the era and on how long the
 * current life has lasted: the life-tick counter (LIFE_TICKS_LOW 0xAD05 / LIFE_TICKS_MID 0xAD06, the
 * low and middle places of a base-sixty counter stepped once per round-engine dispatch) is split into
 * "phases" by the low nibble of its middle place, and each phase runs a different spawner -- except in
 * the last era (ERA_INDEX 0xAD04 reading 4), where the whole step goes to spawnEnemyWaveIntoFreeSlots instead. At phase
 * nine and up (a units digit, so it recurs every ten wraps of the low place) this routine builds a fresh wave itself, inline,
 * on the one pass of the phase whose low place (LIFE_TICKS_LOW) reads zero: it fills free slots of
 * the seven-slot enemy-craft band (records from CRAFT_RECORD_SLOT0 0xA850, sprite entries from
 * CRAFT_ENTRY_SLOT0 0xAA1A) with craft seated at points on the screen's edge. A ROM wave descriptor
 * picks each point from a table of edge positions, offset by the direction the player is flying,
 * and each craft is headed opposite the player's own heading.
 *
 * ROLE IN THE MACHINE. Called once per dispatch of the round engine's service list
 * (serviceRoundThenResolvePlayerState). Nothing happens while ROUND_TRANSITION_HOLD (0xACC6) is
 * nonzero -- during the Mother-Ship's destruction and the round hand-over no new waves come.
 *
 * LIVE-OUT: memory.
 */

import { u8, u16 } from "../../../core/int.js";
import { drawRandomByte } from "./drawRandomByte.js";
import { offsetAddress } from "./offsetAddress.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { pickScriptAtRandomOrInTurn } from "./pickScriptAtRandomOrInTurn.js";
import { stepCraftFlightScript } from "./stepCraftFlightScript.js";
import { spawnEnemyWaveIntoFreeSlots } from "./spawnEnemyWaveIntoFreeSlots.js";
import { turnFiveCraftAway } from "./turnFiveCraftAway.js";
import { gateTheFreeSlotSearchAndPickItsRun } from "./gateTheFreeSlotSearchAndPickItsRun.js";
import { spawnEnemyCraftWhenBandUnderTwo } from "./spawnEnemyCraftWhenBandUnderTwo.js";
import { requestEnemyWaveSound } from "./requestEnemyWaveSound.js";
import { CRAFT_ENTRY_SLOT0, CRAFT_RECORD_SLOT0, ERA_INDEX, KILLS_REMAINING, LIFE_TICKS_LOW, LIFE_TICKS_MID, PLAYER_HEADING, ROUND_CRAFT_COUNT, ROUND_TRANSITION_HOLD, WAVE_CLAIM_TIMER, WAVE_DESCRIPTOR_INDEX, WAVE_KILL_COUNTDOWN, WAVE_HEADING_BIAS_TABLE, WAVE_EDGE_POSITION_TABLE, WAVE_DESCRIPTOR_TABLE, WAVE_SPAWN_BUSY_FLAG } from "./names.js";

// Era 4 (2001) has its own spawner.
const BOSS_ERA = 4;
// Slots walked (and the "full wave" threshold) once the kill quota is spent.
const DEFAULT_COUNT = 5;
// One object record is sixteen bytes.
const RECORD_STRIDE = 16;
// Value seeded into each new craft's record +0x09 flight-script position.
const PRIMED_TIMER = 0x20;
// Half a circle: the craft is aimed opposite the player's heading, i.e. back at the player.
const AIM_OFFSET = 0x80;
// Preload for WAVE_CLAIM_TIMER whenever a wave spawns.
const READY_STATUS = 0xe4;

export function driveEnemyWaveForLifePhase(m) {
  const { mem8 } = m;
  // No wave work during a round / Mother-Ship transition; era 4 always uses its dedicated spawner.
  if (mem8[ROUND_TRANSITION_HOLD] !== 0) return;
  if (mem8[ERA_INDEX] === BOSS_ERA) return spawnEnemyWaveIntoFreeSlots(m);

  // Pick the life phase from the low nibble of the middle life-tick place, and hand the early
  // phases to their spawners: 0-6 the free-slot search, 7 turns five craft away, 8 spawns
  // craft while fewer than two of the band are busy. Each is given the low life-tick cell to gate on.
  const phase = mem8[LIFE_TICKS_MID] & 0x0f;
  // the phase tails all read the low life-tick byte
  if (phase === 7) return turnFiveCraftAway(m, LIFE_TICKS_LOW);
  if (phase < 7) return gateTheFreeSlotSearchAndPickItsRun(m, LIFE_TICKS_LOW);
  if (phase < 9) return spawnEnemyCraftWhenBandUnderTwo(m, LIFE_TICKS_LOW);
  // Phase nine and up: build a wave inline, but only on the tick where the low place is zero --
  // once per wrap of the low place, not every frame.
  if (mem8[LIFE_TICKS_LOW] !== 0) return;

  // Choose the wave descriptor: 2 * era + one random bit, so each era has two wave patterns.
  // WAVE_SPAWN_BUSY_FLAG (0xACC2) reads 0xFF for the whole build.
  const parityBit = drawRandomByte(m) & 1;
  mem8[WAVE_SPAWN_BUSY_FLAG] = 0xff;
  mem8[WAVE_DESCRIPTOR_INDEX] = u8(2 * mem8[ERA_INDEX] + parityBit);

  // Bias the spawn points by the player's heading: round the heading to one of sixteen directions
  // ((heading + 8) >> 4) and look up a per-direction offset into the edge-position table in the ROM
  // table at 0x38D9.
  const headingIndex = u8(mem8[PLAYER_HEADING] + 8) >> 4;
  const bias = mem8[offsetAddress(m, WAVE_HEADING_BIAS_TABLE, headingIndex)];

  // Point at the descriptor row in the ROM table at 0x397B: sixteen bytes per row, two per slot.
  let descriptor = offsetAddress(m, WAVE_DESCRIPTOR_TABLE, u8(16 * mem8[WAVE_DESCRIPTOR_INDEX])); // two-byte entries, one consumed per filled slot

  // How many slots to walk: the round's craft quota (ROUND_CRAFT_COUNT 0xACC1) while kills remain
  // before the Mother-Ship, else five. WAVE_KILL_COUNTDOWN (0xA811) is zeroed and used as the
  // filled-slot tally during the build.
  const count = mem8[KILLS_REMAINING] !== 0 ? mem8[ROUND_CRAFT_COUNT] : DEFAULT_COUNT;
  mem8[WAVE_KILL_COUNTDOWN] = 0;
  let record = CRAFT_RECORD_SLOT0;
  let entry = CRAFT_ENTRY_SLOT0;

  let remaining = count;
  do {
    // Only an empty slot (record head 0) gets a new craft.
    if (mem8[record] === 0) {
      // Position: 2 * (descriptor byte + heading bias) indexes the two-byte table at 0x38E9, whose
      // pairs trace the edge of the screen. The first byte goes to the sprite entry's +0x31 byte (Y),
      // the second to its +0x00 byte (X), so the pair is a spawn position on the edge, not a shape.
      const positionIndex = u8(2 * (mem8[descriptor] + bias));
      const positionEntry = u16(WAVE_EDGE_POSITION_TABLE + positionIndex);
      mem8[entry + 0x31] = fetchTableByte(m, WAVE_EDGE_POSITION_TABLE, positionIndex);
      mem8[entry] = mem8[positionEntry + 1];

      // Heading: opposite the player's, written to both heading bytes of the record (+0x01, +0x02).
      const aimed = u8(mem8[PLAYER_HEADING] + AIM_OFFSET);
      mem8[record + 0x01] = aimed;
      mem8[record + 0x02] = aimed;

      // Record +0x0A takes a script pick (random or in turn) plus nine; +0x0E the descriptor's second
      // byte. Then move on to the next slot's descriptor pair.
      mem8[record + 0x0a] = u8(pickScriptAtRandomOrInTurn(m) + 9);
      mem8[record + 0x0e] = mem8[descriptor + 1];
      descriptor = u16(descriptor + 2);

      // Clear +0x03 and +0x05, prime the +0x09 script position, and step the flight script once so
      // the craft starts with an order from its script.
      mem8[record + 0x03] = 0;
      mem8[record + 0x05] = 0;
      mem8[record + 0x09] = PRIMED_TIMER;
      stepCraftFlightScript(m, record);

      // Mark the slot held (0xFE) while its +0x0E delay is non-zero, live (0xFF) when it is clear -- and tally it.
      mem8[record] = mem8[record + 0x0e] === 0 ? 0xff : 0xfe; // held until its delay runs out; live at once when there is none
      mem8[WAVE_KILL_COUNTDOWN] = u8(mem8[WAVE_KILL_COUNTDOWN] + 1);
    }
    // Next slot: record +16, sprite entry +2.
    record = u16(record + RECORD_STRIDE);
    entry = u16(entry + 2);
    remaining = u8(remaining - 1);
  } while (remaining !== 0);

  // Build finished: drop the busy flag and preload the wave's claim window.
  mem8[WAVE_SPAWN_BUSY_FLAG] = 0;
  mem8[WAVE_CLAIM_TIMER] = READY_STATUS;
  // Five or more filled: the tally stands as the wave's kill countdown, and the wave sound is
  // requested. Otherwise the countdown becomes the round's craft quota, and the sound is still
  // requested when the fill reached that quota.
  const filled = mem8[WAVE_KILL_COUNTDOWN];
  if (filled >= DEFAULT_COUNT) return requestEnemyWaveSound(m);
  const owed = mem8[ROUND_CRAFT_COUNT];
  mem8[WAVE_KILL_COUNTDOWN] = owed;
  if (filled >= owed) return requestEnemyWaveSound(m);
}
