// SPDX-License-Identifier: GPL-3.0-only
/** stepCountdownSlotThenCloseTurn — service one counting slot of the per-slot object sweep: run the slot's object one
 * frame on its own countdown, then close the turn. LIVE-OUT: memory, the two cursors, the counter
 * and the wide scratch pair the turn close leaves.
 * Kept as the ROUTINES override of 0x4108: no idiomatic module calls
 * it, because serviceSlotByMarkerThenCloseSweepTurn runs this arm inline.
 */
//
// ROM 0x4108 (`call 0x413c`, stepDriftingCountdownObjectByEraFrames), falling byte-for-byte into
// 0x410B (closeOneTurnOfTheSlotSweep); lift: translated/loc_4108.js, which carries both as one body
// (0x4108-0x4116). Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. Its only entrant is serviceSlotByMarkerThenCloseSweepTurn's arm for a marker
// byte (record +0) that is neither free (0x00) nor full (0xFF) -- `inc a / jr nz,0x4108` -- where the
// marker is the object's own countdown. What the object is (debris, an explosion) is not settled by the
// code, so it is named only as a counting slot. The record cursor (ix), the sprite-entry cursor (iy)
// and the turns left (b) arrive as the sweep left them.
//
// LIVE-OUT: memory, plus the cursors, the counter and the scratch pair the turn-closer leaves.

// One frame of the counting object: re-stamp and sound at its reset mark, drift with the world scroll,
// count down, retire the slot at zero, else show the era-chosen animation frame. Then close the turn:
// step to the next record (0x10) and sprite entry (2) and run the next turn while any remain.

import { stepDriftingCountdownObjectByEraFrames } from "./stepDriftingCountdownObjectByEraFrames.js";
import { closeOneTurnOfTheSlotSweep } from "./closeOneTurnOfTheSlotSweep.js";

// The record cursor, the entry cursor and the turns left (IX, IY, B) are this entry's inputs, the
// registers the ROM's caller seats. No routine in this layer calls it --
// serviceSlotByMarkerThenCloseSweepTurn runs the same two steps inline -- and they are handed on as
// arguments from here.
export function stepCountdownSlotThenCloseTurn(m, record = m.regs.ix, entry = m.regs.iy, turnsLeft = m.regs.b) {
  stepDriftingCountdownObjectByEraFrames(m, record, entry);
  return closeOneTurnOfTheSlotSweep(m, record, entry, turnsLeft);
}
