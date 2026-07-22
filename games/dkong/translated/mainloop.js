// SPDX-License-Identifier: GPL-3.0-only
/**
 * Translated main loop and the routines the first iterations reach.
 *
 * Continues in EXECUTION ORDER from where boot.js leaves off. Boot falls
 * through from 0x02BC straight into 0x02BD.
 *
 * THE MAIN LOOP IS A TASK SCHEDULER, and it SYNCHRONISES TO THE NMI. It spins
 * comparing the frame counter at 0x601A against its last-seen copy at 0x6383
 * (`jr z,0x02bd`), doing nothing until the vblank NMI changes it. So the loop
 * is not free-running: without the NMI translated it spins forever, and
 * 0x6019 -- which it increments every pass -- runs away. That is the natural
 * cooperative boundary between the two, and it is why the NMI handler is the
 * next required piece rather than an optional one.
 *
 * Every routine carries its ROM range and original mnemonics.
 */

import { NotImplemented } from "../../../boards/dkong/io.js";


/**
 * mainLoop -- ROM 0x02BD-0x02E2
 *
 *   02bd  26 60        ld   h,0x60           ; loc_02bd
 *   02bf  3a b1 60     ld   a,(0x60b1)
 *   02c2  6f           ld   l,a
 *   02c3  7e           ld   a,(hl)
 *   02c4  87           add  a,a
 *   02c5  30 1c        jr   nc,0x02e3
 *   02c7  cd 15 03     call 0x0315
 *   02ca  cd 50 03     call 0x0350
 *   02cd  21 19 60     ld   hl,0x6019
 *   02d0  34           inc  (hl)
 *   02d1  21 83 63     ld   hl,0x6383
 *   02d4  3a 1a 60     ld   a,(0x601a)
 *   02d7  be           cp   (hl)
 *   02d8  28 e3        jr   z,0x02bd
 *   02da  77           ld   (hl),a
 *   02db  cd 7f 03     call 0x037f
 *   02de  cd a2 03     call 0x03a2
 *   02e1  18 da        jr   0x02bd
 *
 * H is fixed at 0x60 and L comes from the task-list pointer at 0x60B1, so
 * the loop walks a task table in page 0x60. `add a,a` tests bit 7 of the task
 * byte: set means "run the per-frame work", clear means "dispatch this task"
 * via the path at 0x02E3.
 *
 * Boot leaves 0x60B1 = 0xC0 and fills 0x60C0-0x60FF with 0xFF, so the first
 * iteration reads 0xFF, `add a,a` sets carry, and the `jr nc` is not taken.
 */
export function mainLoop(m) {
  const { regs, mem } = m;

  for (;;) {
    regs.h = 0x60;
    m.step(0x02bf, 7);
    regs.a = mem.read8(0x60b1);
    m.step(0x02c2, 13);
    regs.l = regs.a;
    m.step(0x02c3, 4);
    regs.a = mem.read8(regs.hl);
    m.step(0x02c4, 7);
    regs.add(regs.a); // add a,a -- bit 7 into carry
    m.step(0x02c5, 4);

    if (regs.fNC) {
      m.step(0x02e3, 12); // jr nc taken
      dispatchTask(m);
      continue; // 0x02E3 pushes 0x02BD, so its ret lands back here
    }
    m.step(0x02c7, 7); // jr nc not taken

    m.push16(0x02ca);
    m.step(0x0315, 17); // call 0x0315
    sub_0315(m);

    m.push16(0x02cd);
    m.step(0x0350, 17); // call 0x0350
    sub_0350(m);

    regs.hl = 0x6019;
    m.step(0x02d0, 10);
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (hl)
    m.step(0x02d1, 11);

    regs.hl = 0x6383;
    m.step(0x02d4, 10);
    regs.a = mem.read8(0x601a);
    m.step(0x02d7, 13);
    regs.cp(mem.read8(regs.hl)); // cp (hl)
    m.step(0x02d8, 7);

    if (regs.fZ) {
      // Frame counter unchanged -- spin here until the NMI decrements it.
      // THIS is where the machine actually sits when vblank arrives.
      m.step(0x02bd, 12);
      continue;
    }
    m.step(0x02da, 7);

    mem.write8(regs.hl, regs.a); // remember the frame we just handled
    m.step(0x02db, 7);

    m.push16(0x02de);
    m.step(0x037f, 17);
    sub_037f(m);

    m.push16(0x02e1);
    m.step(0x03a2, 17);
    sub_03a2(m);

    m.step(0x02bd, 12); // jr 0x02bd
  }
}

/**
 * sub_0008 -- ROM 0x0008-0x000F  (the `rst 0x08` conditional-skip helper)
 *
 *   0008  3a 07 60     ld   a,(0x6007)
 *   000b  0f           rrca
 *   000c  d0           ret  nc
 *   000d  33           inc  sp
 *   000e  33           inc  sp
 *   000f  c9           ret
 *
 * A THIRD STACK IDIOM. If bit 0 of 0x6007 is set, the two `inc sp` discard
 * this routine's own return address so the final `ret` returns to the
 * CALLER'S CALLER -- skipping the rest of whoever invoked `rst 0x08`.
 * Returns true when it returned normally, false when it skipped, so the
 * caller can model the skip as an early return.
 */
export function sub_0008(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6007);
  m.step(0x000b, 13);
  regs.rrca(); // bit 0 -> carry
  m.step(0x000c, 4);
  if (regs.fNC) {
    m.ret(11); // ret nc taken -- normal return
    return true;
  }
  m.step(0x000d, 5); // ret nc not taken
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x000e, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x000f, 6); // inc sp
  m.ret(); // returns to the caller's CALLER
  return false; // caller must return immediately
}

/**
 * sub_0347 -- ROM 0x0347-0x034F
 *
 *   0347  21 40 77     ld   hl,0x7740
 *   034a  a7           and  a
 *   034b  c8           ret  z
 *   034c  21 e0 74     ld   hl,0x74e0
 *   034f  c9           ret
 *
 * Selects one of two video RAM columns based on A. Returns HL.
 */
export function sub_0347(m) {
  const { regs } = m;
  regs.hl = 0x7740;
  m.step(0x034a, 10);
  regs.and(regs.a); // and a -- sets Z from A, clears carry
  m.step(0x034b, 4);
  if (regs.fZ) {
    m.ret(11); // ret z taken
    return;
  }
  m.step(0x034c, 5);
  regs.hl = 0x74e0;
  m.step(0x034f, 10);
  m.ret();
}

/**
 * sub_0315 -- ROM 0x0315-0x0346
 *
 *   0315  3a 1a 60     ld   a,(0x601a)
 *   0318  47           ld   b,a
 *   0319  e6 0f        and  0x0f
 *   031b  c0           ret  nz
 *   031c  cf           rst  0x08
 *   031d  3a 0d 60     ld   a,(0x600d)
 *   0320  cd 47 03     call 0x0347
 *   0323  11 e0 ff     ld   de,0xffe0
 *   0326  cb 60        bit  4,b
 *   0328  28 14        jr   z,0x033e
 *   032a  3e 10        ld   a,0x10
 *   032c  77           ld   (hl),a
 *   032d  19           add  hl,de
 *   032e  77           ld   (hl),a
 *   032f  19           add  hl,de
 *   0330  77           ld   (hl),a
 *   0331  3a 0f 60     ld   a,(0x600f)
 *   0334  a7           and  a
 *   0335  c8           ret  z
 *   0336  3a 0d 60     ld   a,(0x600d)
 *   0339  ee 01        xor  0x01
 *   033b  cd 47 03     call 0x0347
 *   033e  3c           inc  a                ; loc_033e
 *   033f  77           ld   (hl),a
 *   0340  19           add  hl,de
 *   0341  36 25        ld   (hl),0x25
 *   0343  19           add  hl,de
 *   0344  36 20        ld   (hl),0x20
 *   0346  c9           ret
 *
 * Runs only every 16th frame (`and 0x0f / ret nz`) and writes three video RAM
 * cells, stepping DE = 0xFFE0 (-32) between them -- one screen row back per
 * step in the 32-column tilemap.
 */
export function sub_0315(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x601a);
  m.step(0x0318, 13);
  regs.b = regs.a;
  m.step(0x0319, 4);
  regs.and(0x0f);
  m.step(0x031b, 7);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- not a multiple-of-16 frame
    return;
  }
  m.step(0x031c, 5);

  // rst 0x08 -- may skip the remainder of THIS routine by returning past it.
  m.push16(0x031d);
  m.step(0x0008, 11);
  if (!sub_0008(m)) return;

  regs.a = mem.read8(0x600d);
  m.step(0x0320, 13);
  m.push16(0x0323);
  m.step(0x0347, 17);
  sub_0347(m); // HL = column base

  regs.de = 0xffe0; // -32: one tilemap row
  m.step(0x0326, 10);

  const bit4 = regs.bit(4, regs.b);
  m.step(0x0328, 8); // bit 4,b
  if (!bit4) {
    m.step(0x033e, 12); // jr z taken -> loc_033e
  } else {
    m.step(0x032a, 7);
    regs.a = 0x10;
    m.step(0x032c, 7);
    const STORES = [0x032d, 0x032f, 0x0331];
    const ADDS = [0x032e, 0x0330];
    for (let i = 0; i < 3; i++) {
      mem.write8(regs.hl, regs.a);
      m.step(STORES[i], 7);
      if (i < 2) {
        regs.addHl(regs.de);
        m.step(ADDS[i], 11);
      }
    }
    regs.a = mem.read8(0x600f);
    m.step(0x0334, 13);
    regs.and(regs.a);
    m.step(0x0335, 4);
    if (regs.fZ) {
      m.ret(11);
      return;
    }
    m.step(0x0336, 5);
    regs.a = mem.read8(0x600d);
    m.step(0x0339, 13);
    regs.xor(0x01);
    m.step(0x033b, 7);
    m.push16(0x033e);
    m.step(0x0347, 17);
    sub_0347(m);
  }

  // loc_033e
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

/**
 * sub_0350 -- ROM 0x0350-0x037E
 *
 *   0350  3a 2d 62     ld   a,(0x622d)
 *   0353  a7           and  a
 *   0354  c0           ret  nz
 *   0355  21 b3 60     ld   hl,0x60b3
 *   0358  3a 0d 60     ld   a,(0x600d)
 *   035b  a7           and  a
 *   035c  28 03        jr   z,0x0361
 *   035e  21 b6 60     ld   hl,0x60b6
 *   0361  7e           ld   a,(hl)           ; loc_0361
 *   0362  e6 f0        and  0xf0
 *   0364  47           ld   b,a
 *   0365  23           inc  hl
 *   0366  7e           ld   a,(hl)
 *   0367  e6 0f        and  0x0f
 *   0369  b0           or   b
 *   036a  0f           rrca
 *   036b  0f           rrca
 *   036c  0f           rrca
 *   036d  0f           rrca
 *   036e  21 21 60     ld   hl,0x6021
 *   0371  be           cp   (hl)
 *   0372  d8           ret  c
 *   0373  3e 01        ld   a,0x01
 *   0375  32 2d 62     ld   (0x622d),a
 *   0378  21 28 62     ld   hl,0x6228
 *   037b  34           inc  (hl)
 *   037c  c3 b8 06     jp   0x06b8
 *
 * Packs a BCD-ish score value out of two nibbles, rotates it down four bits,
 * and compares against the bonus threshold at 0x6021. On reaching it, sets
 * the "awarded" flag at 0x622D, bumps the life count at 0x6228, and TAIL
 * JUMPS to 0x06B8 -- it does not return there, so 0x06B8's `ret` returns to
 * sub_0350's caller.
 */
export function sub_0350(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x622d);
  m.step(0x0353, 13);
  regs.and(regs.a);
  m.step(0x0354, 4);
  if (regs.fNZ) {
    m.ret(11);
    return;
  }
  m.step(0x0355, 5);

  regs.hl = 0x60b3;
  m.step(0x0358, 10);
  regs.a = mem.read8(0x600d);
  m.step(0x035b, 13);
  regs.and(regs.a);
  m.step(0x035c, 4);
  if (regs.fZ) {
    m.step(0x0361, 12); // jr z taken
  } else {
    m.step(0x035e, 7);
    regs.hl = 0x60b6;
    m.step(0x0361, 10);
  }

  // loc_0361
  regs.a = mem.read8(regs.hl);
  m.step(0x0362, 7);
  regs.and(0xf0);
  m.step(0x0364, 7);
  regs.b = regs.a;
  m.step(0x0365, 4);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0366, 6);
  regs.a = mem.read8(regs.hl);
  m.step(0x0367, 7);
  regs.and(0x0f);
  m.step(0x0369, 7);
  regs.or(regs.b);
  m.step(0x036a, 4);
  const RRCA = [0x036b, 0x036c, 0x036d, 0x036e];
  for (let i = 0; i < 4; i++) {
    regs.rrca();
    m.step(RRCA[i], 4);
  }
  regs.hl = 0x6021;
  m.step(0x0371, 10);
  regs.cp(mem.read8(regs.hl));
  m.step(0x0372, 7);
  if (regs.fC) {
    m.ret(11); // ret c -- below the threshold
    return;
  }
  m.step(0x0373, 5);

  regs.a = 0x01;
  m.step(0x0375, 7);
  mem.write8(0x622d, regs.a);
  m.step(0x0378, 13);
  regs.hl = 0x6228;
  m.step(0x037b, 10);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x037c, 11);
  // jp 0x06b8 -- TAIL jump: no push, so 0x06B8's ret returns to OUR caller.
  // `return` propagates entry_06b8's answer instead of dropping it (hygiene --
  // it is constant TRUE now, so this is inert today; it stops a future reader
  // seeing a bare call at a tail and inferring the boolean does not matter).
  m.step(0x06b8, 10);
  return entry_06b8(m);
}

/**
 * entry_06b8 -- ROM 0x06B8-...  (task 6 from the 0x0307 dispatch table)
 *
 *   06b8  4f           ld   c,a
 *   06b9  cf           rst  0x08
 *   06ba  06 06        ld   b,0x06
 *   06bc  11 e0 ff     ld   de,0xffe0
 *   06bf  21 83 77     ld   hl,0x7783
 *   06c2  36 10        ld   (hl),0x10        ; loc_06c2
 *   06c4  19           add  hl,de
 *   06c5  10 fb        djnz 0x06c2
 *   06c7  3a 28 62     ld   a,(0x6228)
 *   06ca  91           sub  c
 *   06cb  ca d7 06     jp   z,0x06d7
 *   06ce  47           ld   b,a
 *   06cf  21 83 77     ld   hl,0x7783
 *   06d2  36 ff        ld   (hl),0xff        ; loc_06d2
 *   06d4  19           add  hl,de
 *   06d5  10 fb        djnz 0x06d2
 *   06d7  21 03 75     ld   hl,0x7503        ; loc_06d7
 *   06da  36 1c        ld   (hl),0x1c
 *   06dc  21 e3 74     ld   hl,0x74e3
 *   06df  36 34        ld   (hl),0x34
 *   06e1  3a 29 62     ld   a,(0x6229)
 *   06e4  fe 64        cp   0x64
 *   06e6  38 05        jr   c,0x06ed
 *   06e8  3e 63        ld   a,0x63
 *   06ea  32 29 62     ld   (0x6229),a
 *   06ed  01 0a ff     ld   bc,0xff0a        ; loc_06ed
 *   06f0  04           inc  b                ; loc_06f0
 *   06f1  91           sub  c
 *   06f2  d2 f0 06     jp   nc,0x06f0
 *   06f5  81           add  a,c
 *   06f6  32 a3 74     ld   (0x74a3),a
 *   06f9  78           ld   a,b
 *   06fa  32 c3 74     ld   (0x74c3),a
 *   06fd  c9           ret
 *
 * Redraws the lives indicator: blanks six cells (tile 0x10) stepping one
 * tilemap row back each time, then fills 0xFF markers for the current life
 * count, then two fixed tiles.
 *
 * The tail (0x06E1-0x06FD) clamps the level number at 0x6229 to 0x63 and
 * splits it into two decimal digits by REPEATED SUBTRACTION, not DAA: B
 * starts at 0xFF and `inc b` runs before the first `sub c`, so B counts how
 * many times 10 was subtracted while the result stayed non-negative. The
 * final `add a,c` undoes the subtraction that borrowed. Tens go to 0x74C3,
 * units to 0x74A3 -- adjacent tilemap columns 32 apart.
 */
export function entry_06b8(m) {
  const { regs, mem } = m;

  regs.c = regs.a;
  m.step(0x06b9, 4);

  m.push16(0x06ba);
  m.step(0x0008, 11); // rst 0x08
  // NOT a skip signal -- the previous `return false` here was a SCOPE ERROR.
  // sub_0008's FALSE truthfully asserts "I consumed MY caller's continuation",
  // and MY caller is entry_06b8 -- so re-emitting that value verbatim made
  // entry_06b8 assert it about ITS caller, where it is false. A predicate that
  // is true about me is not automatically true about my caller.
  //
  // Trace: handler_01c3's `call 0x06b8` pushes 0x01DF; this rst pushes 0x06BA;
  // sub_0008's skip arm discards 0x06BA and rets to 0x01DF -- handler_01c3's OWN
  // continuation, exactly where our own `ret` would have gone. The same holds
  // for sub_0350's tail jump (nothing pushed, so the skip lands at sub_0350's
  // return address). In BOTH entry modes the skip merely cuts THIS body short;
  // the caller always continues. So the answer to "should my caller continue?"
  // is always YES.
  //
  // Returns TRUE rather than going void deliberately: with TRUE a future
  // erroneous `if (!entry_06b8(m)) return;` is INERT, whereas undefined is
  // falsy and would make that same mistake a LIVE defect. DO NOT add a guard
  // at the callers.
  if (!sub_0008(m)) return true;

  regs.b = 0x06;
  m.step(0x06bc, 7);
  regs.de = 0xffe0;
  m.step(0x06bf, 10);
  regs.hl = 0x7783;
  m.step(0x06c2, 10);
  do {
    mem.write8(regs.hl, 0x10);
    m.step(0x06c4, 10);
    regs.addHl(regs.de);
    m.step(0x06c5, 11);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x06c2 : 0x06c7, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  regs.a = mem.read8(0x6228);
  m.step(0x06ca, 13);
  regs.sub(regs.c);
  m.step(0x06cb, 4);
  if (!regs.fZ) {
    m.step(0x06ce, 10); // jp z not taken
    regs.b = regs.a;
    m.step(0x06cf, 4);
    regs.hl = 0x7783;
    m.step(0x06d2, 10);
    do {
      mem.write8(regs.hl, 0xff);
      m.step(0x06d4, 10);
      regs.addHl(regs.de);
      m.step(0x06d5, 11);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x06d2 : 0x06d7, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
  } else {
    m.step(0x06d7, 10);
  }

  // loc_06d7
  regs.hl = 0x7503;
  m.step(0x06da, 10);
  mem.write8(regs.hl, 0x1c);
  m.step(0x06dc, 10);
  regs.hl = 0x74e3;
  m.step(0x06df, 10);
  mem.write8(regs.hl, 0x34);
  m.step(0x06e1, 10);

  // 06E1-06EA: clamp the level number to 0x63 (99 decimal).
  regs.a = mem.read8(0x6229);
  m.step(0x06e4, 13);
  regs.cp(0x64);
  m.step(0x06e6, 7);
  if (regs.fC) {
    m.step(0x06ed, 12); // jr c taken -> loc_06ed
  } else {
    m.step(0x06e8, 7);
    regs.a = 0x63;
    m.step(0x06ea, 7);
    mem.write8(0x6229, regs.a);
    m.step(0x06ed, 13);
  }

  // 06ED-06F5: split into tens (B) and units (A) by repeated subtraction.
  regs.bc = 0xff0a; // B = 0xFF, C = 10
  m.step(0x06f0, 10);
  do {
    regs.b = regs.inc8(regs.b); // loc_06f0 -- runs BEFORE the first subtract
    m.step(0x06f1, 4);
    regs.sub(regs.c);
    m.step(0x06f2, 4);
    const again = regs.fNC;
    m.step(again ? 0x06f0 : 0x06f5, 10); // jp nc
    if (!again) break;
  } while (true);
  regs.add(regs.c); // undo the borrowing subtraction
  m.step(0x06f6, 4);

  mem.write8(0x74a3, regs.a); // units digit
  m.step(0x06f9, 13);
  regs.a = regs.b;
  m.step(0x06fa, 4);
  mem.write8(0x74c3, regs.a); // tens digit
  m.step(0x06fd, 13);

  m.ret(); // 06fd: ret
  return true;
}

// -- not yet translated ---------------------------------------------------
// Each throws so an unexercised path names itself rather than silently
// producing a nearly-right frame.

/**
 * dispatchTask -- ROM 0x02E3-0x0306  (the main loop's task dispatch)
 *
 *   02e3  e6 1f        and  0x1f
 *   02e5  5f           ld   e,a
 *   02e6  16 00        ld   d,0x00
 *   02e8  36 ff        ld   (hl),0xff
 *   02ea  2c           inc  l
 *   02eb  4e           ld   c,(hl)
 *   02ec  36 ff        ld   (hl),0xff
 *   02ee  2c           inc  l
 *   02ef  7d           ld   a,l
 *   02f0  fe c0        cp   0xc0
 *   02f2  30 02        jr   nc,0x02f6
 *   02f4  3e c0        ld   a,0xc0
 *   02f6  32 b1 60     ld   (0x60b1),a
 *   02f9  79           ld   a,c
 *   02fa  21 bd 02     ld   hl,0x02bd
 *   02fd  e5           push hl
 *   02fe  21 07 03     ld   hl,0x0307
 *   0301  19           add  hl,de
 *   0302  5e           ld   e,(hl)
 *   0303  23           inc  hl
 *   0304  56           ld   d,(hl)
 *   0305  eb           ex   de,hl
 *   0306  e9           jp   (hl)
 *
 * Consumes one task from the ring: the low 5 bits of the first byte index a
 * table of handlers at 0x0307, the second byte is passed to the handler in A,
 * and BOTH slots are marked 0xFF -- free -- as they are read. The read
 * pointer at 0x60B1 wraps back to 0xC0 rather than 0x00, matching sub_309f's
 * write pointer.
 *
 * 0x02BD is pushed as the return address, so the handler's `ret` lands back
 * at the top of the main loop rather than after the dispatch. That is also
 * what bounds the 0x0307 table exactly: it ends where 0x0315 begins.
 *
 * This is the second dispatcher in the ROM and it is computed INLINE rather
 * than via the rst 0x28 trampoline, which is why static tracing logs the
 * `jp (hl)` at 0x0306 as unresolved instead of following it.
 */
export function dispatchTask(m) {
  const { regs, mem } = m;

  regs.and(0x1f);
  m.step(0x02e5, 7);
  regs.e = regs.a;
  m.step(0x02e6, 4);
  regs.d = 0x00;
  m.step(0x02e8, 7);
  mem.write8(regs.hl, 0xff); // free the slot as it is consumed
  m.step(0x02ea, 10);
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x02eb, 4);
  regs.c = mem.read8(regs.hl);
  m.step(0x02ec, 7);
  mem.write8(regs.hl, 0xff);
  m.step(0x02ee, 10);
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x02ef, 4);
  regs.a = regs.l;
  m.step(0x02f0, 4);
  regs.cp(0xc0);
  m.step(0x02f2, 7);
  if (regs.fNC) {
    m.step(0x02f6, 12); // jr nc taken
  } else {
    m.step(0x02f4, 7);
    regs.a = 0xc0; // wrap the read pointer to the ring base
    m.step(0x02f6, 7);
  }
  mem.write8(0x60b1, regs.a);
  m.step(0x02f9, 13);
  regs.a = regs.c; // the task's payload byte, passed to the handler
  m.step(0x02fa, 4);
  regs.hl = 0x02bd;
  m.step(0x02fd, 10);
  m.push16(regs.hl); // the handler returns to the top of the main loop
  m.step(0x02fe, 11);
  regs.hl = 0x0307;
  m.step(0x0301, 10);
  regs.addHl(regs.de);
  m.step(0x0302, 11);
  const index = regs.e; // capture BEFORE the table read clobbers it
  regs.e = mem.read8(regs.hl);
  m.step(0x0303, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0304, 6);
  regs.d = mem.read8(regs.hl);
  m.step(0x0305, 7);
  regs.exDeHl();
  m.step(0x0306, 4);
  m.step(regs.hl, 4); // jp (hl)

  if (regs.hl === 0x05e9) return handler_05e9(m);
  if (regs.hl === 0x05c6) return handler_05c6(m);
  if (regs.hl === 0x0611) return entry_0611(m);
  if (regs.hl === 0x051c) return entry_051c(m);
  if (regs.hl === 0x062a) return entry_062a(m);
  if (regs.hl === 0x06b8) return entry_06b8(m);
  if (regs.hl === 0x059b) return loc_059b(m); // 0x0307 task table idx 2 (gameplay)
  throw new NotImplemented(
    `task handler at ROM 0x${regs.hl.toString(16).padStart(4, "0")} ` +
      `(0x0307 table index ${index}, payload 0x${regs.a.toString(16)})`,
  );
}

/**
 * entry_062a -- ROM 0x062A-0x06B7  (142 bytes, 74 instructions, task entry 10)
 *
 * The five loc_ blocks are written out from the listing, and every m.step
 * target was checked against the listing's own instruction boundaries.
 *
 * A IS A LIVE-IN -- `and a` at 0x062A tests it before anything sets it. It is
 * the task-dispatch payload. C IS ALSO LIVE-IN, but only on the 0x0691 arm:
 * `push bc` at 0x0697 reads C and nothing on the path 0x062A -> 0x0691 -> 0x0697
 * sets it. B *is* set one instruction earlier at 0x0694, which is exactly what
 * makes C easy to miss.
 *
 * THREE EXITS, THREE DIFFERENT SEMANTICS:
 *   0x0639  `ret nz`     CONDITIONAL -- falls through when Z
 *   0x0690  `ret`        unconditional
 *   0x06A5  `jp 0x051c`  TAIL JUMP -- nothing pushed, never reaches a `ret`
 *
 * BC IS PRESERVED ACROSS THE CALL FOR THIS ROUTINE, NOT FOR THE CALLER.
 * `push bc` / `pop bc` bracket the 0x0698 call because entry_051c's first
 * instruction is `ld c,a`, which clobbers it. entry_062a preserves NOTHING for
 * its own caller -- A, BC, DE, HL, IX and flags are all clobbered on some path.
 * That is a fourth sense of "preserved": SAVED FOR SELF, distinct from SAVED
 * FOR CALLER (sub_122a's HL), INVISIBLE (sub_122a's IX) and NEVER-WRITTEN.
 *
 * THE 0x0690 `ret` HANDS BACK TWO DIFFERENT FLAG STATES depending on which arm
 * reached it -- `add a,b` at 0x0685 on the fallthrough, `and 0x0f` at 0x0673
 * via `jp nz,0x0689`. Nothing between either and the exit writes flags.
 *
 * loc_066a and loc_0691 ARE A TWIN PAIR WITH INVERTED REGISTER ROLES, thirty-
 * nine bytes apart -- both split (0x638C) into nibbles; loc_066a keeps the
 * original in C and the low nibble in B, loc_0691 keeps the original in B and
 * leaves the low nibble in A. The 11ec/122a shape inside one routine, and the
 * reason neither block may be factored into a shared helper.
 *
 * All five loc_ labels are PHANTOM -- 0 call sites, jump targets only. They are
 * written as functions for readability; loc_066a is a genuine JOIN, reached by
 * fallthrough from 0x0667 and by `jp 0x066a` from 0x06B5.
 */
export function entry_062a(m) {
  const { regs, mem } = m;

  regs.and(regs.a); // reads the LIVE-IN A
  m.step(0x062b, 4); // and a
  if (regs.fZ) {
    m.step(0x0691, 10); // jp z,0x0691 taken
    return loc_0691(m);
  }
  m.step(0x062e, 10); // jp z not taken

  regs.a = mem.read8(0x638c);
  m.step(0x0631, 13); // ld a,(0x638c)
  regs.and(regs.a);
  m.step(0x0632, 4); // and a
  if (regs.fNZ) {
    m.step(0x06a8, 10); // jp nz,0x06a8 taken
    return loc_06a8(m);
  }
  m.step(0x0635, 10); // jp nz not taken

  regs.a = mem.read8(0x63b8);
  m.step(0x0638, 13); // ld a,(0x63b8)
  regs.and(regs.a);
  m.step(0x0639, 4); // and a
  if (regs.fNZ) {
    m.ret(11); // ret nz taken -- a CONDITIONAL exit
    return;
  }
  m.step(0x063a, 5); // ret nz not taken

  // DIVIDE (0x62B0) BY TEN BY REPEATED SUBTRACTION, counting in B.
  //
  // THIS LOOP DOES NOT TERMINATE FOR EVERY INPUT, and there is no iteration
  // guard in the ROM. It exits only when A reaches EXACTLY zero, and A moves in
  // steps of 10 modulo 256; gcd(10, 256) = 2, so an ODD value at 0x62B0 never
  // hits zero and the CPU spins forever. A = 0 does not exit immediately
  // either -- it needs 128 passes back around to zero.
  //
  // NO GUARD IS ADDED. The ROM has none, and adding one would convert a hang
  // into a silently wrong answer -- the hang is the faithful behaviour and it
  // is loud. Recorded as a predicted failure mode with a named trigger:
  // sub_0f56 computes 0x62B0 as min(((0x6229)*10 + 0x28) mod 256, 0x50), and
  // that clamp DOES NOT DETECT WRAP, so a wrapped value can be odd. Two drafts
  // reached this from opposite ends -- the clamp's structure and gcd(10,256) --
  // which is corroboration rather than one observation counted twice. Neither
  // claims it fires on any tape we hold.
  regs.a = mem.read8(0x62b0);
  m.step(0x063d, 13); // ld a,(0x62b0)
  regs.bc = 0x000a; // B = 0 (the quotient), C = 10 (the divisor)
  m.step(0x0640, 10); // ld bc,0x000a
  do {
    regs.b = regs.inc8(regs.b);
    m.step(0x0641, 4); // inc b
    regs.sub(regs.c);
    m.step(0x0642, 4); // sub c
    m.step(regs.fNZ ? 0x0640 : 0x0645, 10); // jp nz,0x0640
  } while (regs.fNZ);

  regs.a = regs.b; // the quotient
  m.step(0x0646, 4); // ld a,b
  for (const next of [0x0647, 0x0648, 0x0649, 0x064a]) {
    regs.rlca(); // four rotates = move the low nibble to the high nibble
    m.step(next, 4); // rlca
  }
  mem.write8(0x638c, regs.a);
  m.step(0x064d, 13); // ld (0x638c),a

  regs.hl = 0x384a;
  m.step(0x0650, 10); // ld hl,0x384a
  regs.de = 0x7465;
  m.step(0x0653, 10); // ld de,0x7465
  regs.a = 0x06;
  m.step(0x0655, 7); // ld a,0x06

  // `ld ix,0x001d` IS INSIDE THE LOOP -- `jp nz,0x0655` lands ON it, so IX is
  // reloaded every pass and the routine uses it as a fresh STRIDE each time,
  // not as a running pointer. Hoisting it out is the sub_3fa6 trap: the second
  // and later passes would add an already-advanced IX to DE. Note IX here is a
  // CONSTANT 0x001D being added to DE, i.e. `add ix,de` computes DE + 0x1D and
  // the push/pop moves it back into DE -- a 16-bit add with no `add de,rr`
  // instruction available.
  do {
    regs.ix = 0x001d; // LOOP BODY, not setup
    m.step(0x0659, 14); // ld ix,0x001d
    regs.bc = 0x0003;
    m.step(0x065c, 10); // ld bc,0x0003
    m.ldirAt(0x065c, 0x065e);
    regs.addIx(regs.de); // writes H, N, C
    m.step(0x0660, 15); // add ix,de
    m.push16(regs.ix);
    m.step(0x0662, 15); // push ix
    regs.de = m.pop16(); // push ix / pop de == a 16-bit IX -> DE move
    m.step(0x0663, 10); // pop de
    regs.a = regs.dec8(regs.a);
    m.step(0x0664, 4); // dec a
    m.step(regs.fNZ ? 0x0655 : 0x0667, 10); // jp nz,0x0655
  } while (regs.fNZ);

  regs.a = mem.read8(0x638c);
  m.step(0x066a, 13); // ld a,(0x638c)
  return loc_066a(m);
}

/**
 * loc_066a -- ROM 0x066A-0x0690. A JOIN: reached by fallthrough from 0x0667
 * and by `jp 0x066a` from 0x06B5. Splits (0x638C) into BCD nibbles and writes
 * four tile cells.
 *
 *   066a  4f           ld   c,a          ; keep the ORIGINAL in C
 *   066b  e6 0f        and  0x0f
 *   066d  47           ld   b,a          ; low nibble in B
 *   066e  79           ld   a,c
 *   066f  0f 0f 0f 0f  rrca x4
 *   0673  e6 0f        and  0x0f         ; high nibble in A
 *   0675  c2 89 06     jp   nz,0x0689
 *   0678  3e 03        ld   a,0x03
 *   067a  32 89 60     ld   (0x6089),a
 *   067d  3e 70        ld   a,0x70
 *   067f  32 86 74     ld   (0x7486),a
 *   0682  32 a6 74     ld   (0x74a6),a
 *   0685  80           add  a,b
 *   0686  47           ld   b,a
 *   0687  3e 10        ld   a,0x10
 *   0689  32 e6 74     ld   (0x74e6),a   ; loc_0689
 *   068c  78           ld   a,b
 *   068d  32 c6 74     ld   (0x74c6),a
 *   0690  c9           ret
 *
 * THE FOUR VRAM STORES ARE OUT OF ADDRESS ORDER: 0x7486, 0x74A6, 0x74E6,
 * 0x74C6 -- 0x74E6 is written BEFORE 0x74C6. All four addresses are distinct,
 * so sorting them leaves final memory identical and no state diff would
 * notice; writediff gates the write TRACE and would go red. Left in ROM order.
 *
 * The high-nibble-zero arm suppresses a leading digit: it writes 0x70 to two
 * cells and enters the shared tail with A = 0x10, where the non-zero arm
 * enters with A = the high nibble itself.
 */
function loc_066a(m) {
  const { regs, mem } = m;

  regs.c = regs.a; // the ORIGINAL -- loc_0691 keeps it in B instead
  m.step(0x066b, 4); // ld c,a
  regs.and(0x0f);
  m.step(0x066d, 7); // and 0x0f
  regs.b = regs.a; // low nibble
  m.step(0x066e, 4); // ld b,a
  regs.a = regs.c;
  m.step(0x066f, 4); // ld a,c
  for (const next of [0x0670, 0x0671, 0x0672, 0x0673]) {
    regs.rrca();
    m.step(next, 4); // rrca
  }
  regs.and(0x0f); // high nibble
  m.step(0x0675, 7); // and 0x0f
  if (regs.fNZ) {
    m.step(0x0689, 10); // jp nz,0x0689 taken -- A is the high nibble
    return loc_0689(m);
  }
  m.step(0x0678, 10); // jp nz not taken

  regs.a = 0x03;
  m.step(0x067a, 7); // ld a,0x03
  mem.write8(0x6089, regs.a);
  m.step(0x067d, 13); // ld (0x6089),a
  regs.a = 0x70;
  m.step(0x067f, 7); // ld a,0x70
  mem.write8(0x7486, regs.a);
  m.step(0x0682, 13); // ld (0x7486),a
  mem.write8(0x74a6, regs.a);
  m.step(0x0685, 13); // ld (0x74a6),a
  regs.add(regs.b); // leaves the flags the 0x0690 ret hands back on THIS arm
  m.step(0x0686, 4); // add a,b
  regs.b = regs.a;
  m.step(0x0687, 4); // ld b,a
  regs.a = 0x10;
  m.step(0x0689, 7); // ld a,0x10

  return loc_0689(m); // fallthrough, NOT a jump
}

/** loc_0689 -- ROM 0x0689-0x0690, the shared tail of both loc_066a arms. */
function loc_0689(m) {
  const { regs, mem } = m;

  mem.write8(0x74e6, regs.a); // 0x74E6 BEFORE 0x74C6 -- see loc_066a
  m.step(0x068c, 13); // ld (0x74e6),a
  regs.a = regs.b;
  m.step(0x068d, 4); // ld a,b
  mem.write8(0x74c6, regs.a);
  m.step(0x0690, 13); // ld (0x74c6),a

  m.ret(); // 0690
}

/**
 * loc_0691 -- ROM 0x0691-0x06A7. The twin of loc_066a with INVERTED register
 * roles: the ORIGINAL goes to B, and the low nibble is left in A.
 *
 *   0691  3a 8c 63     ld   a,(0x638c)
 *   0694  47           ld   b,a          ; ORIGINAL in B, not C
 *   0695  e6 0f        and  0x0f         ; low nibble left in A, not moved
 *   0697  c5           push bc
 *   0698  cd 1c 05     call 0x051c
 *   069b  c1           pop  bc
 *   069c  78           ld   a,b
 *   069d  0f 0f 0f 0f  rrca x4
 *   06a1  e6 0f        and  0x0f
 *   06a3  c6 0a        add  a,0x0a
 *   06a5  c3 1c 05     jp   0x051c
 *
 * ENTERS entry_051c TWICE BY TWO DIFFERENT MECHANISMS, thirteen bytes apart:
 * a `call` at 0x0698 with a return address pushed, and a TAIL JUMP at 0x06A5
 * with nothing pushed. The tail jump means this block never reaches a `ret` of
 * its own -- entry_051c's `ret` returns to entry_062a's caller.
 *
 * C IS LIVE-IN HERE and is pushed at 0x0697 without ever being set. The `pop`
 * at 0x069B restores it, but the value handed to entry_051c on the FIRST call
 * is the caller's C, because `push` does not clear the register and the `call`
 * is the very next instruction.
 *
 * The second entry passes A = high nibble + 0x0A, i.e. the same routine is
 * invoked once per BCD digit with the second index offset by ten.
 */
function loc_0691(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x638c);
  m.step(0x0694, 13); // ld a,(0x638c)
  regs.b = regs.a; // ORIGINAL in B -- loc_066a uses C
  m.step(0x0695, 4); // ld b,a
  regs.and(0x0f); // low nibble stays in A
  m.step(0x0697, 7); // and 0x0f

  m.push16(regs.bc); // C is the caller's -- never set on this path
  m.step(0x0698, 11); // push bc
  m.push16(0x069b);
  m.step(0x051c, 17); // call 0x051c
  entry_051c(m);
  regs.bc = m.pop16();
  m.step(0x069c, 10); // pop bc

  regs.a = regs.b;
  m.step(0x069d, 4); // ld a,b
  for (const next of [0x069e, 0x069f, 0x06a0, 0x06a1]) {
    regs.rrca();
    m.step(next, 4); // rrca
  }
  regs.and(0x0f);
  m.step(0x06a3, 7); // and 0x0f
  regs.add(0x0a); // the second digit's table index is offset by ten
  m.step(0x06a5, 7); // add a,0x0a

  m.step(0x051c, 10); // jp 0x051c -- TAIL JUMP, nothing pushed
  return entry_051c(m);
}

/**
 * loc_06a8 -- ROM 0x06A8-0x06B7.
 *
 *   06a8  d6 01        sub  0x01      ; sets N=1, and H/C
 *   06aa  20 05        jr   nz,0x06b1
 *   06ac  21 b8 63     ld   hl,0x63b8
 *   06af  36 01        ld   (hl),0x01
 *   06b1  27           daa            ; loc_06b1
 *   06b2  32 8c 63     ld   (0x638c),a
 *   06b5  c3 6a 06     jp   0x066a
 *
 * THE `daa` RUNS WITH N=1, AND ITS INPUTS ARE SET NINE BYTES EARLIER ACROSS A
 * CONDITIONAL BRANCH. `daa` reads H, N and C, all three set by `sub 0x01` at
 * 0x06A8; on the fallthrough path `ld hl,nn` and `ld (hl),n` sit between them
 * and NEITHER WRITES FLAGS, so both paths deliver the `sub`'s H/N/C intact.
 *
 * This is the after-subtract DAA, which had NO EXECUTED PRECEDENT -- every daa
 * this project had run followed an `add` or `adc` (N=0). cpu.js implemented the
 * N=1 branch and had never taken it. Pinned exhaustively against MAME 0.288's
 * daa BEFORE this landed: 2048 cases, 1024 of them N=1, zero mismatches,
 * mutation-tested three ways. A `sub` implemented without H produces a wrong
 * A here, and the error is a VALUE, not a crash.
 *
 * `jp 0x066a` at 0x06B5 is BACKWARD BUT NOT A LOOP -- 0x066A cannot reach
 * 0x06B5, so this is a join into the shared digit-rendering tail, not a cycle.
 */
function loc_06a8(m) {
  const { regs, mem } = m;

  regs.sub(0x01); // sets N=1, H and C -- all read by the daa at 0x06B1
  m.step(0x06aa, 7); // sub 0x01
  if (regs.fNZ) {
    m.step(0x06b1, 12); // jr nz,0x06b1 taken
  } else {
    m.step(0x06ac, 7); // jr nz not taken
    regs.hl = 0x63b8;
    m.step(0x06af, 10); // ld hl,0x63b8   -- writes no flags
    mem.write8(regs.hl, 0x01);
    m.step(0x06b1, 10); // ld (hl),0x01   -- writes no flags
  }

  regs.daa(); // N=1 path -- see the note above
  m.step(0x06b2, 4); // daa
  mem.write8(0x638c, regs.a);
  m.step(0x06b5, 13); // ld (0x638c),a

  m.step(0x066a, 10); // jp 0x066a -- backward, and NOT a loop
  return loc_066a(m);
}

/**
 * entry_051c -- ROM 0x051C-0x055C  (task table entry 0: add to a BCD score)
 *
 *   051c  4f           ld   c,a
 *   051d  cf           rst  0x08
 *   051e  cd 5f 05     call 0x055f
 *   0521  79           ld   a,c
 *   0522  81           add  a,c
 *   0523  81           add  a,c
 *   0524  4f           ld   c,a
 *   0525  21 29 35     ld   hl,0x3529
 *   0528  06 00        ld   b,0x00
 *   052a  09           add  hl,bc
 *   052b  a7           and  a
 *   052c  06 03        ld   b,0x03
 *   052e  1a           ld   a,(de)        ; loop_052e
 *   052f  8e           adc  a,(hl)
 *   0530  27           daa
 *   0531  12           ld   (de),a
 *   0532  13           inc  de
 *   0533  23           inc  hl
 *   0534  10 f8        djnz 0x052e
 *   0536  d5           push de
 *   0537  1b           dec  de
 *   0538  3a 0d 60     ld   a,(0x600d)
 *   053b  cd 6b 05     call 0x056b
 *   053e  d1           pop  de
 *   053f  1b           dec  de
 *   0540  21 ba 60     ld   hl,0x60ba
 *   0543  06 03        ld   b,0x03
 *   0545  1a           ld   a,(de)        ; loop_0545
 *   0546  be           cp   (hl)
 *   0547  d8           ret  c
 *   0548  c2 50 05     jp   nz,0x0550
 *   054b  1b           dec  de
 *   054c  2b           dec  hl
 *   054d  10 f6        djnz 0x0545
 *   054f  c9           ret
 *   0550  cd 5f 05     call 0x055f        ; loc_0550
 *   0553  21 b8 60     ld   hl,0x60b8
 *   0556  1a           ld   a,(de)        ; loop_0556
 *   0557  77           ld   (hl),a
 *   0558  13           inc  de
 *   0559  23           inc  hl
 *   055a  10 fa        djnz 0x0556
 *   055c  c3 da 05     jp   0x05da
 *
 * THREE-BYTE BCD ADD, then a compare-and-maybe-copy against the high score.
 * A carries the task payload in; C holds it, is multiplied by 3, and indexes
 * a table of 3-byte BCD addends at 0x3529.
 *
 * `rst 0x08` AT 0x051D CAN SKIP THIS ENTIRE ROUTINE. sub_0008 discards its own
 * return address when bit 0 of 0x6007 is set, returning to entry_051c's CALLER
 * instead of to 0x051E. Modelled as an early return, which is what sub_0008's
 * boolean is for. A translation calling it and continuing regardless is wrong
 * on that path, and the gate may never see it -- the skip changes WHICH frame
 * resumes, not what memory holds.
 *
 * `and a` AT 0x052B IS LOAD-BEARING AND LOOKS REDUNDANT. It clears CARRY so
 * the `adc a,(hl)` chain starts clean. Deleting it -- it sets no value -- makes
 * the first addend depend on whatever carry `add hl,bc` at 0x052A left, which
 * is a real bit: HL = 0x3529 + 3*payload can carry. This is the flag-liveness
 * shape inverted: usually the risk is assuming flags are dead, here an
 * innocuous-looking instruction exists ONLY for its flag effect.
 *
 * `adc a,(hl)` HAS NO PRECEDENT in games/dkong/translated/ -- an S6 item not on the dispatch.
 * cpu.js's `add(v, carryIn)` was checked against MAME 0.288 z80.cpp:246
 * `adc_a` before use: C from bit 8, H from the low-nibble sum, PV as signed
 * overflow, N cleared. The formulations differ and agree.
 *
 * `daa` AT 0x0530 RUNS WITH N=0 (it follows `adc`). The daa at ROM 0x06B1
 * follows `sub` and runs with N=1, so the two routines exercise OPPOSITE
 * branches of the same helper -- pinned exhaustively against MAME's daa
 * beforehand, all 2048 cases including the 1024 N=1 ones that had never run.
 *
 * B IS CARRIED FROM THE COMPARE LOOP INTO THE COPY LOOP. `jp nz,0x0550` exits
 * mid-loop with B holding the REMAINING count, 0x0550 reloads neither B nor
 * the loop bound, and sub_055f does not touch B -- so the copy at 0x0556 runs
 * exactly as many times as the compare had left. Reloading B to 3 there would
 * be the obvious "fix" and would copy bytes the compare had already cleared.
 *
 * THE TWO LOOPS RUN IN OPPOSITE DIRECTIONS. 0x052E walks UP with `inc de`/
 * `inc hl`; 0x0545 walks DOWN with `dec de`/`dec hl`, which is why 0x0536-
 * 0x053F saves DE, calls the renderer, restores it and decrements twice --
 * repositioning from the low end to the high end. The `push`/`pop` pair
 * brackets a CALL, not a loop.
 *
 * TAIL `jp 0x05da` AT 0x055C -- no return address pushed, so the `ret` that
 * eventually runs is the one belonging to entry_051c's own caller. Enters
 * tail_05da, shared with handler_05c6.
 */
function entry_051c(m) {
  const { regs, mem } = m;

  regs.c = regs.a; // the task payload
  m.step(0x051d, 4); // ld c,a

  m.push16(0x051e);
  m.step(0x0008, 11); // rst 0x08
  if (!sub_0008(m)) return; // skipped: sub_0008 returned to OUR caller

  m.push16(0x0521);
  m.step(0x055f, 17); // call 0x055f
  sub_055f(m); // DE = 0x60B2 or 0x60B5

  regs.a = regs.c;
  m.step(0x0522, 4); // ld a,c
  regs.add(regs.c);
  m.step(0x0523, 4); // add a,c
  regs.add(regs.c);
  m.step(0x0524, 4); // add a,c   -- C * 3
  regs.c = regs.a;
  m.step(0x0525, 4); // ld c,a
  regs.hl = 0x3529;
  m.step(0x0528, 10); // ld hl,0x3529
  regs.b = 0x00;
  m.step(0x052a, 7); // ld b,0x00 -- BC is now the byte offset
  regs.addHl(regs.bc);
  m.step(0x052b, 11); // add hl,bc -- CAN SET CARRY, which is why 0x052B exists
  regs.and(regs.a); // clears carry for the adc chain below
  m.step(0x052c, 4); // and a
  regs.b = 0x03;
  m.step(0x052e, 7); // ld b,0x03

  do {
    regs.a = mem.read8(regs.de);
    m.step(0x052f, 7); // ld a,(de)
    regs.add(mem.read8(regs.hl), regs.fC ? 1 : 0);
    m.step(0x0530, 7); // adc a,(hl)
    regs.daa(); // N = 0 here -- see the note above
    m.step(0x0531, 4); // daa
    mem.write8(regs.de, regs.a);
    m.step(0x0532, 7); // ld (de),a
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0533, 6); // inc de -- 16-bit, unlike the inc e family
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0534, 6); // inc hl
    regs.djnz();
    m.step(regs.b !== 0 ? 0x052e : 0x0536, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.push16(regs.de); // push de -- brackets the CALL, not a loop
  m.step(0x0537, 11);
  regs.de = (regs.de - 1) & 0xffff;
  m.step(0x0538, 6); // dec de
  regs.a = mem.read8(0x600d);
  m.step(0x053b, 13); // ld a,(0x600d)

  m.push16(0x053e);
  m.step(0x056b, 17); // call 0x056b
  draw_056b(m);

  regs.de = m.pop16();
  m.step(0x053f, 10); // pop de
  regs.de = (regs.de - 1) & 0xffff;
  m.step(0x0540, 6); // dec de -- now at the HIGH byte, for the downward walk
  regs.hl = 0x60ba;
  m.step(0x0543, 10); // ld hl,0x60ba
  regs.b = 0x03;
  m.step(0x0545, 7); // ld b,0x03

  // The compare walks DOWN from the high byte. Three exits: `ret c` (ours is
  // lower, nothing to do), `jp nz` (ours is higher -- go copy), or the loop
  // running out with all three bytes equal, which falls to the `ret` at 0x054F.
  for (;;) {
    regs.a = mem.read8(regs.de);
    m.step(0x0546, 7); // ld a,(de)
    regs.cp(mem.read8(regs.hl));
    m.step(0x0547, 7); // cp (hl)
    if (regs.fC) {
      m.ret(11); // ret c taken
      return;
    }
    m.step(0x0548, 5); // ret c not taken
    if (regs.fNZ) {
      m.step(0x0550, 10); // jp nz,0x0550 taken -- B keeps the REMAINING count
      break;
    }
    m.step(0x054b, 10); // jp nz not taken
    regs.de = (regs.de - 1) & 0xffff;
    m.step(0x054c, 6); // dec de
    regs.hl = (regs.hl - 1) & 0xffff;
    m.step(0x054d, 6); // dec hl
    regs.djnz();
    m.step(regs.b !== 0 ? 0x0545 : 0x054f, regs.b !== 0 ? 13 : 8);
    if (regs.b === 0) {
      m.ret(); // 054f -- all three bytes equal
      return;
    }
  }

  // loc_0550: ours is higher, so copy it over the high score.
  m.push16(0x0553);
  m.step(0x055f, 17); // call 0x055f -- does NOT touch B
  sub_055f(m);

  regs.hl = 0x60b8;
  m.step(0x0556, 10); // ld hl,0x60b8

  do {
    regs.a = mem.read8(regs.de);
    m.step(0x0557, 7); // ld a,(de)
    mem.write8(regs.hl, regs.a);
    m.step(0x0558, 7); // ld (hl),a
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0559, 6); // inc de
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x055a, 6); // inc hl
    regs.djnz();
    m.step(regs.b !== 0 ? 0x0556 : 0x055c, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.step(0x05da, 10); // jp 0x05da -- TAIL jump, nothing pushed
  return tail_05da(m);
}

/*
 * The HL-twin of handler_05c6: clears the payload-selected 3-byte BCD slot,
 * then TAIL-JUMPS to handler_05c6 to render.
 *
 * The payload>=3 branch (jp nc,0x05BD) is a recursive "clear all lower slots"
 * loop. As with the twin handler_05c6 -- which THROWS on its analogous
 * high-payload branch rather than translate unexercised recursion -- this stubs
 * it with NotImplemented. The payload<3 path (the common one) is fully
 * translated.
 */
/**
 * loc_059b -- ROM 0x059B-0x05C5  (clear a BCD slot, then render via handler_05c6)
 *
 *   059b  fe 03        cp   0x03
 *   059d  d2 bd 05     jp   nc,0x05bd     ; payload >= 3 -> recursion (STUBBED)
 *   05a0  f5           push af            ; preserve payload across the clear
 *   05a1  21 b2 60     ld   hl,0x60b2
 *   05a4  a7           and  a             ; Z iff payload == 0
 *   05a5  ca ab 05     jp   z,0x05ab      ; ==0 keep 0x60B2
 *   05a8  21 b5 60     ld   hl,0x60b5     ; else 0x60B5
 *   05ab  fe 02        cp   0x02
 *   05ad  c2 b3 05     jp   nz,0x05b3     ; !=2 keep current
 *   05b0  21 b8 60     ld   hl,0x60b8     ; ==2 -> 0x60B8
 *   05b3  af           xor  a             ; loc_05b3: clear the 3-byte slot
 *   05b4  77           ld   (hl),a
 *   05b5  23           inc  hl
 *   05b6  77           ld   (hl),a
 *   05b7  23           inc  hl
 *   05b8  77           ld   (hl),a
 *   05b9  f1           pop  af            ; restore payload
 *   05ba  c3 c6 05     jp   0x05c6        ; TAIL jump into handler_05c6
 */
export function loc_059b(m) {
  const { regs, mem } = m;

  regs.cp(0x03);
  m.step(0x059d, 7); // cp 0x03
  if (regs.fNC) {
    m.step(0x05bd, 10); // jp nc,0x05bd -- payload >= 3
    throw new NotImplemented(
      "loc_059b payload>=3 recursion at ROM 0x05BD (twin-consistent stub; see the header)",
    );
  }
  m.step(0x05a0, 10); // jp nc not taken

  m.push16(regs.af); // push af (0x05A0) -- preserve payload across the clear
  m.step(0x05a1, 11);
  regs.hl = 0x60b2;
  m.step(0x05a4, 10); // ld hl,0x60b2
  regs.and(regs.a); // and a -- Z iff payload == 0
  m.step(0x05a5, 4);
  if (regs.fZ) {
    m.step(0x05ab, 10); // jp z,0x05ab -- keep 0x60B2
  } else {
    m.step(0x05a8, 10); // jp z not taken
    regs.hl = 0x60b5;
    m.step(0x05ab, 10); // ld hl,0x60b5
  }
  regs.cp(0x02);
  m.step(0x05ad, 7); // cp 0x02
  if (regs.fNZ) {
    m.step(0x05b3, 10); // jp nz,0x05b3 -- keep current
  } else {
    m.step(0x05b0, 10); // jp nz not taken
    regs.hl = 0x60b8;
    m.step(0x05b3, 10); // ld hl,0x60b8
  }

  // -- loc_05b3: clear the selected 3-byte slot --
  regs.xor(regs.a); // A = 0
  m.step(0x05b4, 4);
  mem.write8(regs.hl, regs.a);
  m.step(0x05b5, 7); // ld (hl),a
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x05b6, 6); // inc hl
  mem.write8(regs.hl, regs.a);
  m.step(0x05b7, 7); // ld (hl),a
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x05b8, 6); // inc hl
  mem.write8(regs.hl, regs.a);
  m.step(0x05b9, 7); // ld (hl),a
  regs.af = m.pop16(); // pop af (0x05B9) -- restore payload for handler_05c6
  m.step(0x05ba, 10);

  m.step(0x05c6, 10); // jp 0x05c6 -- TAIL jump, nothing pushed
  return handler_05c6(m); // its ret returns on our behalf
}

/**
 * handler_05c6 -- ROM 0x05C6-0x05DF  (task table entry 2: draw a counter)
 *
 *   05c6  fe 03        cp   0x03
 *   05c8  ca e0 05     jp   z,0x05e0
 *   05cb  11 b4 60     ld   de,0x60b4
 *   05ce  a7           and  a
 *   05cf  ca d5 05     jp   z,0x05d5
 *   05d2  11 b7 60     ld   de,0x60b7
 *   05d5  fe 02        cp   0x02
 *   05d7  c2 6b 05     jp   nz,0x056b
 *   05da  11 ba 60     ld   de,0x60ba
 *   05dd  c3 78 05     jp   0x0578
 *
 * Selects which of three BCD counters at 0x60B4 / 0x60B7 / 0x60BA to render
 * from the payload, then tail-jumps to the renderer. Note the `ld de` at
 * 0x05CB is executed and then possibly OVERWRITTEN at 0x05D2 -- the fall
 * through IS the selection, not a mistake.
 */
function handler_05c6(m) {
  const { regs } = m;

  regs.cp(0x03);
  m.step(0x05c8, 7);
  if (regs.fZ) {
    m.step(0x05e0, 10);
    throw new NotImplemented("handler_05c6 payload 3 path at ROM 0x05E0");
  }
  m.step(0x05cb, 10);
  regs.de = 0x60b4;
  m.step(0x05ce, 10);
  regs.and(regs.a);
  m.step(0x05cf, 4);
  if (regs.fZ) {
    m.step(0x05d5, 10); // jp z -- keep 0x60b4
  } else {
    m.step(0x05d2, 10);
    regs.de = 0x60b7;
    m.step(0x05d5, 10);
  }
  regs.cp(0x02);
  m.step(0x05d7, 7);
  if (regs.fNZ) {
    m.step(0x056b, 10);
    return draw_056b(m);
  }
  m.step(0x05da, 10);
  return tail_05da(m);
}

/**
 * tail_05da -- ROM 0x05DA-0x05DF, the last two instructions of handler_05c6
 *
 *   05da  11 ba 60     ld   de,0x60ba
 *   05dd  c3 78 05     jp   0x0578
 *
 * A THIRD ENTRY POINT, extracted because entry_051c TAIL-JUMPS here from
 * 0x055C. It is not a routine in the ROM -- it is the fall-through tail of
 * handler_05c6, and 0x051C reaches the same two instructions by `jp 0x05da`.
 *
 * Extracted rather than duplicated: two copies of a two-instruction tail is
 * exactly where a later edit fixes one and not the other. The caller performs
 * the step that LANDS on 0x05DA, because its cost differs by route -- 10 T for
 * handler_05c6's not-taken `jp nz`, 10 T for 0x055C's unconditional `jp`.
 */
function tail_05da(m) {
  const { regs } = m;

  regs.de = 0x60ba;
  m.step(0x05dd, 10); // ld de,0x60ba
  m.step(0x0578, 10); // jp 0x0578 -- tail jump, nothing pushed
  return draw_0578(m);
}

/**
 * sub_055f -- ROM 0x055F-0x056A  (12 bytes, 6 instructions)
 *
 *   055f  11 b2 60     ld   de,0x60b2
 *   0562  3a 0d 60     ld   a,(0x600d)
 *   0565  a7           and  a
 *   0566  c8           ret  z
 *   0567  11 b5 60     ld   de,0x60b5
 *   056a  c9           ret
 *
 * Selects one of two BCD counter addresses into DE from the flag at 0x600D:
 * zero keeps 0x60B2, non-zero replaces it with 0x60B5. The `ld de` at 0x055F
 * is executed and then possibly OVERWRITTEN -- the fall-through IS the
 * selection, the same shape as handler_05c6's 0x05CB/0x05D2 pair.
 *
 * TWO EXITS, both ordinary `ret`s -- no stack idiom here. It is six
 * instructions with only two callers, both inside entry_051c, at 0x051E and
 * 0x0550.
 *
 * IT RETURNS ITS RESULT IN DE AND CLOBBERS A AND F. A holds (0x600D) at both
 * exits and the flags are `and a`'s -- entry_051c's second call site at 0x0550
 * is followed immediately by `ld hl,0x60b8`, so neither is read there.
 */
function sub_055f(m) {
  const { regs, mem } = m;

  regs.de = 0x60b2;
  m.step(0x0562, 10); // ld de,0x60b2
  regs.a = mem.read8(0x600d);
  m.step(0x0565, 13); // ld a,(0x600d)
  regs.and(regs.a); // sets Z from A; clears C, sets H
  m.step(0x0566, 4); // and a
  if (regs.fZ) {
    m.ret(11); // ret z taken -- DE stays 0x60B2
    return;
  }
  m.step(0x0567, 5); // ret z not taken

  regs.de = 0x60b5; // overwrites the 0x055F load
  m.step(0x056a, 10); // ld de,0x60b5

  m.ret(); // 056a
}

/**
 * draw_056b -- ROM 0x056B-0x0577
 *
 *   056b  dd 21 81 77  ld   ix,0x7781
 *   056f  a7           and  a
 *   0570  28 0a        jr   z,0x057c
 *   0572  dd 21 21 75  ld   ix,0x7521
 *   0576  18 04        jr   0x057c
 *
 * Picks the destination column, then joins draw_0578 partway in -- at
 * 0x057C, AFTER its own `ld ix`. So the two entry points differ only in
 * which IX they establish.
 */
function draw_056b(m) {
  const { regs } = m;
  regs.ix = 0x7781;
  m.step(0x056f, 14);
  regs.and(regs.a);
  m.step(0x0570, 4);
  if (regs.fZ) {
    m.step(0x057c, 12); // jr z taken
  } else {
    m.step(0x0572, 7);
    regs.ix = 0x7521;
    m.step(0x0576, 14);
    m.step(0x057c, 12);
  }
  return draw_0578(m, true);
}

/**
 * draw_0578 -- ROM 0x0578-0x0592  (render a 3-byte BCD counter)
 *
 *   0578  dd 21 41 76  ld   ix,0x7641
 *   057c  eb           ex   de,hl
 *   057d  11 e0 ff     ld   de,0xffe0
 *   0580  01 04 03     ld   bc,0x0304
 *   0583  7e           ld   a,(hl)           ; loop
 *   0584  0f           rrca
 *   0585  0f           rrca
 *   0586  0f           rrca
 *   0587  0f           rrca
 *   0588  cd 93 05     call 0x0593
 *   058b  7e           ld   a,(hl)
 *   058c  cd 93 05     call 0x0593
 *   058f  2b           dec  hl
 *   0590  10 f1        djnz 0x0583
 *   0592  c9           ret
 *
 * Three source bytes, two BCD digits each, high nibble first -- so six
 * digits drawn from HL downward into IX, stepping DE = 0xFFE0 (one tilemap
 * row) per digit. Vertical again, like handler_05e9.
 *
 * `enteredAt057C` skips the `ld ix` when reached from draw_056b, which has
 * already chosen a different destination.
 */
function draw_0578(m, enteredAt057C = false) {
  const { regs } = m;

  if (!enteredAt057C) {
    regs.ix = 0x7641;
    m.step(0x057c, 14);
  }
  regs.exDeHl();
  m.step(0x057d, 4);
  regs.de = 0xffe0;
  m.step(0x0580, 10);
  regs.bc = 0x0304;
  m.step(0x0583, 10);

  loop_0583(m);
}

/**
 * loop_0583 -- ROM 0x0583-0x0592, the BCD expansion loop
 *
 *   0583  7e           ld   a,(hl)           ; loop
 *   0584  0f           rrca
 *   0585  0f           rrca
 *   0586  0f           rrca
 *   0587  0f           rrca
 *   0588  cd 93 05     call 0x0593
 *   058b  7e           ld   a,(hl)
 *   058c  cd 93 05     call 0x0593
 *   058f  2b           dec  hl
 *   0590  10 f1        djnz 0x0583
 *   0592  c9           ret
 *
 * A THIRD ENTRY POINT into this block. draw_0578 reaches 0x0583 by falling
 * into it after setting IX/DE/BC, but sub_0616 TAIL JUMPS straight here with
 * its own HL, DE, IX and B -- so 0x0583 is entered from two routines that
 * share no prologue. Extracted rather than adding another entry flag: the
 * flag pattern already carries `enteredAt057C`, and a second one would encode
 * the control-flow graph in booleans instead of in functions.
 *
 * The four `rrca`s are a nibble SWAP, not a shift -- rotating A right four
 * times puts the high nibble low, and sub_0593 masks with 0x0F. That is why
 * one code path emits the high digit then the low one with no shift variant.
 *
 * HL walks BACKWARDS while IX walks by DE, which is what reverses source
 * byte order into display order.
 *
 * Its `ret` returns to whoever called the ROUTINE, not to draw_0578 -- for
 * sub_0616 that means the tail jump's caller, which is the whole point of a
 * tail jump.
 */
function loop_0583(m) {
  const { regs, mem } = m;

  do {
    regs.a = mem.read8(regs.hl);
    m.step(0x0584, 7);
    for (const nxt of [0x0585, 0x0586, 0x0587, 0x0588]) {
      regs.rrca();
      m.step(nxt, 4);
    }
    m.push16(0x058b);
    m.step(0x0593, 17);
    sub_0593(m); // high nibble

    regs.a = mem.read8(regs.hl);
    m.step(0x058c, 7);
    m.push16(0x058f);
    m.step(0x0593, 17);
    sub_0593(m); // low nibble

    regs.hl = (regs.hl - 1) & 0xffff;
    m.step(0x0590, 6);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x0583 : 0x0592, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret();
}

/**
 * sub_0593 -- ROM 0x0593-0x059A
 *
 *   0593  e6 0f        and  0x0f
 *   0595  dd 77 00     ld   (ix+0x00),a
 *   0598  dd 19        add  ix,de
 *   059a  c9           ret
 *
 * Masks to one BCD digit, stores it, and advances IX by DE -- so the caller
 * controls the step direction and the digit routine stays position-agnostic.
 */
function sub_0593(m) {
  const { regs, mem } = m;
  regs.and(0x0f);
  m.step(0x0595, 7);
  mem.write8(regs.ix, regs.a);
  m.step(0x0598, 19); // ld (ix+d),a
  // WAS `regs.ix = (regs.ix + regs.de) & 0xffff` -- arithmetically right and
  // flag-wise wrong. `add ix,rr` sets H, N and C (and the undocumented F3/F5)
  // from the 16-bit result; the open-coded version left all of them at
  // whatever the preceding `and 0x0f` had set.
  //
  // A liveness check that stops at the routine boundary can return the right
  // verdict BY LUCK: "no reader in this routine" is not "no reader". This is a
  // two-instruction routine whose second instruction is the `ret`, so the
  // carry leaves immediately. Traced out of the caller loop at 0x0583:
  //   loop-back    -- carry DIES at `rrca` (0x0584).
  //   fall-through -- escapes `ret` 0x059A, `ret` 0x0592, reaches 0x15B0 past
  //     three flag-neutral instructions, and escapes `ret` 0x15F9 too. STILL
  //     LIVE three returns up.
  //
  // Whether any reader exists further up is unresolved and does not matter for
  // correctness now that the flags are set correctly.
  regs.addIx(regs.de);
  m.step(0x059a, 15); // add ix,de
  m.ret();
}

/**
 * handler_05e9 -- ROM 0x05E9-0x0610  (task table entry 3: draw a string)
 *
 *   05e9  21 4b 36     ld   hl,0x364b
 *   05ec  87           add  a,a
 *   05ed  f5           push af
 *   05ee  e6 7f        and  0x7f
 *   05f0  5f           ld   e,a
 *   05f1  16 00        ld   d,0x00
 *   05f3  19           add  hl,de
 *   05f4  5e           ld   e,(hl)
 *   05f5  23           inc  hl
 *   05f6  56           ld   d,(hl)
 *   05f7  eb           ex   de,hl
 *   05f8  5e           ld   e,(hl)
 *   05f9  23           inc  hl
 *   05fa  56           ld   d,(hl)
 *   05fb  23           inc  hl
 *   05fc  01 e0 ff     ld   bc,0xffe0
 *   05ff  eb           ex   de,hl
 *   0600  1a           ld   a,(de)           ; loop
 *   0601  fe 3f        cp   0x3f
 *   0603  ca 26 00     jp   z,0x0026
 *   0606  77           ld   (hl),a
 *   0607  f1           pop  af
 *   0608  30 02        jr   nc,0x060c
 *   060a  36 10        ld   (hl),0x10
 *   060c  f5           push af
 *   060d  13           inc  de
 *   060e  09           add  hl,bc
 *   060f  18 ef        jr   0x0600
 *
 * A doubly-indirected string draw. The payload indexes a pointer table at
 * 0x364B; that entry points to a descriptor holding the VRAM destination,
 * and the bytes after it are the characters. BC = 0xFFE0 steps the
 * destination back one tilemap row per character, so the string is drawn
 * VERTICALLY -- which is what you would expect on a screen the hardware
 * rotates 270 degrees.
 *
 * 0x3F is the terminator, and the exit is `jp z,0x0026` -- a jump into the
 * TAIL of sub_0020 (`pop hl / ret`), a shared skip-return that discards this
 * handler's return address and returns to its caller's caller. A fourth
 * distinct stack idiom, and this one is a jump into another routine's middle
 * rather than a call.
 *
 * The `push af` / `pop af` pair carries the carry from `add a,a` across the
 * loop: bit 7 of the payload decides whether each character is followed by a
 * blank (tile 0x10).
 */
export function handler_05e9(m) {
  const { regs, mem } = m;

  regs.hl = 0x364b;
  m.step(0x05ec, 10);
  regs.add(regs.a); // add a,a -- bit 7 into carry
  m.step(0x05ed, 4);
  m.push16(regs.af);
  m.step(0x05ee, 11);
  regs.and(0x7f);
  m.step(0x05f0, 7);
  regs.e = regs.a;
  m.step(0x05f1, 4);
  regs.d = 0x00;
  m.step(0x05f3, 7);
  regs.addHl(regs.de);
  m.step(0x05f4, 11);
  regs.e = mem.read8(regs.hl);
  m.step(0x05f5, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x05f6, 6);
  regs.d = mem.read8(regs.hl);
  m.step(0x05f7, 7);
  regs.exDeHl();
  m.step(0x05f8, 4);
  regs.e = mem.read8(regs.hl);
  m.step(0x05f9, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x05fa, 6);
  regs.d = mem.read8(regs.hl);
  m.step(0x05fb, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x05fc, 6);
  regs.bc = 0xffe0; // -32: one tilemap row per character
  m.step(0x05ff, 10);
  regs.exDeHl();
  m.step(0x0600, 4);

  for (;;) {
    regs.a = mem.read8(regs.de);
    m.step(0x0601, 7);
    regs.cp(0x3f);
    m.step(0x0603, 7);
    if (regs.fZ) {
      // 0x3F terminator -> jp z,0x0026, REUSING sub_0020's `pop hl / ret` tail.
      // This is NOT a caller-skip here (despite borrowing that code): at this
      // point the stack is [return-addr, AF], because the `push af` @0x05EE is
      // still outstanding -- the loop's balancing `pop af` @0x0608 is AFTER this
      // cp/jp-z check. So `pop hl` discards THAT push-af value (not the return
      // address), and `ret` goes to the IMMEDIATE caller. A NORMAL return.
      // (The `pop hl` is load-bearing: remove it and callers return one frame
      // short.)
      m.step(0x0026, 10);
      regs.hl = m.pop16(); // discards the outstanding push-af, NOT the return addr
      m.step(0x0027, 10);
      m.ret(); // -> the immediate caller (normal return)
      return;
    }
    m.step(0x0606, 10);
    mem.write8(regs.hl, regs.a);
    m.step(0x0607, 7);
    regs.af = m.pop16();
    m.step(0x0608, 10);
    if (regs.fNC) {
      m.step(0x060c, 12); // jr nc taken -- no trailing blank
    } else {
      m.step(0x060a, 7);
      mem.write8(regs.hl, 0x10);
      m.step(0x060c, 10);
    }
    m.push16(regs.af);
    m.step(0x060d, 11);
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x060e, 6);
    regs.addHl(regs.bc);
    m.step(0x060f, 11);
    m.step(0x0600, 12); // jr 0x0600
  }
}

/**
 * sub_037f -- ROM 0x037F-0x03A1
 *
 *   037f  21 84 63     ld   hl,0x6384
 *   0382  7e           ld   a,(hl)
 *   0383  34           inc  (hl)
 *   0384  a7           and  a
 *   0385  c0           ret  nz
 *   0386  21 81 63     ld   hl,0x6381
 *   0389  7e           ld   a,(hl)
 *   038a  47           ld   b,a
 *   038b  34           inc  (hl)
 *   038c  e6 07        and  0x07
 *   038e  c0           ret  nz
 *   038f  78           ld   a,b
 *   0390  0f           rrca
 *   0391  0f           rrca
 *   0392  0f           rrca
 *   0393  47           ld   b,a
 *   0394  3a 29 62     ld   a,(0x6229)
 *   0397  80           add  a,b
 *   0398  fe 05        cp   0x05
 *   039a  38 02        jr   c,0x039e
 *   039c  3e 05        ld   a,0x05
 *   039e  32 80 63     ld   (0x6380),a
 *   03a1  c9           ret
 *
 * Two nested rate dividers. 0x6384 counts every call and gates on wrapping to
 * zero (`and a / ret nz` AFTER reading the pre-increment value), then 0x6381
 * gates on every 8th. Only then is the difficulty value at 0x6380 recomputed
 * from the level number, clamped to 5.
 *
 * Note `ld a,(hl)` reads BEFORE `inc (hl)`, so the test is on the old value.
 */
export function sub_037f(m) {
  const { regs, mem } = m;

  regs.hl = 0x6384;
  m.step(0x0382, 10);
  regs.a = mem.read8(regs.hl);
  m.step(0x0383, 7);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x0384, 11);
  regs.and(regs.a);
  m.step(0x0385, 4);
  if (regs.fNZ) {
    m.ret(11);
    return;
  }
  m.step(0x0386, 5);

  regs.hl = 0x6381;
  m.step(0x0389, 10);
  regs.a = mem.read8(regs.hl);
  m.step(0x038a, 7);
  regs.b = regs.a;
  m.step(0x038b, 4);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x038c, 11);
  regs.and(0x07);
  m.step(0x038e, 7);
  if (regs.fNZ) {
    m.ret(11);
    return;
  }
  m.step(0x038f, 5);

  regs.a = regs.b;
  m.step(0x0390, 4);
  for (const nxt of [0x0391, 0x0392, 0x0393]) {
    regs.rrca();
    m.step(nxt, 4);
  }
  regs.b = regs.a;
  m.step(0x0394, 4);
  regs.a = mem.read8(0x6229);
  m.step(0x0397, 13);
  regs.add(regs.b);
  m.step(0x0398, 4);
  regs.cp(0x05);
  m.step(0x039a, 7);
  if (regs.fC) {
    m.step(0x039e, 12); // jr c taken
  } else {
    m.step(0x039c, 7);
    regs.a = 0x05;
    m.step(0x039e, 7);
  }
  mem.write8(0x6380, regs.a);
  m.step(0x03a1, 13);
  m.ret();
}

/**
 * sub_0010 -- ROM 0x0010-0x0017  (the `rst 0x10` conditional-skip helper)
 *
 *   0010  3a 00 62     ld   a,(0x6200)
 *   0013  0f           rrca
 *   0014  d8           ret  c
 *   0015  33           inc  sp
 *   0016  33           inc  sp
 *   0017  c9           ret
 *
 * Mirror of sub_0008 with the opposite polarity: returns NORMALLY when bit 0
 * of 0x6200 is SET, and skips the caller's remainder when it is clear.
 * Returns true for a normal return.
 */
export function sub_0010(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6200);
  m.step(0x0013, 13);
  regs.rrca();
  m.step(0x0014, 4);
  if (regs.fC) {
    m.ret(11);
    return true;
  }
  m.step(0x0015, 5);
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x0016, 6);
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x0017, 6);
  m.ret();
  return false;
}

/**
 * sub_0030 -- ROM 0x0030, which is `jr 0x0044`
 *
 *   0030  18 12        jr   0x0044
 *   0044  21 27 62     ld   hl,0x6227
 *   0047  46           ld   b,(hl)
 *   0048  0f           rrca                  ; loc_0048
 *   0049  10 fd        djnz 0x0048
 *   004b  d8           ret  c
 *   004c  e1           pop  hl
 *   004d  c9           ret
 *
 * The `rst 0x30` helper. Rotates A right B times, where B is the value at
 * 0x6227, then returns normally if the resulting carry is set and skips the
 * caller otherwise -- so it selects a bit of A by an index held in RAM.
 * Returns true for a normal return.
 */
export function sub_0030(m) {
  const { regs, mem } = m;
  m.step(0x0044, 12); // jr 0x0044
  regs.hl = 0x6227;
  m.step(0x0047, 10);
  regs.b = mem.read8(regs.hl);
  m.step(0x0048, 7);
  do {
    regs.rrca();
    m.step(0x0049, 4);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x0048 : 0x004b, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);
  if (regs.fC) {
    m.ret(11);
    return true;
  }
  m.step(0x004c, 5);
  regs.hl = m.pop16(); // pop hl -- discards this routine's return address
  m.step(0x004d, 10);
  m.ret();
  return false;
}

/**
 * sub_03a2 -- ROM 0x03A2-0x03F1  (+ callee sub_03f2 at 0x03F2-0x03FA)
 *
 *   03a2  3e 03        ld   a,0x03
 *   03a4  f7           rst  0x30
 *   03a5  d7           rst  0x10
 *   03a6  3a 50 63     ld   a,(0x6350)
 *   03a9  0f           rrca
 *   03aa  d8           ret  c
 *   03ab  21 b8 62     ld   hl,0x62b8
 *   03ae  35           dec  (hl)
 *   03af  c0           ret  nz
 *   03b0  36 04        ld   (hl),0x04
 *   03b2  3a b9 62     ld   a,(0x62b9)
 *   03b5  0f           rrca
 *   03b6  d0           ret  nc
 *   03b7  21 29 6a     ld   hl,0x6a29
 *   03ba  06 40        ld   b,0x40
 *   03bc  dd 21 a0 66  ld   ix,0x66a0
 *   03c0  0f           rrca
 *   03c1  d2 e4 03     jp   nc,0x03e4
 *   03c4  dd 36 09 02  ld   (ix+0x09),0x02
 *   03c8  dd 36 0a 02  ld   (ix+0x0a),0x02
 *   03cc  04           inc  b
 *   03cd  04           inc  b
 *   03ce  cd f2 03     call 0x03f2
 *   03d1  21 ba 62     ld   hl,0x62ba
 *   03d4  35           dec  (hl)
 *   03d5  c0           ret  nz
 *   03d6  3e 01        ld   a,0x01
 *   03d8  32 b9 62     ld   (0x62b9),a
 *   03db  32 a0 63     ld   (0x63a0),a
 *   03de  3e 10        ld   a,0x10          ; loc_03de
 *   03e0  32 ba 62     ld   (0x62ba),a
 *   03e3  c9           ret
 *   03e4  dd 36 09 02  ld   (ix+0x09),0x02  ; loc_03e4
 *   03e8  dd 36 0a 00  ld   (ix+0x0a),0x00
 *   03ec  cd f2 03     call 0x03f2
 *   03ef  c3 de 03     jp   0x03de
 *
 * Reached in game state 1 once BOTH the rst 0x30 and rst 0x10 gates pass. It
 * services a periodic event, gated three deep: a bit of (0x6350), then a
 * countdown at 0x62B8 reloaded to 4, then a bit of (0x62B9). The `rrca`s test
 * bit 0 into carry and the `ret c`/`ret nc` are the early exits.
 *
 * THE 0x03C0 rrca TESTS THE SAME (0x62B9) BIT AGAIN -- 0x03B5 rotated it into
 * carry and exited on nc; the value is still in A, so 0x03C0 rotates the NEXT
 * bit up. The two-way split at 0x03C1 (jp nc) writes (ix+0x0A) as 0x02 or 0x00
 * accordingly -- the only difference between the two arms, both of which then
 * call 0x03F2 and converge at loc_03de.
 *
 * B = 0x40 then two `inc b` on the 0x03C4 arm (-> 0x42) is the value 0x03F2
 * stores at (HL) = 0x6A29; the 0x03E4 arm leaves B = 0x40. sub_03f2 conditions
 * a second store on a bit of (0x6019).
 */
export function sub_03a2(m) {
  const { regs, mem } = m;

  regs.a = 0x03;
  m.step(0x03a4, 7);

  m.push16(0x03a5);
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return;

  m.push16(0x03a6);
  m.step(0x0010, 11); // rst 0x10
  if (!sub_0010(m)) return;

  regs.a = mem.read8(0x6350);
  m.step(0x03a9, 13); // ld a,(0x6350)
  regs.rrca();
  m.step(0x03aa, 4); // rrca
  if (regs.fC) {
    m.ret(11); // ret c
    return;
  }
  m.step(0x03ab, 5); // ret c not taken

  regs.hl = 0x62b8;
  m.step(0x03ae, 10); // ld hl,0x62b8
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)), 8); // dec (hl)
  m.step(0x03af, 11);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- counter has not reached 0
    return;
  }
  m.step(0x03b0, 5); // ret nz not taken

  mem.write8(regs.hl, 0x04); // reload the 0x62B8 counter
  m.step(0x03b2, 10); // ld (hl),0x04
  regs.a = mem.read8(0x62b9);
  m.step(0x03b5, 13); // ld a,(0x62b9)
  regs.rrca();
  m.step(0x03b6, 4); // rrca -- tests bit 0 of (0x62B9)
  if (regs.fNC) {
    m.ret(11); // ret nc
    return;
  }
  m.step(0x03b7, 5); // ret nc not taken

  regs.hl = 0x6a29;
  m.step(0x03ba, 10); // ld hl,0x6a29
  regs.b = 0x40;
  m.step(0x03bc, 7); // ld b,0x40
  regs.ix = 0x66a0;
  m.step(0x03c0, 14); // ld ix,0x66a0
  regs.rrca();
  m.step(0x03c1, 4); // rrca -- the NEXT bit of (0x62B9), still in A

  if (regs.fNC) {
    m.step(0x03e4, 10); // jp nc,0x03e4
    mem.write8((regs.ix + 0x09) & 0xffff, 0x02);
    m.step(0x03e8, 19); // ld (ix+0x09),0x02
    mem.write8((regs.ix + 0x0a) & 0xffff, 0x00);
    m.step(0x03ec, 19); // ld (ix+0x0a),0x00
    m.push16(0x03ef);
    m.step(0x03f2, 17); // call 0x03f2
    sub_03f2(m);
    m.step(0x03de, 10); // jp 0x03de
  } else {
    m.step(0x03c4, 10); // jp nc not taken
    mem.write8((regs.ix + 0x09) & 0xffff, 0x02);
    m.step(0x03c8, 19); // ld (ix+0x09),0x02
    mem.write8((regs.ix + 0x0a) & 0xffff, 0x02);
    m.step(0x03cc, 19); // ld (ix+0x0a),0x02
    regs.b = regs.inc8(regs.b);
    m.step(0x03cd, 4); // inc b
    regs.b = regs.inc8(regs.b);
    m.step(0x03ce, 4); // inc b  -- B = 0x42
    m.push16(0x03d1);
    m.step(0x03f2, 17); // call 0x03f2
    sub_03f2(m);

    regs.hl = 0x62ba;
    m.step(0x03d4, 10); // ld hl,0x62ba
    mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)), 8); // dec (hl)
    m.step(0x03d5, 11);
    if (regs.fNZ) {
      m.ret(11); // ret nz
      return;
    }
    m.step(0x03d6, 5); // ret nz not taken

    regs.a = 0x01;
    m.step(0x03d8, 7); // ld a,0x01
    mem.write8(0x62b9, regs.a);
    m.step(0x03db, 13); // ld (0x62b9),a
    mem.write8(0x63a0, regs.a);
    m.step(0x03de, 13); // ld (0x63a0),a
  }

  // loc_03de -- both arms converge here.
  regs.a = 0x10;
  m.step(0x03e0, 7); // ld a,0x10
  mem.write8(0x62ba, regs.a);
  m.step(0x03e3, 13); // ld (0x62ba),a

  m.ret(); // 03e3
}

/**
 * sub_03f2 -- ROM 0x03F2-0x03FA
 *
 *   03f2  70           ld   (hl),b
 *   03f3  3a 19 60     ld   a,(0x6019)
 *   03f6  0f           rrca
 *   03f7  d8           ret  c
 *   03f8  04           inc  b
 *   03f9  70           ld   (hl),b
 *   03fa  c9           ret
 *
 * Stores B at (HL). Then, unless bit 0 of (0x6019) is set, increments B and
 * stores AGAIN at the SAME address -- there is no `inc hl` -- so (HL) ends as
 * B when the bit is set and B+1 when it is clear. The first store is then
 * visible only in the write TRACE, never in final state (the second overwrites
 * it), which is exactly the kind of write writediff sees and state-diff cannot.
 * The caller supplies HL = 0x6A29 and B pre-loaded. Called from both arms of
 * sub_03a2.
 */
function sub_03f2(m) {
  const { regs, mem } = m;

  mem.write8(regs.hl, regs.b);
  m.step(0x03f3, 7); // ld (hl),b
  regs.a = mem.read8(0x6019);
  m.step(0x03f6, 13); // ld a,(0x6019)
  regs.rrca();
  m.step(0x03f7, 4); // rrca
  if (regs.fC) {
    m.ret(11); // ret c
    return;
  }
  m.step(0x03f8, 5); // ret c not taken

  regs.b = regs.inc8(regs.b);
  m.step(0x03f9, 4); // inc b
  mem.write8(regs.hl, regs.b);
  m.step(0x03fa, 7); // ld (hl),b

  m.ret(); // 03fa
}

/**
 * entry_0611 -- ROM 0x0611-0x0615  (task table entry 8)
 *
 *   0611  3a 07 60     ld   a,(0x6007)
 *   0614  0f           rrca
 *   0615  d0           ret  nc
 *   ... falls through into sub_0616
 *
 * The `rrca` moves bit 0 of 0x6007 into carry, so this returns unless that
 * bit is set -- a one-bit enable guard, not a value test. A is left rotated
 * and IS read by nothing downstream, which is why the guard can clobber it.
 *
 * 0x6007 bit 0 is the same flag `sub_0008` tests with the identical
 * `ld a,(0x6007) / rrca / ret nc` sequence, so this is a shared idiom rather
 * than a coincidence.
 */
export function entry_0611(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6007);
  m.step(0x0614, 13);
  regs.rrca();
  m.step(0x0615, 4);
  if (regs.fNC) {
    m.ret(11); // ret nc taken -- the enable bit is clear, do nothing
    return;
  }
  m.step(0x0616, 5); // not taken: 5, and falls through into sub_0616
  sub_0616(m);
}

/**
 * sub_0616 -- ROM 0x0616-0x0629
 *
 *   0616  3e 05        ld   a,0x05
 *   0618  cd e9 05     call 0x05e9
 *   061b  21 01 60     ld   hl,0x6001
 *   061e  11 e0 ff     ld   de,0xffe0
 *   0621  dd 21 bf 74  ld   ix,0x74bf
 *   0625  06 01        ld   b,0x01
 *   0627  c3 83 05     jp   0x0583
 *
 * Draws string 5 via the shared string handler, then sets up a ONE-BYTE
 * BCD expansion at 0x6001 and TAIL JUMPS to 0x0583. The jump is not a call:
 * 0x0583's `ret` returns to *this* routine's caller, so sub_0616 has no
 * `ret` of its own. Translating the tail jump as a call would return here
 * and then fall off the end of the routine.
 *
 * DE = 0xFFE0 is -32: each successive digit is written one tilemap ROW back,
 * which is what "vertical" text means in the unrotated tilemap space.
 */
export function sub_0616(m) {
  const { regs } = m;

  regs.a = 0x05;
  m.step(0x0618, 7);
  m.push16(0x061b);
  m.step(0x05e9, 17);
  handler_05e9(m);

  regs.hl = 0x6001;
  m.step(0x061e, 10);
  regs.de = 0xffe0;
  m.step(0x0621, 10);
  regs.ix = 0x74bf;
  m.step(0x0625, 14); // DD-prefixed ld ix,nn
  regs.b = 0x01;
  m.step(0x0627, 7);
  m.step(0x0583, 10); // jp -- a TAIL jump, no return address pushed
  loop_0583(m);
}
