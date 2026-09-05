// SPDX-License-Identifier: GPL-3.0-only
// Tick a two-tier cascade countdown: decrement the byte `ptr` names. While it is
// still nonzero, done. On reaching zero, step to the next byte in the timer block
// and bump it — a carry from the low tier into the next tier.

export function loc_0331(m, ptr = m.regs.hl) {
  const { mem8 } = m;

  // Decrement the counted byte, wrapping 0 -> 255.
  const remaining = (mem8[ptr] - 1) & 0xff;
  mem8[ptr] = remaining;

  // Still counting down — nothing more this tick.
  if (remaining !== 0) return;

  // Expired: step to the next byte (8-bit low-byte increment, stays in-page) and bump it.
  const nextLow = (ptr + 1) & 0xff;
  const nextPtr = (ptr - (ptr & 0xff)) + nextLow;
  mem8[nextPtr] = mem8[nextPtr] + 1; // byte-wide write wraps 0xff -> 0x00
}
