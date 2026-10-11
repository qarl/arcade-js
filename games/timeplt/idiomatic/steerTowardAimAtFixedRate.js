// SPDX-License-Identifier: GPL-3.0-only
/** steerTowardAimAtFixedRate — turn one object a step nearer the heading it is aiming at. It does nothing on one
 * frame in four. Both the standing test and the direction test are taken on the gap PLUS ONE
 * rather than on the gap, so it turns the shorter way round everywhere except at a gap of exactly
 * one short of a half turn, where the offset tips it to the longer side. The offset also leaves
 * the standing band two gaps wide and off centre — the aim reached exactly, and the aim one step
 * behind it — which is what stops it hunting. Because the heading moves in TWOS across a band of
 * two, which of the two it comes to rest on follows the parity of the gap and not the side it came
 * from: an even gap ends with the heading on the aim, an odd one with the aim one step behind, for
 * good.
 *
 * ROM 0x421F-0x4242 (frozen lift translated/loc_421f.js). Grounding: [seen].
 *
 * Role in the machine: the turning half of an enemy's homing. Its caller
 * (flyTowardShipStandoffThenEndApproach) re-aims by writing the object's aim byte on passes that find the
 * frame tick's low four bits clear, calls this, and then calls the flier, whose first act is to read the heading byte this
 * routine just wrote — so the heading here is the one the object's motion follows. Under MAME it
 * did not run in eras 0-1 and ran thousands of times with the era held at 4. Its sibling steerTowardAimOneUnitAFrame is the same biased test with
 * a step of one and no frame gate.
 *
 * `object` is the object's sixteen-byte record (IX on the Z80): +1 the aim heading, +2 the current
 * heading, both on a 256-step circle.
 *
 * LIVE-OUT: memory only — the one heading byte. */

import { u8 } from "../../../core/int.js";
import { FRAME_TICK } from "./names.js";

// The frame counter's low two bits (`and 0x03` at 0x4222): the one frame in four where both are
// clear is the idle tick, on which a dispatch does not turn.
const FOUR_FRAME_PHASE_MASK = 3;

// Record bytes: the heading the object wants, and the heading it is flying on.
const AIM_HEADING = 1;
const CURRENT_HEADING = 2;

// The biased tests: the gap aim-minus-current, plus one (`add a,0x01`), is compared first against
// 2 (`cp 0x02`, stand still below it) and then against a half turn 0x80 (`cp 0x80`, which way
// round). Each turning step is two heading units.
const TEST_OFFSET = 1;
const STANDING_BAND = 2;
const HALF_TURN = 0x80;
const STEP = 2;

export function steerTowardAimAtFixedRate(m, object = m.regs.ix) {
  const { mem8 } = m;

  // Rest on the idle tick: FRAME_TICK advances once per vblank, so this skips one frame in four.
  if ((mem8[FRAME_TICK] & FOUR_FRAME_PHASE_MASK) === 0) return;

  // Measure how far the aim lies ahead of the heading, as an eight-bit angle that wraps round the
  // circle, and add the offset. Gaps of 0 and 255 (on the aim, or one step past it) become 1 and 0,
  // both below the standing band, so the object stops turning there.
  const current = mem8[object + CURRENT_HEADING];
  const decidedOn = u8(mem8[object + AIM_HEADING] - current + TEST_OFFSET);
  if (decidedOn < STANDING_BAND) return;

  // Otherwise turn two units: up when the (offset) gap is under a half turn, so the aim is ahead
  // the short way; down when it is a half turn or more. The heading byte wraps at 256.
  mem8[object + CURRENT_HEADING] = decidedOn < HALF_TURN ? current + STEP : current - STEP;
}
