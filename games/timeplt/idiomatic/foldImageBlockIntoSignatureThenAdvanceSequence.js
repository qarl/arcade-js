// SPDX-License-Identifier: GPL-3.0-only
/**
 * foldImageBlockIntoSignatureThenAdvanceSequence — one step of the tamper-check sequence.
 *
 * WHAT IT IS: ROM 0x17E2-0x17FA, tag [seen] (names.js ROUTINES 0x17e2). It sets scenery slot 7's sprite
 * code byte to all bits, folds a fixed block of the program image into a running total seeded from an image byte,
 * banks the result, and steps the inner sequence index on.
 *
 * ROLE IN THE MACHINE: an anti-tamper check. The banked total, TAMPER_IMAGE_SIGNATURE (0xAA6F), is
 * tested once, by the sequence arm at ROM 0x2730 as `cp 0x76`, which jumps off the genuine path (to
 * 0x2530) on a mismatch; 0x76 is what the thirty ROM bytes at 0x335E sum to on a genuine image
 * (names.js, the cell and foldBlockIntoTotal's "why", which puts that read three frames after this
 * one). So a modified image sends the game off its genuine path a few frames later. The same cell is
 * also sprite entry 23's Y byte (scenery slot 7's): the scenery placement writes it (0x3102, 0x313B)
 * and every frame's publish copies it out.
 *
 * SCENERY_SPRITE_CODE_SLOT7 (0xAA3F) is scenery slot 7's sprite code byte: the era scenery fill seats it
 * and every frame's publish copies it to sprite RAM, so the 0xFF stands until the next playfield reset
 * (mechanisms.md). A second pointer is walked in step with the block and contributes nothing to the total.
 *
 * LIVE-OUT: memory-only.
 */

import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { foldBlockIntoTotal } from "./foldBlockIntoTotal.js";
import { trampolineToSelectFoldBlock } from "./trampolineToSelectFoldBlock.js";
import { TAMPER_IMAGE_SIGNATURE, TAMPER_SIGNATURE_SEED_BYTE, SCENERY_SPRITE_CODE_SLOT7, guardBlockOrBlankDisplay_ADDR } from "./names.js";

/* The code stored: every bit set (the ROM's `ld a,0xff`). */
const ALL_BITS = 255;

export function foldImageBlockIntoSignatureThenAdvanceSequence(m) {
  const { mem8 } = m;
  /* Step 1: set scenery slot 7's sprite code byte 0xAA3F to 0xFF (`ld (0xaa3f),a`). */
  mem8[SCENERY_SPRITE_CODE_SLOT7] = ALL_BITS;

  /*
   * Step 2: find the block. The ROM calls 0x4BD9, a bare jump to selectFoldBlock (0x08AE), which hands
   * back the block's start and length: 0x335E and thirty bytes (`ld hl,0x335e / ld b,0x1e`).
   */
  const [blockStart, blockLength] = trampolineToSelectFoldBlock(m);
  /*
   * Step 3: fold the block into a total and bank it (ROM `call 0x291e / ld (0xaa6f),a`).
   *  - The seed is the image byte at 0x27C0 (TAMPER_SIGNATURE_SEED_BYTE; 0x00 on a genuine image).
   *  - The total wraps at eight bits.
   *  - The passenger pointer starts at 0x17B9, the first byte of routine guardBlockOrBlankDisplay's own
   *    code read as data (the ROM's `ld de,0x17b9`). foldBlockIntoTotal walks it alongside the block but
   *    only its last byte survives, and that byte is not part of the total.
   */
  mem8[TAMPER_IMAGE_SIGNATURE] = foldBlockIntoTotal(
    m,
    mem8[TAMPER_SIGNATURE_SEED_BYTE],
    blockStart,
    guardBlockOrBlankDisplay_ADDR,
    blockLength,
  );

  /*
   * Step 4 (the ROM's tail `jp 0x0f1a`): step the inner sequence index on, so the next frame runs the
   * next arm of the sequence.
   */
  advanceSequenceSubStep(m);
}
