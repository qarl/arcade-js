// SPDX-License-Identifier: GPL-3.0-only
/** drawInterpolatedPenRun — draw one interpolated run of pen cells, then set up the next run. From the pen's
 * current row and column (each a fraction:integer pair) take a signed per-step increment of
 * (target - current) times sixteen with only the high byte kept, then stamp the pen glyph cell by
 * cell, advancing both positions each step, until the stamped cell reaches the run's end cell.
 * Then bump the run index, read the next run's row and column out of the word table, reseat the
 * pen there with the fractions cleared, and report whether the new row integer is zero.
 *
 * ROM 0x0201-0x026E. Grounding: [seen] (names.js ROUTINES 0x0201).
 *
 * ROLE IN THE MACHINE. The sequence machine's "pen" walks a fixed route as an 8.8 fixed-point
 * interpolator (names.js, the pen route block 0xA9E2-0xA9EA): each frame one arm calls this
 * routine to draw one leg. blankKillMeterThenAdvancePenRunStep (phase 3, the round engine, step 2),
 * advancePenRunAnimationStep and erasePenRouteThenOpenInitialsEntry all do, and all stay on their step until the route reseats on row
 * zero -- the live-out below (mechanisms.md). What a leg leaves on screen is whatever the pen
 * pair holds: plotPenCell stamps PEN_GLYPH into the character plane and PEN_COLOUR into the colour
 * plane, and each of the image's pen seats stores the blank glyph 0xF1, so what a walk changes is the colour of the cells it crosses.
 *
 * Cells (all [seen] unless noted, names.js): PEN_ROW_POS 0xA9E3 / PEN_COLUMN_POS 0xA9E5 are the
 * pen's 8.8 row and column; PEN_ROW_STEP 0xA9E7 / PEN_COLUMN_STEP 0xA9E9 their signed per-step
 * increments; PEN_ROUTE_LEG 0xA9E2 the leg index into PEN_ROUTE_TABLE 0x0290. The targets are the
 * words at PEN_ROW_TARGET 0x32F5 and PEN_COLUMN_TARGET 0x0B45, and the run's end is the video-cell
 * address held in the word at PEN_RUN_END_CELL 0x14B2.
 * LIVE-OUT: the stamped cells and the pen state; returns true when the pen reseated on row zero,
 * the condition the ROM leaves in Z (`ld a,e / and a`) for its callers' `ret nz`. */

import { u16 } from "../../../core/int.js";
import { plotPenCell } from "./plotPenCell.js";
import { fetchTableWord } from "./fetchTableWord.js";
import { PEN_COLUMN_POS, PEN_COLUMN_STEP, PEN_ROUTE_LEG, PEN_ROW_POS, PEN_ROW_STEP, PEN_ROUTE_TABLE, PEN_COLUMN_TARGET, PEN_RUN_END_CELL, PEN_ROW_TARGET } from "./names.js";

/** (target - current) times sixteen, keeping only the signed high byte: the per-step increment.
 * ROM (row half, 0x0204-0x0218): `sbc hl,bc` forms the 16-bit difference, four `add hl,hl` make
 * it x16, `ld a,0 / sbc a,0` turns the carry out of the last doubling (bit 12 of the difference)
 * into 0x00 or 0xFF, and `ld l,h / ld h,a` keeps the high byte as the new low byte with that sign
 * above it. The net effect is the difference divided by sixteen, sign kept, as an 8.8 step. */
function stepToward(target, current) {
  const delta = u16(target - current);
  const highByte = (delta >> 12) & 1 ? (0xff << 8) : 0;
  return u16(highByte | ((delta >> 4) & 0xff));
}

export function drawInterpolatedPenRun(m) {
  const { mem8, mem16 } = m;

  // SET UP THE LEG. Stamp the pen's current cell first (call 0x026F), then compute the two
  // per-step increments toward the targets, each about a sixteenth of the remaining distance.
  plotPenCell(m);
  mem16[PEN_ROW_STEP] = stepToward(mem16[PEN_ROW_TARGET], mem16[PEN_ROW_POS]);
  mem16[PEN_COLUMN_STEP] = stepToward(mem16[PEN_COLUMN_TARGET], mem16[PEN_COLUMN_POS]);

  // WALK THE LEG (ROM 0x0232-0x0252). Each step adds the increments to the 8.8 positions -- the
  // fractions accumulate, so the line is interpolated below whole-cell resolution -- and stamps
  // the cell the whole parts now name. plotPenCell returns that cell's video-plane address; the
  // loop runs until it equals the end cell (`sbc hl,de / jp nz,0x0232`).
  let cell;
  do {
    mem16[PEN_ROW_POS] = mem16[PEN_ROW_POS] + mem16[PEN_ROW_STEP];
    mem16[PEN_COLUMN_POS] = mem16[PEN_COLUMN_POS] + mem16[PEN_COLUMN_STEP];
    cell = plotPenCell(m)[0];
  } while (cell !== mem16[PEN_RUN_END_CELL]);

  // NEXT LEG (ROM 0x0255-0x025D). Bump the leg index and fetch that leg's start word from
  // PEN_ROUTE_TABLE 0x0290 (RST 0x10, fetchTableWord).
  mem8[PEN_ROUTE_LEG] = mem8[PEN_ROUTE_LEG] + 1;
  const word = fetchTableWord(m, mem8[PEN_ROUTE_LEG], PEN_ROUTE_TABLE);

  // RESEAT THE PEN (ROM 0x025E-0x026B): the word's low byte becomes the row's whole part and its
  // high byte the column's, both fractions cleared, so the next leg starts exactly on a cell.
  const rowInt = word & 0xff;
  mem8[PEN_ROW_POS] = 0;
  mem8[PEN_ROW_POS + 1] = rowInt;
  mem8[PEN_COLUMN_POS] = 0;
  mem8[PEN_COLUMN_POS + 1] = word >> 8;

  // ROM 0x026C-0x026D `ld a,e / and a`: the callers `ret nz` unless the new row integer is zero.
  return rowInt === 0;
}
