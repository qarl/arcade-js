// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  SOUND_VOICE_VALUE, SOUND_VOICE_LEVEL, loc_720,
  POKEY1_AUDF1, POKEY1_AUDCTL, POKEY1_RANDOM, POKEY1_SKCTL,
  POKEY2_AUDF1, POKEY2_AUDCTL, POKEY2_RANDOM, POKEY2_SKCTL,
} from "./names.js";

/**
 * resetBothPokeyChips — dual-POKEY sound-chip reset and RNG seed. ROM 0xcd95.
 *
 * Role in the machine: Tempest carries two POKEY chips ($60c0 and $60d0) that generate all of its
 * audio. This is the one-time board-init pass (called from runMainFrameLoop's startup and again from
 * the level-timer reset setupLevelTimers) that puts both chips into a known-quiet state and, as a
 * side errand, harvests a hardware random seed. Bringing the serial-control register (SKCTL) low then
 * back to 7 is the documented POKEY initialization handshake — it also frees the polynomial noise
 * generators to run, which is what makes the RANDOM register produce fresh values.
 *
 * Behavior: first it forces both SKCTL latches to 0 (chips held in reset) and clears the scratch flag
 * $720. It snapshots both RANDOM registers, then polls up to five times; the moment either register
 * has moved off its snapshot it latches the first chip's snapshot value into $720 as a seed and stops.
 * It then writes 7 to both SKCTL latches to release the chips, walks the eight audio registers of each
 * chip ($60c0..7 and $60d0..7) to silence, zeroes the paired eight-entry software mirror arrays
 * ($c0,x = voice value and $d0,x = voice level) that the sound engine tracks in RAM, and finally
 * clears both AUDCTL control registers ($60c8/$60d8).
 *
 * Live-out: both POKEY chips silenced and armed (SKCTL=7, all AUDF/AUDCTL clear), the two 8-byte
 * software sound arrays $c0/$d0 cleared, and the RNG seed cell $720 (either the harvested sample or 0
 * if neither counter moved during the five polls).
 *
 * Returns the exit [X, Y] the ROM leaves: X = 0xff (the silencing loop runs X past 0) and Y = chip 2's RANDOM
 * snapshot. The frame loop carries them into its first update, and setupLevelTimers hands them back as its own
 * exit registers. Grounding: [seen].
 */
export function resetBothPokeyChips(m) {
  const { mem8 } = m;
  // Hold both chips in serial reset (SKCTL=0) and clear the seed scratch flag.
  mem8[POKEY1_SKCTL] = 0;
  mem8[POKEY2_SKCTL] = 0;
  mem8[loc_720] = 0;

  // Snapshot both free-running RANDOM registers, then poll: the first time either has advanced,
  // latch chip 1's original sample as the RNG seed and stop early.
  const a = mem8[POKEY1_RANDOM];
  const y = mem8[POKEY2_RANDOM];
  for (let x = 4; x >= 0; x--) {
    if (a !== mem8[POKEY1_RANDOM] || y !== mem8[POKEY2_RANDOM]) {
      mem8[loc_720] = a;
      break;
    }
  }

  // Release both chips (SKCTL=7, the init handshake) and silence every audio register / RAM mirror.
  mem8[POKEY1_SKCTL] = 7;
  mem8[POKEY2_SKCTL] = 7;
  for (let x = 7; x >= 0; x--) {
    mem8[u16(POKEY1_AUDF1 + x)] = 0;      // chip 1 hardware audio regs $60c0..7
    mem8[u16(POKEY2_AUDF1 + x)] = 0;      // chip 2 hardware audio regs $60d0..7
    mem8[u8(SOUND_VOICE_VALUE + x)] = 0;  // software voice-value mirror $c0,x
    mem8[u8(SOUND_VOICE_LEVEL + x)] = 0;  // software voice-level mirror $d0,x
  }
  // Clear both AUDCTL control registers last.
  mem8[POKEY1_AUDCTL] = 0;
  mem8[POKEY2_AUDCTL] = 0;
  return [0xff, y];
}
