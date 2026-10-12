// SPDX-License-Identifier: GPL-3.0-only
/** serviceEra0BallisticObjectBank — in era zero only, run one pass of the three-slot ballistic-object bank from the top:
 * start the cursors at the first slot, then step an empty first slot, fly a ballistic (0xFF) first slot
 * before stepping it, or hand any other first-slot marker to the servicing sweep; outside era zero do
 * nothing. LIVE-OUT: memory; in era zero, returns where the bank's cursors stopped
 * ({ record, sprite, count }). */

/*
 * ROM 0x3FEA-0x4007, grounding [seen] (names.js ROUTINES 0x3fea).
 *
 * WHAT IT IS. The era-object bank is three 16-byte records from ERA_OBJECT_RECORD_SLOT0 (0xA8C0,
 * [seen]) paired with two-byte sprite entries from ERA_OBJECT_ENTRY_SLOT0 (0xAA28, [seen]). Each era
 * runs it through its own entry; this is the era-0 one, run from the round engine's
 * service list (serviceRoundThenResolvePlayerState). In era 0 a slot marked 0xFF flies a ballistic
 * arc -- a constant sideways step plus a velocity on the other axis that grows every frame -- which
 * fits gameplay.md's note that the 1910 bombs fall on a parabola.
 *
 * MECHANISM. The bank is walked by one loop whose head (0x3FF9) branches on each slot's marker byte:
 * 0x00 to 0x400B, 0xFF to 0x4003, any other value to 0x4008. In the ROM this entry only seats the
 * cursors and runs straight on into that head; in this port it reads the FIRST slot's marker itself
 * and joins the matching part of the loop. The later slots are routed by the loop itself.
 *
 * LIVE-OUT: memory; in era zero, the object the joined sweep returns (where the cursors stopped).
 */

import { advanceSlotThenSweepObjectBankByHead } from "./advanceSlotThenSweepObjectBankByHead.js";
import { sweepObjectSlotBankServicingFirstSlot } from "./sweepObjectSlotBankServicingFirstSlot.js";
import { flyAlongBallisticArc } from "./flyAlongBallisticArc.js";
import { ERA_INDEX, ERA_OBJECT_ENTRY_SLOT0, ERA_OBJECT_RECORD_SLOT0 } from "./names.js";

// The bank has three slots (ROM `ld b,0x03`); marker byte (record +0) values: 0x00 empty,
// 0xFF ballistic; any other value is serviced by the sweep's shape-cycle arm.
const BANK_SLOTS = 0x03;
const EMPTY = 0x00;
const BALLISTIC = 0xff;

export function serviceEra0BallisticObjectBank(m) {
  const { mem8 } = m;
  // Era gate (`ld a,(0xad04) / and a / ret nz`): other eras drive this bank through their own
  // entries (serviceEra1BomberObject, sweepEra2PlusObjectBank), so outside era 0 stand aside.
  if (mem8[ERA_INDEX] !== 0) return;

  // Seat the cursors on the first slot (ROM: IX = record, IY = sprite entry, B = slot count).
  const record = ERA_OBJECT_RECORD_SLOT0;
  const sprite = ERA_OBJECT_ENTRY_SLOT0;
  // Route by the first slot's marker. Empty: join the loop at its advance step (0x400B), which moves
  // to the next slot and carries on. Any marker other than 0xFF: join at 0x4008, which services this
  // first slot's shape cycle and then routes the rest. In the ROM these are the loop head's own
  // branches (`jp z,0x400b`, `jr nz,0x4008`), which 0x3FEA runs straight into.
  const marker = mem8[record];
  if (marker === EMPTY) return advanceSlotThenSweepObjectBankByHead(m, record, sprite, BANK_SLOTS);
  if (marker !== BALLISTIC) return sweepObjectSlotBankServicingFirstSlot(m, record, sprite, BANK_SLOTS);
  // Ballistic: fly this slot one frame along its arc (flyAlongBallisticArc, 0x4017 -- which also
  // carries it with the world scroll and retires it once it leaves the field), then join the loop
  // at its advance step for the remaining slots (`jr 0x400b`).
  flyAlongBallisticArc(m, record, sprite);
  return advanceSlotThenSweepObjectBankByHead(m, record, sprite, BANK_SLOTS);
}
