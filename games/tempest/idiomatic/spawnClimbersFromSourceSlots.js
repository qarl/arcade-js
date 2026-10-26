// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  SPAWN_TIMER_RELOAD, FLYER_SLOT_TOP, PLAYER_FINE_ANGLE, ENEMY_SLOT_FLAGS, ENEMY_SLOT_DIR, ENEMY_TIMER, loc_2b5, ENEMY_SEGMENT,
  loc_2c8, ENEMY_PHASE, loc_2db, ENEMY_DEPTH, POKEY1_RANDOM, ACTIVE_ENEMY_COUNT, SPAWN_RATE_TABLE,
} from "./names.js";
import { gateSound8f } from "./gateSound8f.js";

/**
 * spawnClimbersFromSourceSlots — hatch flyers from armed source enemies each frame. ROM 0xa2a6.
 *
 * Role in the machine: some Tempest enemies act as sources that periodically emit a second enemy
 * (a flyer/pulsar hatching off a deep climber). Once a frame this walks the seven source slots and,
 * for each one that is armed and deep enough, ages its emit timer; when the timer underflows and a
 * random roll clears the per-wave difficulty gate, it copies the source enemy's depth/segment/phase
 * into a fresh flyer destination slot, reloads the source's timer, cues the hatch sound, and counts
 * the new enemy.
 *
 * Behavior: the whole pass is suppressed while PLAYER_FINE_ANGLE (loc_201) bit7 is set (player not
 * in a spawnable state). For each source slot x = 6..0 it skips the slot unless it is occupied
 * (ENEMY_DEPTH,x nonzero), sits at depth >= 0x30 down the tube, and is armed (ENEMY_SLOT_DIR,x bit6
 * set). It decrements the emit timer ENEMY_TIMER,x and stores it back; unless that decrement
 * underflowed (bit7 set) it moves on, and when it did underflow it first restores the timer by one
 * (so the underflow tick isn't lost). It then skips a slot flagged done (ENEMY_SLOT_FLAGS,x bit7),
 * and rolls POKEY1_RANDOM against the per-wave gate SPAWN_RATE_TABLE[ACTIVE_ENEMY_COUNT] — a roll
 * below the gate blocks the hatch, so denser waves emit less often. Passing all gates, it scans the
 * flyer destination table from FLYER_SLOT_TOP down for the first empty entry (loc_2db,y == 0) and
 * seeds that entry: depth into loc_2db, segment into loc_2b5, phase into loc_2c8; reloads the source
 * timer ENEMY_TIMER,x from SPAWN_TIMER_RELOAD (loc_119); fires gateSound8f; bumps ACTIVE_ENEMY_COUNT
 * (loc_a6); and ends the destination scan.
 *
 * Live-out: new flyer entries in loc_2db/loc_2b5/loc_2c8, decremented/reloaded ENEMY_TIMER on the
 * source slots, and the bumped ACTIVE_ENEMY_COUNT.
 *
 * x and y are the X/Y the ROM enters with. Returns the exit [X, Y] the ROM leaves. When suppressed it touches
 * neither, so it returns them unchanged. Otherwise X = 0xff (the slot walk runs X past 0), and Y is the last
 * value the walk loaded into it: ACTIVE_ENEMY_COUNT, which indexes the spawn-rate table for the RNG gate, or
 * 0xff once a free-entry scan ran (it runs Y past 0); the incoming y when no slot reached the gate.
 * Grounding: [seen].
 */
export function spawnClimbersFromSourceSlots(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;
  if (mem8[PLAYER_FINE_ANGLE] & 0x80) return [x, y]; // suppressed while loc_201 bit7 set
  for (x = 6; x >= 0; x--) {
    if (mem8[u16(ENEMY_DEPTH + x)] === 0) continue;     // slot empty
    if (mem8[u16(ENEMY_DEPTH + x)] < 0x30) continue;    // not yet deep enough to hatch
    if ((mem8[u16(ENEMY_SLOT_DIR + x)] & 0x40) === 0) continue; // not an armed source
    const dec = u8(mem8[u16(ENEMY_TIMER + x)] - 1);
    mem8[u16(ENEMY_TIMER + x)] = dec;
    if ((dec & 0x80) === 0) continue; // fires only when the timer underflows
    mem8[u16(ENEMY_TIMER + x)] = u8(dec + 1); // restore it
    if (mem8[u16(ENEMY_SLOT_FLAGS + x)] & 0x80) continue; // slot flagged done
    // Per-wave difficulty gate: a low RNG roll blocks the hatch, thinning spawns as waves fill up.
    y = mem8[ACTIVE_ENEMY_COUNT]; // the ROM indexes the spawn-rate table through Y
    if (mem8[POKEY1_RANDOM] < mem8[u16(SPAWN_RATE_TABLE + y)]) continue;
    y = mem8[FLYER_SLOT_TOP]; // scan the flyer destination table for a free entry
    while (true) {
      if (mem8[u16(loc_2db + y)] === 0) {
        mem8[u16(loc_2db + y)] = mem8[u16(ENEMY_DEPTH + x)];   // copy depth
        mem8[u16(loc_2b5 + y)] = mem8[u16(ENEMY_SEGMENT + x)]; // copy segment
        mem8[u16(loc_2c8 + y)] = mem8[u16(ENEMY_PHASE + x)];   // copy phase
        mem8[u16(ENEMY_TIMER + x)] = mem8[SPAWN_TIMER_RELOAD]; // reload source timer
        gateSound8f(m, x, y);                                  // cue the hatch sound
        mem8[ACTIVE_ENEMY_COUNT] = u8(mem8[ACTIVE_ENEMY_COUNT] + 1); // one more active enemy
        y = 0; // spawned -> end the free-slot scan
      }
      y = u8(y - 1);
      if (y & 0x80) break;
    }
  }
  return [0xff, y];
}
