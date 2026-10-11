// SPDX-License-Identifier: GPL-3.0-only
/**
 * clearScreenRamAndVerifyImageThenColdInit — cold-start clear, then verify the program image and hand off to init.
 * Fills colour RAM with 0x10 and video RAM with 0xf1 (bases from two image pointers), then sums the
 * program image and subtracts the stored total: zero hands off to init. The fold covers the program image and
 * nothing else, so the total is a constant of the image and a genuine image always lands on zero. The other
 * arm jumps into a data table and runs it as code, which destroys control rather than reporting anything;
 * it has no faithful transcription, so it raises where it would derail.
 * LIVE-OUT: the two fills and the watchdog kicks (after fill one, then once per summed byte), then the handoff.
 *
 * ROM 0x5866-0x58A3, reached from 0x0069. [seen]
 *
 * Role in the machine: the third stage of the cold start (after power-on at 0x07B1 and the RAM clear
 * at 0x0069). The character plane's two 1 KB planes -- colour RAM at 0xA000 and video RAM at 0xA400
 * -- are each filled with one uniform value so the screen starts in a known pattern, then the whole
 * 24 KB program ROM is checked before the game is
 * allowed to initialise. A tampered image derails into data at 0x59D7 (names.js).
 */

import { u16 } from "../../../core/int.js";
import { initColdStartRamThenSeedConfig } from "./initColdStartRamThenSeedConfig.js";
import { NotImplemented } from "../../../boards/timeplt/io.js";
import { trampolineToProbeExpansionThenSettleControlLatch_ADDR, COLOUR_RAM_BASE_WORD, VIDEO_RAM_BASE_WORD, WATCHDOG_RESET } from "./names.js";

// Fill values: every colour cell gets attribute 0x10, every video cell tile 0xF1 (`ld d,0x10` / `ld d,0xf1`).
const COLOUR_FILL = 0x10;
const VIDEO_FILL = 0xf1;
// Each plane is 0x400 bytes = 32 x 32 cells (`ld bc,0x0400`).
const FILL_BYTES = 0x400;
// The sum stops when the address reaches page 0x60: 0x6000 is one past the end of the program ROM.
const FIRST_PAGE_PAST_ROM = 0x60;
// A genuine image's eight-bit total (the `sub 0xaf`).
const GENUINE_TOTAL = 0xaf;

const u8 = (x) => x & 0xff;

export function clearScreenRamAndVerifyImageThenColdInit(m) {
  const { mem8, mem16 } = m;

  // Fill colour RAM. The base is not an immediate: it is read from the program word at 0x2581
  // (= 0xA000), part of the same image the check below protects. Then kick the watchdog.
  const colourBase = mem16[COLOUR_RAM_BASE_WORD];
  for (let i = 0; i < FILL_BYTES; i++) mem8[u16(colourBase + i)] = COLOUR_FILL;
  mem8[WATCHDOG_RESET] = 0;

  // Fill video RAM, its base likewise read from the program word at 0x4A37 (= 0xA400).
  const videoBase = mem16[VIDEO_RAM_BASE_WORD];
  for (let i = 0; i < FILL_BYTES; i++) mem8[u16(videoBase + i)] = VIDEO_FILL;

  // Whole-image check: add every byte of 0x0000-0x5FFF into an eight-bit total. The ROM seeds the
  // total with the byte at 0x0000 (`ld a,(0x0000)`) and then adds 0x0000 again as the first term,
  // so that byte counts twice -- reproduced here. It kicks the watchdog once per byte, because the
  // 24 KB loop is long enough that the watchdog would otherwise reset the board mid-check.
  let addr = trampolineToProbeExpansionThenSettleControlLatch_ADDR;
  let total = mem8[trampolineToProbeExpansionThenSettleControlLatch_ADDR];
  for (;;) {
    total = u8(total + mem8[addr]);
    addr = u16(addr + 1);
    if (((addr >> 8) & 0xff) >= FIRST_PAGE_PAST_ROM) break;
    mem8[WATCHDOG_RESET] = total; // ⚠ the watchdog port ignores this value; only the kick counts
  }

  // A genuine image lands on 0xAF. Any other total makes the ROM `jp nz,0x59d7` -- into a velocity
  // table, executed as code -- which has no faithful transcription, so the port raises here instead.
  if (u8(total - GENUINE_TOTAL) !== 0) {
    throw new NotImplemented(
      "clearScreenRamAndVerifyImageThenColdInit: the whole-image fold missed its expected total, so the image " +
        "is tampered and the original would run a data table as code; a genuine image always matches",
    );
  }
  // Next stage (`jp 0x2511`, nothing pushed): cold-start RAM init and the DIP-switch seed.
  return initColdStartRamThenSeedConfig(m);
}
