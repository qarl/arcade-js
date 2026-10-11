// SPDX-License-Identifier: GPL-3.0-only
/** sumByteRunAndCompareToExpected — add a run of bytes together and answer whether the total is the one the caller
 * named. The run is walked forward from a pointer; the length arrives as a count that means a
 * full 256 when it is zero, and the total wraps at eight bits. Nothing is written, and both of
 * its exits are the same exit — the answer is left for the caller rather than acted on here.
 * The image's one caller reloads the accumulator, pointer, counter and flags before reading any,
 * so the total, walked pointer and spent count are not handed back.
 *
 * ROM 0x0B4C-0x0B53 (frozen lift translated/loc_0b4c.js). Grounding: [seen].
 *
 * Role in the machine: a simple eight-bit additive checksum, one of the game's anti-tamper
 * tripwires. Its one caller, seatEraSceneryCodesThenSetAttributesAndRunScenery (ROM 0x30A5), sums the
 * sixteen bytes at 0x086B against 0x22 before seating the era's scenery row; names.js records that
 * check as a discarded tripwire. This routine only computes and compares.
 *
 * Parameters as the Z80 passed them: `base` in HL (first byte), `length` in B (a DJNZ count, so 0
 * means 256), `expected` in C (compared with `cp c`).
 *
 * LIVE-OUT: the answer, returned (the Z80's Z flag: set when the total matches). */

import { u8, u16 } from "../../../core/int.js";

// DJNZ decrements before testing, so a starting count of zero runs the loop 256 times.
const LENGTH_ZERO_MEANS = 256;

export function sumByteRunAndCompareToExpected(m, base = m.regs.hl, length = m.regs.b, expected = m.regs.c) {
  const { mem8 } = m;
  // Walk the run and fold each byte into an eight-bit total (`xor a`, then `add a,(hl)` with the
  // carry discarded), exactly as the Z80 accumulator would.
  const run = length === 0 ? LENGTH_ZERO_MEANS : length;
  let total = 0;
  for (let i = 0; i < run; i++) total = u8(total + mem8[u16(base + i)]);
  // The comparison the caller branches on.
  return total === expected;
}
