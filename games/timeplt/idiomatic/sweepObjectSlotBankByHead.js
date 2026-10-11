// SPDX-License-Identifier: GPL-3.0-only
/** sweepObjectSlotBankByHead — sweep a fixed bank of object slots for a frame, servicing each occupied one. An empty
 * head (0) is left alone, a ballistic head (0xFF) is flown a frame along its arc, any other value is
 * a live countdown the shape-cycle service runs down; the cursor strides one record and two
 * sprite-entry bytes per slot, for the caller's count. LIVE-OUT: memory.
 *
 * ROM 0x3FF9-0x4016. Grounding: [seen] (names.js ROUTINES 0x3ff9).
 *
 * ROLE IN THE MACHINE. In the ROM this is the loop head of the era-0 three-slot object bank
 * (mechanisms.md: "the loop head of the era-0 three-slot ballistic bank"). serviceEra0BallisticObjectBank
 * (0x3FEA) seats the cursors — record 0xA8C0 (ERA_OBJECT_RECORD_SLOT0), sprite entry 0xAA28
 * (ERA_OBJECT_ENTRY_SLOT0), count 3 — and its code runs straight on into 0x3FF9; the loop's `djnz`
 * at 0x4014 jumps back here for each further slot. The ROM also enters the same loop mid-way at 0x4008
 * (sweepObjectSlotBankServicingFirstSlot) and at 0x400B (advanceSlotThenSweepObjectBankByHead); in
 * this port those entries are their own routines, and this file is the whole loop entered at its head.
 *
 * WHAT A SLOT IS. Each slot is a 0x10-byte object record (the cursor the ROM keeps in IX) paired with
 * a two-byte sprite entry (the cursor in IY): per names.js runOneShotAnimatedObjectSlot, entry bytes
 * +0 and +0x31 hold the sprite's position (zeroed to retire it), +1 its shape and +0x30 its
 * attribute. Byte +0 of the record, the "head", says what the slot holds.
 *
 * PARAMETERS. `firstRecord` / `firstEntry` / `slots` are the record cursor, sprite-entry cursor and
 * slot count the caller seats before entering.
 *
 * LIVE-OUT: memory (the serviced slots and sprite entries); IX and IY are written back to where the
 * cursors stopped (one stride past the last slot), and that pair is also returned.
 * Kept as the ROUTINES override of 0x3FF9: no idiomatic module calls
 * it, because serviceEra0BallisticObjectBank enters the loop through its mid-loop entries instead.
 */

import { u16 } from "../../../core/int.js";
import { flyAlongBallisticArc } from "./flyAlongBallisticArc.js";
import { runOneShotAnimatedObjectSlot } from "./runOneShotAnimatedObjectSlot.js";

// Per-slot strides: records are 0x10 bytes apart (ROM `ld de,0x0010` / `add ix,de` at 0x400B),
// sprite entries two bytes apart (ROM `inc iy` twice at 0x4010/0x4012).
const RECORD_STRIDE = 0x10;
const ENTRY_STRIDE = 2;
// The head value that marks a slot flying a ballistic arc (the ROM tests it with `inc a`: 0xFF+1 = 0).
const BALLISTIC = 0xff;

export function sweepObjectSlotBankByHead(m, firstRecord = m.regs.ix, firstEntry = m.regs.iy, slots = m.regs.b) {
  const { mem8 } = m;
  let record = firstRecord;
  let entry = firstEntry;
  let count = slots;

  for (;;) {
    // Step 1 — route this slot by its head byte. ROM 0x3FF9 `ld a,(ix+0x00)` / `and a` /
    // `jp z,0x400b`: a zero head is an empty slot and goes straight to the stride. Otherwise
    // `inc a` / `jr nz,0x4008`: a head of 0xFF is a ballistic object, and `call 0x4017`
    // (flyAlongBallisticArc [seen]) flies it one frame — a fixed sideways step plus a velocity that
    // grows every frame, carried with the world scroll, retiring the slot once it leaves the field.
    // Any other non-zero head is a countdown: 0x4008 `call 0x406c` (runOneShotAnimatedObjectSlot
    // [seen]) runs the slot's shape cycle one frame — drift with the world, count down, retire the
    // sprite at zero.
    const head = mem8[record];
    if (head === BALLISTIC) flyAlongBallisticArc(m, record, entry);
    else if (head !== 0) runOneShotAnimatedObjectSlot(m, record, entry);

    // Step 2 — stride to the next slot and count it off. ROM 0x400B-0x4014: IX += 0x10, IY += 2,
    // then `djnz 0x3ff9`. DJNZ decrements B first and loops while it is non-zero, so the count is
    // an 8-bit value and every slot up to the count is visited exactly once.
    record = u16(record + RECORD_STRIDE);
    entry = u16(entry + ENTRY_STRIDE);
    count = (count - 1) & 0xff;
    if (count === 0) break;
  }

  // Step 3 — the ROM leaves IX/IY pointing one stride past the bank when it `ret`s at 0x4016; hand
  // those cursors back in the registers and as the return value.
  return [m.regs.ix = record, m.regs.iy = entry];
}
