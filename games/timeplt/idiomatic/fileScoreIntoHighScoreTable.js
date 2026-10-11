// SPDX-License-Identifier: GPL-3.0-only
/** fileScoreIntoHighScoreTable — try to file the active player's finished score into the five-entry high-score board.
 * The standing records are read top (highest) first; the new score is compared against each until
 * the first one it is NOT below, which is where it belongs. The records beneath that slot slide
 * down one place, the new score is written into the freed slot with its three name cells set to a
 * blank sentinel, the record's initial-glyph row pointer is looked up from the byte the copy
 * uncovered, and the rank column is renumbered top to bottom. A score that beats none is dropped.
 *
 * ROM 0x4CC3-0x4D2A (frozen lift translated/loc_4cc3.js). Grounding: [seen] (names.js ROUTINES 0x4cc3).
 *
 * Role in the machine: the insertion step of the high-score board, run once per finished game.
 * Its caller, fileScoreAfterGameOverHoldElsePassTurn, runs it when the GAME OVER hold expires and
 * branches on the answer: a filed score goes on to initials entry, a dropped one skips it. The table is five records of eight bytes at 0xAB08..0xAB2F (HIGH_SCORE_TABLE_BASE ..
 * HIGH_SCORE_TABLE_END), each record laid out +0 rank, +1..+3 score lo/mid/hi, +4..+6 name glyphs, +7 a pad byte;
 * scores are three packed-BCD bytes compared from the most significant end (isScoreBelow).
 *
 * The two saved pointers are what initials entry works through afterwards: SCRATCH_PTR_A is left
 * on the filed record's name cells, SCRATCH_PTR_B on that rank's initials row in the character
 * plane (HIGH_SCORE_INITIALS_CELL_BASE + 2 * rank).
 *
 * LIVE-OUT: the board, the two saved pointers, and the answer, returned: true when the score was
 * dropped. The ROM leaves it in carry; its one reader is that caller (the call at 0x3310). */

import { u16 } from "../../../core/int.js";
import { isScoreBelow } from "./isScoreBelow.js";
import { ACTIVE_PLAYER, HIGH_SCORE_REC0_SCORE_HI, HIGH_SCORE_SLIDE_SRC, HIGH_SCORE_TABLE_BASE, HIGH_SCORE_TABLE_END, PLAYER1_SCORE_HI, PLAYER2_SCORE_HI, SCRATCH_PTR_A, SCRATCH_PTR_B, HIGH_SCORE_INITIALS_CELL_BASE } from "./names.js";

// Five records on the board, eight bytes apart (the ROM's `ld b,0x05` and its `ld a,0x08` step).
const RECORD_COUNT = 0x05;
const RECORD_STRIDE = 0x08;

// The glyph a freshly filed record's name cells are blanked with (`ld (hl),0xf1` at 0x4CF8).
const NAME_SENTINEL = 0xf1;

export function fileScoreIntoHighScoreTable(m) {
  const { mem8, mem16 } = m;

  // Whose score: ACTIVE_PLAYER 0 is player one, so the candidate is read from the most significant
  // byte of player one's score triple, else player two's.
  const scorePtr = mem8[ACTIVE_PLAYER] === 0 ? PLAYER1_SCORE_HI : PLAYER2_SCORE_HI;

  // Find the slot: walk the records from the top (record 0's score-hi byte) down, one record at a
  // time, and stop at the first standing score the candidate is not below. An equal score counts as
  // not below, so a tie files ABOVE the record it ties with. `rank` ends as the slot's index.
  let standing = HIGH_SCORE_REC0_SCORE_HI;
  let filed = false;
  let rank = 0;
  for (; rank < RECORD_COUNT; rank++) {
    if (!isScoreBelow(m, scorePtr, standing)) { filed = true; break; } // not below -> this is the slot
    standing = u16(standing + RECORD_STRIDE);
  }

  // Below all five: the board is left untouched and the score is dropped (the ROM's `scf; ret`).
  if (!filed) return true;

  // Slide the records beneath the slot down one place, eight cells each; when the slot is the bottom
  // record none slide.
  // Descending copy (highest cell first) so the eight-byte down-shift never clobbers a source
  // cell before it is read — the byte-for-byte effect an LDDR leaves.
  // The copy runs from HIGH_SCORE_SLIDE_SRC (record 3's last byte) to HIGH_SCORE_TABLE_END (record
  // 4's last byte), so the old bottom record is the one pushed off the board.
  const slideBytes = (RECORD_COUNT - 1 - rank) * RECORD_STRIDE;
  if (slideBytes > 0) {
    let src = HIGH_SCORE_SLIDE_SRC;
    let dst = HIGH_SCORE_TABLE_END;
    for (let n = slideBytes; n > 0; n--) {
      mem8[dst] = mem8[src];
      src = u16(src - 1);
      dst = u16(dst - 1);
    }
  }
  // Where the slide stopped is the slot record's last byte (+7); from here the slot is filled
  // downward, which is how the ROM's pointer arrives there after its `ex de,hl`.
  let slotPtr = u16(HIGH_SCORE_TABLE_END - slideBytes);

  // Blank three name cells (+6, +5, +4) with the sentinel, ready for initials entry to overwrite,
  // and park SCRATCH_PTR_A on the lowest of them (+4). The record's +7 byte is not written here.
  for (let i = 0; i < 3; i++) {
    slotPtr = u16(slotPtr - 1);
    mem8[slotPtr] = NAME_SENTINEL;
  }
  mem16[SCRATCH_PTR_A] = slotPtr;

  slotPtr = u16(slotPtr - 1);
  // copy the three score cells into the freed slot, top cell first (descending), as the LDDR did
  // (+3, +2, +1 receive the candidate's hi, mid and lo bytes).
  let src = scorePtr;
  let dst = slotPtr;
  for (let n = 3; n > 0; n--) {
    mem8[dst] = mem8[src];
    src = u16(src - 1);
    dst = u16(dst - 1);
  }

  // The byte left below the copied score is the slot's +0 rank cell, not yet renumbered. Doubled,
  // it indexes the per-rank initials cells in the character plane (two bytes per rank, from
  // HIGH_SCORE_INITIALS_CELL_BASE); that address is parked in SCRATCH_PTR_B. The doubling is a
  // byte add, as the ROM's `add a,a` before `rst 0x08`.
  const uncovered = mem8[u16(slotPtr - 3)]; // the rank the copy uncovered
  mem16[SCRATCH_PTR_B] = u16(HIGH_SCORE_INITIALS_CELL_BASE + ((uncovered + uncovered) & 0xff));

  // renumber the rank column top to bottom, 0 upward, one write per record
  // (+0 of each record, 0xAB08, 0xAB10, ... 0xAB28), so the slid records carry their new places.
  let rankAddr = HIGH_SCORE_TABLE_BASE;
  for (let r = 0; r < RECORD_COUNT; r++) {
    mem8[rankAddr] = r;
    rankAddr = u16(rankAddr + RECORD_STRIDE);
  }

  // Filed (the ROM ends with `scf; ccf`, carry clear).
  return false;
}
