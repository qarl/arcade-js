// SPDX-License-Identifier: GPL-3.0-only
/**
 * optimized/ — hand-optimized rewrites of translated/ routines, each proven
 * equal to its oracle by the equivalence harness.
 *
 * `handler_01c3` below is at rung 2/3 of the ladder (named + documented,
 * byte-identical to ../translated/state0.js). See its own docstring for the
 * ladder status and why its cycle charges must stay.
 *
 * Every callee is imported straight from translated/ — all routines there are
 * exported (README §1), so the oracle stays the single implementation of each
 * and there are NO copies here to drift out of sync. Only routines actually
 * being rewritten live in this file.
 */

import { sub_0874, sub_0207, sub_0a53, sub_309f } from "../translated/state0.js";
import { entry_06b8, draw_056b, tail_05da, sub_0616 } from "../translated/mainloop.js";
import { NotImplemented } from "../../../boards/dkong/io.js";
import { ATTRACT, LEVEL, LIVES, GAME_STATE, BOARD, GAME_SUBSTATE } from "./ram.js";

// Board control latch, not work RAM — it lives in the dkong board, not ram.js.
const FLIPSCREEN = 0x7d82;

/**
 * handler_01c3 -- game state 0: one-time power-on initialization.  [ROM 0x01C3-0x0206]
 *
 * Runs once. It seeds a known baseline, sets the screen up, queues the opening
 * tasks, and advances GAME_STATE so the *next* NMI dispatches a different
 * handler and this one never runs again.
 *
 * LADDER STATUS — rung 2/3 (named + documented), NOT yet de-scaffolded.
 * The `m.step(addr, tstates)` charges and the `m.push16(retaddr)` before each
 * call are RETAINED deliberately, and this remains behaviourally byte-identical
 * to ../translated/state0.js:
 *   - This routine runs inside the NMI, and the NMI's total cycle cost sets how
 *     long the main loop then spins, which is the PRNG's entropy (see ram.js
 *     SPIN_COUNT / RNG). So the `m.step` charges may be observable here; whether
 *     they can be dropped is a harness question, taken up in the next rung.
 *   - Each callee (sub_0874, entry_06b8, sub_0207, sub_0a53, sub_309f) ends in
 *     its own `ret`, so the matching `m.push16` is the calling convention: drop
 *     it and the callee's `ret` unbalances SP. The push stays.
 * So this rung buys readability (names + structure), not fewer operations.
 */
export function handler_01c3(m) {
  const { regs, mem } = m;

  // Clear the playfield and do the initial object setup.
  m.push16(0x01c6); m.step(0x0874, 17); sub_0874(m);

  // Seed 9 bytes of initial data from ROM 0x01BA into the 0x60B2 region.
  regs.hl = 0x01ba; m.step(0x01c9, 10);
  regs.de = 0x60b2; m.step(0x01cc, 10);
  regs.bc = 0x0009; m.step(0x01cf, 10);
  m.ldir(0x01d1);

  // Baseline: attract on, level 1, one life. (A=1 is also carried into entry_06b8.)
  regs.a = 0x01;               m.step(0x01d3, 7);
  mem.write8(ATTRACT, regs.a); m.step(0x01d6, 13);
  mem.write8(LEVEL, regs.a);   m.step(0x01d9, 13);
  mem.write8(LIVES, regs.a);   m.step(0x01dc, 13);

  m.push16(0x01df); m.step(0x06b8, 17); entry_06b8(m); // draw the lives display, etc.
  m.push16(0x01e2); m.step(0x0207, 17); sub_0207(m);   // unpack DSW0 into the settings block

  // Screen up; advance the top-level state (so this handler runs once); board = 25m.
  regs.a = 0x01;                       m.step(0x01e4, 7);
  mem.write8(FLIPSCREEN, regs.a, 10);  m.step(0x01e7, 13);
  mem.write8(GAME_STATE, regs.a);      m.step(0x01ea, 13); // next NMI dispatches attract
  mem.write8(BOARD, regs.a);           m.step(0x01ed, 13);
  regs.xor(regs.a);                    m.step(0x01ee, 4);  // A = 0
  mem.write8(GAME_SUBSTATE, regs.a);   m.step(0x01f1, 13);

  m.push16(0x01f4); m.step(0x0a53, 17); sub_0a53(m);

  // Queue the three opening tasks (each a 16-bit D,E pair via sub_309f).
  for (const [de, after, next] of [
    [0x0304, 0x01f7, 0x01fa],
    [0x0202, 0x01fd, 0x0200],
    [0x0200, 0x0203, 0x0206],
  ]) {
    regs.de = de;   m.step(after, 10);
    m.push16(next); m.step(0x309f, 17); sub_309f(m);
  }

  m.ret();
}

/**
 * handler_05c6 -- task table entry 2: draw a BCD counter.  [ROM 0x05C6-0x05DF]
 *
 * The task-dispatch payload in A selects one of three 3-byte little-endian BCD
 * scores to render, addressed by its MOST-significant byte (draw_0578 walks
 * three bytes DOWNWARD from there):
 *   0 -> 0x60B4  (P1_SCORE  0x60B2 + 2), rendered by draw_056b
 *   1 -> 0x60B7  (P2_SCORE  0x60B5 + 2), rendered by draw_056b
 *   2 -> 0x60BA  (HIGH_SCORE 0x60B8 + 2), rendered by tail_05da -> draw_0578
 *   3 -> untranslated tail at ROM 0x05E0 (throws; must stay identical)
 * 0x60B4/B7/BA are NOT named in ram.js -- they are the +2 MSB of the named
 * score bases, not fields in their own right -- so they stay hex here.
 *
 * A is left untouched: draw_056b re-reads it (`and a`) to pick the render
 * column, and the renderer overwrites every flag it needs, so no flag set here
 * is observed -- the equivalence harness (which compares F) confirms it.
 *
 * LADDER STATUS -- rung 5 (idiomatic), cycles collapsed to one total charge.
 * THE RUNG-4 EXPERIMENT settled the open question the README §2 caveat left:
 * handler_01c3's cycle charges were observable because the NMI's total cost
 * sets the main-loop spin count -- but is that NMI-specific? handler_05c6 is a
 * MAIN-LOOP routine (dispatched by dispatchTask), so it is the control. Result:
 *   (a) stripping ALL m.step charges DIVERGED at 0x6019 (SPIN_COUNT), frame 6,
 *       65 vs 66 -- the *same address and values* as the NMI case. One cheaper
 *       frame reaches the vblank spin sooner, so the loop spins once more.
 *   (b) charging the executed path's TOTAL in a single m.step stayed EQUAL.
 * So a routine's TOTAL cycle cost is observable through the spin count NO MATTER
 * where it runs; only the internal DISTRIBUTION is free. The charge stays -- but
 * as one total per branch, not one per instruction. (Totals below are the sums
 * of the oracle's per-instruction charges along each branch.)
 */
export function handler_05c6(m) {
  const { regs } = m;
  const payload = regs.a;

  if (payload === 3) {
    // Untranslated: left exactly as the oracle, which throws here.
    m.step(0x05e0, 10);
    throw new NotImplemented("handler_05c6 payload 3 path at ROM 0x05E0");
  }

  if (payload === 2) {
    // HIGH_SCORE: tail_05da loads 0x60BA itself, so DE need not be set here.
    m.step(0x05da, 68); // ROM 0x05C8..0x05DA path total
    return tail_05da(m);
  }

  // P1 (0) / P2 (1) score; draw_056b picks its column from A (still == payload).
  regs.de = payload === 0 ? 0x60b4 : 0x60b7;
  m.step(0x056b, payload === 0 ? 58 : 68); // ROM 0x05C8..0x056B path totals
  return draw_056b(m);
}

// -- handler_05e9 constants (ROM literals; NOT work-RAM, so none are in ram.js) --
const STRING_PTR_TABLE = 0x364b; // base of the 05e9 pointer table (indexed by payload*2)
const VRAM_ROW_STEP = 0xffe0; //   -32: back one tilemap row per char (vertical draw)
const STRING_TERMINATOR = 0x3f; // sentinel byte ending the character run
const BLANK_TILE = 0x10; //        tile written in the "blank the string" mode (bit 7 of payload)
const TABLE_INDEX_MASK = 0x7f; //  `and 0x7f` after `add a,a` -- keep the doubled index, drop bit 8

/**
 * handler_05e9 -- task table entry 3: draw a string.  [ROM 0x05E9-0x0610]
 *
 * A doubly-indirected vertical string draw. The dispatch payload in A selects
 * an entry in the pointer table at 0x364B (word-addressed: `add a,a` doubles the
 * index). That entry points to a descriptor whose first word is the VRAM
 * destination and whose following bytes are the characters. The destination
 * pointer steps back one tilemap row (-32) per character, so the string is drawn
 * VERTICALLY -- as you would expect on a screen the hardware rotates 270 degrees.
 *
 * 0x3F terminates the run. The terminator exit is `jp z,0x0026` -- a jump into
 * the TAIL of sub_0020 (`pop hl / ret`), inlined here. It is a NORMAL return:
 * at that point the stack is [return-addr, AF] because the prologue `push af`
 * is still outstanding (the loop's balancing `pop af` is AFTER the terminator
 * check), so `pop hl` discards THAT push-af value -- not the return address --
 * and `ret` goes to the immediate caller.
 *
 * The `push af` (before the `and`) carries bit 7 of the payload -- via the
 * carry set by `add a,a` -- across every loop iteration (pop af / re-push af).
 * When set, each cell is overwritten with the blank tile 0x10 after the
 * character is stored (a "blank the string" mode); when clear, the character
 * stands. The value is constant for the whole string.
 *
 * LADDER STATUS -- rung 2 (named + documented, real-loop structured), and this
 * is the LAST rung that stays EQUAL. Rung 3 -- collapsing the per-instruction
 * m.step charges to one TOTAL per path -- CANNOT be done for this routine, and
 * the per-instruction charges below are therefore retained deliberately.
 *
 * WHY THE COLLAPSE DIVERGES (a case README §2's caveat covers). The path totals
 * are themselves correct: prologue 118, drawing iter 93 (carry clear, no blank)
 * / 98 (carry set, extra `ld (hl),0x10`), terminator 44 -- summed from the
 * oracle's per-instruction tstates and cross-checked against its measured 1092 =
 * 118 + 10*93 + 44 for payload 4's 10-char string. The UNIT harness (which runs
 * the routine with no interrupt) reads EQUAL with the charges collapsed. But the
 * WHOLE-machine trace diverges at frame 7, addr 0x6bf2 (118 vs 86): the vblank
 * NMI fires INSIDE the loop on a frame-6 dispatch, and the oracle pushes PC
 * 0x060d (the boundary after `push af`) onto the stack -- diffed work RAM. A
 * per-iteration charge has PC 0x0600 at that instant, so it pushes the wrong
 * return address and the NMI handler's deeper stack frame diverges downstream.
 * Unlike handler_05c6 (short enough that the NMI never lands inside it),
 * handler_05e9 is long enough to be interrupted, so its internal cycle
 * DISTRIBUTION is observable and the per-instruction m.step charges must stay.
 *
 * The push/pop stack idioms are load-bearing regardless: the unit harness
 * compares the stack byte at 0x6BFC (SP=0x6BFE on entry) AND the full register
 * file, including HL, which the terminator's `pop hl` sets. No callees: the
 * sub_0020 tail is inlined, so nothing is imported for it.
 */
export function handler_05e9(m) {
  const { regs, mem } = m;

  // -- prologue: resolve payload -> descriptor -> (VRAM dest, char source) --
  regs.hl = STRING_PTR_TABLE;
  m.step(0x05ec, 10);
  regs.add(regs.a); // add a,a -- doubles the index; bit 7 of payload -> carry
  m.step(0x05ed, 4);
  m.push16(regs.af); // save the carry (blank-mode flag) across the loop
  m.step(0x05ee, 11);
  regs.and(TABLE_INDEX_MASK);
  m.step(0x05f0, 7);
  regs.e = regs.a;
  m.step(0x05f1, 4);
  regs.d = 0x00;
  m.step(0x05f3, 7);
  regs.addHl(regs.de); // hl -> pointer-table entry
  m.step(0x05f4, 11);
  regs.e = mem.read8(regs.hl); // de = descriptor address (16-bit table entry)
  m.step(0x05f5, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x05f6, 6);
  regs.d = mem.read8(regs.hl);
  m.step(0x05f7, 7);
  regs.exDeHl(); // hl -> descriptor
  m.step(0x05f8, 4);
  regs.e = mem.read8(regs.hl); // de = VRAM destination (descriptor's first word)
  m.step(0x05f9, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x05fa, 6);
  regs.d = mem.read8(regs.hl);
  m.step(0x05fb, 7);
  regs.hl = (regs.hl + 1) & 0xffff; // hl -> first character byte
  m.step(0x05fc, 6);
  regs.bc = VRAM_ROW_STEP;
  m.step(0x05ff, 10);
  regs.exDeHl(); // hl = VRAM dest (write ptr), de = char source ptr
  m.step(0x0600, 4);

  // -- loop: copy chars until the 0x3F terminator, stepping up one row each --
  for (;;) {
    regs.a = mem.read8(regs.de);
    m.step(0x0601, 7);
    regs.cp(STRING_TERMINATOR);
    m.step(0x0603, 7);
    if (regs.fZ) {
      // Terminator: inlined sub_0020 tail. `pop hl` discards the outstanding
      // prologue push-af; `ret` returns to the immediate caller. NORMAL return.
      m.step(0x0026, 10);
      regs.hl = m.pop16();
      m.step(0x0027, 10);
      m.ret();
      return;
    }
    m.step(0x0606, 10);
    mem.write8(regs.hl, regs.a); // store the character
    m.step(0x0607, 7);
    regs.af = m.pop16(); // restore the blank-mode carry
    m.step(0x0608, 10);
    if (regs.fNC) {
      m.step(0x060c, 12); // carry clear: keep the character (jr nc taken)
    } else {
      m.step(0x060a, 7); // carry set: overwrite with the blank tile
      mem.write8(regs.hl, BLANK_TILE);
      m.step(0x060c, 10);
    }
    m.push16(regs.af); // re-save the carry for the next iteration
    m.step(0x060d, 11);
    regs.de = (regs.de + 1) & 0xffff; // next char
    m.step(0x060e, 6);
    regs.addHl(regs.bc); // dest up one tilemap row (-32)
    m.step(0x060f, 11);
    m.step(0x0600, 12); // jr 0x0600
  }
}

/**
 * entry_0611 -- task table entry 8: enable-gated string draw + BCD expansion.
 * [ROM 0x0611-0x0615, then falls through into sub_0616 @ 0x0616]
 *
 *   0611  3a 07 60   ld  a,(0x6007)   ; A = ATTRACT
 *   0614  0f         rrca             ; bit 0 of ATTRACT -> carry
 *   0615  d0         ret nc           ; enable bit clear: do nothing
 *   ...  falls through into sub_0616  ; draw string 5 + tail-jump a BCD expand
 *
 * A one-bit ENABLE GUARD on bit 0 of ATTRACT (0x6007): `rrca` rotates that bit
 * into carry, so the routine returns UNLESS it is set -- not a value test but
 * the same `ld a,(0x6007) / rrca / ret nc` idiom sub_0008 uses on the identical
 * byte. When the bit IS set, control falls straight through into sub_0616, which
 * draws string 5 (via handler_05e9) and tail-jumps a one-byte BCD expansion at
 * 0x6001. sub_0616 is the translated ORACLE, imported not copied (README §1);
 * it is left per-instruction because it IS interruptible (handler_05e9).
 *
 * A is left rotated and read by nothing downstream (sub_0616's first act reloads
 * A with 0x05); F's carry is the return value on the guard-clear branch and is
 * overwritten by sub_0616 on the fall-through branch. The `rrca` is kept verbatim
 * so BOTH A and F match the oracle exactly -- the unit gate compares the whole
 * register file, F included.
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles collapsed to one total per branch.
 * entry_0611 is ATOMIC (unlike handler_05e9): charging each branch's per-
 * instruction tstate SUM in a single m.step -- guard-clear 13+4+11 = 28, fall-
 * through 13+4+5 = 22 -- stays EQUAL whole-machine AND unit. The vblank NMI never
 * lands inside this 3-instruction prologue, so its internal cycle distribution is
 * free. The TOTAL is still load-bearing, though: stripping the charges ENTIRELY
 * diverges at stack 0x6bf2 (frame 7, 118 vs 86), because the downstream sub_0616
 * is interruptible -- a cheaper prologue moves where the NMI lands INSIDE it and
 * the pushed PC changes. Preserving each branch's total keeps that landing
 * identical, so: collapse = win, drop = wrong. (Same lesson as handler_05c6, via
 * the stack rather than the spin count -- the mechanism is universal, README §2.)
 */
export function entry_0611(m) {
  const { regs, mem } = m;

  // ld a,(ATTRACT) / rrca -- rotate the enable bit (bit 0) into carry.
  regs.a = mem.read8(ATTRACT);
  regs.rrca();

  if (regs.fNC) {
    // ret nc taken: enable bit clear -- do nothing. path total 13+4+11 = 28 t.
    m.ret(28);
    return;
  }

  // ret nc not taken -- fall through into sub_0616. prologue total 13+4+5 = 22 t.
  m.step(0x0616, 22);
  sub_0616(m);
}
