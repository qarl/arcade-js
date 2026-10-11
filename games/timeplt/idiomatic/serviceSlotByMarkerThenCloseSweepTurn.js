// SPDX-License-Identifier: GPL-3.0-only
/** serviceSlotByMarkerThenCloseSweepTurn — one turn of the per-slot sweep over an object bank: pick the slot's handler from its
 * marker byte and let that handler close the turn. A free slot (marker zero) is passed over; any
 * marker other than full is a drifting countdown object, stepped and then passed; a full marker is
 * a chased object whose handler turns on the era and on the record's countdown — the final era runs
 * the approach-then-breakaway handler, a live countdown flies the slot and ticks it, and a spent one
 * chases its aim point for the frame. Every path ends in closing the turn, which goes round again
 * while turns remain. The record cursor, the sprite-entry cursor and the turns left are this turn's
 * arguments and are handed on as arguments. LIVE-OUT: memory. */
//
// ROM 0x40EA-0x4107; lift: translated/loc_40ea.js. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. Each object bank is an array of sixteen-byte records (the object's state) with a
// parallel array of two-byte sprite entries (where and how it is drawn). sweepEra2PlusObjectBank
// (0x40D6) seats the record cursor (ix), the sprite-entry cursor (iy) and the turn count (b), then
// enters here; closeOneTurnOfTheSlotSweep (0x410B) steps both cursors one slot on, counts b down and
// re-enters this body while turns remain. So a call here services this slot AND every slot after it --
// the whole remaining bank -- and every arm below ends by closing the turn.
//
// The record's first byte, the marker, says what kind of occupant the slot has:
//   0x00        free -- nothing to do this frame;
//   0x01..0xFE  a counting object whose marker is its own countdown (see stepCountdownSlotThenCloseTurn);
//   0xFF        a full, live object whose handler depends on the era and on the countdown at +0x0E.
//
// LIVE-OUT: memory -- the records and sprite entries of this slot and the ones after it, as the
// handlers and the turn-closer leave them.

import { u16 } from "../../../core/int.js";
import { ERA_INDEX } from "./names.js";
import { closeOneTurnOfTheSlotSweep } from "./closeOneTurnOfTheSlotSweep.js";
import { stepDriftingCountdownObjectByEraFrames } from "./stepDriftingCountdownObjectByEraFrames.js";
import { stepSlotApproachThenBreakawayRetire } from "./stepSlotApproachThenBreakawayRetire.js";
import { flyAndRetireSlotCyclingShapeInEra4 } from "./flyAndRetireSlotCyclingShapeInEra4.js";
import { chaseOneAimPointAndRetireAtTheLine } from "./chaseOneAimPointAndRetireAtTheLine.js";

// Record offsets (from ix): the marker byte, and the live object's own countdown.
const MARKER = 0x00;
const COUNTDOWN = 0x0e;
// Marker values, and the one era (ERA_INDEX [seen], the manual's ROUND, 0-4) with its own full-slot handler.
const FREE = 0x00;
const FULL = 0xff;
const FINAL_ERA = 4;

export function serviceSlotByMarkerThenCloseSweepTurn(m, record = m.regs.ix, entry = m.regs.iy, turnsLeft = m.regs.b) {
  const { mem8 } = m;
  const marker = mem8[u16(record + MARKER)];

  // A free slot: go straight to the turn-closer (`and a / jp z,0x410b`).
  if (marker === FREE) return closeOneTurnOfTheSlotSweep(m, record, entry, turnsLeft);

  // Any marker short of 0xFF is a counting object (`inc a / jr nz,0x4108`): run it one frame on its
  // countdown -- drift, count down, retire at zero, animate -- then close the turn. In the ROM this is
  // the jump to 0x4108 (stepCountdownSlotThenCloseTurn), which falls straight into the turn-closer.
  if (marker !== FULL) {
    stepDriftingCountdownObjectByEraFrames(m, record, entry);
    return closeOneTurnOfTheSlotSweep(m, record, entry, turnsLeft);
  }

  // A full slot in the last era (ERA_INDEX == 4, `cp 0x04 / jp z,0x4194`) has its own handler:
  // stepSlotApproachThenBreakawayRetire runs the approach countdown at +4, then flies the object off at
  // double speed, and steps the sweep on itself -- so this arm hands over the turn count too.
  if (mem8[ERA_INDEX] === FINAL_ERA) return stepSlotApproachThenBreakawayRetire(m, record, entry, turnsLeft);

  // Any other era: branch on the record's countdown at +0x0E (`jp nz,0x418b`).
  const countdown = u16(record + COUNTDOWN);
  if (mem8[countdown] !== 0) {
    // a live countdown: fly the slot, tick its countdown, then close the turn. This is the ROM arm at
    // 0x418B (flyLiveSlotAndTickCountdown [seen]) written out: one step along the stored velocity,
    // retiring the slot if that step reaches a retire line, then the countdown at +0x0E drops by one.
    flyAndRetireSlotCyclingShapeInEra4(m, record, entry);
    mem8[countdown] = mem8[countdown] - 1;
    return closeOneTurnOfTheSlotSweep(m, record, entry, turnsLeft);
  }

  // The countdown is spent: the object now chases its aim point for a whole frame (re-aim on its
  // rationed frames, turn, move, dress its sprite, retire on a retire line) -- `call 0x4117` -- and
  // then the turn is closed (`jr 0x410b`).
  chaseOneAimPointAndRetireAtTheLine(m, record, entry);
  return closeOneTurnOfTheSlotSweep(m, record, entry, turnsLeft);
}
