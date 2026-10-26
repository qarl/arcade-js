// SPDX-License-Identifier: GPL-3.0-only
import { blockCopy } from "./blockCopy.js";
import { WORKRAM_INIT_IMAGE, ALIEN_DRAW_PENDING } from "./names.js";

/**
 * initWorkRam — stamp work RAM from its ROM template image.
 *
 * WHAT IT IS
 *   Copies a block of bytes from the fixed ROM initialization image into the base of work RAM. The
 *   copy length is the caller's `count` (the ROM's B register; 0 means a full 256-byte pass), so this
 *   body serves both a caller-chosen length and the fixed-0xc0 preset that seedWorkRamImage seats first.
 *   Source is WORKRAM_INIT_IMAGE (0x1b00); destination is the work-RAM base ALIEN_DRAW_PENDING (0x2000).
 *
 * ROLE IN THE MACHINE
 *   At cold start the machine paints its own work RAM into existence from this template. seedWorkRamImage
 *   (0x01e4) sets the count to 0xc0 and drops straight in, so the 0x2000-0x20bf object/sprite work area
 *   (with GAME_OBJECT_TABLE at 0x2010 inside it) is stamped down in one pass. initWorkRam is also
 *   reachable on its own — from bootInit — with a caller-chosen length, while the 0xc0-preset form
 *   (seedWorkRamImage) is what re-runs on player handoff and round resets. The move itself is blockCopy,
 *   the plain byte-for-byte loop that walks source
 *   and destination forward together.
 *
 * ROM 0x01e6.  Grounding: [seen] (WORKRAM_INIT_IMAGE and ALIEN_DRAW_PENDING are both [seen]).
 *
 * LIVE-OUT: memory only (`count` bytes of work RAM from 0x2000 up stamped from the ROM image).
 */
export function initWorkRam(m, count = m.regs.b) {
  // Block-copy the caller's `count` bytes from the ROM template image (0x1b00) into the work-RAM base (0x2000).
  blockCopy(m, WORKRAM_INIT_IMAGE, ALIEN_DRAW_PENDING, count);
}
