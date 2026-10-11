// SPDX-License-Identifier: GPL-3.0-only
/**
 * publishSpriteShadow — publish the sprite shadow into the two hardware banks. Each bank is gathered from three runs of the
 * shadow, in an order that is not the order they sit in memory, into one continuous forty-eight-byte block, and each
 * byte passes through a transform chosen by TWO things: which half of its two-byte sprite it is, and which way round
 * the cabinet has the picture. Of the four bank-and-orientation pairs, one (upright bank 0) passes both halves straight, two transform one half and pass the other
 * through; the fourth transforms both halves, differently. Every transform is byte-wide, so all of them wrap.
 *
 * Afterwards, and only inside one window of the sequence machine, eight of the twenty-four sprites have 0x80 added
 * to both their bytes — and only where the second half's top bit is still clear, so a second pass changes nothing.
 * LIVE-OUT: memory.
 *
 * ROM: 0x0365. Tag [seen] (names.js). Role in the machine: the game never draws into the sprite hardware
 * while it works — every handler writes the sprite shadow at 0xAA10-0xAA6F — and once a frame, first thing
 * in the vertical-blank service, this routine copies that shadow into hardware bank 0 at SPRITE_BANK0_BASE
 * 0xB010 (X and shape bytes) and bank 1 at SPRITE_BANK1_BASE 0xB410 (attribute and Y bytes), twenty-four
 * sprites each. Which way round the picture is comes from SCREEN_UNFLIPPED 0xA987 [seen]; the vertical-blank
 * service rewrites that cell only after this publish, so each frame's sprites use the previous frame's
 * orientation (mechanisms.md, "Publishing to the sprite banks").
 */

import { u8 } from "../../../core/int.js";
import { PLAYER_ENTRY, PLAYER_SPRITE_ATTRIBUTE, SCENERY_ENTRY_SLOT0, SCENERY_ENTRY_SLOT3, SCENERY_SPRITE_ATTRIBUTE_SLOT0, SCENERY_SPRITE_ATTRIBUTE_SLOT3, SCREEN_UNFLIPPED, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, SPRITE_BANK0_BASE, SPRITE_BANK1_BASE, SPRITE_RAISE_STEP_FLOOR } from "./names.js";

// The three runs of each bank, in the order they land in hardware: scenery slots 16-18 first
// (SCENERY_ENTRY_SLOT0 0xAA30 [seen]), then the whole active array, slots 0-15 (PLAYER_ENTRY 0xAA10
// [seen]), then scenery slots 19-23 (SCENERY_ENTRY_SLOT3 0xAA36 [seen]); bank 1 takes the matching
// attribute runs 0x30 higher. So hardware sprites 0-2 and 19-23 are the eight scenery sprites — the
// only ones the raise below, and the doubling passes after it, can reach.
const BANK_0 = { at: SPRITE_BANK0_BASE, runs: [[SCENERY_ENTRY_SLOT0, 6], [PLAYER_ENTRY, 32], [SCENERY_ENTRY_SLOT3, 10]] };
const BANK_1 = { at: SPRITE_BANK1_BASE, runs: [[SCENERY_SPRITE_ATTRIBUTE_SLOT0, 6], [PLAYER_SPRITE_ATTRIBUTE, 32], [SCENERY_SPRITE_ATTRIBUTE_SLOT3, 10]] };

// The byte transforms (mechanisms.md). Upright, only Y changes: it becomes the complement of Y+14,
// i.e. 241 - Y, matching the driver's sy = 241 - value. Turned round, X becomes the complement of
// X+15, the shape passes through, the attribute has its top two bits toggled, and Y
// becomes Y+1. Everything is byte-wide, so every transform wraps.
const keep = (byte) => byte;
const complementPast = (bias) => (byte) => u8(~u8(byte + bias));
const toggleTopTwoBits = (byte) => byte ^ 0xc0;
const stepOn = (byte) => u8(byte + 1);

/** Per orientation: the transforms for the first and second half of a sprite, bank 0 then bank 1. */
const UPRIGHT = [[keep, keep], [keep, complementPast(14)]];
const TURNED_ROUND = [[complementPast(15), keep], [toggleTopTwoBits, stepOn]];

// The raise window: SEQUENCE_PHASE 0xA9AB [seen] at 3 (the round engine), and SEQUENCE_SUBSTEP 0xA9AC
// [seen] from the floor read out of the ROM byte SPRITE_RAISE_STEP_FLOOR 0x0832 up to 7 inclusive.
const RAISE_PHASE = 3;
const RAISE_STEP_CEILING = 8;
const TOP_BIT = 0x80;

/** The eight sprites the raise reaches: the three of the first run and the five of the third. */
const RAISED_SPRITES = [0, 2, 4, 38, 40, 42, 44, 46];

/** Gather one bank: walk its three runs in order into consecutive hardware bytes, sending even
 * bytes (the first half of each two-byte sprite) through one transform and odd bytes through the
 * other. (The ROM's upright bank-0 copy is an unrolled chain of LDI instructions, byte by byte.) */
function publish(m, bank, [firstHalf, secondHalf]) {
  const { mem8 } = m;
  let slot = 0;
  for (const [from, length] of bank.runs) {
    for (let i = 0; i < length; i++, slot++) {
      mem8[bank.at + slot] = (slot % 2 === 0 ? firstHalf : secondHalf)(mem8[from + i]);
    }
  }
}

/** Add 0x80 to both bytes of the eight scenery sprites, inside the window only. The top
 * bit of the bank-1 Y byte is a REQUEST that the doubling pass (multiplexSpriteSlots and its
 * siblings) acts on to show the sprite a second time half a screen away. A sprite whose request is
 * already up is left alone, so running the raise twice changes nothing. */
function raiseEightSprites(m) {
  const { mem8 } = m;
  if (mem8[SEQUENCE_PHASE] !== RAISE_PHASE) return;
  const step = mem8[SEQUENCE_SUBSTEP];
  if (step < mem8[SPRITE_RAISE_STEP_FLOOR] || step >= RAISE_STEP_CEILING) return;
  for (const sprite of RAISED_SPRITES) {
    const second = mem8[BANK_1.at + sprite + 1];
    if ((second & TOP_BIT) !== 0) continue;
    mem8[BANK_1.at + sprite + 1] = u8(second + TOP_BIT);
    mem8[BANK_0.at + sprite] = u8(mem8[BANK_0.at + sprite] + TOP_BIT);
  }
}

// Pick the transform set from the orientation cell (0 = turned round, which is also what a
// cold machine reads before the first vertical-blank store), publish both banks, then raise.
export function publishSpriteShadow(m) {
  const [bank0, bank1] = m.mem8[SCREEN_UNFLIPPED] === 0 ? TURNED_ROUND : UPRIGHT;
  publish(m, BANK_0, bank0);
  publish(m, BANK_1, bank1);
  raiseEightSprites(m);
}
