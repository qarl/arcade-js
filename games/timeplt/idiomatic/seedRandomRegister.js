// SPDX-License-Identifier: GPL-3.0-only
/**
 * seedRandomRegister — copy a fixed seventeen-byte run of program space into the random register
 * block, then check the image that run came out of.
 *
 * WHAT IT IS: ROM routine 0x4B67 [seen]. RANDOM_REGISTER is the game's only entropy source, and its head
 * is written only by the generator's own feedback store and by this block copy. The copy is
 * unconditional and COMPLETE before the check runs, so nothing written here is gated by it.
 *
 * ROLE IN THE MACHINE: it runs at cold start (from initColdStartRamThenSeedConfig) and again at the
 * start of every attract demo, where FRAME_TICK has also just been zeroed -- so each demo begins from
 * identical generator state. A real game is not re-seeded; it inherits whatever
 * state the attract cycle left. A reader who takes the register as fixed from boot will be wrong.
 *
 * THE GUARD IS AN ANTI-TAMPER CHECK ON THE COPYRIGHT LINE, NOT A CHECKSUM OF THE SEED: the two words it
 * reads (RANDOM_SEED_GUARD_WORD0 / RANDOM_SEED_GUARD_WORD1) sit in the middle of the copyright
 * caption's record -- its colour byte 0x10, the (c) glyph 0x30 and the K glyph 0x7C -- which with this
 * routine's own 0x44 come to zero exactly. The seed run is not read by the guard at all. A tampered
 * copyright line therefore raises only AFTER the register has been seeded.
 *
 * LIVE-OUT: memory -- the seventeen seed bytes -- plus the zero the guard total comes to (the ROM leaves
 * it in the accumulator).
 */

import { NotImplemented } from "../../../boards/timeplt/io.js";
import { u8 } from "../../../core/int.js";
import { RANDOM_REGISTER, RANDOM_REGISTER_SEED_SOURCE, RANDOM_SEED_GUARD_WORD0, RANDOM_SEED_GUARD_WORD1 } from "./names.js";

/** Length of the seed run and of the register block it fills (the ROM's `ld bc,0x0011`). */
const SEED_BYTES = 17;
/** The routine's own constant, picked so the three caption bytes plus it wrap to zero. */
const GUARD_BIAS = 0x44;

export function seedRandomRegister(m) {
  const { mem8, mem16 } = m;
  // Step 1: seed. A straight seventeen-byte block copy from the fixed run in program space into the
  // register block (the ROM's single `ldir`), overwriting whatever the generator had evolved to.
  for (let i = 0; i < SEED_BYTES; i++) mem8[RANDOM_REGISTER + i] = mem8[RANDOM_REGISTER_SEED_SOURCE + i];

  // Step 2: the guard. The ROM loads the first word into IX and the second into HL, then adds IX's two
  // bytes and L -- only the second word's LOW byte takes part -- plus the bias, in eight-bit arithmetic.
  const word0 = mem16[RANDOM_SEED_GUARD_WORD0];
  const word1 = mem16[RANDOM_SEED_GUARD_WORD1];
  const total = u8((word0 & 0xff) + (word0 >> 8) + (word1 & 0xff) + GUARD_BIAS);
  // Step 3: on any non-zero total the ROM jumps to 0x6000, which lies outside the program image, so
  // the machine derails rather than failing cleanly. There is nowhere real to go, so this raises.
  if (total !== 0) {
    throw new NotImplemented(
      `seedRandomRegister: guard total ${total} rather than zero, so the image is tampered and control ` +
        "jumps outside the program image; a genuine image never does",
    );
  }
  return (m.regs.a = total);
}
