// SPDX-License-Identifier: GPL-3.0-only
/**
 * unpackTheFirstThreeSwitchSettings — open the settings block: store the lives count whole, peel the
 * next two switch bits into a cell each, and hand the rest of the switch byte on.
 *
 * ROM 0x2E19-0x2E30 (ends `jp 0x49A8`). Grounding: [seen] (names.js ROUTINES 0x2E19).
 *
 * ROLE IN THE MACHINE. One link of the power-on chain that turns the gameplay DIP-switch bank
 * (DSW1, read at 0xC200) into settings cells, once at boot. The caller, seedGameConfigFromDipSwitches
 * [seen], has already read the bank, complemented it (the switches are active-low) and turned its low
 * two bits into a lives count. This routine takes the next two bits; finishBootSelfTestAndColdStart
 * [seen], which it jumps into, takes bits 4-7. Between the three of them every bit of the bank lands
 * in a cell:
 *   bits 0-1 -> STARTING_LIVES (0xA9C1) [seen]      (here, as the caller's count)
 *   bit 2    -> UPRIGHT_CABINET (0xA9C2) [seen]       (here)
 *   bit 3    -> BONUS_LIFE_SETTING (0xA9C3) [seen]  (here)
 *   bits 4-6 -> DIFFICULTY_SETTING, bit 7 -> DEMO_SOUNDS_ENABLE (the continuation)
 *
 * PARAMETERS. `whole` is the lives count the caller worked out (3, 4, 5, or 0xFF for the setting that
 * would compute 6). `packed` is the whole complemented switch byte.
 *
 * Nothing is read from memory. Control tail-transfers into the continuation and never comes back.
 * LIVE-OUT: the three settings cells, and everything the continuation does.
 */

import { u8 } from "../../../core/int.js";
import { finishBootSelfTestAndColdStart } from "./finishBootSelfTestAndColdStart.js";
import { BONUS_LIFE_SETTING, UPRIGHT_CABINET, STARTING_LIVES } from "./names.js";

// The two single-bit settings this routine peels, in the order the ROM takes them: two `rrca`s bring
// bit 2 to the bottom for UPRIGHT_CABINET (0x2E1D-0x2E25), one more brings bit 3 down for
// BONUS_LIFE_SETTING (0x2E26-0x2E2D); each is masked with `and 0x01`, one bit per cell and nothing else.
const SINGLE_BIT_CELLS = [
  { cell: UPRIGHT_CABINET, bit: 2 },
  { cell: BONUS_LIFE_SETTING, bit: 3 },
];
// Bit 3 is the last bit spent; the byte goes on rotated right by that many places.
const LAST_BIT_SPENT = SINGLE_BIT_CELLS[SINGLE_BIT_CELLS.length - 1].bit;
const BITS_IN_A_BYTE = 8;

export function unpackTheFirstThreeSwitchSettings(m, whole = m.regs.a, packed = m.regs.c) {
  const { mem8 } = m;
  // Lives per game (0x2E19 `ld (0xa9c1),a`), stored exactly as the caller computed it; startOnePlayerGame /
  // startTwoPlayerGame [seen] later copy it into the players' lives cells.
  mem8[STARTING_LIVES] = whole;
  // Bit 2 = cabinet type, bit 3 = which bonus-life score list (and attract captions) applies.
  for (const { cell, bit } of SINGLE_BIT_CELLS) mem8[cell] = (packed >> bit) & 1;
  // Hand the byte on rotated right three places (the ROM's three `rrca`s, a rotate so no bit is
  // lost): original bit 3 now sits lowest, so the continuation's first rotate brings bit 4 — the start
  // of the difficulty field — to the bottom. The ROM jumps with it at 0x2E2E.
  const unspent = u8((packed >> LAST_BIT_SPENT) | (packed << (BITS_IN_A_BYTE - LAST_BIT_SPENT)));
  return finishBootSelfTestAndColdStart(m, unspent);
}
