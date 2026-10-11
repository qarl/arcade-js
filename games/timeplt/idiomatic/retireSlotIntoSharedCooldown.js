// SPDX-License-Identifier: GPL-3.0-only
/** retireSlotIntoSharedCooldown — take the caller's slot out of play and stock its record byte (index 14) from the
 * shared ATTACKER_SPAWN_COOLDOWN_PERIOD, so every slot retired here goes out holding it. LIVE-OUT: memory + the value in A.
 *
 * ROM 0x3DFB-0x3E04 (frozen lift translated/loc_3dfb.js). Grounding: [seen] (names.js ROUTINES
 * 0x3dfb). Role in the machine: the retire path of serviceSlotByHeadByte, which retires its slot
 * straight into this shared cooldown (mechanisms.md). It differs from retireSlotIntoCooldown,
 * which loads the same record byte with a fixed 240: here the value comes from one address that
 * six sites read and whose value moves over a game — 0x1E through the attract demo, then 0x42,
 * 0x48 and 0x4E across a driven game, restamped per era (names.js).
 *
 * `record` is the slot's record (IX) and `entry` its sprite entry (IY).
 */

import { retireSlot } from "./retireSlot.js";
import { ATTACKER_SPAWN_COOLDOWN_PERIOD } from "./names.js";

// The record's delay byte: `ld (ix+0x0e),a` in the ROM.
const RECORD_BYTE = 14;

export function retireSlotIntoSharedCooldown(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;
  /* Retire: `call 0x40ab`, retireSlot [seen], zeroes the occupancy byte and both sprite-entry
   * coordinates, leaving the sub-pixel remainders standing. */
  retireSlot(m, record, entry);
  /* Re-arm: `ld a,(0xa8f6) / ld (ix+0x0e),a` copies ATTACKER_SPAWN_COOLDOWN_PERIOD [seen] into
   * the record's +14, so a recycled slot re-enters carrying the same interval. The value is left
   * in A, as the ROM leaves it. */
  const cooldown = mem8[ATTACKER_SPAWN_COOLDOWN_PERIOD];
  mem8[record + RECORD_BYTE] = cooldown;
  return (m.regs.a = cooldown);
}
