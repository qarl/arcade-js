// SPDX-License-Identifier: GPL-3.0-only
/** pickScriptAtRandomOrInTurn — draw a byte and let one comparison against SCRIPT_PICK_THRESHOLD decide
 * between two answers: at or above the threshold, fold the draw down to one of four values in a band and
 * return it; below it, ignore the draw and return the next entry of a five-long round-robin counter
 * (stepped and wrapped).
 *
 * ROM 0x382D-0x3846 (frozen lift translated/loc_382d.js). Grounding: [seen] (names.js ROUTINES 0x382D).
 *
 * Role in the machine: chooses the movement script a freshly spawned enemy craft will follow. Its
 * two callers, driveEnemyWaveForLifePhase and spawnEnemyIntoFreeSlotElseStepSearch, store the answer (the first after adding 9)
 * at the new object's +0x0A, and stepCraftFlightScript later uses that byte to pick a run from the word
 * table at 0x3438 and walk it (names.js "why"). SCRIPT_PICK_THRESHOLD (0xACC4) is set per round by
 * the era/rung configuration, so a higher threshold biases the game toward the ordered cycle.
 *
 * The two arms answer from DISJOINT ranges — the random arm only 5 to 8, the rotation only 0 to 4 —
 * so which arm ran is recoverable from the answer alone.
 *
 * LIVE-OUT: the answer in A (returned), plus the counter on the second path. */

import { u8 } from "../../../core/int.js";
import { drawRandomByte } from "./drawRandomByte.js";
import { SCRIPT_CYCLE_COUNTER, SCRIPT_PICK_THRESHOLD } from "./names.js";


// Random arm: `and 0x03` keeps one of four values, `add a,0x05` moves them to 5..8.
const BAND_SIZE = 4;
const FIRST_IN_BAND = 5;
// Rotation arm: `cp 0x05` — the counter runs 0..4 and wraps.
const CYCLE_LENGTH = 5;

export function pickScriptAtRandomOrInTurn(m) {
  const { mem8 } = m;
  // `call 0x4b4b`: the game's pseudo-random generator (a seventeen-byte shift register plus the
  // frame counter).
  const drawn = drawRandomByte(m);

  // `ld hl,0xacc4 / cp (hl) / jr nc`: no carry means the draw is at or above the threshold. Then the
  // draw itself is the answer, folded into the band 5..8; nothing is written.
  if (drawn >= mem8[SCRIPT_PICK_THRESHOLD]) {
    return (m.regs.a = (drawn % BAND_SIZE) + FIRST_IN_BAND);
  }

  // Below the threshold the draw is discarded. `ld hl,0xa9cf / ld a,(hl) / inc a / cp 0x05`: step
  // SCRIPT_CYCLE_COUNTER; if that reaches 5, `xor a` wraps it to 0. `ld (hl),a` stores it back and
  // the same value is the answer.
  const stepped = u8(mem8[SCRIPT_CYCLE_COUNTER] + 1);
  const answer = stepped < CYCLE_LENGTH ? stepped : 0;
  mem8[SCRIPT_CYCLE_COUNTER] = answer;
  return (m.regs.a = answer);
}
