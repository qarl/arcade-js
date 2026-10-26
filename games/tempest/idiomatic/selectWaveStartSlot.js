// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { bcdSubByte } from "../../../core/bcd.js";
import {
  GAME_MODE, MODE_DISPATCH_SEL, MODE_DELAY_TIMER, STATUS_FLAGS, DSW1_SNAPSHOT, loc_29, loc_3d, LEVEL_ID, PLAYER_LEVEL_TBL, SLOT_COUNTDOWN,
  INPUT_EDGE_FLAGS, RIM_ROT_OFFSET, DEPTH_LO, SEG_SPREAD_A_LO_3, SEG_SPREAD_A_LO_4, loc_9f,
  loc_102, TUBE_GEOM_FLAG, WAVE_PEAK_SEED, DEPTH_CEILING, DSW_DIFFICULTY, PLAYER_SEGMENT, PASS_COUNTER, loc_71d, POKEY1_RANDOM, SLOT_THRESHOLD_TABLE,
} from "./names.js";
import { swapParallelTables } from "./swapParallelTables.js";
import { clearByte50 } from "./clearByte50.js";
import { reseedStateTables } from "./reseedStateTables.js";
import { seedPerLaneSpikeArray } from "./seedPerLaneSpikeArray.js";
import { unpackLevelNibbleTables } from "./unpackLevelNibbleTables.js";
import { requestLevelIntroSound } from "./requestLevelIntroSound.js";
import { nudgeBlasterRimPosition } from "./nudgeBlasterRimPosition.js";
import { clearReadyLatchPair } from "./clearReadyLatchPair.js";

/**
 * selectWaveStartSlot — choose how deep in the tube a wave starts, then reseed the wave. ROM 0x90c4.
 *
 * Role in the machine: at the top of each wave the game decides how far down the tube the enemies begin
 * (the start slot / depth ceiling). Harder settings and higher wave numbers push that start deeper. This
 * routine scans the slot-threshold table against a seed to find the natural start slot, clamps it up
 * against a difficulty/wave-derived floor, publishes both the floor and the start index, and then tail-
 * falls through the two wave-reseed bodies below to build the working set for the new wave.
 *
 * Behavior: read the wave seed WAVE_PEAK_SEED (loc_126) and scan the threshold table SLOT_THRESHOLD_TABLE
 * (0x91fe) downward from index 28, stopping at the highest slot whose threshold is <= the seed. Then
 * derive a floor: base 4, and if the difficulty dip (DSW_DIFFICULTY bit 2) is set, bump it once at wave
 * (loc_71d) >= 48, again at >= 80, again at >= 112; a specific cabinet-config combination
 * (DSW1_SNAPSHOT & 0x43 == 64) overrides the floor to 27. Publish the floor into loc_29, clamp the start
 * index up to at least the floor, and store it as DEPTH_CEILING (loc_127). On the sign flag
 * (STATUS_FLAGS bit 7) clear the seed. Tail-delegate into reseedWaveWorkingSet.
 *
 * Live-out: loc_29 (floor), DEPTH_CEILING/loc_127 (start slot), WAVE_PEAK_SEED (cleared on sign), plus
 * everything the reseed chain writes. The ROM holds the floor in Y and the start index in X, and enters
 * reseedWaveWorkingSet with them; returns its exit [X, Y].
 *
 * Grounding: [seen]
 */
export function selectWaveStartSlot(m) {
  const { mem8 } = m;

  // Scan the threshold table downward from 28 for the highest slot at or below the seed.
  const seed = mem8[WAVE_PEAK_SEED];
  let idx = 28;
  do { idx = u8(idx - 1); } while (seed < mem8[u16(SLOT_THRESHOLD_TABLE + idx)]);

  // Derive the depth floor: harder difficulty ratchets it deeper as the wave number climbs.
  let floor = 4;
  if ((mem8[DSW_DIFFICULTY] & 0x04) !== 0) {
    const wave = mem8[loc_71d];
    if (wave >= 48) floor++;
    if (wave >= 80) floor++;
    if (wave >= 112) floor++;
  }
  // Cabinet-config override forces a deep start.
  if ((mem8[DSW1_SNAPSHOT] & 0x43) === 64) floor = 27;

  // Publish the floor, clamp the start slot up to it, publish the ceiling.
  mem8[loc_29] = floor;
  if (idx < floor) idx = floor;
  mem8[DEPTH_CEILING] = idx;

  // On the sign flag, retire the seed so it does not carry into the next wave.
  if ((mem8[STATUS_FLAGS] & 0x80) !== 0) mem8[WAVE_PEAK_SEED] = 0;
  return reseedWaveWorkingSet(m, floor, idx);
}

/**
 * reseedWaveWorkingSet — reseed the per-wave working set (a mid-entry into the wave build). ROM 0x9108.
 *
 * Role in the machine: this is the middle stage of the wave build, entered both by falling through from
 * selectWaveStartSlot and as its own ROM entry. It resets the cells that describe the current wave's
 * geometry and pacing to their fresh-wave values, and when the sign flag marks a real level intro it
 * primes the extra intro state and arms the intro delay.
 *
 * Behavior: latch the active seat loc_3d from LEVEL_ID (loc_3f); when that seat is non-zero, swap the
 * parallel slot tables (swapParallelTables) so the layout matches the level. Seed the fixed wave cells:
 * SEG_SPREAD_A_LO_4=4, DEPTH_LO=0xff, PLAYER_SEGMENT=0, RIM_ROT_OFFSET=0, SEG_SPREAD_A_LO_3=0,
 * PASS_COUNTER=0. On the sign flag (STATUS_FLAGS bit 7) this is a level intro: set PASS_COUNTER=20,
 * TUBE_GEOM_FLAG=0xff, GAME_MODE=22, MODE_DISPATCH_SEL=8, loc_9f=0, unpack the level nibble tables, and
 * arm the intro delay count to 0x10. Store the (possibly 0) count into MODE_DELAY_TIMER, clear byte 0x50,
 * and fall through into tickWaveSpawnCadence.
 *
 * Live-out: loc_3d, SEG_SPREAD_A_LO_3/4, DEPTH_LO, PLAYER_SEGMENT, RIM_ROT_OFFSET, PASS_COUNTER,
 * MODE_DELAY_TIMER, and on intro TUBE_GEOM_FLAG/GAME_MODE/MODE_DISPATCH_SEL/loc_9f plus the unpacked
 * tables; byte 0x50 cleared.
 *
 * y and x are the Y and X the ROM enters with. The ROM loads X from LEVEL_ID and then from STATUS_FLAGS, and
 * the table swap and the intro unpack each leave X and Y of their own; tickWaveSpawnCadence is entered with
 * the X/Y that sequence leaves, and its exit [X, Y] is returned.
 *
 * Grounding: [seen]
 */
export function reseedWaveWorkingSet(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;

  // Latch the active seat; a non-zero seat means swap in that level's parallel tables.
  const seat = mem8[LEVEL_ID];
  mem8[loc_3d] = seat;
  x = seat;
  if (seat !== 0) [x, y] = swapParallelTables(m);

  // Fresh-wave geometry/pacing defaults.
  mem8[SEG_SPREAD_A_LO_4] = 4;
  mem8[DEPTH_LO] = 0xff;
  mem8[PLAYER_SEGMENT] = 0;
  mem8[RIM_ROT_OFFSET] = 0;
  mem8[SEG_SPREAD_A_LO_3] = 0;
  mem8[PASS_COUNTER] = 0;

  // Sign flag set => a real level intro: prime the intro state and arm the intro delay.
  let count = 0;
  x = mem8[STATUS_FLAGS]; // the ROM tests the sign flag through X
  if ((x & 0x80) !== 0) {
    mem8[PASS_COUNTER] = 20;
    mem8[TUBE_GEOM_FLAG] = 0xff;
    mem8[GAME_MODE] = 22;
    mem8[MODE_DISPATCH_SEL] = 8;
    mem8[loc_9f] = 0;
    [x, y] = unpackLevelNibbleTables(m);
    count = 0x10;
  }
  mem8[MODE_DELAY_TIMER] = count;

  clearByte50(m);
  return tickWaveSpawnCadence(m, y, x);
}

/**
 * tickWaveSpawnCadence — advance the wave's spawn cadence one frame and, when it fires, release the next
 * enemy slot (a mid-entry into the wave build). ROM 0x9149.
 *
 * Role in the machine: this is the per-frame heartbeat of enemy spawning. It runs down a frame counter;
 * each time the counter underflows it decimal-counts the intro/spawn phase and reloads. When the phase
 * gate opens it commits one entry into the level's slot tables and runs the spawn/emit chain that puts a
 * new enemy on the tube, then nudges the blaster's rim position and trims the edge-flag cell.
 *
 * Behavior: decrement PASS_COUNTER (loc_605). On underflow (bit7 set): BCD-subtract 1 from the phase
 * MODE_DELAY_TIMER (loc_4), storing the new phase; if that subtraction itself underflowed set an
 * INPUT_EDGE_FLAGS bit (0x10); when the phase reaches 3 request the level-intro sound; reload
 * PASS_COUNTER to 20. Always nudge the rim position. Then choose an edge mask (0x18 when the phase >= 8,
 * else 0x78) and, if any masked edge flag is set, fire a spawn: clear INPUT_EDGE_FLAGS, record the player
 * segment into loc_102+seat, and pick the table entry from SLOT_THRESHOLD_TABLE by segment; but off the
 * sign flag (STATUS_FLAGS bit7 clear) instead mark SLOT_COUNTDOWN=1 and take a random 0..7 from
 * POKEY1_RANDOM. Store the entry into PLAYER_LEVEL_TBL+seat (byte-wrapped) and loc_9f, then run the spawn
 * chain (unpackLevelNibbleTables, reseedStateTables, seedPerLaneSpikeArray, clearReadyLatchPair), set
 * GAME_MODE=2, and clear byte 0x50. Finally trim INPUT_EDGE_FLAGS to its low 3 bits.
 *
 * Live-out: PASS_COUNTER, MODE_DELAY_TIMER, INPUT_EDGE_FLAGS, and on a spawn loc_102+seat,
 * PLAYER_LEVEL_TBL+seat, loc_9f, SLOT_COUNTDOWN, GAME_MODE plus all the spawn-chain tables.
 *
 * The intro sound's loader stashes the X/Y it is called with (loc_31/loc_32), so it is handed the ROM's:
 * y and x are the Y and X this routine is entered with (as a frame handler, X is the GAME_MODE byte the
 * dispatcher loaded to select it), and nothing here changes either before the cue. Entered by falling
 * through from reseedWaveWorkingSet the cue cannot fire: that path has just set PASS_COUNTER to 0 or 20, so
 * the phase step either does not run or lands on 0x99, never 3. Returns the exit [X, Y] the ROM leaves:
 * after a spawn, X = 0xff (seedPerLaneSpikeArray's) and Y = reseedStateTables' exit Y; otherwise the
 * incoming x and Y = MODE_DELAY_TIMER, which the ROM loads into Y for the edge-mask test.
 *
 * Grounding: [seen]
 */
export function tickWaveSpawnCadence(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;

  // Run down the frame counter; underflow drives one phase step.
  const ticked = u8(mem8[PASS_COUNTER] - 1);
  mem8[PASS_COUNTER] = ticked;
  if ((ticked & 0x80) !== 0) {
    // Decimal-count the phase down and reload the frame counter.
    const prev = mem8[MODE_DELAY_TIMER];
    const phase = bcdSubByte(prev, 1).value;
    mem8[MODE_DELAY_TIMER] = phase;
    if ((u8(prev - 1) & 0x80) !== 0) mem8[INPUT_EDGE_FLAGS] = 0x10; // phase itself underflowed
    if (phase === 3) requestLevelIntroSound(m, x, y); // cue the intro sound at phase 3
    mem8[PASS_COUNTER] = 20;
  }

  nudgeBlasterRimPosition(m);

  // Phase-dependent edge mask decides whether this frame commits a spawn.
  const mask = mem8[MODE_DELAY_TIMER] >= 8 ? 0x18 : 0x78;
  if ((mask & mem8[INPUT_EDGE_FLAGS]) !== 0) {
    mem8[INPUT_EDGE_FLAGS] = 0;
    // Record the player segment against the active seat.
    const value = mem8[PLAYER_SEGMENT];
    const slot = mem8[loc_3d];
    mem8[u16(loc_102 + slot)] = value;
    // Table entry by segment; off the sign flag take a random slot instead.
    let entry = mem8[u16(SLOT_THRESHOLD_TABLE + value)];
    if ((mem8[STATUS_FLAGS] & 0x80) === 0) {
      mem8[SLOT_COUNTDOWN] = 1;
      entry = mem8[POKEY1_RANDOM] & 0x07;
    }
    mem8[(PLAYER_LEVEL_TBL + slot) & 0xff] = entry;
    mem8[loc_9f] = entry;
    // Build the new enemy: unpack tables, reseed state, seed spikes, clear the ready latch.
    unpackLevelNibbleTables(m);
    [, y] = reseedStateTables(m);
    x = seedPerLaneSpikeArray(m);
    clearReadyLatchPair(m);
    mem8[GAME_MODE] = 2;
    clearByte50(m);
  } else {
    y = mem8[MODE_DELAY_TIMER]; // the ROM loads the phase into Y for the edge-mask test
  }

  // Keep only the low 3 edge bits for the next frame.
  mem8[INPUT_EDGE_FLAGS] = mem8[INPUT_EDGE_FLAGS] & 0x07;
  return [x, y];
}
