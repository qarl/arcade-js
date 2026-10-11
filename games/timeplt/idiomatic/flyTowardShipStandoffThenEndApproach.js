// SPDX-License-Identifier: GPL-3.0-only
/**
 * flyTowardShipStandoffThenEndApproach — run one chased object through a frame of its approach.
 *
 * WHAT IT IS: ROM 0x41B8-0x41EB, tag [seen] (names.js ROUTINES 0x41b8). On every sixteenth frame it
 * re-aims the object at one of two fixed standoff points near the ship, a bit in the object's record
 * choosing which; if the object has by then arrived at that point it cuts the record's approach
 * countdown to zero, so the record's handler takes its expired arm next frame. Then, every frame, it
 * turns the object toward its aim, moves it and dresses its sprite, and finally asks whether it has
 * reached a retire line.
 *
 * ROLE IN THE MACHINE: an era-4 path only -- the one route in requires ERA_INDEX to be 4 (names.js "why"
 * for endApproachNow, which this routine alone calls); under MAME every dispatch of endApproachNow had
 * the record at 0xA8C0. The two standoff points (ENEMY_STANDOFF_AIM_SET / _CLEAR) stand off
 * the ship rather than sitting on it: the object closes in on a point near the ship, not on the ship.
 *
 * Arguments: `record` is the object's record, `entry` its sprite entry.
 * LIVE-OUT: memory; whether the object reached a retire line is returned (the ROM's carry).
 */

import { u8, u16 } from "../../../core/int.js";
import { ENEMY_STANDOFF_AIM_CLEAR, ENEMY_STANDOFF_AIM_SET, FRAME_TICK, OPENING_ERA_VELOCITY_TABLE } from "./names.js";
import { headingToward } from "./headingToward.js";
import { endApproachNow } from "./endApproachNow.js";
import { steerTowardAimAtFixedRate } from "./steerTowardAimAtFixedRate.js";
import { flyAlongHeadingAtDoubleVelocity } from "./flyAlongHeadingAtDoubleVelocity.js";
import { animateFixedShapeCycleFromShape50 } from "./animateFixedShapeCycleFromShape50.js";
import { hasReachedRetireLine } from "./hasReachedRetireLine.js";

/* Low four bits of FRAME_TICK: all clear on one frame in sixteen, the re-aim frame (`and 0x0f`). */
const REAIM_MASK = 0x0f;
/* Record byte +0x0F; its bit 0 picks which standoff point to aim at (`bit 0,(ix+0x0f)`). */
const AIM_SELECTOR = 15;
/* Record byte +0x01: the heading the object aims at, which the steerer turns it toward (`ld (ix+0x01),b`). */
const AIM_HEADING = 1;
/* The sprite entry's second coordinate lives 0x31 bytes past its first. */
const SECOND_COORD = 49;
/* Both axis gaps below this count as arrived (the ROM's two `cp 0x10`). */
const ARRIVED = 16;
// the velocity table an approaching object flies along
const APPROACH_VELOCITY_TABLE = OPENING_ERA_VELOCITY_TABLE;

export function flyTowardShipStandoffThenEndApproach(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;

  /*
   * Re-aim, one frame in sixteen (FRAME_TICK 0xA980 low nibble zero). The rest of the time the object
   * keeps flying toward the aim heading it already holds.
   */
  if ((mem8[FRAME_TICK] & REAIM_MASK) === 0) {
    /*
     * Pick the point: record bit 0 of +0x0F SET aims at 0xAC75 (ENEMY_STANDOFF_AIM_SET), CLEAR at
     * 0xAC79 (ENEMY_STANDOFF_AIM_CLEAR). Each name is the point's X byte; its Y byte sits one below.
     * Then store the heading from the object's sprite entry to that point as the new aim heading
     * (headingToward, ROM 0x33B8, returns a heading on a 256-step circle).
     */
    const point = mem8[u16(record + AIM_SELECTOR)] & 1 ? ENEMY_STANDOFF_AIM_SET : ENEMY_STANDOFF_AIM_CLEAR;
    mem8[u16(record + AIM_HEADING)] = headingToward(m, point, entry);
    // headingToward drops the two axis gaps it measures; recompute them to spot arrival.
    /*
     * The ROM reads those two gaps from registers headingToward leaves behind (D, and the shadow A').
     * Here they are taken again: X of the point against the entry's first byte, and the point's Y byte
     * (the byte below it, kept inside the same 256-byte page) against the
     * entry's second coordinate at +0x31.
     */
    const firstGap = Math.abs(mem8[point] - mem8[entry]);
    const secondGap =
      Math.abs(mem8[(point & (0xff << 8)) | u8(point - 1)] - mem8[u16(entry + SECOND_COORD)]);
    /*
     * Arrived: both gaps under sixteen. endApproachNow (ROM 0x41EC) zeroes the record's countdown at
     * +0x04, so its handler takes the expired arm next frame instead of counting the rest of the delay.
     */
    if (firstGap < ARRIVED && secondGap < ARRIVED) endApproachNow(m, record);
  }

  /*
   * Every frame, three steps in the ROM's order:
   *  - steerTowardAimAtFixedRate (0x421F): turn the flight heading two units toward the aim heading, on
   *    three frames in four;
   *  - fly one step at twice the velocity from the opening-era table at 0x5E00 (the ROM's `call 0x58b6`,
   *    a shim that fixes that table for the double-velocity mover at 0x58FE), the world scroll added
   *    once;
   *  - animateFixedShapeCycleFromShape50 (0x41F1): dress the sprite with the current frame of an
   *    eight-frame shape cycle taken from FRAME_TICK bits 1-3.
   */
  steerTowardAimAtFixedRate(m, record);
  flyAlongHeadingAtDoubleVelocity(m, APPROACH_VELOCITY_TABLE, record, entry);
  animateFixedShapeCycleFromShape50(m, entry);

  /*
   * Finally (the ROM's tail `jp 0x2b83`): has the sprite entry drifted onto one of the two fixed retire
   * lines? The answer goes back to the caller, but its one caller
   * (the call at 0x419E, in the era-4 sweep arm at 0x4194) ignores it and closes the sweep turn
   * (`jp 0x410b`), so a yes frees nothing on this path.
   */
  return hasReachedRetireLine(m, entry);
}
