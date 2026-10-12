// SPDX-License-Identifier: GPL-3.0-only
/** flyBomberThenTryAimedShot — advance a two-tile object one step: fly it along its stored velocity, then place its
 * second tile beside the first (same X, Y + 0x10; native Y runs across the glass). If it has reached a boundary,
 * retire it; otherwise dress the pair by heading and run the bomber's aimed-shot attempt. LIVE-OUT: memory. */
//
// ROM 0x3B77-0x3B93 (lift: translated/loc_3b77.js). Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. This object is drawn as two sprite entries side by side on the glass, so
// every step both must be moved together. names.js records the caller as serviceEra1BomberObject
// (0x3B5F): in era 1 it dispatches the single object at record 0xA8C0 on its head byte, and a head of
// 0xFF runs THIS routine -- the per-pass "fly it" arm of that object's life.
//
// PARAMETERS. `record` is the object's work-RAM record (the ROM's IX) and `sprite` is its sprite entry
// (the ROM's IY); both are seated by the caller and passed straight through to every step below.
//
// LIVE-OUT: memory only -- the object's record and its two sprite entries, plus whatever the retire
// or spawn tails write. Nothing is returned to the caller beyond what those tails return.

import { u8, u16 } from "../../../core/int.js";
import { flyAlongStoredVelocity } from "./flyAlongStoredVelocity.js";
import { hasReachedBoundaryBandSelectedByHeading } from "./hasReachedBoundaryBandSelectedByHeading.js";
import { retireObjectAndHold } from "./retireObjectAndHold.js";
import { mirrorTwoTileObjectByHeading } from "./mirrorTwoTileObjectByHeading.js";
import { fireBomberShotWhenClearOfPlayer } from "./fireBomberShotWhenClearOfPlayer.js";

// Offsets into the sprite-entry area (from IY). The first tile's Y lives at +0x31 and the second
// tile's at +0x33; the first tile's X at +0x00 and the second's at +0x02 -- the two entries sit one
// stride (two bytes) apart in each coordinate run, matching the ROM's `ld (iy+0x33)` / `ld (iy+0x02)`.
const TILE_Y = 0x31;
const SECOND_TILE_Y = 0x33;
const TILE_X = 0x00;
const SECOND_TILE_X = 0x02;
// The second tile sits a fixed 0x10 further along native Y than the first (`add a,0x10` at 0x3B7D).
const TILE_DROP = 0x10;

export function flyBomberThenTryAimedShot(m, record = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;

  // STEP 1 -- MOVE (call 0x3E05). Fly the first tile one step along the velocity stored in the
  // object's record; the same add also carries it with the world's per-frame scroll, so the object
  // keeps its place relative to the scrolling sky.
  flyAlongStoredVelocity(m, record, sprite);
  // STEP 2 -- KEEP THE PAIR TOGETHER (0x3B7A-0x3B87). Only the first tile was moved, so re-seat the
  // second from it: Y = first Y + 0x10 (wrapping at a byte, as the Z80 add does), X = first X. The two
  // hardware sprites then draw as one wide object, side by side on the glass.
  mem8[u16(sprite + SECOND_TILE_Y)] = u8(mem8[u16(sprite + TILE_Y)] + TILE_DROP);
  mem8[u16(sprite + SECOND_TILE_X)] = mem8[u16(sprite + TILE_X)];

  // STEP 3 -- OFF THE EDGE? (call 0x3CC4, answered in carry in the ROM). If the object has reached the
  // boundary band its heading selects, it is retired (tail `jp c,0x3C0D`) and nothing more happens
  // this pass.
  if (hasReachedBoundaryBandSelectedByHeading(m, record, sprite)) return retireObjectAndHold(m, record, sprite);
  // STEP 4 -- STILL IN PLAY. Dress the two entries with the shape pair for its damage and heading
  // (call 0x3CE9), then tail into the aimed-shot attempt (jp 0x3D25, fireBomberShotWhenClearOfPlayer), which may fire one aimed
  // shot from this object when its own gates allow.
  mirrorTwoTileObjectByHeading(m, record, sprite);
  return fireBomberShotWhenClearOfPlayer(m, record, sprite);
}
