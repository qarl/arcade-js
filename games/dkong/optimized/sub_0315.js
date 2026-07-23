// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0315 — hand-optimized rewrite of the translated routine at ROM 0x0315,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0008 = the rst-0x08 caller-skip helper,
 * 0x0347 = the video-column selector) is reached through `m.call`, the routine
 * registry (games/dkong/routines.js), so each resolves to the oracle or to a
 * future optimized rewrite — none is imported. Only RAM NAMES are imported
 * (from ram.js); the VRAM cell addresses live inside sub_0347 and stay there.
 */

import { FRAME, CURRENT_PLAYER, TWO_PLAYER_GAME } from "./ram.js";

/**
 * sub_0315 -- the blinking player-up ("1UP"/"2UP") indicator, redrawn every
 * 16th frame.  [ROM 0x0315-0x0346, with a shared tail at loc_033e @ 0x033E]
 *
 *   0315  3a 1a 60   ld  a,(FRAME)     ; A = frame counter (0x601A)
 *   0318  47         ld  b,a           ; keep the whole frame byte in B
 *   0319  e6 0f      and 0x0f          ; low nibble
 *   031b  c0         ret nz            ; only act on every 16th frame
 *   031c  cf         rst 0x08          ; sub_0008: skip the rest unless in a game
 *   031d  3a 0d 60   ld  a,(CURRENT_PLAYER)
 *   0320  cd 47 03   call sub_0347     ; HL = this player's VRAM column base
 *   0323  11 e0 ff   ld  de,0xffe0     ; -32: step one tilemap row UP per add
 *   0326  cb 60      bit 4,b           ; bit4 of the frame byte -> blink phase
 *   0328  28 14      jr  z,loc_033e    ; phase 0: draw the lit "digit/arrow" glyphs
 *   032a  3e 10      ld  a,0x10        ; phase 1: draw the BLANK glyph (0x10) x3
 *   032c  77         ld  (hl),a
 *   032d  19         add hl,de
 *   032e  77         ld  (hl),a
 *   032f  19         add hl,de
 *   0330  77         ld  (hl),a
 *   0331  3a 0f 60   ld  a,(TWO_PLAYER_GAME)
 *   0334  a7         and a
 *   0335  c8         ret z             ; 1-player: only the P1 column blanks
 *   0336  3a 0d 60   ld  a,(CURRENT_PLAYER)
 *   0339  ee 01      xor 0x01          ; 2-player: also touch the OTHER player's column
 *   033b  cd 47 03   call sub_0347     ; HL = the other column base
 *   033e  3c         inc a             ; loc_033e: A = player+1 -> the "1"/"2" digit
 *   033f  77         ld  (hl),a
 *   0340  19         add hl,de
 *   0341  36 25      ld  (hl),0x25
 *   0343  19         add hl,de
 *   0344  36 20      ld  (hl),0x20
 *   0346  c9         ret
 *
 * WHAT IT DOES. Called once per main-loop pass from mainLoop (ROM 0x02CA); it
 * early-returns UNLESS the frame counter's low nibble is 0 (every 16th frame),
 * then `rst 0x08` (sub_0008) early-returns AGAIN unless a game is credited
 * (bit0 of ATTRACT/0x6007 clear). When both gates pass it repaints the player-up
 * indicator in a 3-cell vertical column, stepping DE = -32 (one tilemap row up)
 * between cells:
 *   - bit4 of the frame byte is the BLINK PHASE. Phase 1 (bit4 set) writes the
 *     blank glyph 0x10 to all three cells; phase 0 (bit4 clear, the loc_033e
 *     tail) writes the lit glyphs (player+1 digit, then 0x25, then 0x20). The
 *     phase toggles every 16 frames as the frame byte decrements through the
 *     0x?0 values, so the indicator blinks ~0.9 Hz.
 *   - sub_0347 selects the column from CURRENT_PLAYER (0 -> 0x7740, else 0x74E0).
 *     In a TWO-player game the phase-1 arm ALSO paints the other player's column
 *     (0x600D xor 1 -> sub_0347), so both "1UP"/"2UP" markers are maintained.
 *
 * INPUTS.  RAM: FRAME (0x601A) — the blink clock and gate; CURRENT_PLAYER
 *   (0x600D) — the column; TWO_PLAYER_GAME (0x600F) — whether to paint the second
 *   column; and (inside sub_0008) ATTRACT (0x6007) — the in-game gate. Registers
 *   on entry: none consumed (A is reloaded from FRAME as the first act).
 * OUTPUTS. VRAM cells at the selected column base, base-32, base-64 (and, in the
 *   2-player phase-1 arm, the same three in the other column). No hardware latch.
 *   Return value: undefined on every arm.
 *
 * ATOMIC? NO — decisively, and MEASURED so. The vblank NMI lands INSIDE this
 * routine on real gameplay: its first instructions (0x0315/0x0318/0x0319/0x031B)
 * are among the most-hit NMI-landing addresses (2488 NMIs, doc 06 "interruptible
 * surface"), which stands to reason — it is called ~140x/frame from the main
 * loop (mask ENABLED) and spends most of those passes on the `ret nz` early-out.
 * So the per-instruction m.step charges are NOT collapsed: each instruction keeps
 * its own charge at its own PC, byte-identical to the oracle. Collapsing would
 * move where a mid-routine NMI lands and change the PC it pushes into diffed
 * stack RAM (the loc_197a / entry_0611 mechanism). Same decision, same reason.
 *
 * HARDWARE WRITES. None — the three (or six) stores target the tilemap/work VRAM
 * (0x7740 / 0x74E0 columns), whose VALUE is diffed but which carry no 0x7Dxx
 * bus-cycle position, so no write-trace gate is needed. The stores are NOT
 * reordered or dropped: each keeps its exact address, value, and sequence.
 *
 * FLAGS. Every flag-setting op is kept verbatim (`and 0x0f`, `bit 4,b`, `and a`,
 * `xor 0x01`, `inc a`, the `add hl,de`s), because the unit gate compares the
 * whole register file, F included. The CALLER (mainLoop) consumes NONE of them:
 * its next act is `call 0x0350`, which reloads A and recomputes its own flags —
 * but "the caller ignores them" is not licence to leave them wrong when the gate
 * checks them, so they match the oracle exactly on every arm.
 */
export function sub_0315(m) {
  const { regs, mem } = m;

  // ld a,(FRAME) / ld b,a / and 0x0f -- gate on every-16th-frame.
  regs.a = mem.read8(FRAME);
  m.step(0x0318, 13);
  regs.b = regs.a; // keep the whole frame byte: bit4 is the blink phase below
  m.step(0x0319, 4);
  regs.and(0x0f);
  m.step(0x031b, 7);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- not a 16th frame (the overwhelmingly common arm)
    return;
  }
  m.step(0x031c, 5);

  // rst 0x08 (sub_0008): unless bit0 of ATTRACT is clear (a game is credited)
  // it discards our return address and unwinds to mainLoop -- modelled as the
  // callee returning false, i.e. "skip the rest of this routine".
  m.push16(0x031d);
  m.step(0x0008, 11);
  if (!m.call(0x0008)) return;

  // ld a,(CURRENT_PLAYER) / call sub_0347 -> HL = this player's column base.
  regs.a = mem.read8(CURRENT_PLAYER);
  m.step(0x0320, 13);
  m.push16(0x0323);
  m.step(0x0347, 17);
  m.call(0x0347);

  regs.de = 0xffe0; // -32: one tilemap row up per `add hl,de`
  m.step(0x0326, 10);

  // bit 4,b -- the blink phase. Clear -> the lit glyphs (loc_033e tail below);
  // set -> the blank glyph 0x10 x3 (and, in 2P, the other player's column too).
  const phaseSet = regs.bit(4, regs.b);
  m.step(0x0328, 8);
  if (phaseSet) {
    // ld a,0x10, then three `ld (hl),a` stepping DE between them.
    m.step(0x032a, 7);
    regs.a = 0x10;
    m.step(0x032c, 7);
    mem.write8(regs.hl, regs.a);
    m.step(0x032d, 7);
    regs.addHl(regs.de);
    m.step(0x032e, 11);
    mem.write8(regs.hl, regs.a);
    m.step(0x032f, 7);
    regs.addHl(regs.de);
    m.step(0x0330, 11);
    mem.write8(regs.hl, regs.a);
    m.step(0x0331, 7);

    // ld a,(TWO_PLAYER_GAME) / and a / ret z -- 1P stops after its own column.
    regs.a = mem.read8(TWO_PLAYER_GAME);
    m.step(0x0334, 13);
    regs.and(regs.a);
    m.step(0x0335, 4);
    if (regs.fZ) {
      m.ret(11); // ret z -- one-player game: done
      return;
    }
    m.step(0x0336, 5);

    // 2P: repaint the OTHER player's column too. ld a,(CURRENT_PLAYER) / xor 1 /
    // call sub_0347, then fall into the loc_033e tail with A = other player.
    regs.a = mem.read8(CURRENT_PLAYER);
    m.step(0x0339, 13);
    regs.xor(0x01);
    m.step(0x033b, 7);
    m.push16(0x033e);
    m.step(0x0347, 17);
    m.call(0x0347);
  } else {
    m.step(0x033e, 12); // jr z taken -> straight into the loc_033e tail
  }

  // loc_033e -- shared tail: lit glyphs into the current HL column.
  // A holds the player index (0 for P1, or player^1 on the 2P arm); inc -> digit.
  regs.a = regs.inc8(regs.a);
  m.step(0x033f, 4);
  mem.write8(regs.hl, regs.a);
  m.step(0x0340, 7);
  regs.addHl(regs.de);
  m.step(0x0341, 11);
  mem.write8(regs.hl, 0x25);
  m.step(0x0343, 10);
  regs.addHl(regs.de);
  m.step(0x0344, 11);
  mem.write8(regs.hl, 0x20);
  m.step(0x0346, 10);
  m.ret();
}
