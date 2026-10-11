// SPDX-License-Identifier: GPL-3.0-only
/**
 * runSlotCountdownDriftAndAnimateElseRetire — ROM 0x3E8E [seen]
 *
 * WHAT IT IS. The countdown arm of dispatchObjectSlotByHeadByte, the per-slot handler that
 * stepFourActorSlots runs over the four enemy-shot slots (ACTOR_RECORD_SLOT0..3, 0xA810-0xA840).
 * That dispatcher reads only the slot's head byte: 0 is empty, 0xFF is flying, and ANY other value
 * comes here with the slot's state record (`record`, byte +0 is the head/counter) and its sprite
 * entry (`entry`).
 *
 * ROLE IN THE MACHINE. Only the last era treats such a head as a countdown animation
 * (mechanisms.md, retiring and hiding). Outside era 4 the slot is retired on the spot. In era 4 a
 * head of 1 retires it; any other value drops by one this pass, then a count that came in at 60 or more
 * has the head clamped to 59 (overwriting the drop) and asks for two sounds, and the object drifts with the world. While
 * the count (re-read after the clamp) is 28 or more, the sprite takes one of the eight table entries from
 * COUNTDOWN_SLOT_SHAPE_TABLE (0x3EC3), each held for four counts and repeating, with a fixed 3 in
 * its attribute byte. Retiring is the ROM block at 0x40AB (retireSlot [seen]): zero the head and
 * both sprite coordinates, which takes the object off the screen.
 *
 * LIVE-OUT: memory.
 */

import { driftWithWorldScroll } from "./driftWithWorldScroll.js";
import { ERA_INDEX, COUNTDOWN_SLOT_SHAPE_TABLE } from "./names.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { clampOneShotCountdownThenRequestTwoSounds } from "./clampOneShotCountdownThenRequestTwoSounds.js";
import { retireSlot } from "./retireSlot.js";

// ERA_INDEX 0xAD04 value of the one era that runs the countdown (`cp 0x04` at 0x3E91).
const LAST_ERA = 4;
// Record offset of the head byte, which doubles as the counter; a head of 1 is the last count
// (`cp 0x01` / `jp z,0x40ab` at 0x3E9B).
const COUNTER = 0;
const FLOOR = 1;
// 60 (0x3C): a count at or above this is clamped; 28 (0x1C): the lowest count that picks a shape.
const CLAMPED_FROM = 60;
const SHAPES_FROM = 28;
const HELD_FOR = 4;
const SHAPES = 8;
// Sprite-entry offsets: shape at +1, attribute at +48 (0x30), which gets the fixed value 3.
const SHAPE_IN_ENTRY = 1;
const BESIDE_IT_IN_ENTRY = 48;
const BESIDE_IT = 3;

export function runSlotCountdownDriftAndAnimateElseRetire(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;

  // Step 1: outside era 4 a non-empty, non-flying slot has nothing to run -- retire it now
  // (`jp 0x40ab`, a tail jump, so its return is this routine's).
  if (mem8[ERA_INDEX] !== LAST_ERA) {
    retireSlot(m, record, entry);
    return;
  }
  // Step 2: a head already at 1 has finished its count -- retire it too.
  const wasAt = mem8[record + COUNTER];
  if (wasAt === FLOOR) {
    retireSlot(m, record, entry);
    return;
  }

  // Step 3: count down one (`dec (ix+0x00)`). The high-mark test that follows compares the value from
  // BEFORE the decrement, which the ROM still has in A (`cp 0x3c`); at 60 or more the head is forced
  // to 0x3B (59) and two sounds are requested (clampOneShotCountdownThenRequestTwoSounds, 0x3ECB
  // [seen]). Then the object drifts by the frame's world scroll (driftWithWorldScroll, 0x2B60 [seen]).
  mem8[record + COUNTER] = wasAt - 1;
  if (wasAt >= CLAMPED_FROM) clampOneShotCountdownThenRequestTwoSounds(m, record);
  driftWithWorldScroll(m, record, entry);

  // Step 4: re-read the head -- the clamp may have moved it (`ld a,(ix+0x00)` at 0x3EAB) -- and below
  // 28 leave the sprite's shape alone.
  const nowAt = mem8[record + COUNTER];
  if (nowAt < SHAPES_FROM) return;

  // Step 5: pick the shape. The ROM's `sub 0x1c` / `rrca` / `rrca` / `and 0x07` is (count - 28) / 4
  // taken modulo 8, so each shape is held for four counts and the eight repeat; the byte comes from
  // the table through `rst 0x08` (fetchTableByte [seen]) and the attribute byte beside it is set to 3.
  mem8[entry + SHAPE_IN_ENTRY] = fetchTableByte(m, COUNTDOWN_SLOT_SHAPE_TABLE, Math.floor((nowAt - SHAPES_FROM) / HELD_FOR) % SHAPES);
  mem8[entry + BESIDE_IT_IN_ENTRY] = BESIDE_IT;
}
