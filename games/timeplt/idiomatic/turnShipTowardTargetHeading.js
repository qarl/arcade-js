// SPDX-License-Identifier: GPL-3.0-only
/** turnShipTowardTargetHeading — turn the ship one notch toward a wanted heading, then scroll the world to match.
 * The wanted heading comes from a fixed table indexed by the value handed in. The live heading in
 * PLAYER_HEADING is left alone when it already matches, snapped on when one notch either side would
 * reach it, and otherwise stepped the short way round the compass by three notches — four once the
 * era's low digit reaches three. Control then falls into the shared world-scroll tail. LIVE-OUT: memory.
 *
 * ROM 0x1F01-0x1F41 (frozen lift translated/loc_1f01.js; the step arms sit at 0x1F68 and 0x1F6F),
 * falling into scrollWorldAtTheEraPace at 0x1F42. Grounding: [seen] in names.js.
 *
 * Role in the machine: this is how the player steers. In Time Pilot the ship never leaves the
 * centre of the screen; the joystick picks a direction, the ship rotates toward it a few heading
 * steps per call, and the world scrolls opposite the heading. dispatchPlayerFrameByState calls this while
 * the ship is alive, play is live and the stick is off centre.
 *
 * Parameter: `stick` is the low nibble of the control word readPlayerControls returned (non-zero —
 * a centred stick never reaches here). PLAYER_HEADING (0xA802) is a whole byte: 256 steps round the
 * circle, so heading arithmetic wraps naturally at eight bits. */

import { u8 } from "../../../core/int.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { scrollWorldAtTheEraPace } from "./scrollWorldAtTheEraPace.js";
import { PLAYER_HEADING, ERA_INDEX, STICK_HEADING_TABLE } from "./names.js";

// `cp 0x03` on ERA_INDEX's low nibble (0x1F13): from era 3 on the ship turns faster.
const FAST_DIGIT = 3;
// The two turn rates in heading steps per call (`ld d,0x04` / `ld d,0x03`).
const FAST_STEP = 4;
const SLOW_STEP = 3;
// `add a,0x01 / cp 0x03` (0x1F1E-0x1F22): difference + 1 below 3 means one step either side.
const WITHIN_ONE_NOTCH = 3;
// `cp 0x80` (0x1F26): a difference of half the circle or more means the other way round is shorter.
const HALF_TURN = 128;

export function turnShipTowardTargetHeading(m, stick = m.regs.a) {
  const { mem8 } = m;
  /* Step 1 — look up the wanted heading (0x1F01-0x1F09).
   * The stick's direction bits index the byte table at 0x1F2E through fetchTableByte (rst 0x08),
   * giving the heading the ship should face for that stick position. (names.js notes that these
   * bytes are also reachable as code — the ROM reads that stretch as a data table here.) */
  const wanted = fetchTableByte(m, STICK_HEADING_TABLE, stick);
  const heading = mem8[PLAYER_HEADING];
  if (heading !== wanted) {
    /* Step 2 — choose how far to turn (0x1F0D-0x1F1D).
     * delta is (live - wanted) wrapped to a byte. The turn rate comes from the low nibble of
     * ERA_INDEX: three heading steps per call in the early eras, four once it reads 3 or more. */
    const delta = u8(heading - wanted);
    const step = (mem8[ERA_INDEX] & 0x0f) >= FAST_DIGIT ? FAST_STEP : SLOW_STEP;
    /* Step 3 — apply the turn.
     * - delta of 0xFF or 0x01 (one step either side; 0 already left above): snap straight onto the
     *   wanted heading (0x1F3E), so the turn finishes exactly on it.
     *   (A three- or four-step turn can still land past it; the following calls bring it back.)
     * - delta 0x80 or more: the wanted heading lies ahead going upward, so add the step (0x1F6F).
     * - otherwise: it lies the other way, so subtract the step (0x1F68).
     * Choosing by delta's half of the circle is what makes the ship turn the short way round. */
    if (u8(delta + 1) < WITHIN_ONE_NOTCH) mem8[PLAYER_HEADING] = wanted;
    else if (delta >= HALF_TURN) mem8[PLAYER_HEADING] = u8(heading + step);
    else mem8[PLAYER_HEADING] = u8(heading - step);
  }
  /* Step 4 — the shared tail at 0x1F42: move the world past the ship at the era's pace along the
   * (possibly new) heading. Every steering path, including a centred stick, ends here. */
  return scrollWorldAtTheEraPace(m, mem8[PLAYER_HEADING]);
}
