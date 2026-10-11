// SPDX-License-Identifier: GPL-3.0-only
/** enterVblankInterrupt — the per-frame interrupt entry: control lands here once a frame and hands straight on to the frame-service handler, writing nothing of its own. LIVE-OUT: memory.
 *
 * ROM 0x0066-0x0068: a single `jp 0x00d8`. [seen]
 *
 * Role in the machine: 0x0066 is the Z80's fixed non-maskable-interrupt vector. The board raises
 * that interrupt at vertical blank while latch line 0 (0xC300) is set, so once
 * enableInterruptAndEnterForegroundLoop opens the line this entry runs once per frame, and
 * everything the game does per frame starts here.
 */

import { enterVerticalBlankService } from "./enterVerticalBlankService.js";

export function enterVblankInterrupt(m) {
  // On to 0x00D8, the one-byte `push af` that falls into the frame service at 0x00D9.
  return enterVerticalBlankService(m);
}
