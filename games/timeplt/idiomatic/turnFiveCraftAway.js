// SPDX-License-Identifier: GPL-3.0-only
/** turnFiveCraftAway — while the byte a caller points at still reads zero, order five consecutive
 * craft records at a fixed base to turn away: each is given steering order 0x11 and has its script
 * position cleared. A non-zero byte means nothing at all is touched; the guard byte is the
 * caller's while the five records are this routine's own. The Z80 left the guard byte and its
 * test flags, or the loop's spent counter, stride and record cursor, standing in registers;
 * nothing after the call reads any of them, so they are not handed back.
 *
 * ROM 0x3855-0x386D (frozen lift translated/loc_3855.js). Grounding: [seen].
 *
 * Role in the machine: the enemy-wave substep driveEnemyWaveForLifePhase dispatches here at life
 * phase 7. It reaches the first five enemy-craft records, from CRAFT_RECORD_SLOT0 0xA850 at a
 * sixteen-byte stride. The re-aim pass reads order 0x11 as: take the heading toward the 0xAC65
 * anchor plus 0x80 (directly away), then hold. The zero position means stepCraftFlightScript
 * returns without writing, so no script order replaces the 0x11.
 *
 * `guardAddr` is the address of the caller's guard byte (HL on the Z80).
 *
 * LIVE-OUT: the ten bytes. */

import { CRAFT_RECORD_SLOT0 } from "./names.js";

// Five craft records, sixteen bytes apart (`ld de,0x0010`, `ld b,0x05`); within each, byte +8 is
// the steering order and byte +9 the script position, and 0x11 is the turn-away order.
const RECORD_STRIDE = 16;
const RECORDS = 5;
const STEERING_ORDER = 8;
const SCRIPT_POSITION = 9;
const TURN_AWAY = 17;

export function turnFiveCraftAway(m, guardAddr = m.regs.hl) {
  const { mem8 } = m;
  // The guard (`ld a,(hl); and a; ret nz`): only while the caller's byte reads zero is anything done.
  if (mem8[guardAddr] !== 0) return;

  // Each of the five records: turn-away order in, script position cleared so the script never
  // overwrites the order.
  for (let i = 0; i < RECORDS; i++) {
    const record = CRAFT_RECORD_SLOT0 + i * RECORD_STRIDE;
    mem8[record + STEERING_ORDER] = TURN_AWAY;
    mem8[record + SCRIPT_POSITION] = 0;
  }
}
