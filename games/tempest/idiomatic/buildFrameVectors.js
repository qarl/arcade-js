// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import {
  MODE_DISPATCH_SEL, DRAW_RECORD_PTR_LO, LEVEL_LAYOUT_TRIGGER, SCORE_DISPLAY_TIMER, loc_455,
  VEC_LIST_HEADER_LO, VEC_LIST_HEADER_HI, VECHEAD0_PLAY, VECHEAD1_PLAY, VECHEAD0_LEVEL,
} from "./names.js";
import { resetMathboxInputs } from "./resetMathboxInputs.js";
import { dispatchDisplayModeHandler } from "./dispatchDisplayModeHandler.js";
import { drawFrame } from "./drawFrame.js";
import { seatDrawCursor } from "./seatDrawCursor.js";
import { closeLayerPointer } from "./closeLayerPointer.js";
import { emitFrameLink } from "./emitFrameLink.js";

// buildFrameVectors — per-frame vector-list housekeeping. ROM 0xb1b6.
//
// Role in the machine: run once per drawn frame to keep the vector display list coherent. It resets the
// math-box scratch, short-circuits when the frame is already settled, and otherwise either hands the whole
// draw to the frame builder (mode 0) or runs the mode-specific dispatch and, in the scoring case, folds a
// 40-byte record under the draw pointer into a one-byte checksum. It closes by publishing the play-mode
// header into the first two display words so the AVG picks up the right list next pass.
//
// Behavior: clear the frame work cells (resetMathboxInputs). Return early when the guard cell
// VEC_LIST_HEADER_LO (0x2000) already equals its level checkpoint VECHEAD0_LEVEL (0xcec6) and the pending
// trigger LEVEL_LAYOUT_TRIGGER (0x133) is clear — the frame is settled. If the mode selector
// MODE_DISPATCH_SEL (0x1) is zero, route the entire draw through drawFrame and return. Otherwise seat the
// draw cursor, and unless emitFrameLink reports a published change, run the computed-jump trampoline
// dispatchDisplayModeHandler; then when SCORE_DISPLAY_TIMER is nonzero, walk 40 bytes (0x27..0) under
// DRAW_RECORD_PTR_LO subtracting each with a carry-chained borrow (BCD-corrected when the D flag is live),
// and whiten the result with two conditional XORs (0xe5 then 0x29) into the loc_455 checksum cell. Finally
// close the layer pointer and latch the play-mode header bytes VECHEAD0_PLAY/VECHEAD1_PLAY (0xcec4/0xcec5)
// into display words 0x2000/0x2001.
//
// dFlag carries the CPU decimal flag in from the bridge: an earlier stage may leave it set, and the
// subtract below must BCD-correct its accumulator to match the hardware when it is.
//
// x and y are the X/Y the ROM enters with (seedFramePhaseAndTick's exit registers). Returns the exit [X, Y]
// the ROM leaves, which survive the main loop's wait (the IRQ restores both) into the next update's
// dispatcher, whose spike pre-pass may reload Y before the mode handler. Both drawing paths end in
// closeLayerPointer, whose exit registers they return (Y = 1). The settled-frame early return writes no
// register, so it returns the incoming [x, y]. Grounding: [seen].
export function buildFrameVectors(m, x = m.regs.x, y = m.regs.y, dFlag = m.regs.fD) {
  const { mem8, mem16 } = m;

  resetMathboxInputs(m); // clear the math-box / frame work cells

  // Frame already settled: guard cell matches its checkpoint and the pending flag is clear.
  if (mem8[VEC_LIST_HEADER_LO] === mem8[VECHEAD0_LEVEL] && mem8[LEVEL_LAYOUT_TRIGGER] === 0) return [x, y];

  // Mode zero routes the entire draw through the frame builder.
  if (mem8[MODE_DISPATCH_SEL] === 0) return drawFrame(m); // its last layer close's exit registers

  seatDrawCursor(m, 0x00);
  const changed = emitFrameLink(m); // true = a change was published; skip the checksum path
  if (!changed) {
    dispatchDisplayModeHandler(m); // computed-jump dispatch
    if (mem8[SCORE_DISPLAY_TIMER] !== 0) {
      // Fold the 40-byte record under the draw pointer into a running one-byte checksum.
      const ptr = mem16[DRAW_RECORD_PTR_LO];
      let a = 0x0e;
      let carry = 1; // seeded set
      for (let i = 0x27; i >= 0; i--) {
        const v = mem8[u16(ptr + i)];
        const c = carry ? 1 : 0;
        const diff = a - v - (1 - c);
        carry = diff >= 0 ? 1 : 0; // borrow flag is the binary result in both modes
        if (dFlag) {
          // Decimal mode: BCD-correct the low then high nibble to match the 6502's SBC.
          let al = (a & 0x0f) - (v & 0x0f) - (1 - c);
          if (al < 0) al = ((al - 6) & 0x0f) - 0x10;
          let sum = (a & 0xf0) - (v & 0xf0) + al;
          if (sum < 0) sum -= 0x60;
          a = sum & 0xff;
        } else {
          a = diff & 0xff;
        }
      }
      let cs = a;
      if (cs !== 0) cs = (cs ^ 0xe5) & 0xff;
      if (cs !== 0) cs = (cs ^ 0x29) & 0xff;
      mem8[loc_455] = cs;
    }
  }

  const exit = closeLayerPointer(m, 0x00);
  mem8[VEC_LIST_HEADER_LO] = mem8[VECHEAD0_PLAY];
  mem8[VEC_LIST_HEADER_HI] = mem8[VECHEAD1_PLAY];
  return exit; // the layer close's exit registers (the header stores write none)
}
