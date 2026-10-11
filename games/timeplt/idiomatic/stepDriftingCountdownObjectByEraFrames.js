// SPDX-License-Identifier: GPL-3.0-only
/** stepDriftingCountdownObjectByEraFrames — run one frame of an object whose life is a countdown at its base. At or above the
 * reset mark the state is re-stamped and its sound requested; then the object drifts with the
 * world and the count falls by one. At zero the slot retires. Below the animation window nothing
 * more happens; otherwise the count picks a frame from one of two fixed tables — the choice made
 * on the era index — and that frame plus a fixed sprite state are written to the sprite entry.
 * The object record and its sprite entry are arguments. LIVE-OUT: memory.
 *
 * ROM 0x413C-0x4182 (frozen lift translated/loc_413c.js). Grounding: [seen] in names.js.
 *
 * The object's record head (+0x00) doubles as its lifetime counter: the object lives exactly as long
 * as that byte is counting down. Its paired sprite entry follows the usual Time Pilot entry layout
 * (names.js, the enemy-craft slot note): +0x01 = tile/shape, +0x30 = attribute (colour + flip).
 *
 * Parameters: `object` is the object's record (the caller's object sweep seats it), `sprite` is the
 * sprite entry paired with that record. */

import { clampOneShotCountdownThenRequestSound } from "./clampOneShotCountdownThenRequestSound.js";
import { driftWithWorldScroll } from "./driftWithWorldScroll.js";
import { retireSlot } from "./retireSlot.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { ERA_INDEX, NEAR_ERA_SPRITE_FRAME_TABLE, FAR_ERA_SPRITE_FRAME_TABLE } from "./names.js";

// Record offset of the countdown (the record head itself).
const COUNT = 0;
// `cp 0x3c` at 0x413F: a count at or above 0x3C gets its state re-stamped (0x409D) before the frame runs.
const RESET_MARK = 0x3c;
// `cp 0x1c` at 0x4150: below 0x1C the object is still alive but no longer animates.
const WINDOW_FLOOR = 0x1c;
// `cp 0x04` at 0x415D: eras 4 and up (ERA_INDEX >= 4) take the far-era table.
const FINAL_ERA = 0x04;
// The two inline ROM frame tables: 0x416E (eras 0-3) and 0x4183 (era 4).
const NEAR_TABLE = NEAR_ERA_SPRITE_FRAME_TABLE;
const FAR_TABLE = FAR_ERA_SPRITE_FRAME_TABLE;
// Sprite-entry offsets written: +0x01 tile/shape and +0x30 attribute.
const SPRITE_CODE = 1;
const SPRITE_STATE = 0x30;
// The attribute byte each table's frames are drawn with (`ld (iy+0x30),0x0d` / `ld (iy+0x30),0x02`).
const NEAR_STATE = 0x0d;
const FAR_STATE = 0x02;

export function stepDriftingCountdownObjectByEraFrames(m, object = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;

  /* Step 1 — top of the count: re-stamp, then drift (0x413C-0x4147).
   * A count at or above the reset mark is clamped by clampOneShotCountdownThenRequestSound (0x409D),
   * which writes 0x3B into the head and requests the object's sound — so a count arriving high is
   * pulled down to 0x3B before this frame's decrement. Every frame, whatever the count, the object
   * is then carried along with the world by driftWithWorldScroll (0x2B60): it adds this frame's
   * world-scroll displacement to the object's coordinates, so it stays put relative to the sky while
   * the player's ship appears to fly past it. */
  if (mem8[object + COUNT] >= RESET_MARK) clampOneShotCountdownThenRequestSound(m, object);
  driftWithWorldScroll(m, object, sprite);

  /* Step 2 — count down one frame (`dec (ix+0x00)` at 0x4147).
   * Reaching zero ends the object's life: retireSlot (0x40AB, a tail jump in the ROM) zeroes the
   * occupancy byte and the sprite entry's coordinates, freeing the slot. Counts below the window
   * floor still live and drift but keep whatever frame they last showed (`ret c` at 0x4152). */
  const count = (mem8[object + COUNT] - 1) & 0xff;
  mem8[object + COUNT] = count;
  if (count === 0) return retireSlot(m, object, sprite);
  if (count < WINDOW_FLOOR) return;

  /* Step 3 — pick and draw this frame's shape (0x4153-0x4182).
   * The part of the count above the window floor, divided by four (`sub 0x1c / rrca / rrca /
   * and 0x07`), gives a frame index 0-7, so each shape holds for four counts. ERA_INDEX chooses
   * which inline ROM table the index reads through fetchTableByte (rst 0x08): the near-era table at
   * 0x416E for eras 0-3, the far-era table at 0x4183 for era 4. The fetched byte becomes the
   * entry's tile, and a fixed attribute byte per table sets its colour. */
  const frame = ((count - WINDOW_FLOOR) >> 2) & 0x07;
  const far = mem8[ERA_INDEX] >= FINAL_ERA;
  mem8[sprite + SPRITE_CODE] = fetchTableByte(m, far ? FAR_TABLE : NEAR_TABLE, frame);
  mem8[sprite + SPRITE_STATE] = far ? FAR_STATE : NEAR_STATE;
}
