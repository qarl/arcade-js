import { ATTACKER_SPAWN_SLOT_COUNT, ERA_INDEX, ERA_OBJECT_ENTRY_SLOT0, ERA_OBJECT_RECORD_SLOT0 } from "./names.js";
import { serviceSlotByMarkerThenCloseSweepTurn } from "./serviceSlotByMarkerThenCloseSweepTurn.js";
// SPDX-License-Identifier: GPL-3.0-only
/** sweepEra2PlusObjectBank — enter the per-slot sweep of an object bank: below the first swept era, or with the bank's
 * slot count zero, do nothing; else run the sweep body from the bank's first record and sprite
 * entry for that many turns. LIVE-OUT: memory. */

/*
 * ROM 0x40D6-0x40E9, grounding [seen] (names.js ROUTINES 0x40d6).
 *
 * WHAT IT IS. Time Pilot keeps a small "era-object bank" of special objects beside the enemy craft:
 * three 16-byte records starting at ERA_OBJECT_RECORD_SLOT0 (0xA8C0), each paired with a two-byte
 * sprite entry starting at ERA_OBJECT_ENTRY_SLOT0 (0xAA28). Which routine drives that bank depends on
 * the era (ERA_INDEX, 0xAD04): era 0 has its own entry (serviceEra0BallisticObjectBank), era 1 its own
 * (serviceEra1BomberObject), and from era 2 upward the bank is run by THIS entry, which only gates and
 * seats the sweep; the per-slot work is the sweep body serviceSlotByMarkerThenCloseSweepTurn (0x40EA).
 *
 * ROLE. One of the round engine's object services: each call either returns at once or services
 * the bank's slots once each, as many as the slot count below says.
 *
 * LIVE-OUT: memory only -- the sweep body writes the slots' records and sprite entries.
 */

// The first era this entry serves; the ROM's `cp 0x02 / ret c` at 0x40D9 returns for eras 0 and 1.
const FIRST_SWEPT_ERA = 2;

export function sweepEra2PlusObjectBank(m) {
  const { mem8 } = m;

  // Era gate. Eras 0 and 1 have dedicated bank services of their own, so below era 2 this entry
  // must stand aside rather than double-service the same records.
  if (mem8[ERA_INDEX] < FIRST_SWEPT_ERA) return;

  // Slot-count gate. ATTACKER_SPAWN_SLOT_COUNT (0xA8C6, [seen]) is the era bank's size, stocked
  // per era/rung from the settings row at every life start and every rung bump; it also bounds the sweep loop. Zero means
  // this era fields no bank objects, so there is nothing to sweep (the ROM's `and a / ret z`).
  const count = mem8[ATTACKER_SPAWN_SLOT_COUNT];
  if (count === 0) return;

  // Seat the sweep: record cursor on the bank's first record, sprite cursor on its first entry, and
  // the slot count as the number of turns. The body services one slot per turn and re-enters itself
  // (via closeOneTurnOfTheSlotSweep) while turns remain, so this one call covers every counted slot.
  // In the ROM these are IX, IY and B falling through into 0x40EA; here they are arguments.
  return serviceSlotByMarkerThenCloseSweepTurn(m, ERA_OBJECT_RECORD_SLOT0, ERA_OBJECT_ENTRY_SLOT0, count);
}
