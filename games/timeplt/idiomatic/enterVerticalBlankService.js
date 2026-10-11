// SPDX-License-Identifier: GPL-3.0-only
/** enterVerticalBlankService — the frame interrupt lands here and runs the vertical-blank service.
 * In the original this entry is the one byte `push af` that opens the service's register save; the service
 * body follows it directly. Saving the interrupted code's registers is bookkeeping for the CPU, not a
 * fact about the game — the interrupted foreground holds none of its state in registers across the
 * interrupt — so the save is not represented and this entry is simply the service. The same entry is
 * what the two boot-time image checks call on a tampered image, running one frame's service out of
 * band and returning. LIVE-OUT: memory, the control latches and the sound send, all the service's.
 * ROM 0x00D8, one byte, the service body following at 0x00D9. Grounding: [seen] (names.js ROUTINES 0x00D8). */

import { serviceVerticalBlankInterrupt } from "./serviceVerticalBlankInterrupt.js";

export function enterVerticalBlankService(m) {
  return serviceVerticalBlankInterrupt(m);
}
