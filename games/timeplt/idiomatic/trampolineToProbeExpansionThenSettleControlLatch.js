// SPDX-License-Identifier: GPL-3.0-only
/** trampolineToProbeExpansionThenSettleControlLatch — where the processor starts from cold: three bytes that hand straight on to the
 * power-on routine, touching nothing on the way. LIVE-OUT: whatever that routine leaves.
 *
 * ROM 0x0000-0x0002: the bytes `c3 b1 07`, a bare `jp 0x07b1`. [seen]
 *
 * Role in the machine: the Z80 begins executing at address 0 after reset, so this is the first
 * instruction the game ever runs. It reads and writes nothing; the real power-on work is at 0x07B1.
 * These three bytes are also the first bytes summed by the whole-image check in
 * clearScreenRamAndVerifyImageThenColdInit, which reads this entry's address as data.
 */

import { probeExpansionThenSettleControlLatch } from "./probeExpansionThenSettleControlLatch.js";

export function trampolineToProbeExpansionThenSettleControlLatch(m) {
  // Jump to the power-on routine at 0x07B1.
  return probeExpansionThenSettleControlLatch(m);
}
