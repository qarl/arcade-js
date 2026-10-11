// SPDX-License-Identifier: GPL-3.0-only
/** turnFiveCraftAway — while the byte a caller points at still reads zero, stop five consecutive records
 * at a fixed base: each is given the same shape byte and has its step timer cleared. A non-zero
 * byte means nothing at all is touched, so this is a guarded reset and not a step, and the guard
 * byte is the caller's while the five records are this routine's own. The Z80 left the guard byte
 * and its test flags, or the reset loop's spent counter, stride and record cursor, standing in
 * registers; nothing after the call reads any of them, so they are not handed back.
 *
 * ROM 0x3855-0x386D (frozen lift translated/loc_3855.js). Grounding: [seen].
 *
 * Role in the machine: the enemy-wave substep driveEnemyWaveForLifePhase dispatches here at life
 * phase 7. It leaves the first five enemy-craft records, from CRAFT_RECORD_SLOT0 0xA850 at a
 * sixteen-byte stride, standing on the shape a finished animation ends on. Why this is a STOP:
 * the animation machine counts a record's step byte down once per dispatch and returns without
 * writing when it reads zero, so a zero step is never raised again; and 0x11 is the first byte of
 * every one of the eighteen animation runs in the table at 0x3438 — the resting shape. The sites
 * that START an animation store 0x20 into the same step byte.
 *
 * `guardAddr` is the address of the caller's guard byte (HL on the Z80).
 *
 * LIVE-OUT: the ten bytes. */

import { CRAFT_RECORD_SLOT0 } from "./names.js";

// Five craft records, sixteen bytes apart (`ld de,0x0010`, `ld b,0x05`); within each, byte +8 is
// the shape and byte +9 the animation step, and 0x11 is the resting shape the ROM stores.
const RECORD_STRIDE = 16;
const RECORDS = 5;
const SHAPE_BYTE = 8;
const STEP_TIMER = 9;
const RESTING_SHAPE = 17;

export function turnFiveCraftAway(m, guardAddr = m.regs.hl) {
  const { mem8 } = m;
  // The guard (`ld a,(hl); and a; ret nz`): only while the caller's byte reads zero is anything done.
  if (mem8[guardAddr] !== 0) return;

  // Settle each of the five records: resting shape in, step cleared so the animation never
  // advances it again.
  for (let i = 0; i < RECORDS; i++) {
    const record = CRAFT_RECORD_SLOT0 + i * RECORD_STRIDE;
    mem8[record + SHAPE_BYTE] = RESTING_SHAPE;
    mem8[record + STEP_TIMER] = 0;
  }
}
