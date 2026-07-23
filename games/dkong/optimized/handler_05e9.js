// SPDX-License-Identifier: GPL-3.0-only
/**
 * handler_05e9 — hand-optimized rewrite of the translated routine at ROM 0x05E9,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. This routine has no callees (the sub_0020 tail is inlined
 * at the terminator), so it makes no `m.call`. All constants below are ROM literals.
 */

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
