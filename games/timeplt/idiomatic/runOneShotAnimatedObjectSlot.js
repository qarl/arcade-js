// SPDX-License-Identifier: GPL-3.0-only
/**
 * runOneShotAnimatedObjectSlot — ROM 0x406C [seen]
 *
 * WHAT IT IS. The per-pass handler for an object slot whose head byte is running a one-shot
 * countdown (any value other than 0 = empty and 0xFF = flying). The slot bank sweeps
 * (sweepObjectSlotBankByHead, sweepObjectSlotBankServicingFirstSlot) hand it one slot at a time: a
 * state record, whose byte +0 is the counter, and the sprite entry that puts it on screen.
 *
 * ROLE IN THE MACHINE. The countdown is an animation that plays once and then removes the object
 * (mechanisms.md, object banks): a counter of 60 or more is re-stamped down to 59 once (with a
 * sound request), then the counter drops by one a pass; while it is 28 or more the object is shown
 * with a shape from ONE_SHOT_OBJECT_SHAPE_TABLE (0x4094), and when it reaches zero the slot is cleared.
 * Between those the object drifts with the world scroll, so it keeps its place in the world while
 * the view scrolls under the player's ship. The expiry arm is the ROM block at 0x40AB, the same three stores as retireSlot.
 *
 * PARAMETERS: `object` = the slot's state record (the ROM's IX), `sprite` = its sprite entry (IY).
 * LIVE-OUT: memory only.
 */

import { clampOneShotCountdownThenRequestSound } from "./clampOneShotCountdownThenRequestSound.js";
import { driftWithWorldScroll } from "./driftWithWorldScroll.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { ONE_SHOT_OBJECT_SHAPE_TABLE } from "./names.js";

// Offsets inside the record and the sprite entry. A sprite entry keeps its two coordinates 0x31
// bytes apart (+0 and +0x31), its shape at +1 and its attribute at +0x30.
const COUNTER = 0;
// 60: at or above this the counter is re-stamped (`cp 0x3c` / `call nc,0x409d`).
const REARM_AT = 0x3c;
// 28: below this the object keeps whatever shape it last had (`cp 0x1c` / `ret c`).
const SHAPE_FLOOR = 0x1c;
const SPRITE_SHAPE = 1;
const SPRITE_ATTR = 0x30;
const SECOND_AXIS_OFFSET = 0x31;
const SHAPE_ATTR = 0x0e;

export function runOneShotAnimatedObjectSlot(m, object = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;

  // Step 1 -- rearm. A counter of 60 or more is forced to 59 (0x3B) and the matching sound requested
  // (clampOneShotCountdownThenRequestSound, 0x409D [seen]). After the decrement below it reads 58,
  // under the mark, so this fires only on the first pass: it does not self-retrigger.
  if (mem8[object + COUNTER] >= REARM_AT) clampOneShotCountdownThenRequestSound(m, object);

  // Step 2 -- count down (`dec (ix+0x00)`). Reaching zero ends the animation: the slot is retired by
  // zeroing both sprite coordinates, which takes it off the screen (ROM 0x40AB-0x40B7). The ROM also
  // stores 0 to the counter there, which it already holds, so only the two sprite bytes are written.
  mem8[object + COUNTER] = (mem8[object + COUNTER] - 1);
  if (mem8[object + COUNTER] === 0) {
    mem8[sprite] = 0;
    mem8[sprite + SECOND_AXIS_OFFSET] = 0;
    return;
  }

  // Step 3 -- drift (`call 0x2b60`, driftWithWorldScroll [seen]): add this frame's world-scroll
  // displacement to the object's coordinates.
  driftWithWorldScroll(m, object, sprite);

  // Step 4 -- choose the shape. The counter is re-read; below 28 nothing more is done.
  const counter = mem8[object + COUNTER];
  if (counter < SHAPE_FLOOR) return;
  // counter above the floor, rotated right twice, low nibble: the shape-table index.
  // (`sub 0x1c` / `rrca` / `rrca` / `and 0x0f`: the two bits rotated round to the top are masked
  // away, so this is (counter - 28) / 4 -- each shape is held for four passes.)
  const index = ((((counter - SHAPE_FLOOR) & 0xff) >> 2) | (((counter - SHAPE_FLOOR) & 0xff) << 6)) & 0x0f;
  // Look the shape up (`rst 0x08`, fetchTableByte [seen]) and store it with the fixed attribute 0x0E.
  const shape = fetchTableByte(m, ONE_SHOT_OBJECT_SHAPE_TABLE, index);
  mem8[sprite + SPRITE_SHAPE] = shape;
  mem8[sprite + SPRITE_ATTR] = SHAPE_ATTR;
}
