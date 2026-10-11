// SPDX-License-Identifier: GPL-3.0-only
/** postCommand — append a command byte and its argument to the 64-cell command ring. A cell is
 * free while its high bit is set; when the one the write cursor names is still occupied the pair
 * is DROPPED silently. Otherwise both bytes go in and the cursor steps two cells on, wrapping
 * inside the ring. It claims nothing about what a command byte selects or when it is acted on.
 * LIVE-OUT: memory-only.
 *
 * ROM: 0x0038, the RST 0x38 restart vector. Tag [seen] (names.js). Role in the machine: the one way
 * anything — frame code inside the vertical-blank interrupt or the foreground — asks for work to be
 * done later. The foreground loop runCommandRingDrainLoop takes pairs off the ring and dispatches
 * them (mechanisms.md: captions are requested inside the interrupt and drawn outside it; every
 * score award is posted here too, so a full ring loses the award).
 *
 * Parameters: `command` (the ROM's D) and `argument` (E), whatever the caller wants posted. */

import { u8 } from "../../../core/int.js";
import { COMMAND_RING, COMMAND_WRITE_CURSOR } from "./names.js";

const RING_CELLS = 64;

export function postCommand(m, command = m.regs.d, argument = m.regs.e) {
  const { mem8 } = m;
  // The next free cell, from COMMAND_WRITE_CURSOR 0xA9B2 [seen] into COMMAND_RING 0xAC00 [seen].
  // "Free" is the high bit SET: init fills the ring with 0xFF and the drain loop restores 0xFF to
  // each pair it takes. A clear high bit means the reader has not caught up, so the ROM skips
  // straight to its exit (bit 7,(hl) / jr z) and this pair is lost, with no retry.
  const cursor = mem8[COMMAND_WRITE_CURSOR];
  if ((mem8[COMMAND_RING + cursor] & 0x80) === 0) return;
  // Command in the named cell, argument in the next (the ROM steps with `inc l`, so the step
  // stays inside the ring's 256-byte page).
  mem8[COMMAND_RING + cursor] = command;
  const argumentCell = u8(cursor + 1);
  mem8[COMMAND_RING + argumentCell] = argument;
  // Advance past the pair and wrap at 64 cells (the ROM masks with `and 0x3f`).
  mem8[COMMAND_WRITE_CURSOR] = (cursor + 2) % RING_CELLS;
}
