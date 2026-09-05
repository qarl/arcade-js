// SPDX-License-Identifier: GPL-3.0-only
// Countdown-and-finish tail of the message scroller: tick the step/delay counter at
// the pointer down one; on the exact zero-crossing clear the scroll-enable flag so the
// scroller stops running.
import { MESSAGE_SCROLL_ENABLE } from "./names.js";

export function loc_18e8(m, counterPtr = m.regs.hl) {
  const { mem8 } = m;

  // Tick the counter down one, with 8-bit wrap.
  const remaining = (mem8[counterPtr] - 1) & 0xff;
  mem8[counterPtr] = remaining;

  // Only on the exact zero-crossing does the message finish: stop the scroller.
  if (remaining === 0) mem8[MESSAGE_SCROLL_ENABLE] = 0;
}
