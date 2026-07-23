// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0426 — hand-optimized rewrite of the translated routine at ROM 0x0426,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0464 loc_0464, 0x0486 loc_0486, 0x004e
 * the template block-copy, 0x0450 loc_0450) is reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so each resolves to the oracle or
 * to a future optimized rewrite — never a copy. Only the RAM name SND_TRIGGER is
 * imported (from ram.js).
 */

import { SND_TRIGGER } from "./ram.js";

/**
 * loc_0426 -- advance the colour-cycle animation's own frame counter (0x6390),
 * and every 32 frames refresh the animation table.
 * [ROM 0x0426-0x044F, then falls into loc_0450 @ 0x0450]
 *
 *   0426  21 90 63   ld  hl,0x6390    ; HL -> colour-cycle frame counter
 *   0429  34         inc (hl)         ; (0x6390)++  (the running animation phase)
 *   042a  7e         ld  a,(hl)
 *   042b  fe 80      cp  0x80         ; counter wrapped to 0x80?
 *   042d  ca 64 04   jp  z,0x0464     ;   yes -> loc_0464 (reset counter + latch)
 *   0430  3a 93 63   ld  a,(0x6393)   ; A = colour-cycle "suppress table copy" flag
 *   0433  a7         and a
 *   0434  c2 86 04   jp  nz,0x0486    ;   flag set -> just redraw the colour tail
 *   0437  7e         ld  a,(hl)       ; A = counter again (HL still 0x6390)
 *   0438  47         ld  b,a
 *   0439  e6 1f      and 0x1f         ; on a 32-frame boundary?
 *   043b  c2 86 04   jp  nz,0x0486    ;   no -> just redraw the colour tail
 *   043e  21 cf 39   ld  hl,0x39cf    ; 32-boundary: pick animation table A (0x39CF)...
 *   0441  cb 6b      bit 5,b
 *   0443  20 03      jr  nz,0x0448    ;   ...unless counter bit5 clear ->
 *   0445  21 f7 39   ld  hl,0x39f7    ;      table B (0x39F7)
 *   0448  cd 4e 00   call 0x004e      ; block-copy the chosen table into the sprite block
 *   044b  3e 03      ld  a,0x03
 *   044d  32 82 60   ld  (0x6082),a   ; SND_TRIGGER[2] := 3 (a 3-frame sound assert)
 *   0450             (falls into loc_0450, the (0x6227) bit-dispatch colour tail)
 *
 * WHAT IT DOES. This is the body the colour-cycle gate loc_0413 falls into once
 * per frame while the animation "active" latch (0x6391) is set. It bumps the
 * animation's private frame counter 0x6390 (0->0x80 over 128 frames) and routes
 * on it:
 *
 *   - counter reached 0x80        -> loc_0464 (reset 0x6390/0x6391, one full cycle done)
 *   - 0x6393 flag set             -> loc_0486 (idle: redraw the colour columns only)
 *   - counter not a 32-multiple   -> loc_0486 (idle redraw)
 *   - counter IS a 32-multiple    -> reload the animation table (block-copy 0x004e),
 *                                    fire a sound trigger, then fall into loc_0450
 *                                    (which itself ends in the loc_0486 colour tail)
 *
 * The 32-boundary table pick keys off bit 5 of the counter: counter&0x1f==0
 * restricts it to {0x20,0x40,0x60}; bit5 set (0x20,0x60) keeps table 0x39CF,
 * bit5 clear (0x40) swaps to 0x39F7 -- so the two ROM animation tables alternate
 * across the 128-frame cycle. 0x6393 acts as a "skip the table copy this cycle"
 * suppressor; observed set (=1) throughout normal gameplay, which is why the
 * table-copy arm is the COLD path (see CYCLES/coverage below).
 *
 * INPUTS:  reads 0x6390 (colour-cycle frame counter) and 0x6393 (table-copy
 *          suppress flag) -- both currently UNNAMED in ram.js (the world verifier
 *          left the 0x6390/0x6391/0x6393 block hex), so they stay hex literals
 *          here and are reported as naming candidates; only SND_TRIGGER is an
 *          established name.
 * OUTPUTS: writes 0x6390 (the ++), and on the 32-boundary arm SND_TRIGGER[2]
 *          (0x6082) = 3 plus whatever the 0x004e block-copy lands in the sprite
 *          object block. All are WORK RAM -- there is NO 0x7Dxx hardware-latch
 *          write on any path, so no bus-cycle-positioned write and no write-trace
 *          concern (SND_TRIGGER[2] is the work-RAM trigger COUNTER at 0x6082, not
 *          the ls259.6h latch at 0x7D02 that sub_00e0 drives from it).
 *
 * FLAGS. The routine never returns a `cc` -- every exit tail-calls, so its
 * observable "return" is whatever loc_0464 / loc_0486 / loc_0450 leave. Each
 * flag-setting op here (`inc (hl)`, `cp 0x80`, `and a`, `and 0x1f`, `bit 5,b`)
 * has its Z/carry consumed by the very next `jp`/`jr` and then overwritten before
 * anything downstream reads it. They are nonetheless kept VERBATIM so A, B, HL
 * and F match the oracle bit-for-bit at every point -- the unit gate compares the
 * whole register file, F included.
 *
 * CYCLES -- PER-INSTRUCTION, deliberately NOT collapsed. loc_0426 is a LEAF
 * reached only via `m.call`, and by the atomicity-is-per-call-path rule it is
 * NOT atomic: its sole caller is loc_0413 (both the `jp nz,0x0426` arm and the
 * FRAME==0 fall-through), which is itself interruptible with the NMI mask
 * ENABLED -- loc_0413 is reached from entry_03fb <- loc_197a (the main-loop
 * per-frame update cascade) and from entry_0400 (a dispatchTask task), and is
 * kept per-instruction for exactly this reason. The vblank NMI can therefore land
 * INSIDE loc_0426, pushing a live PC into the diffed stack RAM, so collapsing its
 * per-instruction m.step charges to one total per branch could move where that
 * NMI lands. Each `m.step(nextPC, t)` is kept at its oracle cycle so the
 * cumulative clock is identical instruction by instruction. This buys names +
 * structure + documentation, not fewer operations. (The harness confirms EQUAL
 * with the charges kept; collapse is not attempted because the call path forbids
 * it, per loc_0413 / loc_197a / sub_0020.)
 */
export function loc_0426(m) {
  const { regs, mem } = m;

  // ld hl,0x6390 / inc (hl) -- advance the colour-cycle frame counter.
  regs.hl = 0x6390;
  m.step(0x0429, 10); // ld hl,0x6390
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x042a, 11); // inc (hl) -- (0x6390)++

  // ld a,(hl) / cp 0x80 -- did the counter wrap to 0x80 (one full cycle)?
  regs.a = mem.read8(regs.hl);
  m.step(0x042b, 7); // ld a,(hl)
  regs.cp(0x80);
  m.step(0x042d, 7); // cp 0x80
  if (regs.fZ) {
    // jp z,0x0464 taken: reset the counter + the active latch.
    m.step(0x0464, 10); // jp z,0x0464
    return m.call(0x0464);
  }
  m.step(0x0430, 10); // jp z NOT taken

  // ld a,(0x6393) / and a -- table-copy suppressed this cycle?
  regs.a = mem.read8(0x6393);
  m.step(0x0433, 13); // ld a,(0x6393)
  regs.and(regs.a);
  m.step(0x0434, 4); // and a
  if (regs.fNZ) {
    // jp nz,0x0486 taken: flag set -- idle redraw of the colour tail.
    m.step(0x0486, 10); // jp nz,0x0486
    return m.call(0x0486);
  }
  m.step(0x0437, 10); // jp nz NOT taken

  // ld a,(hl) / ld b,a / and 0x1f -- is the counter on a 32-frame boundary?
  regs.a = mem.read8(regs.hl); // hl still 0x6390
  m.step(0x0438, 7); // ld a,(hl)
  regs.b = regs.a;
  m.step(0x0439, 4); // ld b,a
  regs.and(0x1f);
  m.step(0x043b, 7); // and 0x1f
  if (regs.fNZ) {
    // jp nz,0x0486 taken: not a boundary -- idle redraw of the colour tail.
    m.step(0x0486, 10); // jp nz,0x0486
    return m.call(0x0486);
  }
  m.step(0x043e, 10); // jp nz NOT taken -- 32-frame boundary

  // ld hl,0x39cf / bit 5,b / jr nz,0x0448 -- pick the animation table by bit 5.
  regs.hl = 0x39cf; // table A (default)
  m.step(0x0441, 10); // ld hl,0x39cf
  const bit5 = regs.bit(5, regs.b);
  m.step(0x0443, 8); // bit 5,b
  if (bit5) {
    m.step(0x0448, 12); // jr nz,0x0448 taken -- keep table 0x39cf
  } else {
    m.step(0x0445, 7); // jr nz NOT taken
    regs.hl = 0x39f7; // table B
    m.step(0x0448, 10); // ld hl,0x39f7
  }

  // call 0x004e -- block-copy the chosen ROM table into the sprite object block.
  m.push16(0x044b);
  m.step(0x004e, 17); // call 0x004e
  m.call(0x004e);

  // ld a,0x03 / ld (0x6082),a -- fire a 3-frame sound trigger, then fall into loc_0450.
  regs.a = 0x03;
  m.step(0x044d, 7); // ld a,0x03
  mem.write8(SND_TRIGGER + 2, regs.a); // 0x6082 -- falls into loc_0450
  m.step(0x0450, 13); // ld (0x6082),a
  return m.call(0x0450);
}
