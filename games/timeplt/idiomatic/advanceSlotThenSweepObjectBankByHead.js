// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceSlotThenSweepObjectBankByHead — the advance-step entry of the object-bank sweep.
 *
 * ROM 0x400B (the stride-and-count step at 0x400B-0x4016, looping back through the marker test at
 * 0x3FF9). Grounding: [seen] (names.js ROUTINES 0x400b).
 *
 * WHAT IT IS. Time Pilot keeps a small bank of special objects in fixed slots. Each slot is a
 * sixteen-byte object record in work RAM, paired with a two-byte sprite entry; the slot's first byte
 * (its "marker" or head) says what the slot holds: 0x00 = empty, 0xFF = an object flying a ballistic
 * arc, anything else = an object with its own state to service. This routine is entered with the
 * record and sprite cursors sitting on a slot that has just been dealt with, and walks forward
 * through the rest of the bank until either the bank runs out or it finds a slot that needs the full
 * servicing sweep.
 *
 * ROLE IN THE MACHINE. It is the "step over" leg of the era-0 ballistic-object bank service
 * (serviceEra0BallisticObjectBank, ROM 0x3FEA, which starts the walk at record 0xA8C0 / sprite entry
 * 0xAA28 with three slots) and of the servicing sweep itself (sweepObjectSlotBankServicingFirstSlot,
 * ROM 0x4008).
 *
 * ROM VS THIS PORT. In the ROM 0x400B is not a routine of its own: it is the stride step inside the
 * loop, reached from `jp z,0x400b` at 0x3FFD, `jr 0x400b` at 0x4006 and the run-on from 0x4008, and
 * its `djnz 0x3ff9` at 0x4014 returns to the marker test, which routes every later slot itself. This
 * port's function instead walks only to the first slot bearing a marker other than 0x00/0xFF and
 * hands that slot and the rest of the bank to sweepObjectSlotBankServicingFirstSlot.
 *
 * PARAMETERS. `record` is the current slot's record address, `sprite` its sprite-entry address and
 * `count` the slots left in the walk, counting this one -- the three cursors the caller carried.
 *
 * LIVE-OUT: memory (whatever the ballistic flight or the servicing sweep writes); returns where the
 * cursors stopped as { record, sprite, count } -- from the servicing sweep when it hands off.
 */

import { u16 } from "../../../core/int.js";
import { sweepObjectSlotBankServicingFirstSlot } from "./sweepObjectSlotBankServicingFirstSlot.js";
import { flyAlongBallisticArc } from "./flyAlongBallisticArc.js";

// One object record is sixteen bytes; one sprite entry is two (the ROM adds 0x0010 to IX and
// increments IY twice per slot).
const RECORD_STRIDE = 0x10;
const SPRITE_STRIDE = 2;
// The slot-marker alphabet this entry distinguishes.
const EMPTY = 0x00;
const BALLISTIC = 0xff;

export function advanceSlotThenSweepObjectBankByHead(m, record = m.regs.ix, sprite = m.regs.iy, count = m.regs.b) {
  const { mem8 } = m;
  for (;;) {
    // Step both cursors onto the next slot and spend one from the count (the ROM's
    // `add ix,de / inc iy / inc iy / djnz`). When the count reaches zero the whole bank has been
    // walked and the sweep is over for this frame.
    record = u16(record + RECORD_STRIDE);
    sprite = u16(sprite + SPRITE_STRIDE);
    count = (count - 1) & 0xff;
    if (count === 0) return { record, sprite, count };

    // Route the new slot by its marker byte (record +0x00):
    //  - empty: nothing to do, step on;
    //  - anything but 0xFF: an object with its own state, so the servicing sweep takes over this
    //    slot and every slot after it (it carries the walk to the end of the bank itself);
    //  - 0xFF: a ballistic object -- fly it one frame along its arc here, then step on.
    const marker = mem8[record];
    if (marker === EMPTY) continue;
    if (marker !== BALLISTIC) return sweepObjectSlotBankServicingFirstSlot(m, record, sprite, count);
    flyAlongBallisticArc(m, record, sprite);
  }
}
