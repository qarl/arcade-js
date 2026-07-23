// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0486 — hand-optimized rewrite of the translated routine at ROM 0x0486,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its three tail callees (0x04be loc_04be, 0x04a1 loc_04a1,
 * 0x04a3 loc_04a3) are reached through `m.call`, the routine registry
 * (games/dkong/routines.js), so each resolves to the oracle or to a future
 * optimized rewrite — never a copy. Only the RAM name BOARD is imported (from ram.js).
 */

import { BOARD } from "./ram.js";

/**
 * loc_0486 -- the "redraw the colour columns" tail of the per-frame intro /
 * attract colour-cycle animation. [ROM 0x0486-0x04A0, then tail-calls
 * loc_04a1 / loc_04a3 / loc_04be]
 *
 *   0486  3a 90 63   ld  a,(0x6390)   ; A = colour-cycle frame counter (the PHASE)
 *   0489  4f         ld  c,a          ; C = phase -- handed to the colour writer sub_0514
 *   048a  11 20 00   ld  de,0x0020    ; DE = 0x20 = the row stride sub_0514 walks
 *   048d  3a 27 62   ld  a,(0x6227)   ; A = BOARD (1..4)
 *   0490  fe 04      cp  0x04         ; board 4 == 100m rivets?
 *   0492  ca be 04   jp  z,0x04be     ; -> loc_04be (100m's two-column blink block)
 *   0495  79         ld  a,c          ; A = phase
 *   0496  a7         and a            ; phase == 0?
 *   0497  ca a1 04   jp  z,0x04a1     ; phase 0 -> loc_04a1 (colour byte 0x10)
 *   049a  3e ef      ld  a,0xef       ; else default colour byte 0xEF
 *   049c  cb 71      bit 6,c          ; high half of the 0..0x7F phase cycle?
 *   049e  c2 a3 04   jp  nz,0x04a3    ; bit6 set -> loc_04a3, keep A = 0xEF
 *   04a1             (falls into loc_04a1, which forces A = 0x10)
 *
 * WHAT IT DOES. This is the leaf every arm of the colour-cycle tree funnels into
 * to actually repaint the animated colour columns for the current frame. It is a
 * tail target reached SEVEN ways -- from loc_0413 (the FRAME!=0 idle branch,
 * which is how it runs in practice), loc_0426, loc_0450 (×2), loc_0464, and
 * loc_0478 -- all inside the loc_197a per-frame update cascade. It picks the
 * colour BYTE for this frame and where to write it:
 *
 *   - BOARD == 4 (100m)          -> loc_04be : the rivet board's dedicated block,
 *                                   two sub_0514 columns + an X-position blink.
 *   - BOARD != 4, phase == 0     -> loc_04a1 : colour byte 0x10 (via loc_04a1 -> loc_04a3).
 *   - BOARD != 4, phase's bit6=1 -> loc_04a3 : colour byte 0xEF (the high half of the
 *                                   0x00..0x7F phase cycle -- the counter is reset at
 *                                   0x80 by loc_0464, so bit6 marks the second quarter-
 *                                   pair, giving the 0xEF/0x10 colour alternation).
 *   - BOARD != 4, phase's bit6=0 -> loc_04a1 : falls through, colour byte 0x10.
 *
 * So 0x6390's bit6 is the colour-cycle toggle: A = 0xEF for phase 0x40..0x7F and
 * A = 0x10 for phase 0x00..0x3F, which loc_04a3 writes down a colour column via
 * sub_0514 (using C = phase and DE = 0x20). 0x6390 is currently UNNAMED in ram.js
 * -- the world verifier left the 0x6390/0x6391/0x6393 animation block hex -- so it
 * stays a hex literal here and is reported as a naming candidate; only BOARD =
 * 0x6227 is an established name.
 *
 * INPUTS:  reads 0x6390 (phase counter) and BOARD (0x6227).
 * OUTPUTS: writes NO RAM itself -- it only sets up registers (C = phase, DE = 0x20,
 *          A = the colour byte) and tail-calls loc_04a1 / loc_04a3 / loc_04be,
 *          which do the visible colour-RAM writes. No hardware latch is touched
 *          here (the tails' sub_0514 writes go to colour VRAM, not a 0x7Dxx latch),
 *          so there is no bus-cycle-positioned write and no write-trace concern in
 *          this routine.
 *
 * FLAGS. The routine never returns a `cc` -- every path tail-calls, so its
 * observable "return" is whatever the tail routine leaves. Each flag-setting op
 * (`cp 0x04`, `and a`, `bit 6,c`) is consumed IMMEDIATELY by the very next `jp`
 * and then overwritten by the tail routine's own first flag op before anything
 * reads it. The ops are nonetheless kept VERBATIM (`regs.cp`, `regs.and`,
 * `regs.bit`) so A and F match the oracle bit-for-bit at every m.call boundary --
 * the unit gate compares the whole register file, F included. C and DE are the
 * real live outputs the tail's sub_0514 consumes, so they must be exact.
 *
 * CYCLES -- PER-INSTRUCTION, deliberately NOT collapsed. loc_0486 is a LEAF
 * reached only via m.call, and by the atomicity-is-per-call-path rule it is NOT
 * atomic: EVERY one of its callers is interruptible with the NMI mask ENABLED --
 * all seven sit inside the loc_197a main-loop per-frame colour cascade (and the
 * scheduled task entry_0400), for which loc_197a / loc_0413 are themselves kept
 * per-instruction. The vblank NMI can therefore land INSIDE this routine, pushing
 * a live PC into the diffed stack RAM, so collapsing its per-instruction m.step
 * charges to one total per branch could move where that NMI lands. Each
 * `m.step(nextPC, t)` is kept at its oracle cycle so the cumulative clock is
 * identical instruction by instruction. This rung buys names + structure +
 * documentation (the handler_01c3 rung), not fewer operations. (Same decision,
 * and same reason, as its parent loc_0413.)
 */
export function loc_0486(m) {
  const { regs, mem } = m;

  // ld a,(0x6390) / ld c,a -- C = colour-cycle phase counter (index for sub_0514).
  // 0x6390 is UNNAMED in ram.js (animation block left hex); kept a hex literal.
  regs.a = mem.read8(0x6390);
  m.step(0x0489, 13); // ld a,(0x6390)
  regs.c = regs.a;
  m.step(0x048a, 4); // ld c,a

  // ld de,0x0020 -- the row stride sub_0514 walks while writing the colour column.
  regs.de = 0x0020;
  m.step(0x048d, 10); // ld de,0x0020

  // ld a,(BOARD) / cp 0x04 -- board 4 (100m rivets) has its own colour block.
  regs.a = mem.read8(BOARD);
  m.step(0x0490, 13); // ld a,(0x6227)
  regs.cp(0x04);
  m.step(0x0492, 7); // cp 0x04
  if (regs.fZ) {
    // board == 4: hand off to the 100m two-column blink block.
    m.step(0x04be, 10); // jp z,0x04be (taken)
    return m.call(0x04be);
  }
  m.step(0x0495, 10); // jp z NOT taken -- board != 4

  // ld a,c / and a -- is the phase counter 0?
  regs.a = regs.c;
  m.step(0x0496, 4); // ld a,c
  regs.and(regs.a);
  m.step(0x0497, 4); // and a
  if (regs.fZ) {
    // phase == 0: colour byte 0x10 (loc_04a1 loads it, then falls into loc_04a3).
    m.step(0x04a1, 10); // jp z,0x04a1 (taken)
    return m.call(0x04a1);
  }
  m.step(0x049a, 10); // jp z NOT taken -- phase != 0

  // ld a,0xef / bit 6,c -- default colour 0xEF; is the phase in the cycle's high half?
  regs.a = 0xef;
  m.step(0x049c, 7); // ld a,0xef
  const b6 = regs.bit(6, regs.c);
  m.step(0x049e, 8); // bit 6,c
  if (b6) {
    // bit6 set (phase 0x40..0x7F): keep colour 0xEF and write it (loc_04a3).
    m.step(0x04a3, 10); // jp nz,0x04a3 (taken)
    return m.call(0x04a3);
  }

  // bit6 clear (phase 0x01..0x3F): fall into loc_04a1, which overrides A = 0x10.
  m.step(0x04a1, 10); // jp nz NOT taken -- fall into loc_04a1
  return m.call(0x04a1);
}
