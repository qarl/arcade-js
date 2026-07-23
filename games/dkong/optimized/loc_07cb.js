// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_07cb — hand-optimized rewrite of the translated routine at ROM 0x07CB,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x309f, 0x004e, 0x3f24, 0x0038) is reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle or a future optimized rewrite — never a copy. Only RAM
 * *names* are imported (from ram.js); the two work-RAM cells this routine's
 * finish path touches are named, everything else (the animation timer 0x638A /
 * pattern 0x638B, the 0x7D8x decode scratch, the 0x3D08 ROM fill table, the
 * 0x69xx sound records) has no ram.js name and stays hex.
 */

import { SUBSTATE_TIMER, GAME_SUBSTATE } from "./ram.js";

/**
 * loc_07cb -- attract "HOW HIGH" round-2 per-frame countdown animation task.
 * [ROM 0x07CB-0x084A, 128 bytes]  Reached ONLY via the 0x0748 sub-state table
 * (dw 0x07cb @0x0754, entry index 6), dispatched by handler_073c when GAME_STATE
 * (0x6005) == 1 (attract) and GAME_SUBSTATE (0x600A) == 6 and CREDITS (0x6001)
 * == 0. handler_073c is itself the state-1 arm of the NMI's 0x00CA table, so this
 * WHOLE routine executes INSIDE the vblank NMI (see the LADDER note).
 *
 * WHAT IT DOES. Advances a 96-frame countdown that repaints a block of the
 * attract screen each frame and, on expiry, hands the attract state machine on.
 *   • FRAME TIMER 0x638A. Nonzero => one countdown frame: reload the pattern C
 *     from 0x638B and decrement the timer. Zero (first frame) => ARM it to 0x60
 *     (96) and seed the pattern C = 0x5F.
 *   • JOIN: if the (post-decrement) timer is 0 the countdown is OVER -- write
 *     SUBSTATE_TIMER (0x6009) = 2, bump GAME_SUBSTATE (0x600A) so handler_073c
 *     moves to the next sub-state, clear 0x638A/0x638B, and return.
 *   • Otherwise DECODE two bits of the pattern: `rlc` C twice, writing 0/1 into
 *     0x7D86 and 0x7D87 from the two carries, then save the rotated pattern back
 *     to 0x638B (so it walks a new 2-bit window every frame).
 *   • TABLE FILL: walk the record list at ROM 0x3D08 -- each record is
 *     [count, destLo, destHi] -- and block-fill `count` bytes of value 0xB0 to
 *     VRAM starting at dest; stop at the record whose trailing count byte is 0.
 *   • Then QUEUE two tasks (sub_309f with 0x031E, 0x031F), REPAINT (sub_004e
 *     copies 0x28 bytes from ROM 0x39CF to 0x6908; sub_3f24 draws two fixed
 *     VRAM cells), and fire two sound triggers via `rst 0x38` (sub_003d adds
 *     C into 10 stride-4 bytes at HL: C=0x44 @0x6908, C=0x78 @0x690B).
 *
 * INPUTS  : RAM 0x638A (frame timer), 0x638B (pattern), + the callees' inputs.
 * OUTPUTS : 0x638A/0x638B (timer/pattern), on finish SUBSTATE_TIMER (0x6009) &
 *           GAME_SUBSTATE (0x600A); decode scratch 0x7D86/0x7D87 (NOT in the
 *           compared state dump -- those live at 0x7D8x); VRAM cells filled by
 *           the 0x3D08 table + sub_3f24; work RAM 0x6908-0x692F via sub_004e and
 *           the two `rst 0x38`s; the task ring via sub_309f x2.
 *   Registers at exit (the unit gate compares the whole file): the FINISH path
 *   leaves A=0, HL=0x638B, F from `inc (0x600A)`; the FULL path leaves whatever
 *   the final `rst 0x38` (sub_003d) leaves -- A/B/HL/F from its add-hl-de/djnz
 *   tail, C=0x78, DE=0x0004 -- unchanged by the closing `ret`. Both are matched
 *   by calling the SAME oracle callees, so nothing here needs to model them.
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles collapsed. loc_07cb is ATOMIC:
 * it runs inside the vblank NMI (dispatched via handler_073c, the state-1 arm of
 * the 0x00CA NMI table), where the NMI mask 0x7D84 is CLEAR -- so tick() never
 * re-enters fireNmi, and the whole NMI finishes well within one frame, so no
 * frame boundary is crossed inside it either. The vblank NMI therefore cannot
 * land in this routine OR its callees, so their internal cycle DISTRIBUTION is
 * unobservable. Harness-VERIFIED (equivalence-07cb.test.js): collapsing the
 * per-instruction m.step charges to one-per-straight-line-segment (and one per
 * loop ITERATION for the data-dependent fill loop, whose record/byte counts come
 * from the ROM table) stays EQUAL whole-machine AND unit across the arm,
 * countdown, finish, both rlc-carry arms, and the fill loop. Each segment/branch
 * TOTAL is preserved exactly (every inline sum equals the oracle's per-
 * instruction charges along that path -- and the test's per-branch cycle check
 * confirms optimized total == oracle total for each). The TOTAL is STILL load-
 * bearing (README §2): the NMI's total cost sets the post-NMI main-loop spin
 * count SPIN_COUNT (0x6019 -> PRNG), so stripping the charges ENTIRELY diverges
 * there -- measured at 0x6019 on frame 2853, this routine's own first dispatch,
 * baseline 28 vs stripped 72 (same MECHANISM as handler_01c3's 0x6019
 * divergence, loc_07cb's own numbers). So the charge stays, just not once per
 * instruction; only its distribution is free, which is why the collapsed
 * segments' intermediate PCs need not be materialised.
 */
export function loc_07cb(m) {
  const { regs, mem } = m;

  // -- prologue: read the frame timer and test it. --------------------------
  regs.a = mem.read8(0x638a);
  regs.cp(0x00);
  m.step(0x07d0, 20); // ld a,(0x638a) + cp 0x00 = 13+7

  if (regs.fNZ) {
    // countdown frame: restore pattern C from 0x638B, decrement the timer.
    // (the intermediate `ld a,(0x638b)` is dead -- A is reloaded from 0x638A
    // before it is read again -- so only C is materialised.)
    regs.c = mem.read8(0x638b);
    regs.a = regs.dec8(mem.read8(0x638a));
    mem.write8(0x638a, regs.a);
    // jp nz + ld a,(0x638b) + ld c,a + ld a,(0x638a) + dec a + ld (0x638a),a
    // + jp 0x07da = 10+13+4+13+4+13+10
    m.step(0x07da, 67);
  } else {
    // first frame: arm the timer to 96 and seed the pattern.
    regs.a = 0x60;
    mem.write8(0x638a, 0x60);
    regs.c = 0x5f;
    // jp nz(not taken) + ld a,0x60 + ld (0x638a),a + ld c,0x5f = 10+7+13+7
    m.step(0x07da, 37);
  }

  // -- loc_07da (JOIN): A = timer, C = pattern. Countdown finished? ----------
  regs.cp(0x00);
  m.step(0x07dc, 7); // cp 0x00

  if (regs.fZ) {
    // FINISH: mark the sub-state done and advance the attract state machine.
    regs.hl = SUBSTATE_TIMER; // 0x6009
    mem.write8(regs.hl, 0x02);
    regs.hl = (regs.hl + 1) & 0xffff; // -> GAME_SUBSTATE 0x600A
    regs.incMem8(mem, regs.hl); // 0x600A++ (sets exit flags)
    regs.hl = 0x638a;
    mem.write8(regs.hl, 0x00);
    regs.hl = (regs.hl + 1) & 0xffff; // -> 0x638B
    mem.write8(regs.hl, 0x00);
    // jp z + ld hl,0x6009 + ld (hl),0x02 + inc hl + inc (hl) + ld hl,0x638a
    // + ld (hl),0x00 + inc hl + ld (hl),0x00 = 10+10+10+6+11+10+10+6+10
    m.step(0x084a, 83);
    m.ret(); // 0x084a
    return;
  }

  // -- decode 2 pattern bits into 0x7D86 / 0x7D87 ---------------------------
  regs.hl = 0x7d86;
  mem.write8(regs.hl, 0x00);
  regs.a = regs.c;
  regs.a = regs.rlc(regs.a); // first bit -> carry
  // jp z(not taken) + ld hl,0x7d86 + ld (hl),0x00 + ld a,c + rlc a = 10+10+10+4+8
  m.step(0x07e7, 42);

  if (regs.fC) {
    mem.write8(regs.hl, 0x01);
    m.step(0x07eb, 17); // jr nc(not taken) + ld (hl),0x01 = 7+10
  } else {
    m.step(0x07eb, 12); // jr nc taken
  }

  regs.hl = (regs.hl + 1) & 0xffff; // -> 0x7D87
  mem.write8(regs.hl, 0x00);
  regs.a = regs.rlc(regs.a); // second bit -> carry
  m.step(0x07f0, 24); // inc hl + ld (hl),0x00 + rlc a = 6+10+8

  if (regs.fC) {
    mem.write8(regs.hl, 0x01);
    m.step(0x07f4, 17); // jr nc(not taken) + ld (hl),0x01 = 7+10
  } else {
    m.step(0x07f4, 12); // jr nc taken
  }

  // save the rotated pattern, then point HL at the ROM fill table.
  mem.write8(0x638b, regs.a);
  regs.hl = 0x3d08;
  m.step(0x07fa, 23); // ld (0x638b),a + ld hl,0x3d08 = 13+10

  // -- table fill: outer over [count,destLo,destHi] records, inner block-fill.
  do {
    regs.a = 0xb0;
    regs.b = mem.read8(regs.hl); // count
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.e = mem.read8(regs.hl); // dest lo
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.d = mem.read8(regs.hl); // dest hi
    // ld a,0xb0 + ld b,(hl) + inc hl + ld e,(hl) + inc hl + ld d,(hl)
    m.step(0x0801, 40); // 7+7+6+7+6+7

    do {
      mem.write8(regs.de, regs.a);
      regs.de = (regs.de + 1) & 0xffff;
      regs.b = (regs.b - 1) & 0xff; // djnz (does NOT affect flags)
      // ld (de),a + inc de + djnz = 7+6+(13 taken | 8 final)
      m.step(regs.b !== 0 ? 0x0801 : 0x0805, regs.b !== 0 ? 26 : 21);
    } while (regs.b !== 0);

    regs.hl = (regs.hl + 1) & 0xffff;
    regs.a = mem.read8(regs.hl); // next record's count
    regs.cp(0x00);
    // inc hl + ld a,(hl) + cp 0x00 + jp nz = 6+7+7+10
    m.step(regs.fNZ ? 0x07fa : 0x080c, 30);
  } while (regs.fNZ);

  // -- queue tasks, repaint, two sound triggers -----------------------------
  regs.de = 0x031e;
  m.step(0x080f, 10); // ld de,0x031e
  m.push16(0x0812);
  m.step(0x309f, 17); // call 0x309f -- queue task 0x031E
  m.call(0x309f);

  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0813, 6); // inc de
  m.push16(0x0816);
  m.step(0x309f, 17); // call 0x309f -- queue task 0x031F
  m.call(0x309f);

  regs.hl = 0x39cf;
  m.step(0x0819, 10); // ld hl,0x39cf
  m.push16(0x081c);
  m.step(0x004e, 17); // call 0x004e -- repaint (ldir 0x39cf -> 0x6908, 0x28 bytes)
  m.call(0x004e);

  m.push16(0x081f);
  m.step(0x3f24, 17); // call 0x3f24 -- two fixed VRAM cells
  m.call(0x3f24);

  regs.hl = 0x6908;
  regs.c = 0x44;
  m.step(0x0825, 21); // nop + ld hl,0x6908 + ld c,0x44 = 4+10+7
  m.push16(0x0826);
  m.step(0x0038, 11); // rst 0x38 -- add 0x44 into 10 bytes @0x6908
  m.call(0x0038);

  regs.hl = 0x690b;
  regs.c = 0x78;
  m.step(0x082b, 17); // ld hl,0x690b + ld c,0x78 = 10+7
  m.push16(0x082c);
  m.step(0x0038, 11); // rst 0x38 -- add 0x78 into 10 bytes @0x690B
  m.call(0x0038);

  m.ret(); // 0x082c
}
