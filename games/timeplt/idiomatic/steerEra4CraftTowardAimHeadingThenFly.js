// SPDX-License-Identifier: GPL-3.0-only
/** steerEra4CraftTowardAimHeadingThenFly — steer one live slot toward its aim heading, then fly it a step. When the slot's probe
 * cell sits within a fixed window of either reference point, the turn runs with the shared rate index
 * forced to zero and then reseated to four; otherwise it runs at the standing index. The step then
 * alternates a double- and a single-velocity mover on bit 1 of the frame tick. LIVE-OUT: memory.
 *
 * ROM 0x29F7-0x2A2A. names.js tag: [seen].
 *
 * Role in the machine: the live (0xFF) arm of serviceEra4EnemyCraftSlot, the fifth era's (ERA_INDEX 4) entry in
 * the per-era slot-handler table at 0x2914. Every round-engine pass each live enemy craft in that era comes
 * through here once: its heading is turned one notch toward the heading it aims at
 * (steerTowardAimHeading), and it is then moved one step along that heading.
 *
 * The "shared rate index" is ERA_INDEX (0xAD04) itself. steerTowardAimHeading takes its turn step
 * from a five-entry per-era table (TURN_RATE_BY_ERA_TABLE, 0x2C1D) keyed on that cell, so writing 0
 * to it for the length of one turn borrows the first era's turn rate. This routine only runs in the
 * fifth era (ERA_INDEX 4), which is why the ROM puts back the constant 4 rather than a saved value.
 *
 * Inputs: `entry` is the slot's sprite entry and `record` its object record, both seated by the slot sweep
 * that dispatched here. */

import { steerTowardAimHeading } from "./steerTowardAimHeading.js";
import { loc_58aa } from "./loc_58aa.js";
import { flyAtSecondFastestSpeed } from "./flyAtSecondFastestSpeed.js";
import { ERA_INDEX, FRAME_TICK } from "./names.js";
import { u8 } from "../../../core/int.js";

// Offset of the probe byte in the sprite entry: iy+0x31, the entry's sprite Y (the same +0x31 that
// names.js records as the sprite Y for the entries it names).
const PROBE = 49;
// The window test the ROM runs: `ld a,ref / sub (iy+0x31) / add a,0x48 / cp 0x90 / jr c`. Adding
// 0x48 (72) and comparing against 0x90 (144) folds "ref - probe lies in -72..71" into a single
// unsigned compare, wrapping at 256 like the 8-bit coordinate itself.
const HALF_WINDOW = 72;
const WINDOW = 144;
// The two reference points, 0x78 and 0x84 -- the pair of coordinates the player's own sprite entry is
// pinned at (resetPlayfieldForLifeStart, per hasReachedRetireLine's names.js entry). The ROM tests
// 0x78 first (0x29F7) and 0x84 second (0x2A02); either hit takes the same arm.
const REFERENCES = [120, 132];
// ERA_INDEX while the borrowed-rate turn runs (`xor a / ld (0xad04),a` at 0x2A1C)...
const RATE_INDEX_WHILE_TURNING = 0;
// ...and the value put back afterwards (`ld a,0x04 / ld (0xad04),a` at 0x2A23).
const RATE_INDEX_RESEATED = 4;

const withinWindow = (probe) =>
  REFERENCES.some((ref) => u8(ref - probe + HALF_WINDOW) < WINDOW);

export function steerEra4CraftTowardAimHeadingThenFly(m, entry = m.regs.iy, record = m.regs.ix) {
  const { mem8 } = m;
  // Step 1 -- turn. Inside the window of either reference point the turn runs at the first era's
  // rate (ERA_INDEX forced to 0 around the call to 0x2BEF, then reseated to 4); outside it the turn
  // runs at the fifth era's (ERA_INDEX 4) own rate. Only the rate differs: the same steering routine turns the
  // heading toward the aim heading either way.
  if (withinWindow(mem8[entry + PROBE])) {
    mem8[ERA_INDEX] = RATE_INDEX_WHILE_TURNING;
    steerTowardAimHeading(m, record);
    mem8[ERA_INDEX] = RATE_INDEX_RESEATED;
  } else {
    steerTowardAimHeading(m, record);
  }
  // Step 2 -- fly. `ld a,(0xa980) / rrca / and 0x01` isolates bit 1 of FRAME_TICK, so the choice
  // flips every two frames. Bit clear: tail to 0x58AA, the double-velocity mover on the 0x59D7
  // velocity table. Bit set: tail to 0x5860 (flyAtSecondFastestSpeed), a single step on the 0x2E3E
  // table. Alternating keeps the craft from sitting on one speed rung. Both are tail transfers, so
  // whatever the mover leaves is this routine's result.
  return ((mem8[FRAME_TICK] >> 1) & 1) === 0 ? loc_58aa(m, record, entry) : flyAtSecondFastestSpeed(m, record, entry);
}
