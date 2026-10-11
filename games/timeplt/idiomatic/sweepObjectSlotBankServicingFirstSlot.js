// SPDX-License-Identifier: GPL-3.0-only
/** sweepObjectSlotBankServicingFirstSlot — sweep a fixed bank of object slots for one frame from the seated cursors. Each slot's
 * marker routes it: empty is skipped, the ballistic marker flies the object a step, any other marker
 * services its shape-cycle. Cursors stride one record and one sprite entry per slot; the seated count
 * bounds the pass, and the first slot is always serviced. LIVE-OUT: memory; returns where the cursors
 * stopped ({ record, sprite, count }, the count run out to zero).
 *
 * ROM 0x4008 (the loop body at 0x4008-0x4016 plus the loop head at 0x3FF9). Grounding: [seen]
 * (names.js ROUTINES 0x4008).
 *
 * ROLE IN THE MACHINE. Part of the era-0 three-slot object bank that the round engine runs once per
 * pass of its service list (mechanisms.md, "Era 0"). The bank's slots are ERA_OBJECT_RECORD_SLOT0..2 (0xA8C0, 0xA8D0,
 * 0xA8E0) with sprite entries ERA_OBJECT_ENTRY_SLOT0..2 (0xAA28, 0xAA2A, 0xAA2C). In the ROM this
 * address is not a separate routine but a mid-loop entry point of the sweep whose head is 0x3FF9
 * (sweepObjectSlotBankByHead): the point reached once a slot's marker has been found to be a
 * countdown; the ROM reaches it with `jr nz,0x4008` (from 0x3FEA's first-slot test, and from the
 * loop head at 0x3FF9). In this port its callers are:
 *   - serviceEra0BallisticObjectBank (0x3FEA), when the bank's first slot carries a countdown marker;
 *   - advanceSlotThenSweepObjectBankByHead, when it strides onto such a slot part-way through.
 * Because the marker was already tested by whoever arrives here, the slot the cursors point at on
 * entry is serviced unconditionally; every following slot is routed by its own marker.
 *
 * WHAT A SLOT IS. A 0x10-byte object record (cursor `record`, the ROM's IX) paired with a two-byte
 * sprite entry (cursor `sprite`, the ROM's IY). Record byte +0 is the marker: 0x00 empty, 0xFF a
 * ballistic object, anything else a countdown for the one-shot shape cycle.
 *
 * PARAMETERS. `record` / `sprite` / `count` default to the IX, IY and B registers the ROM caller
 * leaves seated; `count` is how many slots remain including the one at `record`.
 *
 * LIVE-OUT: memory (slots and sprite entries serviced); returns { record, sprite, count } with the
 * cursors one stride past the last slot and count 0.
 */

import { u16 } from "../../../core/int.js";
import { runOneShotAnimatedObjectSlot } from "./runOneShotAnimatedObjectSlot.js";
import { flyAlongBallisticArc } from "./flyAlongBallisticArc.js";

// Per-slot strides: ROM `ld de,0x0010` / `add ix,de` for the record, `inc iy` twice for the entry.
const RECORD_STRIDE = 0x10;
const SPRITE_STRIDE = 2;
// Marker values in record byte +0 (tested at 0x3FF9 with `and a`, then `inc a` for 0xFF).
const EMPTY = 0x00;
const BALLISTIC = 0xff;

export function sweepObjectSlotBankServicingFirstSlot(m, record = m.regs.ix, sprite = m.regs.iy, count = m.regs.b) {
  const { mem8 } = m;
  // `service` carries the routing decision for the slot the cursors point at: true means "run its
  // shape cycle". It starts true because this entry point (0x4008) is only jumped to once the
  // current slot is known to hold a countdown marker.
  let service = true;
  for (;;) {
    // Step 1 — service a countdown slot. ROM 0x4008 `call 0x406c`: runOneShotAnimatedObjectSlot
    // [seen] runs the slot's shape cycle one frame — rearm at the cap, count down, retire the sprite
    // at zero, otherwise drift with the world scroll and pick the shape from the table at 0x4094.
    if (service) runOneShotAnimatedObjectSlot(m, record, sprite);

    // Step 2 — stride and count. ROM 0x400B-0x4014: IX += 0x10, IY += 2, then `djnz`. B is 8-bit
    // and decremented before the test; when it reaches zero the ROM `ret`s at 0x4016 and the whole
    // bank is done for this frame.
    record = u16(record + RECORD_STRIDE);
    sprite = u16(sprite + SPRITE_STRIDE);
    count = (count - 1) & 0xff;
    if (count === 0) return { record, sprite, count };

    // Step 3 — route the next slot by its marker (the loop head at 0x3FF9). An empty slot
    // (`jp z,0x400b`) goes straight back to the stride. A countdown marker (`jr nz,0x4008`) comes
    // round to Step 1. A ballistic marker (0xFF) is flown one frame by flyAlongBallisticArc [seen]
    // (`call 0x4017`) — a fixed sideways step plus a velocity that grows each frame, carried with the
    // world scroll — and then, like an empty slot, goes to the stride without the shape cycle.
    const marker = mem8[record];
    if (marker === EMPTY) { service = false; continue; }
    if (marker !== BALLISTIC) { service = true; continue; }
    flyAlongBallisticArc(m, record, sprite);
    service = false;
  }
}
