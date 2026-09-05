// SPDX-License-Identifier: GPL-3.0-only
// Rotate the input byte right three bits (circular) and latch it to the coin-counter
// output, then decrement the byte at ptr. Only bit 0 of the latch is wired, so bit 3 of
// the input value drives the coin counter.
import { COIN_COUNTER_0_LATCH } from "./names.js";

const ROTATE = 3;

export function pulseCoinCounter(m, value = m.regs.a, ptr = m.regs.hl) {
  const { mem8 } = m;

  // Circular rotate-right by three: the source byte's bit 3 lands in bit 0.
  const rotated = ((value >> ROTATE) | (value << (8 - ROTATE))) & 0xff;

  // Write-only coin-counter output; only its low bit reaches the io model.
  mem8[COIN_COUNTER_0_LATCH] = rotated; // io

  // Byte-wide decrement wraps 0 to 255.
  mem8[ptr] = mem8[ptr] - 1;

  return (m.regs.a = rotated);
}
