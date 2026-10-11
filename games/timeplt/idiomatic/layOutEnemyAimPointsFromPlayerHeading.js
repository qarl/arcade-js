// SPDX-License-Identifier: GPL-3.0-only
/** layOutEnemyAimPointsFromPlayerHeading — when the mode byte in C selects sub-mode 7, lay the enemy aim anchor's twelve coordinate
 * fields (0xAC64 +0x10..+0x1b, the standoff aim points) out as six XY pairs around centre (0x78 across, 0x84 down): the scroll angle
 * turned a quarter and the scroll angle itself, each drawn through the velocity table at an x8 and an
 * x16 radius, the quarter-turned direction also mirrored to its negatives; every other sub-mode
 * returns without a write.
 *
 * ROM 0x326C-0x32EA (lift: translated/loc_326c.js). Grounding: [seen] (names.js ROUTINES 0x326C).
 *
 * ROLE IN THE MACHINE. Enemy re-aim code steers toward aim points (mechanisms.md, record +1);
 * this routine lays a set of those points out around the ship's fixed screen position. Its caller
 * is reaimEnemyCraftByFlightScriptOnPhaseTick, which runs first in each round-engine dispatch and
 * passes the low place of the life tick counter (LIFE_TICKS_LOW 0xAD05 [seen]) as the mode byte.
 * That byte is packed decimal, so "low nibble == 7" means "units digit 7": on those passes (and
 * not on the 00-09 / 30-39 passes that re-aim a craft instead) the points are laid out from the
 * heading as it stood before this dispatch's turn (mechanisms.md, round engine order).
 *
 * The "scroll angle" in the name is PLAYER_HEADING 0xA802 [seen]: the world scroll is the negated
 * ship velocity (names.js WORLD_SCROLL_Y), so the ship's heading also fixes the scroll direction. The fields are written from ENEMY_AIM_ANCHOR_Y 0xAC64 [seen], the enemy aim anchor.
 *
 * PARAMETER: mode = the mode byte (which the caller loaded from LIFE_TICKS_LOW).
 * LIVE-OUT: fields 0x10-0x1b of that object; no return value. */

import { loc_59d1 } from "./loc_59d1.js";
import { u8, u16 } from "../../../core/int.js";
import { ENEMY_AIM_ANCHOR_Y, PLAYER_HEADING } from "./names.js";

// `and 0x0f` / `cp 0x07` / `ret nz` at 0x326D-0x3271: only sub-mode 7 lays anything out.
const UNITS_DIGIT_MASK = 0x0f;
const LAYOUT_UNITS_DIGIT = 0x07;
// A quarter of the 256-step circle (`add a,0x40` at 0x3279).
const QUARTER_TURN = 0x40;
// The centre the points are laid around: 0x78 across, 0x84 down -- the player's fixed screen
// position (mechanisms.md: the player's sprite entry sits at +0x31 = 0x78 and +0 = 0x84).
const ACROSS = 0x78;
const DOWN = 0x84;

/** Store term's high byte at the x8 and x16 radii, offset from centre; MIRROR also seats the
 *  negatives (centre - h, a neg-then-add) four fields along from each.
 *
 *  The ROM does this with HL = term, then `add hl,hl` three times (x8) and once more (x16),
 *  taking H each time -- so each radius is the whole part of term x 8 or x 16. */
function plot(m, base, term, centre, off8, off16, mirror) {
  const { mem8 } = m;
  // The x8 radius: the point, and (if mirrored) the point diametrically opposite.
  const h8 = u8(u16(term << 3) >> 8);
  mem8[u16(base + off8)] = u8(h8 + centre);
  if (mirror) mem8[u16(base + off8 + 4)] = u8(centre - h8);
  // The x16 radius: the same direction twice as far out.
  const h16 = u8(u16(u16(term << 3) << 1) >> 8);
  mem8[u16(base + off16)] = u8(h16 + centre);
  if (mirror) mem8[u16(base + off16 + 4)] = u8(centre - h16);
}

export function layOutEnemyAimPointsFromPlayerHeading(m, mode = m.regs.c) {
  const { mem8 } = m;

  /* Step 1 -- only on sub-mode 7 (0x326D-0x3272); every other value returns with no write. */
  if ((mode & UNITS_DIGIT_MASK) !== LAYOUT_UNITS_DIGIT) return;
  // The base is a fixed anchor; the index register it once rode through is dead past this routine,
  // so a plain constant reproduces the field writes.
  const base = ENEMY_AIM_ANCHOR_Y;

  /* Step 2 -- the quarter-turned direction (heading + 0x40). loc_59d1 hands back the doubled
   * component pair for a heading from a fixed table of samples (the velocity table): the first
   * component lands across (fields 0x10/0x12, mirrored to 0x14/0x16), the second down (0x11/0x13,
   * mirrored to 0x15/0x17). Each mirrored point is the first reflected through the centre. */
  const [quarterAcross, quarterDown] = loc_59d1(m, u8(mem8[PLAYER_HEADING] + QUARTER_TURN));
  plot(m, base, quarterAcross, ACROSS, 0x10, 0x12, true);
  plot(m, base, quarterDown, DOWN, 0x11, 0x13, true);

  /* Step 3 -- the heading itself, unmirrored (fields 0x18-0x1B): one point at each of the same
   * two radii, with no reflection. */
  const [straightAcross, straightDown] = loc_59d1(m, mem8[PLAYER_HEADING]);
  plot(m, base, straightAcross, ACROSS, 0x18, 0x1a, false);
  plot(m, base, straightDown, DOWN, 0x19, 0x1b, false);
}
