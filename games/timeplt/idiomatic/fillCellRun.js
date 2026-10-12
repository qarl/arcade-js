// SPDX-License-Identifier: GPL-3.0-only
/** fillCellRun — lay one byte across a fixed run of thirteen cells of a character line.
 * The cursor starts where the caller left it and steps back thirty-two addresses per cell, one
 * cell further along the line, so all thirteen come out uniform — a blanking character in the
 * character plane, a colour in the colour plane. LIVE-OUT: those thirteen cells, plus the
 * cell-step register left holding minus thirty-two, which callers walk on from without reloading
 * it. The run length is fixed here; the caller chooses only where it starts and what fills it.
 *
 * ROM 0x1319-0x1322 (lift: translated/loc_1319.js — `ld de,0xffe0 / ld b,0x0d /
 * loop: ld (hl),a / add hl,de / djnz loop / ret`). Grounding: [seen].
 *
 * Why minus thirty-two is "one cell along the line": the tilemap is 32 cells to a row in video
 * RAM, so -0x20 is one row back. The board is rotated a quarter turn (ROT90), so a fixed
 * video-RAM column shows on the glass as a horizontal line, and stepping a row in memory steps
 * one cell along that line. Callers (the scripted band animations advanceScriptedCharPlaneBandTo2
 * and ...To4, armRoundWonBandAnimationThenStepSequence, paintRoundWonBandTailThenStepSequence)
 * start it at a run's highest native row — e.g. CHAR_PLANE_LEFT_RUN_OUTER (0xA7B1) or its
 * colour-plane twin — and it walks thirteen native rows back toward row zero.
 *
 * `fill` is the byte to lay (the ROM's A) and `start` the first cell (the ROM's HL).
 */

import { u16 } from "../../../core/int.js";

// Thirteen cells (`ld b,0x0d`) stepped one tilemap row back each (`ld de,0xffe0`).
const RUN_CELLS = 13;
const CELL_STEP = -32;

export function fillCellRun(m, fill = m.regs.a, start = m.regs.hl) {
  const { mem8 } = m;
  // Store, then step the cursor one row back with 16-bit wrap — the `ld (hl),a / add hl,de` pair
  // repeated by `djnz` thirteen times.
  let cursor = start;
  for (let i = 0; i < RUN_CELLS; i++) {
    mem8[cursor] = fill;
    cursor = u16(cursor + CELL_STEP);
  }
  // The cell step is a live-out: the ROM's callers walk on from DE without reloading it, so it is
  // left in DE and returned.
  return (m.regs.de = u16(CELL_STEP));
}
