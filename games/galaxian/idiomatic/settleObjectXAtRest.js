// SPDX-License-Identifier: GPL-3.0-only
// Per-frame handler that nudges one object field up toward a fixed rest value, one count each call,
// until it lands in the resting band and then holds. This is how the object settles and stays put.

// Object-record offset of the advancing field.
const FIELD = 4;

// Value the field settles at; below it the field is stepped upward each frame.
const REST_VALUE = 200;

// Width of the resting band: while the wrapped distance from the rest value is within it, hold.
const REST_BAND = 5;

export function settleObjectXAtRest(m, obj = m.regs.ix) {
  const { mem8 } = m;

  const field = mem8[obj + FIELD];

  // Already settled: 8-bit-wrapped distance from the rest value is within the band, so hold.
  if (((field - REST_VALUE) & 0xff) < REST_BAND) return;

  // Not there yet — step the field one count up (byte write wraps 0xff -> 0x00).
  mem8[obj + FIELD] = field + 1;
}
