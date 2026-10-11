// SPDX-License-Identifier: GPL-3.0-only
/** startTheWholePlaneWipeAndFoldAnImageBlockIntoThePhase — run one setup-and-guard entry, seat the inner sequence index at a fixed step, then fold a
 * block of the program image into the outer phase. Neither number lands as an immediate: the index is READ
 * from a program byte that is the low half of an address inside an instruction, so moving that instruction
 * moves the index, and the phase is not assigned at all — a 256-byte block is subtracted from whatever it
 * already holds and a fixed key exclusive-ored into the difference. That leaves some phases standing and
 * moves others, so it is a tamper test that CORRUPTS the sequence rather than refusing to run. LIVE-OUT: memory.
 *
 * ROM 0x15E2-0x15FD. Grounding: [seen].
 *
 * Role in the machine: the game is driven by a two-level sequence machine -- an OUTER phase
 * (SEQUENCE_PHASE, 0xA9AB: 0 boot wipe, 1 attract, 2 credit / push-start, 3 round engine) and
 * an INNER sub-step index (SEQUENCE_SUBSTEP, 0xA9AC). The vblank frame service masks the phase
 * to two bits and dispatches through its phase table at 0x015F; phase 0 goes to 0x15C2, which
 * masks the sub-step with 0x07 and dispatches through the inline word table at 0x15C8. Entry 0
 * of that table is this routine: the first thing phase zero does. Only entries 0 and 6 of that
 * table are arms; the bytes from 0x15D6 are caption record 5, ending just before this entry.
 *
 * Note that the dispatch masks the phase with 0x03, so arriving here proves only that the phase
 * is a multiple of four; 0x04, 0x08 and 0x0C are not fixed points of the fold below. That the
 * phase is left standing rests on the phase arriving here as 0, as it does in normal running (names.js); the one genuine corner that arrives with phase 4 (mechanisms.md) leaves 0x1C, whose low two bits still select phase 0.
 *
 * LIVE-OUT: memory -- the wipe cells armed by the call, SEQUENCE_SUBSTEP, SEQUENCE_PHASE. */

import { u8, u16 } from "../../../core/int.js";
import { armWholePlaneWipeThenDerailOnATamperedImage } from "./armWholePlaneWipeThenDerailOnATamperedImage.js";
import { SEQUENCE_PHASE, SEQUENCE_SUBSTEP, WIPE_SUBSTEP_SEED, SEQUENCE_PHASE_TAMPER_SPAN_BASE } from "./names.js";

// The fold covers 256 bytes (ROM `ld c,0x00` then `dec c` / `jr nz`: a zero count means 256).
const FOLD_BYTES = 256;
// The key exclusive-ored into the difference (ROM `xor 0x4e` at 0x15F8).
const FOLD_KEY = 0x4e;

export function startTheWholePlaneWipeAndFoldAnImageBlockIntoThePhase(m) {
  const { mem8 } = m;
  // Arm the wipe (ROM call 0x019A): seat the character-plane wipe cursor on the plane's first
  // cell with 32 lines to go -- the whole 0xA400-0xA7FF plane -- then run that routine's own
  // checksum of a fixed 240-byte run of the image, which derails a tampered image. The wipe is
  // armed either way; this call only ARMS it, the blanking happens on later dispatches.
  armWholePlaneWipeThenDerailOnATamperedImage(m);

  // Pick the step that consumes what was just armed. The value is read from 0x1749
  // (WIPE_SUBSTEP_SEED), which holds 0x06 because 0x1748 is the instruction `cd 06 0b` -- the
  // byte is the low half of a call operand reused as data. Sub-step 6 of the 0x15C8 table is
  // 0x15FE, which opens with `call 0x01c2 / ret nz`: blankNextLine, one line per dispatch until
  // the 32 are done. So from the next dispatch on, phase zero runs the wipe.
  mem8[SEQUENCE_SUBSTEP] = mem8[WIPE_SUBSTEP_SEED];

  // The anti-tamper fold. Starting from the phase's own value, subtract each of the 256
  // program bytes from 0x5648 (SEQUENCE_PHASE_TAMPER_SPAN_BASE) with 8-bit wrap. On a genuine
  // image those bytes sum to 0xB2, so the net effect is phase - 0xB2 (mod 256).
  let folded = mem8[SEQUENCE_PHASE];
  for (let i = 0; i < FOLD_BYTES; i++) folded = u8(folded - mem8[u16(SEQUENCE_PHASE_TAMPER_SPAN_BASE + i)]);
  // Then exclusive-or with 0x4E and store the result back as the phase. On a genuine image,
  // ((phase - 0xB2) & 0xFF) ^ 0x4E leaves 0 and 1 unchanged (2 and 3 are not fixed points), so
  // phase 0 stays phase 0; a patched block shifts the difference and the phase lands somewhere
  // else -- the sequence is corrupted rather than refused.
  mem8[SEQUENCE_PHASE] = folded ^ FOLD_KEY;
}
