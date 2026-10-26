// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { loc_29, SLOT_LOOP_INDEX, SPIKE_TABLE_GUARD, loc_3fe } from "./names.js";

/**
 * stepSpikeTableCollapse — collapse the descending-spike height table one step. ROM 0xa7d2.
 *
 * Role in the machine: Tempest's Spikers crawl up a lane leaving a spike behind them; a separate
 * descending-spike object animates those spikes shrinking back down. loc_3fe is the 8-entry table of
 * per-lane spike heights and SPIKE_TABLE_GUARD ($0115) is that object's arm/guard flag. This routine
 * advances the whole table one frame toward flat: tall spikes lose a fixed amount of height, short ones
 * are pushed to one of two rails, and once the whole table has drained to zero the object disarms itself.
 * The guard's sign bit selects which rail (0xf0 vs 0) the snap uses, so the same table can be driven up or
 * down by flipping one flag.
 *
 * Behavior: no-op while the guard is zero (object not armed). Otherwise walk the eight slots from x=7 down
 * to 0. A tall entry (>= 0x17) shrinks by 7. A smaller nonzero entry snaps to the guard-signed rail
 * (0xf0 when the guard is negative, else 0). A zero entry stays 0 unless the guard is negative, in which
 * case it may adopt 0xf0 by borrowing from its wrap-around next neighbour (only when that neighbour is
 * nonzero and below 0xd5). Every result is OR-folded into acc so the loop learns whether anything remains.
 *
 * Live-out: the rewritten loc_3fe height table; loc_29 ($0029) holds the OR-fold of all results;
 * SLOT_LOOP_INDEX ($0037) is reset to 0xff for the next per-slot walk; and SPIKE_TABLE_GUARD is cleared
 * to 0 (disarming the object) once the table has fully collapsed. Returns the exit Y, which the frame
 * dispatcher hands to the mode handler: the ROM loads the guard into Y while remapping an empty or short
 * entry (and the wrapped neighbour index when it then checks a negative guard's neighbour), and leaves Y
 * alone for a tall entry and when the pass is skipped, so the last such load wins, else the incoming y.
 * Grounding: [seen].
 */
export function stepSpikeTableCollapse(m, y) {
  const { mem8 } = m;
  const ref = mem8[SPIKE_TABLE_GUARD];
  if (ref === 0) return y; // object not armed: nothing to collapse this frame

  let acc = 0; // OR-fold of every result; zero at the end means the table has flattened
  for (let x = 7; x >= 0; x--) {
    const entry = mem8[u16(loc_3fe + x)];
    let result;
    if (entry === 0) {
      // Empty slot: only a negative guard can (re)fill it, and only by borrowing its next neighbour's rail.
      y = mem8[SPIKE_TABLE_GUARD];
      if (mem8[SPIKE_TABLE_GUARD] & 0x80) {
        const next = x === 7 ? 0 : x + 1; // wrap the top slot back to slot 0
        y = next;
        const nbr = mem8[u16(loc_3fe + next)];
        result = nbr !== 0 && nbr < 0xd5 ? 0xf0 : 0; // adopt the rail only from a live, below-limit neighbour
      } else {
        result = 0; // guard non-negative: stay empty
      }
    } else if (entry >= 0x17) {
      result = entry - 7; // tall spike: shrink by a fixed step toward the rail
    } else {
      y = mem8[SPIKE_TABLE_GUARD];
      result = mem8[SPIKE_TABLE_GUARD] & 0x80 ? 0xf0 : 0; // short spike: snap to the guard-signed rail
    }
    mem8[u16(loc_3fe + x)] = result;
    acc |= result;
  }

  mem8[loc_29] = acc; // publish the fold for the caller
  mem8[SLOT_LOOP_INDEX] = 0xff; // reseed the slot walk index
  if (acc === 0) mem8[SPIKE_TABLE_GUARD] = 0; // whole table drained: disarm the object
  return y;
}
