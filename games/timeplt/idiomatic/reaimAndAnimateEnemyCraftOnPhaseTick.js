// SPDX-License-Identifier: GPL-3.0-only
/**
 * reaimAndAnimateEnemyCraftOnPhaseTick — ROM 0x31B4 [seen]
 *
 * WHAT IT IS. A round-robin servicer for the seven enemy-craft slots. Rather than re-aim every craft
 * every frame, the ROM spreads the work over the life tick counter LIFE_TICKS_LOW (0xAD05 [seen]),
 * a packed-decimal byte zeroed when a life starts and observed under MAME only at 00-59 (and a
 * pre-wrap 60). Its two digits are used
 * separately: the tens digit decides WHAT is done this pass, the units digit WHICH craft gets it.
 *
 * ROLE IN THE MACHINE. On a tens digit of 0 or 3 (ticks 00-09 and 30-39) the craft whose slot number
 * equals the units digit is serviced -- its shape animation advanced and its heading re-aimed at an
 * aim point -- so each of slots 0-6 comes up twice per pass of the counter through 00-59 (units
 * digits 7-9 service nothing).
 * On every other tens digit the pass instead goes to layOutEnemyAimPointsFromScrollAngle (0x326C
 * [seen]), which rebuilds those aim points around the ship. A craft's record (CRAFT_RECORD_SLOT0
 * 0xA850 [seen], 16 bytes a slot) holds its occupancy at +0, heading at +1 and state byte at +8; its
 * sprite entry (CRAFT_ENTRY_SLOT0 0xAA1A [seen], 2 bytes a slot) is where it is on screen.
 *
 * LIVE-OUT: memory only -- the craft record's heading (+1), state (+8) and step-timer (+9) bytes (or the aim-point
 * object, on the lay-out passes).
 */

import { u8 } from "../../../core/int.js";
import { layOutEnemyAimPointsFromScrollAngle } from "./layOutEnemyAimPointsFromScrollAngle.js";
import { stepShapeAnimation } from "./stepShapeAnimation.js";
import { headingToward } from "./headingToward.js";
import { offsetAddress } from "./offsetAddress.js";
import { CRAFT_ENTRY_SLOT0, CRAFT_RECORD_SLOT0, ENEMY_AIM_POINT_TABLE, LIFE_TICKS_LOW } from "./names.js";

// Seven craft slots (`cp 0x07` / `ret nc` at 0x31CC): units digits 7-9 fall through with nothing done.
const SLOT_COUNT = 7;
// A live craft's record head reads 0xFF (the ROM tests it with `inc a` / `ret nz` at 0x31E6).
const OCCUPIED = 0xff;
// State 0x10: the craft is holding its current heading, so it is animated but not re-aimed.
const HELD = 0x10;
// State 0x11: aim once at the table base (the ship anchor), then latch to HELD.
const REAIM_THEN_HOLD = 0x11;
// The two tens digits (high nibble of the packed-decimal counter) on which a craft is serviced.
const TENTHS_00 = 0x00;
const TENTHS_30 = 0x30;

export function reaimAndAnimateEnemyCraftOnPhaseTick(m) {
  const { mem8 } = m;
  // Read the life tick counter once; both digits come from this one byte (`ld a,(0xad05)` / `ld c,a`).
  const phase = mem8[LIFE_TICKS_LOW];

  // Step 1: the tens digit picks the job. Any tens digit other than 0 or 3 is an aim-point lay-out
  // pass, handed on with the whole counter byte (the ROM's `jp nz,0x326c`, C still holding it); that
  // routine itself only acts when the units digit is 7.
  const tens = phase & 0xf0;
  if (tens !== TENTHS_00 && tens !== TENTHS_30) return layOutEnemyAimPointsFromScrollAngle(m, phase);

  // Step 2: the units digit is the slot number. Out-of-range slots (7-9) do nothing. The record is
  // 16 bytes a slot and the sprite entry 2 bytes a slot (the ROM builds 16*slot and 2*slot by
  // repeated `add a,a` at 0x31D7-0x31E0), and an unoccupied slot is skipped.
  const slot = phase & 0x0f;
  if (slot >= SLOT_COUNT) return;
  const record = CRAFT_RECORD_SLOT0 + slot * 16;
  const entry = CRAFT_ENTRY_SLOT0 + slot * 2;
  if (mem8[record] !== OCCUPIED) return;

  // Step 3: every serviced live craft advances its shape animation (`call 0x323a`, stepShapeAnimation
  // [seen]: count its step timer at +9 down and reload byte +8 -- the state byte Step 4 reads (stepShapeAnimation calls it the shape byte) -- from the run entry the new count selects).
  stepShapeAnimation(m, record);

  // Step 4: the state byte at +8 decides the aim. A holding craft (0x10) keeps its heading.
  const state = mem8[record + 8];
  if (state === HELD) return;

  // State 0x11: take the heading toward the unindexed table base -- ENEMY_AIM_POINT_TABLE 0xAC65
  // [seen], whose first entry is the ship's anchor point -- add 0x80 (half of the 256-step circle,
  // so the stored heading is the opposite direction), then latch the record to HELD and clear its
  // byte +9 (ROM 0x3201-0x3214).
  if (state === REAIM_THEN_HOLD) {
    const heading = headingToward(m, ENEMY_AIM_POINT_TABLE, entry);
    mem8[record + 1] = u8(heading + 0x80);
    mem8[record + 8] = HELD;
    mem8[record + 9] = 0x00;
    return;
  }

  // Any other state: it indexes the aim-point table directly -- two bytes (one point) per state value,
  // hence 2*state added to the base (`add a,a` then `rst 0x18`, offsetAddress) -- and the craft's
  // heading at +1 becomes the heading from its sprite entry toward that point (`call 0x33b8`,
  // headingToward [seen]).
  const aim = offsetAddress(m, ENEMY_AIM_POINT_TABLE, u8(state + state));
  mem8[record + 1] = headingToward(m, aim, entry);
}
