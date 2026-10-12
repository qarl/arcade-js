// SPDX-License-Identifier: GPL-3.0-only
/**
 * launchAttackerIntoFreeSlot — let one enemy craft launch an attacker into the era-object bank.
 *
 * ROM 0x4243-0x429B. Grounding: [seen] (names.js ROUTINES 0x4243).
 *
 * WHAT IT IS. Some enemy craft release a second object (an attacker) into the three-slot era-object
 * bank (records from ERA_OBJECT_RECORD_SLOT0 0xA8C0, sprite entries from ERA_OBJECT_ENTRY_SLOT0
 * 0xAA28). This is the gate in front of that launch. It runs for the craft whose slot the caller is
 * servicing, but acts only on that craft's own turn of an eight-frame round, only once a shared spawn
 * cooldown has run out, only when a bank slot is free, and not when the craft is close to both of
 * two fixed lines (0x78 on one sprite coordinate, 0x84 on the other).
 *
 * ROLE IN THE MACHINE. Called from the per-slot enemy-craft services of eras 0, 2, 3 and 4
 * (serviceEra0/2/3/4EnemyCraftSlot). Once a free slot is found it stashes the free slot's record and sprite-entry
 * addresses in SCRATCH_PTR_A / SCRATCH_PTR_B (0xA991 / 0xA993) and, past the proximity test, tails into a launcher: in era 0
 * the aim-window launcher (0x429C, setTheLaunchFacingInsideOneAimWindow), in any other era the
 * heading-follows launcher (0x42B7, commissionStagedAttackerByEra), which is handed the craft's
 * heading byte (record +0x02) as the new object's facing.
 *
 * PARAMETERS. `craftRecord` is the launching craft's object record, `craftEntry` its sprite entry.
 *
 * LIVE-OUT: memory.
 */

import { setTheLaunchFacingInsideOneAimWindow } from "./setTheLaunchFacingInsideOneAimWindow.js";
import { commissionStagedAttackerByEra } from "./commissionStagedAttackerByEra.js";
import { u8, u16 } from "../../../core/int.js";
import { ATTACKER_SPAWN_COOLDOWN, ATTACKER_SPAWN_SLOT_COUNT, ATTACKER_SPAWN_WINDOW_HALF, ERA_INDEX, ERA_OBJECT_ENTRY_SLOT0, ERA_OBJECT_RECORD_SLOT0, FRAME_TICK, SCRATCH_PTR_A, SCRATCH_PTR_B } from "./names.js";

// (FRAME_TICK & 7) + 5 is compared with the craft's record +0x0F turn byte.
const PHASE_BIAS = 5;
// One object record is sixteen bytes.
const RECORD_STRIDE = 0x10;
// The two fixed lines the proximity window is centred on (one per sprite coordinate).
const FIRST_LINE = 0x78;
const SECOND_LINE = 0x84;

export function launchAttackerIntoFreeSlot(m, craftRecord = m.regs.ix, craftEntry = m.regs.iy) {
  const { mem8 } = m;

  // Only on this craft's turn: the frame tick's low three bits, plus five, must equal the turn
  // byte at record +0x0F. That spreads the launch attempts of different craft over the eight frames.
  if ((mem8[FRAME_TICK] & 7) + PHASE_BIAS !== mem8[craftRecord + 0x0f]) return;

  // Shared cooldown (ATTACKER_SPAWN_COOLDOWN 0xA8F4): while it is nonzero, spend one from it and
  // launch nothing this turn.
  if (mem8[ATTACKER_SPAWN_COOLDOWN] !== 0) {
    mem8[ATTACKER_SPAWN_COOLDOWN] = mem8[ATTACKER_SPAWN_COOLDOWN] - 1;
    return;
  }

  // The per-era slot count (ATTACKER_SPAWN_SLOT_COUNT 0xA8C6) both enables the launcher (0 = never)
  // and bounds the free-slot search.
  let count = mem8[ATTACKER_SPAWN_SLOT_COUNT];
  if (count === 0) return;

  // Walk the bank for the first free record (head byte 0), stepping the record by 16 and the
  // sprite entry by 2 per slot. Every slot busy: give up.
  let record = ERA_OBJECT_RECORD_SLOT0;
  let entry = ERA_OBJECT_ENTRY_SLOT0;
  let free = false;
  for (; count > 0; count--) {
    if (mem8[record] === 0) { free = true; break; }
    record = (record & (0xff << 8)) | u8(record + RECORD_STRIDE); // step L only; the bank never carries into H
    entry = u16(entry + 2);
  }
  if (!free) return;

  // Stage the free slot for the launcher: its record in SCRATCH_PTR_A, its sprite entry in
  // SCRATCH_PTR_B. (These stay written even if the proximity test below refuses the launch.)
  m.mem16[SCRATCH_PTR_A] = record;
  m.mem16[SCRATCH_PTR_B] = entry;

  // Proximity test. With margin = ATTACKER_SPAWN_WINDOW_HALF (0xA8D6), (line - coordinate + margin)
  // is below 2 * margin exactly when the coordinate lies within the margin of the line (eight-bit
  // wrap makes one unsigned compare do both sides). The craft is refused only when it is inside
  // the window on BOTH coordinates: sprite-entry +0x31 against 0x78, then +0x00 against 0x84.
  const margin = mem8[ATTACKER_SPAWN_WINDOW_HALF];
  const window = u8(margin + margin);
  const yDelta = u8(FIRST_LINE - mem8[craftEntry + 0x31] + margin);
  if (yDelta < window) {
    const xDelta = u8(SECOND_LINE - mem8[craftEntry + 0x00] + margin);
    if (xDelta < window) return;
  }

  // Launch: the craft's heading (record +0x02) becomes the facing handed on. Era 0 goes to the
  // aim-window launcher, every other era to the heading-follows launcher.
  const facing = mem8[craftRecord + 0x02];
  if (mem8[ERA_INDEX] === 0) return setTheLaunchFacingInsideOneAimWindow(m, craftRecord, craftEntry);
  return commissionStagedAttackerByEra(m, craftRecord, craftEntry, facing);
}
