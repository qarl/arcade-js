// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { ACTIVE_ENEMY_COUNT, ACTIVE_OBJECT_COUNT, SLOT_STATE } from "./names.js";

/**
 * clearActiveShots — reset the shot bank to its baseline. ROM 0x928f.
 *
 * Role in the machine: a reset leaf called at wave start and on collisions to wipe the active-shot
 * state. It zeroes the 12-entry per-slot state array and both running count cells so the shot/object
 * bookkeeping starts clean.
 *
 * Behavior: it walks SLOT_STATE from index 0x0b down to 0, storing 0x00 into each of the 12 cells, then
 * clears ACTIVE_OBJECT_COUNT and ACTIVE_ENEMY_COUNT to 0x00.
 *
 * Live-out: the 12-byte SLOT_STATE array and the two count cells, all zeroed. Returns the exit X the ROM
 * leaves, 0xff (the clear runs X past 0); Y is not touched. Grounding: [seen].
 */
export function clearActiveShots(m) {
  const { mem8 } = m;
  // Clear the 12-byte array.
  for (let x = 0x0b; x >= 0; x--) mem8[u16(SLOT_STATE + x)] = 0x00;
  // Clear the two associated flag cells.
  mem8[ACTIVE_OBJECT_COUNT] = 0x00;   // running object count
  mem8[ACTIVE_ENEMY_COUNT] = 0x00;    // running enemy count
  return 0xff;
}
