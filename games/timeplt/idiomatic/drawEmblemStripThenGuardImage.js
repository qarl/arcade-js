// SPDX-License-Identifier: GPL-3.0-only
/** drawEmblemStripThenGuardImage — stamp a row of award emblems, then blank the rest of that row.
 * The enable cell gates the whole routine. The caller's count, clamped to six, sets how many
 * two-by-two emblems to stamp from a fixed cursor; the cursor then carries on and the row
 * is blanked down to a fixed floor. A running XOR over a fixed program span guards the image last.
 *
 * ROM 0x4D72-0x4DAE. Grounding: [seen] (names.js ROUTINES 0x4D72).
 *
 * ROLE IN THE MACHINE. This is command 5's handler in the command ring (word-table slot 5 at
 * 0x0BBC): the reserve-ships HUD. The count it is handed is the number of ships in reserve --
 * loadActivePlayerContextAndPostRoundHud posts LIVES_REMAINING minus one when a turn begins, and
 * awardBonusLifeAtScoreMark posts the same figure after a bonus life (mechanisms.md §8). Any
 * reserve beyond six is simply not shown. Because the enable cell is PLAY_ACTIVE 0xAD30 [seen],
 * which is clear throughout the attract demo, the strip is only ever drawn in credited play.
 *
 * The tail is an anti-tamper check, not part of the HUD: the 256 program bytes at
 * IMAGE_GUARD_BLOCK_0711_BASE (0x0711-0x0810) XOR-folded, plus 25, must come to zero on a genuine
 * image. On the real board a mismatch takes `jp nz,0x4BB1` into the default high-score block --
 * data, run as code (mechanisms.md, "Derails into data"); this port stops with an error there.
 * PARAMETER: count = the reserve-ship count, the ring command's argument (the ROM's A).
 * LIVE-OUT: memory only. */

import { NotImplemented } from "../../../boards/timeplt/io.js";
import { u8 } from "../../../core/int.js";
import { stampTwoByTwoTileBlock } from "./stampTwoByTwoTileBlock.js";
import { paintGlyphOverBlankInColourThenStepCursor } from "./paintGlyphOverBlankInColourThenStepCursor.js";
import { PLAY_ACTIVE, IMAGE_GUARD_BLOCK_0711_BASE, EMBLEM_STRIP_FLOOR, EMBLEM_STRIP_TOP } from "./names.js";

// At most six emblems fit the strip (ROM `cp 0x07 / jr c / ld a,0x06` at 0x4D7C-0x4D80).
const MAX_EMBLEMS = 6;
// Each emblem is tiles 9-12 in colour 0x18 (ROM `ld b,0x09 / ld c,0x18` at 0x4D85-0x4D87).
const EMBLEM_BASE = 9;
const EMBLEM_COLOUR = 24;
// The rest of the row is cleared with the blank glyph 0xF1 in colour 0x10 (ROM `ld bc,0xf110`).
const BLANK_GLYPH = 241;
const BLANK_COLOUR = 16;
// The guard: 256 bytes XOR-folded (`ld b,0x00` + djnz wraps to 256 passes), then +0x19 must be 0.
const CHECK_LEN = 256;
const CHECK_BIAS = 25;

export function drawEmblemStripThenGuardImage(m, count = m.regs.a) {
  const { mem8 } = m;
  // Gate: nothing at all happens outside credited play (`ld a,(0xad30) / and a / ret z`) -- not
  // even the image check.
  if (mem8[PLAY_ACTIVE] === 0) return;

  // STAMP. Starting at the strip's top cell, stamp one 2x2 emblem per reserve ship. A count of
  // zero stamps nothing (`and a / jr z,0x4d91`).
  // each callee advances the cursor and returns it; carry that forward to the next.
  let cursor = EMBLEM_STRIP_TOP;
  for (let emblems = count > MAX_EMBLEMS ? MAX_EMBLEMS : count; emblems !== 0; emblems--) {
    cursor = stampTwoByTwoTileBlock(m, EMBLEM_BASE, EMBLEM_COLOUR, cursor);
  }

  // BLANK. From wherever the emblems stopped, blank cells down to and including
  // EMBLEM_STRIP_FLOOR 0xA623, so cells a longer strip stamped earlier are cleared. The ROM
  // tests the bound as `ld hl,0x59dd / add hl,de / jr nc`: 0x59DD + DE carries exactly when
  // DE >= 0xA623.
  while (cursor >= EMBLEM_STRIP_FLOOR) {
    cursor = paintGlyphOverBlankInColourThenStepCursor(m, cursor, BLANK_GLYPH, BLANK_COLOUR);
  }

  // GUARD. XOR-fold the program span 0x0711-0x0810 (ROM 0x4DA1-0x4DA9) and require fold + 25 == 0
  // (`add a,0x19 / jp nz,0x4bb1` at 0x4DA9-0x4DAB). Because of the gate above, the check
  // only ever runs in credited play.
  let check = 0;
  for (let i = 0; i < CHECK_LEN; i++) check ^= mem8[IMAGE_GUARD_BLOCK_0711_BASE + i];
  if (u8(check + CHECK_BIAS) !== 0) throw new NotImplemented("drawEmblemStripThenGuardImage: the guarded program block does not fold to zero, so the image is tampered; a genuine image never does");
}
