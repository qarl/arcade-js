// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceEra1BomberObject — one round-engine pass of the 1940 era's bomber.
 *
 * ROM 0x3B5F-0x3B76 (the live arm falls through into 0x3B77). Grounding: [seen]
 * (names.js ROUTINES 0x3b5f).
 *
 * WHAT IT IS. In era 1 (1940) the era-object bank carries a single large multi-hit craft, the bomber,
 * in its first slot (record ERA_OBJECT_RECORD_SLOT0 0xA8C0, sprite entry ERA_OBJECT_ENTRY_SLOT0
 * 0xAA28). The record's head byte says what state it is in, and this routine runs the matching step:
 *   - 0x00 (empty): count its arming timer, and arm a new bomber when it fires
 *     (armBomberSlotWhenTimerFires, 0x3C25);
 *   - 0xFF (live): the ordinary two-tile move, with a chance of an aimed shot
 *     (advanceTwoTileObjectThenTryAimedSpawn, 0x3B77);
 *   - anything else: it has been hit, so spend its remaining hits and run it down toward death
 *     (advanceHitSoakingObjectThenAnimateDeath, 0x3B94).
 *
 * ROLE IN THE MACHINE. Called once per dispatch of the round engine's service list
 * (serviceRoundThenResolvePlayerState) alongside the other eras' object-bank services; it returns
 * untouched in every era but 1.
 *
 * LIVE-OUT: memory.
 */

import { u8 } from "../../../core/int.js";
import { armBomberSlotWhenTimerFires } from "./armBomberSlotWhenTimerFires.js";
import { advanceHitSoakingObjectThenAnimateDeath } from "./advanceHitSoakingObjectThenAnimateDeath.js";
import { advanceTwoTileObjectThenTryAimedSpawn } from "./advanceTwoTileObjectThenTryAimedSpawn.js";
import { ERA_INDEX, ERA_OBJECT_ENTRY_SLOT0, ERA_OBJECT_RECORD_SLOT0 } from "./names.js";

export function serviceEra1BomberObject(m) {
  const { mem8 } = m;
  // Era 1 only (ERA_INDEX 0xAD04).
  if (mem8[ERA_INDEX] !== 1) return;

  // Dispatch the bank's first slot on its head byte. The ROM tests 0 with `and a`, then 0xFF with
  // `inc a`; the hit-soaking step is handed the head byte plus one, the value `inc a` leaves.
  const record = ERA_OBJECT_RECORD_SLOT0;
  const entry = ERA_OBJECT_ENTRY_SLOT0;
  const head = mem8[record];
  if (head === 0) return armBomberSlotWhenTimerFires(m, record, entry);
  if (head !== 0xff) return advanceHitSoakingObjectThenAnimateDeath(m, record, entry, u8(head + 1));
  return advanceTwoTileObjectThenTryAimedSpawn(m, record, entry);
}
