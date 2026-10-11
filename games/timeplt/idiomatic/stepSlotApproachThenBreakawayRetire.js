// SPDX-License-Identifier: GPL-3.0-only
/** stepSlotApproachThenBreakawayRetire — the per-pass handler for one slot in an object sweep. The record byte at +4 is an
 * approach countdown: while it runs, count it down by one and drive the object through its full
 * chased-object frame. Once it reads zero, fly the object at double velocity, animate its
 * shape, and retire the slot only if it has drifted onto a retire line. Either way step the sweep
 * onto the next slot. The record, its sprite entry and the sweep's turns left are arguments, handed
 * on to the turn-closer. LIVE-OUT: memory.
 *
 * ROM 0x4194-0x41B7. names.js tag: [seen].
 *
 * Role in the machine: one arm of serviceSlotByMarkerThenCloseSweepTurn, the body of the object-bank
 * sweep. That body sends a slot here when its marker byte (ix+0) is 0xFF (live) and ERA_INDEX is 4,
 * i.e. only in the fifth era (2001). Like every arm of that body it ends at closeOneTurnOfTheSlotSweep
 * (0x410B), which steps both cursors on to the next slot and re-enters the body while turns remain --
 * so this call services this slot and, through the closer, the rest of the bank.
 *
 * Inputs: `record` is the slot's sixteen-byte object record, `entry` its sprite entry, `turnsLeft`
 * the sweep's turns left; all three are seated by the sweep and only passed through here.
 *
 * The object's life in this arm has two phases, told apart by the countdown at record +4:
 *   - approach (countdown nonzero): flyTowardShipStandoffThenEndApproach steers the object at one of
 *     two fixed points and itself cuts the countdown to zero once it gets close, so the approach can
 *     end early as well as by running out;
 *   - breakaway (countdown zero): the object flies straight on at double velocity until it reaches a
 *     retire line, and then the slot is freed. */

import { u16 } from "../../../core/int.js";
import { OPENING_ERA_VELOCITY_TABLE } from "./names.js";
import { flyAlongHeadingAtDoubleVelocity } from "./flyAlongHeadingAtDoubleVelocity.js";
import { animateFixedShapeCycleFromShape50 } from "./animateFixedShapeCycleFromShape50.js";
import { hasReachedRetireLine } from "./hasReachedRetireLine.js";
import { retireSlot } from "./retireSlot.js";
import { closeOneTurnOfTheSlotSweep } from "./closeOneTurnOfTheSlotSweep.js";
import { flyTowardShipStandoffThenEndApproach } from "./flyTowardShipStandoffThenEndApproach.js";

// Offset of the approach countdown in the object record (ix+0x04).
const COUNTDOWN = 4;
// the velocity table the breakaway flies the object along
// (0x5E00 -- the ROM reaches the mover through the shim at 0x58B6, whose only job is to fix this table)
const BREAKAWAY_VELOCITY_TABLE = OPENING_ERA_VELOCITY_TABLE;

export function stepSlotApproachThenBreakawayRetire(m, record = m.regs.ix, entry = m.regs.iy, turnsLeft = m.regs.b) {
  const { mem8 } = m;
  const countdown = u16(record + COUNTDOWN);

  // `ld a,(ix+0x04) / and a / jp z,0x41a4`: a zero countdown means the approach is over.
  if (mem8[countdown] === 0) {
    // Breakaway, 0x41A4 onward. The ROM brackets these calls with `push bc` / `pop bc` to keep the
    // sweep's turn count in B safe from the callees; here `turnsLeft` is a plain argument, so nothing needs
    // saving. Fly one step along the held heading at twice the velocity (call 0x58B6), then give the
    // sprite the current frame of its eight-frame shape cycle (call 0x41F1).
    flyAlongHeadingAtDoubleVelocity(m, BREAKAWAY_VELOCITY_TABLE, record, entry);
    animateFixedShapeCycleFromShape50(m, entry);
    // call 0x2B83 answers in carry whether the object sits on either retire line; `jp nc,0x410b`
    // skips the retirement, otherwise call 0x40AB frees the slot (occupancy byte and both sprite
    // coordinates zeroed). The object is not retired for simply losing its approach -- only for
    // leaving the field this way.
    if (hasReachedRetireLine(m, entry)) retireSlot(m, record, entry);
    // Tail jump to 0x410B: close this turn and carry the sweep on.
    return closeOneTurnOfTheSlotSweep(m, record, entry, turnsLeft);
  }

  // Approach, 0x419B onward. `dec (ix+0x04)` -- the countdown is nonzero here, so it cannot wrap --
  // then one full chased-object frame (call 0x41B8): re-aim on passes that find FRAME_TICK's low four bits zero, then turn, move and
  // dress the sprite.
  mem8[countdown] = (mem8[countdown] - 1);
  flyTowardShipStandoffThenEndApproach(m, record, entry);
  // Tail jump to 0x410B, the same turn-closer as the breakaway arm. The chased-object frame's own
  // retire-line answer is not acted on here.
  return closeOneTurnOfTheSlotSweep(m, record, entry, turnsLeft);
}
