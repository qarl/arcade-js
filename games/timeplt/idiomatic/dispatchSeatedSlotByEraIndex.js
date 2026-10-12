// SPDX-License-Identifier: GPL-3.0-only
/** dispatchSeatedSlotByEraIndex — run the per-slot handler the low three bits of the era index select out of a word
 * table laid down inline just behind this entry, on the object record the caller seated. Each case is
 * the slot's literal target, called directly with that record, and nothing here runs after it. Three
 * bits admit eight slots: the first five are the five eras' slot services; the sixth and seventh hold
 * words that address no program at all, so reaching one is a fault and it is raised, not assumed
 * away; the eighth holds the word of the round-won band animation step (0x1323), and that is what it runs. The record and
 * its sprite entry come in as arguments and each handler is entered directly, with no table word
 * carried in on a register pair. LIVE-OUT: memory, and the handler's. */

/*
 * ROM 0x290E-0x2913 (the dispatch) + 0x2914 (the inline 8-word table ERA_SLOT_DISPATCH_TABLE),
 * grounding [seen] (names.js ROUTINES 0x290e).
 *
 * ROLE. The common tail of every per-slot craft entry (seatCraftSlot0..4ThenDispatchByEra and the two
 * gated siblings): the entry seats a slot's record and sprite entry, and this picks HOW that slot
 * behaves this pass from the era the player is in. Time Pilot's five eras (A.D. 1910, 1940, 1970,
 * 1982/83 and 2001 in gameplay.md) each fly their enemy craft differently, and ERA_INDEX (0xAD04, [seen]) is the
 * number of the current one.
 *
 * MECHANISM IN THE ROM. `ld a,(0xad04) / and 0x07 / rst 0x30`: RST 0x30 is the game's computed-jump
 * helper; it treats the address after the RST (0x2914) as a table of two-byte targets, doubles A to
 * index it, and jumps to the word it finds. Because it JUMPS, the chosen handler returns directly to
 * whoever called this entry -- nothing runs after it here, which is why each case below simply
 * returns the handler's result.
 *
 * LIVE-OUT: memory, plus whatever the chosen handler leaves.
 */

import { NotImplemented } from "../../../boards/timeplt/io.js";
import { ERA_INDEX } from "./names.js";
import { serviceEra0EnemyCraftSlot } from "./serviceEra0EnemyCraftSlot.js";
import { serviceEra1EnemyCraftSlot } from "./serviceEra1EnemyCraftSlot.js";
import { serviceEra2EnemyCraftSlot } from "./serviceEra2EnemyCraftSlot.js";
import { serviceEra3EnemyCraftSlot } from "./serviceEra3EnemyCraftSlot.js";
import { serviceEra4EnemyCraftSlot } from "./serviceEra4EnemyCraftSlot.js";
import { stepRoundWonBandAnimation } from "./stepRoundWonBandAnimation.js";

// The ROM's `and 0x07`: only the low three bits of the era index choose a table word (eight words).
const ARM_MASK = 0x07;

export function dispatchSeatedSlotByEraIndex(m, record = m.regs.ix, entry = m.regs.iy) {
  // Select the table word. The record/entry defaults read the register pair the ROM's callers seat
  // (IX = record, IY = sprite entry) for any caller that still arrives that way.
  const slot = m.mem8[ERA_INDEX] & ARM_MASK;
  switch (slot) {
    // Words 0-4: one craft service per era (0x2927, 0x294C, 0x2984, 0x29B0, 0x29D5), each run on the
    // seated slot. They share one skeleton on the slot's head byte -- free does nothing, 0xFE counts
    // a held object's release delay down, a countdown value steps the dying state, a live craft
    // is steered, flown and retire-tested -- and differ in how they steer, how fast they fly and
    // what they launch.
    // startNextRound wraps the era after the fifth back to zero, so in play only these five run.
    case 0: return serviceEra0EnemyCraftSlot(m, record, entry);
    case 1: return serviceEra1EnemyCraftSlot(m, record, entry);
    case 2: return serviceEra2EnemyCraftSlot(m, record, entry);
    case 3: return serviceEra3EnemyCraftSlot(m, record, entry);
    case 4: return serviceEra4EnemyCraftSlot(m, record, entry);
    // Word 7: the round-won band animation (sequence step 14, 0x1323), which takes no slot arguments,
    // so the seated record is not passed.
    case 7: return stepRoundWonBandAnimation(m);
    // The two remaining words point past the program image into unmapped space, where the inline
    // dispatch would jump and fault; surface the same fault here.
    default:
      throw new NotImplemented(`dispatchSeatedSlotByEraIndex: era slot ${slot} addresses no transcribed routine`);
  }
}
