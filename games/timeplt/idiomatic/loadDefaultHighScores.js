import { HIGH_SCORE_TABLE_BASE, DEFAULT_HIGH_SCORE_TABLE } from "./names.js";
// SPDX-License-Identifier: GPL-3.0-only
/** loadDefaultHighScores — copy a forty-byte block out of program space into work RAM, byte for byte, nothing
 * skipped and nothing transformed. Both ends and the length are fixed here, so it takes no
 * argument and running it twice changes nothing the first run did not. LIVE-OUT: memory only.
 *
 * ROM 0x4BA5-0x4BB0 (frozen lift translated/loc_4ba5.js): `ld hl,0x4bb1 / ld de,0xab08 / ld bc,0x0028 /
 * ldir / ret`. Grounding: [seen] (names.js ROUTINES 0x4ba5: "copy forty bytes of program space into the
 * five-entry high-score table, which is the only way that table is ever initialised").
 *
 * Role in the machine: seeds the high-score board. The table at HIGH_SCORE_TABLE_BASE 0xAB08 is five
 * records of eight bytes -- per record +0 rank, +1..+3 score low/mid/high, +4..+6 initials, +7 a 0xF1 pad (names.js,
 * High score block). The ROM defaults at DEFAULT_HIGH_SCORE_TABLE 0x4BB1 sit immediately after this
 * routine's own `ret` and are monotone decreasing in score. Under MAME the destination took exactly
 * one write, at boot, and none through a full driven game -- a table of defaults, afterwards kept up by
 * fileScoreIntoHighScoreTable's insertion sort (names.js "why").
 *
 * Note: this routine's own code bytes are read as data by the image's anti-tamper checksum
 * (loadDefaultHighScores_ADDR in names.js), and the default block is also a tamper-path derail target
 * (DEFAULT_HIGH_SCORE_TABLE); that concerns the ROM image, not what this routine does.
 */

// Five records of eight bytes (the ROM's `ld bc,0x0028`).
const BYTES = 40;

export function loadDefaultHighScores(m) {
  const { mem8 } = m;
  // The ROM's `ldir`: an ascending byte copy of the whole block, ROM defaults -> work-RAM table.
  // Source and destination do not overlap, so the direction does not matter.
  for (let i = 0; i < BYTES; i++) mem8[HIGH_SCORE_TABLE_BASE + i] = mem8[DEFAULT_HIGH_SCORE_TABLE + i];
}
