// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceSequenceUnlessImageTampered — ROM 0x5303 [seen]
 *
 * WHAT IT IS. The verdict step of one of the program image's anti-tamper checks. Earlier links of
 * the chain (sumImageBlockForTheTamperCheck 0x43E8 -> parkTheImageTotalForTheTamperVerdict) fold a
 * block of ROM bytes into an 8-bit total and hand it here; a genuine, unmodified ROM always
 * produces 0x67.
 *
 * ROLE. Present the checksum the caller carried, then relay by its verdict: the one value a
 * genuine image yields steps the attract sequence on (advanceSequenceSubStep 0x0F1A), anything else
 * springs the tamper trap (loc_0F8D), which unwinds the caller chain instead of returning normally.
 * Under MAME the trap took zero dispatches on the real ROM -- a genuine image never fails.
 * Reads and writes nothing itself; the chosen arm owns all of that.
 *
 * PARAMETERS: total = the carried checksum (B in the ROM); pointer, offset and walk = the HL, DE and
 * A the chain carries, which presentChecksumForTamperTest walks forward as arithmetic only (HL + DE
 * + A, left in HL) and which nothing downstream dereferences.
 *
 * TWO ENTRIES. advanceSequenceUnlessImageTampered is the ROUTINES entry (0x5303): it reproduces the
 * ROM's walk as well as the verdict. The verdict alone is
 * advanceSequenceUnlessTotalTampered, which an idiomatic chain hands the total to: the walk writes
 * no memory and decides nothing, so a caller holding only the total has nothing else to pass.
 *
 * LIVE-OUT: that arm's memory and its return.
 */

import { presentChecksumForTamperTest } from "./presentChecksumForTamperTest.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { loc_0f8d as springTamperTrap } from "./loc_0f8d.js";

// The total a genuine program image produces (ROM 0x5306: cp 0x67).
const GENUINE_IMAGE_CHECKSUM = 0x67;

export function advanceSequenceUnlessImageTampered(m, total = m.regs.b, pointer = m.regs.hl, offset = m.regs.de, walk = m.regs.a) {
  // presentChecksumForTamperTest (0x200C) puts the carried total back where the comparison reads
  // it (the ROM's final `ld a,b`); its address walk touches no memory.
  return advanceSequenceUnlessTotalTampered(m, presentChecksumForTamperTest(m, pointer, offset, total, walk));
}

export function advanceSequenceUnlessTotalTampered(m, checksum) {
  // Wrong total: the image was altered, so divert to the trap (ROM: jp nz,0x0f8d).
  if (checksum !== GENUINE_IMAGE_CHECKSUM) return springTamperTrap(m);
  // Right total: carry on with the sequence by stepping its sub-step (ROM: jp 0x0f1a).
  return advanceSequenceSubStep(m);
}
