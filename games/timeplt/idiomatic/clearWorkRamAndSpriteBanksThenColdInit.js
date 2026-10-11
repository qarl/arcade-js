// SPDX-License-Identifier: GPL-3.0-only
/** clearWorkRamAndSpriteBanksThenColdInit — cold-start clear: kick the watchdog, wipe two sprite-bank runs and the whole 2 KB of
 * work RAM, then fold a fixed program run into one total; anything but a genuine image's total runs
 * the frame service out of band, and either way it hands off to the screen-RAM clear and verify.
 * LIVE-OUT: memory.
 *
 * ROM 0x0069-0x00A7, reached once at boot from 0x07B1. [seen]
 *
 * Role in the machine: the second stage of the cold start. RAM powers up holding garbage, so every
 * sprite and work cell is zeroed here before anything reads it. It ends with one of the game's
 * anti-tamper checks, which on a patched image does not halt but quietly runs a whole frame service
 * early -- corruption rather than a clean refusal (names.js, enterVerticalBlankService).
 */

import { u8, u16 } from "../../../core/int.js";
import { clearScreenRamAndVerifyImageThenColdInit } from "./clearScreenRamAndVerifyImageThenColdInit.js";
import { enterVerticalBlankService } from "./enterVerticalBlankService.js";
import { PLAYER_STATE, SPRITE_BANK1_BASE, SPRITE_BANK1_SLOT0_Y, WATCHDOG_RESET, enterVerticalBlankService_ADDR } from "./names.js";

// Each sprite run is 0x30 bytes (the ROM's `ld b,0x30`), the 48 bytes of a hardware sprite bank.
const SPRITE_RUN_BYTES = 0x30;
// Work RAM is 0xA800-0xAFFF: one seeded zero plus a 0x7FF-byte `ldir` copy of it.
const WORK_RAM_BYTES = 0x800;
// The check folds 256 bytes (`ld b,0x00` loops 256 times) ...
const CHECK_BYTES = 0x100;
// ... and a genuine image sums to 0x87 (the `sub 0x87` at 0x00A0).
const GENUINE_TOTAL = 0x87;

export function clearWorkRamAndSpriteBanksThenColdInit(m) {
  const { mem8 } = m;

  // Two 48-byte zero runs in the sprite-attribute bank at 0xB400, one starting at 0xB411 and one at
  // 0xB410 (so they overlap by all but one byte), with a watchdog kick before, between and after.
  // The kicks (any write to 0xC200) keep the watchdog from resetting the board during the long boot.
  mem8[WATCHDOG_RESET] = 0;
  for (let i = 0; i < SPRITE_RUN_BYTES; i++) mem8[u16(SPRITE_BANK1_SLOT0_Y + i)] = 0;
  mem8[WATCHDOG_RESET] = 0;
  for (let i = 0; i < SPRITE_RUN_BYTES; i++) mem8[u16(SPRITE_BANK1_BASE + i)] = 0;
  mem8[WATCHDOG_RESET] = 0;

  // Zero all 2 KB of work RAM from 0xA800. Every game-state cell starts at zero from here; the few
  // structures that must not (the command ring, the high-score table) are set later in the cold start.
  for (let i = 0; i < WORK_RAM_BYTES; i++) mem8[u16(PLAYER_STATE + i)] = 0;
  mem8[WATCHDOG_RESET] = 0;

  // Anti-tamper check: add up the 256 program bytes starting at 0x00D8 (the frame-service entry) into
  // an eight-bit total. On a genuine image the total is 0x87 and nothing happens. Any other total
  // makes the ROM `call nz,0x00d8` -- run one whole frame service now, out of band, and return.
  let total = 0;
  for (let i = 0; i < CHECK_BYTES; i++) total = u8(total + mem8[u16(enterVerticalBlankService_ADDR + i)]);
  if (u8(total - GENUINE_TOTAL) !== 0) enterVerticalBlankService(m);

  // Next stage (`jp 0x5866`): fill the screen RAM and verify the whole image.
  return clearScreenRamAndVerifyImageThenColdInit(m);
}
