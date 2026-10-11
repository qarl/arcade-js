// SPDX-License-Identifier: GPL-3.0-only
/**
 * flyLiveSlotAndTickCountdown — service one live slot of the per-slot object sweep.
 *
 * WHAT IT IS: ROM 0x418B-0x4193, tag [seen] (names.js ROUTINES 0x418b). Three steps: fly the slot's
 * object a step along its stored velocity (retiring it if that step took it onto a retire line), tick
 * the slot's own countdown at record offset 0x0E down by one, then close this turn of the sweep.
 *
 * ROLE IN THE MACHINE: one arm of the object-bank sweep body (0x40EA). The body sends a slot here only
 * when its marker byte reads 0xFF (live), ERA_INDEX is not 4, and the record's countdown at +0x0E is
 * nonzero; with a zero countdown the slot gets a chaseOneAimPointAndRetireAtTheLine frame instead
 * (names.js, the sweep body's role). So this is the phase of a live object's life in which it simply
 * flies on while its countdown runs out.
 *
 * LIVE-OUT: memory. Whatever the sweep's turn-closer hands back is returned.
 * Kept as the ROUTINES override of 0x418B: no idiomatic module calls
 * it, because serviceSlotByMarkerThenCloseSweepTurn runs this arm inline.
 */
import { u16 } from "../../../core/int.js";
import { closeOneTurnOfTheSlotSweep } from "./closeOneTurnOfTheSlotSweep.js";
import { flyAndRetireSlotCyclingShapeInEra4 } from "./flyAndRetireSlotCyclingShapeInEra4.js";

/* The slot's own countdown sits at +0x0E in its sixteen-byte record (the ROM's `dec (ix+0x0e)`). */
const COUNTDOWN_OFFSET = 0x0e;

/* `record` is the slot's record, the sweep's record cursor (the ROM's IX); `entry` the slot's sprite
 * entry, the sweep's entry cursor (IY); `turnsLeft` the turns the sweep has left (B). No routine in
 * this layer calls this entry -- the sweep body serviceSlotByMarkerThenCloseSweepTurn runs the same
 * three steps inline -- so the three are the registers the ROM's caller seats, handed on as
 * arguments from here. */
export function flyLiveSlotAndTickCountdown(m, record = m.regs.ix, entry = m.regs.iy, turnsLeft = m.regs.b) {
  /*
   * Step 1 (the ROM's `call 0x3e6c`): fly the object one step along the velocity it carries and retire
   * the slot if that step put it on a retire line. The mover works on the sweep's current record and
   * sprite entry.
   */
  flyAndRetireSlotCyclingShapeInEra4(m, record, entry);
  /*
   * Step 2: count the slot's countdown down by one. The byte wraps as the Z80's `dec` does; the sweep
   * body only sends a slot here while it is nonzero, and when it reaches zero the next pass takes the
   * body's other arm.
   */
  const countdown = u16(record + COUNTDOWN_OFFSET);
  m.mem8[countdown] = m.mem8[countdown] - 1;
  /*
   * Step 3 (the ROM's tail `jp 0x410b`): close this turn of the sweep -- step both cursors on to the next
   * slot and go round again while turns remain. Because it is a tail, one call here services this slot
   * and every slot after it in the bank.
   */
  return closeOneTurnOfTheSlotSweep(m, record, entry, turnsLeft);
}
