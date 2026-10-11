// SPDX-License-Identifier: GPL-3.0-only
/** loc_0bdc — a handler that does nothing whatever: it reads no cell, writes no cell and leaves every register as it found it, so a command that lands here is consumed and changes nothing. LIVE-OUT: nothing.
 *
 * ROM 0x0BDC (frozen lift translated/loc_0bdc.js): a lone `ret`. Grounding: [code] (names.js ROUTINES 0x0bdc).
 *
 * Role in the machine: runCommandRingDrainLoop takes a command and its argument off the command ring
 * and runs the handler the command's low nibble selects from the sixteen-word table at 0x0BBC. Six of
 * those words -- slots 8, 9, 12, 13, 14 and 15 -- hold this address, so taking one of those commands
 * only frees the pair and returns to the top of the loop.
 *
 * Why it is kept hex and why nothing is here: no poster in the image puts a command with one of those
 * low nibbles on the ring, so the six slots are unreachable filler. The address occurs in the image
 * only as those six table words (names.js role).
 */

export function loc_0bdc() {
  // The ROM's `ret`: back to the drain loop, which looks at the ring again.
  return;
}
