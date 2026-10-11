// SPDX-License-Identifier: GPL-3.0-only
/** serviceFixedSlotInEra1 — service one fixed object slot, and only while the era index holds one particular
 * value; every other era leaves without touching a thing. The slot's record and the sprite entry
 * that goes with it are constants here, so this entry is a guard plus the choice of that one
 * pair. What servicing amounts to is not decided here. The guard steps the era byte down by one
 * to test it (`dec a / ret nz`): the serviced era is the one value that steps down to zero.
 * LIVE-OUT: memory.
 * ROM 0x3DDA-0x3DEA. Grounding: [seen] (names.js ROUTINES 0x3DDA). */

import { u8 } from "../../../core/int.js";
import { serviceSlotByHeadByte } from "./serviceSlotByHeadByte.js";
import { ERA_INDEX, ERA_OBJECT_ENTRY_SLOT2, ERA_OBJECT_RECORD_SLOT2 } from "./names.js";

export function serviceFixedSlotInEra1(m) {
  if (u8(m.mem8[ERA_INDEX] - 1) !== 0) return;
  return serviceSlotByHeadByte(m, ERA_OBJECT_RECORD_SLOT2, ERA_OBJECT_ENTRY_SLOT2);
}
