// SPDX-License-Identifier: GPL-3.0-only
/** advanceHitSoakingObjectThenAnimateDeath — advance one object that is still soaking up hits. While HITS_REMAINING is left, spend
 * one, keep the record live and re-request the pair of sounds, then hand off to the ordinary move.
 * Once no hits remain, run the record head down toward retirement, and at the values it crosses
 * reseat the sprite entry from the shape table. LIVE-OUT: memory.
 *
 * ROM 0x3B94-0x3C08 (frozen lift translated/loc_3b94.js). Grounding: [seen] in names.js.
 *
 * Role in the machine: this handles the big two-tile object that takes several hits to kill.
 * HITS_REMAINING (0xA8DC) counts the hits it can still ABSORB; a hit arriving while that count is
 * non-zero only spends one and the object keeps flying. When the count is already zero the hit is
 * fatal, and this routine then plays the object's death: the record head (0xFF while live) becomes
 * a countdown, the two tiles change colour, then shape, the kill is scored, and the slot retires.
 *
 * Parameters: `record` is the object's record, `entry` its sprite entry (the two tiles are adjacent
 * entries: +0x00 X, +0x01 tile, +0x30 attribute, +0x31 Y for the first; +0x02/+0x03/+0x32/+0x33
 * the same for the second). `headPlusOne` is the record head plus one as the caller hands it over —
 * the ROM opens with `dec a` to recover the raw head. */

import { u8 } from "../../../core/int.js";
import { HITS_REMAINING, DEATH_ANIMATION_SHAPE_TABLE } from "./names.js";
import { requestTwoSounds } from "./requestTwoSounds.js";
import { advanceTwoTileObjectThenTryAimedSpawn } from "./advanceTwoTileObjectThenTryAimedSpawn.js";
import { retireObjectAndHold } from "./retireObjectAndHold.js";
import { driftWithWorldScroll } from "./driftWithWorldScroll.js";
import { postCommand } from "./postCommand.js";
import { fetchTableByte } from "./fetchTableByte.js";

export function advanceHitSoakingObjectThenAnimateDeath(m, record = m.regs.ix, entry = m.regs.iy, headPlusOne = m.regs.a) {
  const { mem8 } = m;
  const head = u8(headPlusOne - 1);

  /* Arm 1 — a hit absorbed (0x3B96-0x3BA6).
   * With hits still in hand, spend one, force the head back to 0xFF (live), request the hit's pair
   * of sounds (0x5683), and carry on with the ordinary two-tile move (0x3B77, a tail jump), which
   * flies the object and keeps its second tile seated under the first. */
  if (mem8[HITS_REMAINING] !== 0) {
    mem8[HITS_REMAINING] = mem8[HITS_REMAINING] - 1;
    mem8[record] = 0xff;
    requestTwoSounds(m);
    return advanceTwoTileObjectThenTryAimedSpawn(m, record, entry);
  }

  /* Arm 2 — the death countdown. First frame (0x3BA9-0x3BBD): a head at 0x61 or above (a live
   * object reads 0xFF) is clamped to 0x61, so the countdown always starts from the same point; the
   * pair of sounds is requested and both tiles' attribute bytes (+0x30, +0x32) are set to 0x3D, recolouring
   * the wreck. */
  if (head >= 0x61) {
    mem8[record] = 0x61;
    requestTwoSounds(m);
    mem8[entry + 0x30] = 0x3d;
    mem8[entry + 0x32] = 0x3d;
  }

  /* Every death pass (`dec (ix+0x00)` at 0x3BBD): step the countdown. At zero the object and its
   * partner slot are taken out of play by retireObjectAndHold (0x3C0D, a tail transfer). */
  mem8[record] = mem8[record] - 1;
  if (mem8[record] === 0) return retireObjectAndHold(m, record, entry);

  /* Still dying: the wreck keeps drifting with the world (0x2B60), and the second tile is re-seated
   * directly under the first — same X (+0x02 <- +0x00), Y 0x10 further on (+0x33 <- +0x31 + 0x10). */
  driftWithWorldScroll(m, record, entry);
  mem8[entry + 0x33] = mem8[entry + 0x31] + 0x10;
  mem8[entry + 0x02] = mem8[entry + 0x00];

  /* The count at 0x40 (0x3BF1-0x3C08): post command 4 with argument 0x0B to the command ring
   * (rst 0x38) — command 4 is the score-award handler (awardScoreToPlayer), so the kill is scored
   * here — switch both tiles to the final shapes 0xFA/0xFB with attribute 0x6C, and step the count
   * once more so this arm runs only once. */
  const level = mem8[record];
  if (level === 0x40) {
    postCommand(m, 0x04, 0x0b);
    mem8[entry + 0x03] = 0xfa;
    mem8[entry + 0x01] = 0xfb;
    mem8[entry + 0x30] = 0x6c;
    mem8[entry + 0x32] = 0x6c;
    mem8[record] = mem8[record] - 1;
    return;
  }
  /* Below 0x40 the shapes set above simply hold until the count reaches zero. Above it, the shape
   * changes only on counts that are a multiple of eight above 0x40 (0x60 on the first death
   * frame, then 0x58, 0x50, 0x48). */
  if (level < 0x40) return;
  if (((level - 0x40) & 0x07) !== 0) return;

  /* Reseat the shape (0x3BE1-0x3BF0): (count - 0x40) / 8 - 1 indexes DEATH_ANIMATION_SHAPE_TABLE
   * (0x3C09) through fetchTableByte (rst 0x08); the second tile (+0x03) takes that shape and the
   * first (+0x01) the next shape code after it. */
  const shape = fetchTableByte(m, DEATH_ANIMATION_SHAPE_TABLE, ((level - 0x40) >> 3) - 1);
  mem8[entry + 0x03] = shape;
  mem8[entry + 0x01] = shape + 1;
}
