// SPDX-License-Identifier: GPL-3.0-only
/** spawnAimedEnemyIntoEraBankWhenInWindow — spawn one aimed enemy, but only when the spawn slot is free, the cooldown at
 * ATTACKER_SPAWN_COOLDOWN is clear, the era count is live, and some object in the caller's two-slot bank passes
 * the doubled-window test (step 2 below). Draws a heading toward the player at ENEMY_STANDOFF_AIM_MAIN, alternates the aim's
 * side each spawn via ATTACKER_SPAWN_AIM_SIDE_TOGGLE, then seats coords, the doubled velocity pair, a shape code and an
 * attribute byte into the era's fixed record+sprite bank and reloads the cooldown. LIVE-OUT: memory. The routine is a
 * pure writer — its sole caller (advanceTwoTileObjectThenTryAimedSpawn) tail-returns and reads no register it
 * leaves, and that whole dispatch chain up to serviceEra1BomberObject is memory-only — so the search pointers,
 * the window bound and the loop count all live here as JS locals. The aimed heading passes into the velocity
 * shim as an argument, and the shim hands the doubled pair back, which this routine reads straight into the record.
 *
 * ROM 0x3D25-0x3DD9. Grounding: [seen] (names.js ROUTINES 0x3d25).
 *
 * ROLE IN THE MACHINE. An era object (reached from serviceEra1BomberObject's chain) uses this to
 * launch an attacker: a new object placed where one of the caller's two objects sits and sent off
 * on a heading aimed near the player. How often this can happen is governed by the era's
 * difficulty settings: ATTACKER_SPAWN_SLOT_COUNT 0xA8C6 [seen] (how many attacker slots the era
 * fields; zero disables the arm), ATTACKER_SPAWN_WINDOW_HALF 0xA8D6 [seen] (the half-width of the
 * window test), and the shared cooldown ATTACKER_SPAWN_COOLDOWN 0xA8F4 [seen], which is reloaded
 * from ATTACKER_SPAWN_COOLDOWN_PERIOD 0xA8F6 [seen] after every spawn.
 *
 * TWO DESTINATION BANKS. The new attacker goes into one of two fixed record + sprite-entry seats:
 * "bank A" = ACTOR_RECORD_SLOT3 0xA840 / ACTOR_ENTRY_SLOT3 0xAA18 [seen], or "bank B" =
 * ERA_OBJECT_RECORD_SLOT2 0xA8E0 / ERA_OBJECT_ENTRY_SLOT2 0xAA2C [seen]. Bank B is used when the
 * era's slot count is not 1 and bank B's head byte is 0 (free); otherwise bank A, which must itself
 * be free (head 0) or nothing spawns.
 */

import { u8, u16 } from "../../../core/int.js";
import { requestEnemyLaunchSound } from "./requestEnemyLaunchSound.js";
import { headingToward } from "./headingToward.js";
import { loc_59c5 } from "./loc_59c5.js";
import { ACTOR_ENTRY_SLOT3, ACTOR_RECORD_SLOT3, ATTACKER_SPAWN_AIM_SIDE_TOGGLE, ATTACKER_SPAWN_COOLDOWN, ATTACKER_SPAWN_COOLDOWN_PERIOD, ATTACKER_SPAWN_SLOT_COUNT, ATTACKER_SPAWN_WINDOW_HALF, ENEMY_STANDOFF_AIM_MAIN, ERA_OBJECT_ENTRY_SLOT2, ERA_OBJECT_RECORD_SLOT2 } from "./names.js";


// The caller's record head must read 0xFF for the routine to go on (ROM `inc a / ret nz` at 0x3D28).
const SLOT_FREE = 0xff;
// The caller's bank: two objects, records sixteen bytes apart, sprite entries two bytes apart.
const SEARCH_SLOTS = 2;
const RECORD_STRIDE = 0x10;
const ENTRY_STRIDE = 2;
// A sprite entry's two native-axis coordinate bytes sit at +0x00 and +0x31.
const ENTRY_X = 0x00;
const ENTRY_Y = 0x31;
// 0x84 / 0x78 are the player's own pinned sprite coordinates, the reference point of the window test.
const X_ORIGIN = 0x84;
const Y_ORIGIN = 0x78;
// The aim is turned 0x18 steps (of a 256-step circle) off the heading, to one side or the other.
const TURN = 0x18;

// Fixed bytes seated into the new attacker's sprite entry (+0x01 and +0x30).
const NEW_SCRIPT = 0x4d;
const NEW_SHAPE = 0x62;

// era count != 1 with bank B's head byte clear selects the second bank; the guard and the seat both ask.
const useSecondBank = (m) => m.mem8[ATTACKER_SPAWN_SLOT_COUNT] !== 1 && m.mem8[ERA_OBJECT_RECORD_SLOT2] === 0;

export function spawnAimedEnemyIntoEraBankWhenInWindow(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;

  // Step 1 -- the gates, each an early return in the ROM: the caller's head byte, the shared
  // cooldown still running, the era fielding no attackers, and (when bank A would be the seat)
  // bank A already occupied.
  if (mem8[record] !== SLOT_FREE) return;
  if (mem8[ATTACKER_SPAWN_COOLDOWN] !== 0) return;
  if (mem8[ATTACKER_SPAWN_SLOT_COUNT] === 0) return;
  if (!useSecondBank(m) && mem8[ACTOR_RECORD_SLOT3] !== 0) return;

  // scan the caller's two-slot bank for an object inside the doubled window; the record pointer walks
  // in lockstep with the entry pointer but its landing slot is discarded — the seat below is fixed.
  // Step 2 -- the window test, per axis: take the player's coordinate minus the object's, add the
  // half-width, and compare against twice the half-width, all in wrapping 8-bit arithmetic. The
  // ROM's `jp nc,0x3d6f` takes the spawn path when the biased difference is at or past the full
  // width on EITHER axis -- that is, when the object's offset from the player's spot on that axis
  // falls outside -half .. half-1. The first object that does so is the one used.
  const half = mem8[ATTACKER_SPAWN_WINDOW_HALF];
  const full = u8(2 * half);
  let count = SEARCH_SLOTS;
  let hit = false;
  do {
    const x = u8(u8(X_ORIGIN - mem8[u16(entry + ENTRY_X)]) + half);
    const y = u8(u8(Y_ORIGIN - mem8[u16(entry + ENTRY_Y)]) + half);
    if (x >= full || y >= full) { hit = true; break; }
    record = u16(record + RECORD_STRIDE);
    entry = u16(entry + ENTRY_STRIDE);
    count = u8(count - 1);
  } while (count !== 0);
  // Neither object qualified: nothing is spawned and nothing is written.
  if (!hit) return;

  // Step 3 -- the launch sound (program byte 0x07A2, queued only while a game is being played),
  // then the aim. headingToward gives the heading from the found object to the aim point at
  // ENEMY_STANDOFF_AIM_MAIN 0xAC7F [seen]. The side toggle is stepped every spawn and its low bit
  // picks +0x18 (odd) or -0x18 (even), so successive attackers are aimed to alternate sides.
  requestEnemyLaunchSound(m);
  const heading = headingToward(m, ENEMY_STANDOFF_AIM_MAIN, entry);
  mem8[ATTACKER_SPAWN_AIM_SIDE_TOGGLE] = u8(mem8[ATTACKER_SPAWN_AIM_SIDE_TOGGLE] + 1);
  const turn = mem8[ATTACKER_SPAWN_AIM_SIDE_TOGGLE] & 1 ? TURN : u8(-TURN);
  const aimed = u8(turn + heading);

  // Step 4 -- choose the destination bank (the same test as the gate in step 1, asked again).
  const foundY = mem8[u16(entry + ENTRY_Y)];
  const foundX = mem8[u16(entry + ENTRY_X)];
  let recBank, entBank;
  if (useSecondBank(m)) {
    recBank = ERA_OBJECT_RECORD_SLOT2;
    entBank = ERA_OBJECT_ENTRY_SLOT2;
  } else {
    recBank = ACTOR_RECORD_SLOT3;
    entBank = ACTOR_ENTRY_SLOT3;
  }

  // Step 5 -- stock the new attacker. It starts at the found object's coordinates. Its velocity
  // is the doubled component pair for the aimed heading, stored little-endian as two words at
  // record +0x0A..+0x0D -- the stored velocity a separate mover later reads to move the object.
  mem8[entBank + ENTRY_Y] = foundY;
  mem8[entBank + ENTRY_X] = foundX;
  const [alongFirstAxis, alongSecondAxis] = loc_59c5(m, aimed); // doubled velocity pair for the aimed heading
  mem8[recBank + 0x0a] = alongFirstAxis;
  mem8[recBank + 0x0b] = u8(alongFirstAxis >> 8);
  mem8[recBank + 0x0c] = alongSecondAxis;
  mem8[recBank + 0x0d] = u8(alongSecondAxis >> 8);
  mem8[entBank + 0x01] = NEW_SCRIPT;
  mem8[entBank + 0x30] = NEW_SHAPE;
  // The head byte was 0 (free) to get here, so the decrement makes it 0xFF: live.
  mem8[recBank] = u8(mem8[recBank] - 1);
  // Step 6 -- restart the shared cooldown so no attacker spawns again until it runs out.
  mem8[ATTACKER_SPAWN_COOLDOWN] = mem8[ATTACKER_SPAWN_COOLDOWN_PERIOD];
}
