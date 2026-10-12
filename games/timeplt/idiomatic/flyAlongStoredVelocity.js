// SPDX-License-Identifier: GPL-3.0-only
/** flyAlongStoredVelocity — fly one object a single step along the velocity it CARRIES, and in the same add
 * carry it with the world.
 *
 * Each of the object's two coordinates is sixteen bits stored split: the whole part in the
 * sprite entry, the fraction in the record, so a step smaller than a pixel banks instead of
 * vanishing. Each coordinate gains its own velocity word — read out of the object's own record
 * rather than looked up from a heading — PLUS a world-scroll displacement held in a fixed pair of
 * cells that every object shares. The two are folded into one add, which is why nothing else may
 * drift this object: a separate drift beside this would apply that shared displacement twice.
 * LIVE-OUT: memory only — the four coordinate bytes; nothing is clamped and nothing returned.
 *
 * ROM 0x3E05-0x3E35 (lift: translated/loc_3e05.js). Grounding: [seen].
 *
 * Role in the machine: the player's plane stays centred and the world scrolls past it, so every
 * object must move by the world scroll as well as by its own motion. The shared displacement is
 * WORLD_SCROLL_Y (0xA808) and WORLD_SCROLL_X (0xA80A) — named for the NATIVE sprite axes; under the
 * board's ROT90 native Y is the display's horizontal. The velocity words at +0x0A..+0x0D are
 * banked by other routines (e.g. fireBomberShotWhenClearOfPlayer and
 * fireCraftShotWhenAimedNearPlayer), never by this one; its sibling flyAlongHeading looks the
 * velocity up from a heading instead. Callers include serviceSlotByHeadByte, runParachutistSlot,
 * flyAndRetireSlotCyclingShapeInEra4 and flyBomberThenTryAimedShot.
 *
 * `object` is the object's record (the ROM's IX); `sprite` is its sprite entry (the ROM's IY).
 */

import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "./names.js";
import { addToCoordinate } from "./objectGeometry.js";

// Record offsets of the two velocity words, the two fraction bytes, and the sprite-entry offsets
// of the two whole bytes. The "high axis" is the native-Y coordinate (sprite +0x31, fraction +3),
// the "low axis" the native-X one (sprite +0x00, fraction +5) — see WORLD_SCROLL_X/Y in names.js.
const VELOCITY_HIGH_AXIS = 10;
const VELOCITY_LOW_AXIS = 12;
const FRACTION_HIGH_AXIS = 3;
const FRACTION_LOW_AXIS = 5;
const WHOLE_HIGH_AXIS = 49;
const WHOLE_LOW_AXIS = 0;

export function flyAlongStoredVelocity(m, object = m.regs.ix, sprite = m.regs.iy) {
  // Native-Y coordinate: velocity word at +0x0A plus WORLD_SCROLL_Y, added to the 8.8 value made
  // of sprite +0x31 (whole) and record +3 (fraction). ROM 0x3E05-0x3E1D.
  addToCoordinate(
    m, sprite + WHOLE_HIGH_AXIS, object + FRACTION_HIGH_AXIS,
    m.mem16[object + VELOCITY_HIGH_AXIS] + m.mem16[WORLD_SCROLL_Y],
  );
  // Native-X coordinate: velocity word at +0x0C plus WORLD_SCROLL_X, into sprite +0x00 / record
  // +5. ROM 0x3E1D-0x3E35.
  addToCoordinate(
    m, sprite + WHOLE_LOW_AXIS, object + FRACTION_LOW_AXIS,
    m.mem16[object + VELOCITY_LOW_AXIS] + m.mem16[WORLD_SCROLL_X],
  );
}
