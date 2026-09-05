// SPDX-License-Identifier: GPL-3.0-only
// Per-frame expiry tick for one actor record: counts its timer down and, on
// the frame it reaches zero, clears the state byte to retire the actor.

// Field offsets within the actor record addressed by `obj`.
const EXPIRY_TIMER = 16; // countdown; retires the actor at zero
const STATE_BYTE = 1; // cleared when the timer expires

export function loc_113d(m, obj = m.regs.ix) {
  const { mem8 } = m;

  // Tick the countdown once (wraps at 8 bits).
  const remaining = (mem8[obj + EXPIRY_TIMER] - 1) & 0xff;
  mem8[obj + EXPIRY_TIMER] = remaining;

  // Still counting down.
  if (remaining !== 0) return;

  // Expired: clear the state byte.
  mem8[obj + STATE_BYTE] = 0;
}
