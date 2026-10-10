// SPDX-License-Identifier: GPL-3.0-only
/**
 * armRoundWonBandAnimationThenStepSequence — ROM 0x4A0F [seen]
 *
 * WHAT IT IS. The set-up for the between-eras band animation a won round plays (the time-warp
 * effect before the next era begins). It is sequence sub-step 13 of the round engine; the
 * animation itself is then run frame by frame by stepRoundStartIntroAnimation, which dispatches on
 * INTRO_ANIMATION_STEP.
 *
 * ROLE. It stocks the animation's eight-byte control block (the step seed, the flash tick, the two
 * band pass countdowns, the colour-cycle and colour-flood countdowns and the band script's start),
 * lays the band's backing picture along the first row of the character plane, colours the band's
 * rows and stub cells by adding the pen colour to fixed offsets, seeds the active player's saved
 * pen from its era, and tail-steps the sequence sub-step.
 *
 * HARDWARE. The character (tilemap) RAM has two planes 0x400 apart: the tile codes at 0xA400-0xA7FF
 * and their colour attributes at 0xA000-0xA3FF. The ROM addresses a colour cell by taking the
 * tile cell's address and clearing bit 10 (`res 2,h`), which is what toColour does. One row of the
 * plane is 32 cells, so ROW_STEP (-32) moves one row up the address space.
 *
 * LIVE-OUT: the block, the backing row, the coloured cells, the saved pen and the sub-step cell;
 * no register is live-out.
 */

import { u8, u16 } from "../../../core/int.js";
import { fillCellRun } from "./fillCellRun.js";
import { setSavedPenFromEra } from "./setSavedPenFromEra.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { PEN_COLOUR, INTRO_ANIMATION_STEP, PLAYER_FLASH_TICK, BAND_TO2_PASS_COUNTDOWN, SPRITE_COLOUR_CYCLE_COUNTDOWN, BAND_TO4_PASS_COUNTDOWN, COLOUR_FLOOD_COUNTDOWN, BAND_SCRIPT_CURSOR, CHAR_PLANE_BASE, INTRO_ANIMATION_STEP_SEED, BAND_SCRIPT_START, CHAR_PLANE_LOWER_RUN_BOTTOM, CHAR_PLANE_UPPER_RUN_BOTTOM, CHAR_PLANE_STUB_UPPER_LEFT, CHAR_PLANE_COLUMN_MID_BOTTOM, CHAR_PLANE_STUB_LOWER_LEFT } from "./names.js";

// One character row in cell addresses; the ROM adds DE = 0xFFE0, which fillCellRun leaves behind.
const ROW_STEP = -32;

const toColour = (cell) => cell & ~(1 << 10); // clear bit 10: tile-code plane -> colour plane

export function armRoundWonBandAnimationThenStepSequence(m) {
  const { mem8 } = m;

  // --- The control block, 0xA9F0-0xA9F8 (ROM 0x4A0F-0x4A34) ---
  // INTRO_ANIMATION_STEP, the step selector: seeded from ROM byte 0x3213 (INTRO_ANIMATION_STEP_SEED, a
  //    code byte that happens to be 0x00), so the animation starts at step 0;
  // PLAYER_FLASH_TICK, the flash tick, 0;
  // BAND_TO2_PASS_COUNTDOWN and BAND_TO4_PASS_COUNTDOWN, the two band pass countdowns, 0xFF each;
  // SPRITE_COLOUR_CYCLE_COUNTDOWN, the colour-cycle countdown, 4;
  // COLOUR_FLOOD_COUNTDOWN, the colour-flood countdown, 8;
  // BAND_SCRIPT_CURSOR (a word), aimed at the script's ROM start BAND_SCRIPT_START (0x56F1), stored
  //    little-endian.
  mem8[INTRO_ANIMATION_STEP] = mem8[INTRO_ANIMATION_STEP_SEED];
  mem8[PLAYER_FLASH_TICK] = 0x00;
  mem8[BAND_TO2_PASS_COUNTDOWN] = 0xff;
  mem8[SPRITE_COLOUR_CYCLE_COUNTDOWN] = 0x04;
  mem8[BAND_TO4_PASS_COUNTDOWN] = 0xff;
  mem8[COLOUR_FLOOD_COUNTDOWN] = 0x08; // 0xA9F5, the cell before this one, is deliberately left untouched
  mem8[BAND_SCRIPT_CURSOR] = BAND_SCRIPT_START;
  mem8[BAND_SCRIPT_CURSOR + 1] = BAND_SCRIPT_START >> 8;

  // --- The band's backing picture along the plane's first row (ROM 0x4A34-0x4A53) ---
  // From CHAR_PLANE_BASE (0xA400): thirteen tiles of code 0x14, two blank (0x00) tiles, thirteen
  // more 0x14 and four of 0x0E -- 32 cells, one full row.
  let cur = CHAR_PLANE_BASE;
  for (let i = 0; i < 13; i++) mem8[cur++] = 0x14;
  mem8[cur++] = 0x00;
  mem8[cur++] = 0x00;
  for (let i = 0; i < 13; i++) mem8[cur++] = 0x14;
  for (let i = 0; i < 4; i++) mem8[cur++] = 0x0e;

  // --- Colouring the band ---
  // Every colour written below is the live pen colour (PEN_COLOUR 0xAD0C) plus a fixed offset
  // (0x20, 0x60, 0xA0 or 0xE0), so the band takes the current caption colour.
  const base = mem8[PEN_COLOUR];

  // The lower run: fillCellRun (0x1319) fills thirteen colour cells upward from the one behind
  // CHAR_PLANE_LOWER_RUN_BOTTOM (0xA7B1 -> colour cell 0xA3B1) with pen + 0xA0.
  fillCellRun(m, u8(0xa0 + base), toColour(CHAR_PLANE_LOWER_RUN_BOTTOM));

  // The upper run: the same from CHAR_PLANE_UPPER_RUN_BOTTOM (0xA5D1 -> 0xA1D1) with pen + 0x20.
  fillCellRun(m, u8(0x20 + base), toColour(CHAR_PLANE_UPPER_RUN_BOTTOM));

  // three columns of the colour plane, each a cell and the cell one row above it
  // The warp-band flare corners at row 16, columns 0x10 and 0x12 (colour cells 0xA210 and 0xA212,
  // names.js [seen]) and the column-centre cell at column 0x11 (0xA211), each coloured together
  // with the cell one row above it (ROM 0x4A6D-0x4A97).
  paintColumn(mem8, toColour(CHAR_PLANE_STUB_UPPER_LEFT), u8(0xa0 + base), u8(0x20 + base));
  paintColumn(mem8, toColour(CHAR_PLANE_STUB_LOWER_LEFT), u8(0xe0 + base), u8(0x60 + base));
  paintColumn(mem8, toColour(CHAR_PLANE_COLUMN_MID_BOTTOM), u8(0xa0 + base), u8(0x20 + base));

  // Seed the pen (glyph and colour) that the active player's SAVED context block will hand back,
  // from the record the era selects (setSavedPenFromEra 0x339C); the live pen is left alone.
  setSavedPenFromEra(m);
  // Tail jump to 0x0F1A: step SEQUENCE_SUBSTEP so the next frame runs the following sub-step.
  return advanceSequenceSubStep(m);
}

// Colour one cell and the cell one row above it (the ROM's `ld (hl),a / add hl,de / ld (hl),a`).
function paintColumn(mem8, cell, here, above) {
  mem8[cell] = here;
  mem8[u16(cell + ROW_STEP)] = above;
}
