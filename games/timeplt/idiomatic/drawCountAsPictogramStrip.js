// SPDX-License-Identifier: GPL-3.0-only
/**
 * drawCountAsPictogramStrip — paint a count (clamped to 99) as a strip of tally blocks, like roman
 * numerals: thirties and tens as four-tile blocks, fives as two-tile blocks, ones as single glyphs.
 * Then check three words of the program image and reset the machine if they do not add up.
 *
 * ROM 0x0DD7-0x0E6F. Grounding: [seen] (names.js ROUTINES 0x0DD7).
 *
 * ROLE IN THE MACHINE. The handler for drawing command 6 on the command ring — the queue of drawing
 * jobs the foreground loop executes. When a turn begins, loadActivePlayerContextAndPostRoundHud
 * [seen] posts command 6 with ROUND_NUMBER, so this is the round (stage) indicator on the HUD; the
 * high-score attract screen posts it with 1. The strip occupies the character-plane cells from
 * COUNT_PICTOGRAM_STRIP_START (0xA463) up to EMBLEM_STRIP_FLOOR (0xA623); the emblem strip grows
 * toward it from the other end of the same band.
 *
 * PARAMETER. `tally` is the count the ring command carried.
 *
 * THE IMAGE CHECK. Like many Time Pilot routines this one carries an anti-tamper test on the program
 * image: three fixed low-ROM words (at 0x009D, 0x00A0, 0x00A3 — code bytes read as data) are added,
 * the two bytes of the sum folded together, and the result must come to 0x69. On a genuine image it
 * always does, so the failure arm is dead code; a patched image jumps to the reset vector.
 *
 * LIVE-OUT: the painted strip (glyphs and colours); on a failed check, control goes to the reset
 * vector and never returns.
 */

import { trampolineToProbeExpansionThenSettleControlLatch } from "./trampolineToProbeExpansionThenSettleControlLatch.js";
import { drawSlotWithOneGlyph } from "./drawSlotWithOneGlyph.js";
import { paintDoubleTile } from "./paintDoubleTile.js";
import { paintQuadTile } from "./paintQuadTile.js";
import { IMAGE_CHECKSUM_WORD_009D, IMAGE_CHECKSUM_WORD_00A0, IMAGE_CHECKSUM_WORD_00A3, COUNT_PICTOGRAM_STRIP_START, EMBLEM_STRIP_FLOOR } from "./names.js";

// Padding past the last block: glyph 0xF1 (the blank glyph) in colour 0x10 — the pair loaded by
// `ld bc,0xf110` at 0x0E4C.
const BLANK_GLYPH = 0xf1;
const BLANK_COLOUR = 0x10;
// The image check's expected fold (`sub 0x69` at 0x0E6A).
const CHECKSUM_TARGET = 0x69;

export function drawCountAsPictogramStrip(m, tally = m.regs.a) {
  const { mem16 } = m;

  // Clamp (0x0DDA `cp 0x64`): 100 or more is drawn as 99.
  // Split greedily (0x0DE3-0x0E02), as the ROM does by repeated subtraction of 30, 10 and 5:
  // e.g. 47 = one thirty, one ten, one five, two ones.
  let value = tally >= 100 ? 99 : tally;
  const thirties = Math.floor(value / 30); value %= 30;
  const tens = Math.floor(value / 10); value %= 10;
  const fives = Math.floor(value / 5); value %= 5;
  const ones = value;

  // One row per denomination, in the order the ROM paints them — smallest first:
  //   [count, glyph or base tile code, colour, painter]
  //   ones     glyph 0x01, colour 0x13, one glyph per slot   (drawSlotWithOneGlyph [seen], 0x0E8D)
  //   fives    base 0x32,  colour 0x11, two-tile block       (paintDoubleTile [seen], 0x0E9C)
  //   tens     base 0xCE,  colour 0x16, four-tile block      (paintQuadTile [seen], 0x0E70)
  //   thirties base 0x23,  colour 0x11, four-tile block      (paintQuadTile again)
  // Tens and thirties share a block size and differ only in tile base and colour.
  const denominations = [
    [ones, 0x01, 0x13, drawSlotWithOneGlyph],
    [fives, 0x32, 0x11, paintDoubleTile],
    [tens, 0xce, 0x16, paintQuadTile],
    [thirties, 0x23, 0x11, paintQuadTile],
  ];

  // Paint (0x0E04-0x0E4A): each painter lays its block at the cursor and returns the cursor stepped
  // clear of it, so the blocks chain one after another along the strip.
  let cursor = COUNT_PICTOGRAM_STRIP_START;
  for (const [count, glyph, colour, paint] of denominations) {
    for (let i = 0; i < count; i++) cursor = paint(m, cursor, glyph, colour);
  }
  // Pad (0x0E4C-0x0E58): blank the rest of the strip up to EMBLEM_STRIP_FLOOR, so a smaller count
  // than last time leaves no stale blocks. (The ROM detects the floor as the carry out of
  // `ld hl,0x59DD / add hl,de`, which carries exactly when the cursor reaches 0xA623.)
  while (cursor < EMBLEM_STRIP_FLOOR) cursor = drawSlotWithOneGlyph(m, cursor, BLANK_GLYPH, BLANK_COLOUR);

  // Image check (0x0E5A-0x0E6C): add the three little-endian program words, then add the sum's low
  // and high bytes together; the 8-bit result minus 0x69 must be zero. A mismatch takes
  // `jp nz,0x0000` — the reset vector, trampolineToProbeExpansionThenSettleControlLatch [seen] —
  // which restarts the machine from power-on. A genuine image simply returns.
  const sum = mem16[IMAGE_CHECKSUM_WORD_00A0] + mem16[IMAGE_CHECKSUM_WORD_00A3] + mem16[IMAGE_CHECKSUM_WORD_009D];
  const fold = ((sum & 0xff) + ((sum >> 8) & 0xff) - CHECKSUM_TARGET) & 0xff;
  if (fold !== 0) return trampolineToProbeExpansionThenSettleControlLatch(m);
}
