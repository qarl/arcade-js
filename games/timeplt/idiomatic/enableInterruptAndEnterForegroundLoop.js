// SPDX-License-Identifier: GPL-3.0-only
/** enableInterruptAndEnterForegroundLoop — open the frame interrupt and enter the foreground for good. The
 * setting it is handed drives the interrupt-enable line from its low bit and kicks the watchdog, then
 * control passes into the command-ring loop, which never comes back. LIVE-OUT: the interrupt-enable
 * line, the watchdog, and whatever the loop leaves.
 *
 * ROM 0x00A8-0x00B0 (three instructions: `ld (0xc300),a`, `ld (0xc200),a`, `jp 0x0b93`). [seen]
 *
 * Role in the machine: this is the hinge between boot and the running game. Everything before it is
 * the one-time cold start (clear memory, verify the image, seed the settings); everything after it is
 * the two halves the game lives in for ever -- the frame interrupt, which does the game's work once
 * per vertical blank, and the foreground loop, which carries out the drawing and scoring requests the frame work posts.
 * Boot wrote 0 into the first four latch lines earlier, line 0 among them, so the frame interrupt stays shut until THIS store.
 *
 * `setting` is the byte the caller carries in; names.js records that under MAME it is the program
 * byte at 0x4C87, which reads 0x01 -- so in practice this store switches the interrupt ON.
 */

import { runCommandRingDrainLoop } from "./runCommandRingDrainLoop.js";
import { WATCHDOG_RESET, NMI_ENABLE_LATCH } from "./names.js";

export function* enableInterruptAndEnterForegroundLoop(m, setting) {
  const { mem8 } = m;
  // 0xC300 is line 0 of the board's addressable control latch (an LS259): the latch takes its data
  // from the low bit of the byte, and line 0 gates the per-frame (vblank) interrupt. From here on the
  // frame service runs once per frame.
  mem8[NMI_ENABLE_LATCH] = setting;
  // Any write to 0xC200 kicks the watchdog; the hardware ignores the value, so the same byte serves.
  mem8[WATCHDOG_RESET] = setting;
  // Fall into the foreground loop. It has no exit of its own, so this call is the rest of the
  // machine's foreground life (the ROM's `jp` pushes no return address).
  return yield* runCommandRingDrainLoop(m);
}
