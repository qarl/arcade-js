// SPDX-License-Identifier: GPL-3.0-only
/**
 * Translated boot path: Z80 reset through main-loop entry.
 *
 * Translated in EXECUTION ORDER from the reset vector. Every routine below
 * carries its ROM address range and the original mnemonics so fidelity is
 * auditable line by line.
 *
 * Register state is threaded through `Regs` rather than JS locals because the
 * original passes values between routines in registers.
 */

import { mainLoop } from "./mainloop.js";

/**
 * reset -- ROM 0x0000-0x0005
 *
 *   0000  3e 00        ld   a,0x00
 *   0002  32 84 7d     ld   (0x7d84),a
 *   0005  c3 66 02     jp   0x0266
 *
 * Clears the vblank NMI mask before anything else: interrupts off during
 * setup. 0x7D84 is the NMI mask (confirmed against MAME's driver:
 * `map(0x7d84,0x7d84).w(nmi_mask_w)`), not an ls259.6h latch bit.
 */
export function reset(m) {
  bootOnly(m);
  // 0x02BC falls THROUGH into the main loop at 0x02BD -- there is no jump
  // instruction, the code simply continues. This was missing, and its absence
  // made the ENTIRE main loop and NMI path dead code while the state diff
  // stayed green -- because the frames it compares all end before boot does.
  // A passing gate said nothing about code it never reached.
  mainLoop(m);
}

/**
 * Reset through the end of boot (0x02BC), stopping before the fall-through.
 *
 * Not a ROM boundary -- the hardware just keeps going. It exists because
 * `reset()` faithfully never returns, so tests and diagnostics that want
 * "the machine as boot left it" need somewhere to stop.
 */
export function bootOnly(m) {
  const { regs } = m;
  regs.a = 0x00;
  m.tick(7); // ld a,0x00
  m.mem.write8(0x7d84, regs.a, 10); // ld (nn),a
  m.tick(13); // ld (0x7d84),a
  m.tick(10); // jp 0x0266
  bootInit(m);
}

/**
 * bootInit -- ROM 0x0266-0x02BC
 *
 *   0266  06 10        ld   b,0x10
 *   0268  21 00 60     ld   hl,0x6000
 *   026b  af           xor  a
 *   026c  4f           ld   c,a              ; loc_026c
 *   026d  77           ld   (hl),a           ; loc_026d
 *   026e  23           inc  hl
 *   026f  0d           dec  c
 *   0270  20 fb        jr   nz,0x026d
 *   0272  10 f8        djnz 0x026c
 *   0274  06 04        ld   b,0x04
 *   0276  21 00 70     ld   hl,0x7000
 *   0279  4f           ld   c,a              ; loc_0279
 *   027a  77           ld   (hl),a           ; loc_027a
 *   027b  23           inc  hl
 *   027c  0d           dec  c
 *   027d  20 fb        jr   nz,0x027a
 *   027f  10 f8        djnz 0x0279
 *   0281  06 04        ld   b,0x04
 *   0283  3e 10        ld   a,0x10
 *   0285  21 00 74     ld   hl,0x7400
 *   0288  0e 00        ld   c,0x00           ; loc_0288
 *   028a  77           ld   (hl),a           ; loc_028a
 *   028b  23           inc  hl
 *   028c  0d           dec  c
 *   028d  20 fb        jr   nz,0x028a
 *   028f  10 f7        djnz 0x0288
 *   0291  21 c0 60     ld   hl,0x60c0
 *   0294  06 40        ld   b,0x40
 *   0296  3e ff        ld   a,0xff
 *   0298  77           ld   (hl),a           ; loc_0298
 *   0299  23           inc  hl
 *   029a  10 fc        djnz 0x0298
 *   029c  3e c0        ld   a,0xc0
 *   029e  32 b0 60     ld   (0x60b0),a
 *   02a1  32 b1 60     ld   (0x60b1),a
 *   02a4  af           xor  a
 *   02a5  32 83 7d     ld   (0x7d83),a
 *   02a8  32 86 7d     ld   (0x7d86),a
 *   02ab  32 87 7d     ld   (0x7d87),a
 *   02ae  3c           inc  a
 *   02af  32 82 7d     ld   (0x7d82),a
 *   02b2  31 00 6c     ld   sp,0x6c00
 *   02b5  cd 1c 01     call 0x011c
 *   02b8  3e 01        ld   a,0x01
 *   02ba  32 84 7d     ld   (0x7d84),a
 *                      ; falls through into the main loop at 0x02bd
 *
 * NOTE ON THE FIRST CLEAR LOOP: `dec c / jr nz` with C entering at 0 runs 256
 * times (0 decrements to 0xFF), so the loop is 16 x 256 = 4096 bytes and
 * clears 0x6000-0x6FFF. Work RAM is only 0x6000-0x6BFF, so it over-runs real
 * RAM by 0x400 bytes; those writes are discarded and counted (see
 * DISCARD_BASE in boards/dkong/memory.js). The 0x6BFF bound is right -- `ld sp,0x6c00`
 * below puts the stack top at 0x6BFF, which would be impossible if RAM ran to
 * 0x6FFF.
 *
 * Video RAM is filled with 0x10, NOT zero. (Power-on VRAM is all zeroes, but
 * that is the state sampled *before* any instruction runs; by the time
 * boot finishes, every cell holds tile 0x10.)
 */
export function bootInit(m) {
  const { regs, mem } = m;

  // 0266-0272: clear 16 x 256 bytes from 0x6000.
  regs.b = 0x10;
  m.tick(7); // ld b,0x10
  regs.hl = 0x6000;
  m.tick(10); // ld hl,0x6000
  regs.xor(regs.a); // xor a -- A = 0, and sets flags
  m.tick(4);
  do {
    regs.c = regs.a; // loc_026c
    m.tick(4); // ld c,a -- runs once per OUTER iteration, so x16
    do {
      mem.write8(regs.hl, regs.a); // loc_026d
      m.tick(7); // ld (hl),a
      regs.hl = (regs.hl + 1) & 0xffff;
      m.tick(6); // inc hl
      regs.c = regs.dec8(regs.c);
      m.tick(4); // dec c
      m.tick(regs.fNZ ? 12 : 7); // jr nz -- 12 taken, 7 not
    } while (regs.fNZ);
    regs.djnz();
    m.tick(regs.b !== 0 ? 13 : 8); // djnz -- 13 taken, 8 not
  } while (regs.b !== 0);

  // 0274-027F: clear 4 x 256 = 1024 bytes of sprite RAM (0x7000-0x73FF).
  regs.b = 0x04;
  m.tick(7); // ld b,0x04
  regs.hl = 0x7000;
  m.tick(10); // ld hl,0x7000
  do {
    regs.c = regs.a; // loc_0279, A is still 0
    m.tick(4); // ld c,a
    do {
      mem.write8(regs.hl, regs.a); // loc_027a
      m.tick(7); // ld (hl),a
      regs.hl = (regs.hl + 1) & 0xffff;
      m.tick(6); // inc hl
      regs.c = regs.dec8(regs.c);
      m.tick(4); // dec c
      m.tick(regs.fNZ ? 12 : 7); // jr nz
    } while (regs.fNZ);
    regs.djnz();
    m.tick(regs.b !== 0 ? 13 : 8); // djnz
  } while (regs.b !== 0);

  // 0281-028F: fill 4 x 256 = 1024 bytes of video RAM (0x7400-0x77FF) with
  // tile 0x10 -- not zero.
  regs.b = 0x04;
  m.tick(7); // ld b,0x04
  regs.a = 0x10;
  m.tick(7); // ld a,0x10
  regs.hl = 0x7400;
  m.tick(10); // ld hl,0x7400
  do {
    regs.c = 0x00; // loc_0288 -- explicit, since A is no longer 0
    m.tick(7); // ld c,0x00 -- 7 not 4: immediate, not register
    do {
      mem.write8(regs.hl, regs.a); // loc_028a
      m.tick(7); // ld (hl),a
      regs.hl = (regs.hl + 1) & 0xffff;
      m.tick(6); // inc hl
      regs.c = regs.dec8(regs.c);
      m.tick(4); // dec c
      m.tick(regs.fNZ ? 12 : 7); // jr nz
    } while (regs.fNZ);
    regs.djnz();
    m.tick(regs.b !== 0 ? 13 : 8); // djnz
  } while (regs.b !== 0);

  // 0291-029B: fill 0x60C0-0x60FF with 0xFF (0x40 bytes).
  regs.hl = 0x60c0;
  m.tick(10); // ld hl,0x60c0
  regs.b = 0x40;
  m.tick(7); // ld b,0x40
  regs.a = 0xff;
  m.tick(7); // ld a,0xff
  do {
    mem.write8(regs.hl, regs.a); // loc_0298
    m.tick(7); // ld (hl),a
    regs.hl = (regs.hl + 1) & 0xffff;
    m.tick(6); // inc hl
    regs.djnz();
    m.tick(regs.b !== 0 ? 13 : 8); // djnz
  } while (regs.b !== 0);

  // 029C-02A3: task-list pointers both start at 0xC0.
  regs.a = 0xc0;
  m.tick(7); // ld a,0xc0
  mem.write8(0x60b0, regs.a);
  m.tick(13); // ld (0x60b0),a
  mem.write8(0x60b1, regs.a);
  m.tick(13); // ld (0x60b1),a

  // 02A4-02B1: hardware control bits.
  regs.xor(regs.a); // A = 0
  m.tick(4); // xor a
  mem.write8(0x7d83, regs.a, 10); // sprite bank   = 0
  m.tick(13);
  mem.write8(0x7d86, regs.a, 10); // palette bank0 = 0
  m.tick(13);
  mem.write8(0x7d87, regs.a, 10); // palette bank1 = 0
  m.tick(13);
  regs.a = regs.inc8(regs.a); // A = 1
  m.tick(4); // inc a
  mem.write8(0x7d82, regs.a, 10); // flipscreen    = 1
  m.tick(13);

  // 02B2: stack grows down from 0x6C00, so the first push writes 0x6BFF --
  // the top byte of work RAM.
  regs.sp = 0x6c00;
  m.tick(10); // ld sp,0x6c00

  // 02B5: call 0x011c -- pushes 0x02B8, the address of the next instruction.
  m.push16(0x02b8);
  m.tick(17); // call nn
  sub_011c(m);

  // 02B8-02BC: re-enable the vblank NMI. From here the NMI can fire.
  regs.a = 0x01;
  m.tick(7); // ld a,0x01
  mem.write8(0x7d84, regs.a, 10);
  m.tick(13); // ld (0x7d84),a

}

/**
 * sub_011c -- ROM 0x011C-0x0137  "silence the sound hardware"
 *
 *   011c  06 08        ld   b,0x08
 *   011e  af           xor  a
 *   011f  21 00 7d     ld   hl,0x7d00
 *   0122  11 80 60     ld   de,0x6080
 *   0125  77           ld   (hl),a           ; loc_0125
 *   0126  12           ld   (de),a
 *   0127  2c           inc  l
 *   0128  1c           inc  e
 *   0129  10 fa        djnz 0x0125
 *   012b  06 04        ld   b,0x04
 *   012d  12           ld   (de),a           ; loc_012d
 *   012e  1c           inc  e
 *   012f  10 fc        djnz 0x012d
 *   0131  32 80 7d     ld   (0x7d80),a
 *   0134  32 00 7c     ld   (0x7c00),a
 *   0137  c9           ret
 *
 * Zeroes all eight ls259.6h latch bits (0x7D00-0x7D07) while keeping a shadow
 * copy in work RAM at 0x6080-0x6087, then zeroes 0x6088-0x608B, the audio IRQ
 * (0x7D80) and the ls175.3d sound latch (0x7C00).
 *
 * The shadow copy matters for us: the latch is write-only from the Z80's
 * side, so the ROM keeps its own readable mirror in RAM. That mirror lands in
 * the state dump, which means the state diff covers the latch contents even
 * though the hardware register itself is invisible.
 *
 * Note `inc l` / `inc e` (8-bit) rather than `inc hl` / `inc de`: the high
 * bytes never change here, and translating them as 16-bit increments would be
 * wrong the moment a low byte wrapped.
 */
export function sub_011c(m) {
  const { regs, mem } = m;

  regs.b = 0x08;
  m.tick(7); // ld b,0x08
  regs.xor(regs.a); // A = 0
  m.tick(4); // xor a
  regs.hl = 0x7d00;
  m.tick(10); // ld hl,0x7d00
  regs.de = 0x6080;
  m.tick(10); // ld de,0x6080

  do {
    mem.write8(regs.hl, regs.a, 4); // loc_0125 -- ls259.6h bit, ld (hl),a
    m.tick(7); // ld (hl),a
    mem.write8(regs.de, regs.a); // shadow copy in work RAM
    m.tick(7); // ld (de),a
    regs.l = regs.inc8(regs.l); // inc l, NOT inc hl -- and INC sets flags
    m.tick(4);
    regs.e = regs.inc8(regs.e); // inc e, NOT inc de
    m.tick(4);
    regs.djnz();
    m.tick(regs.b !== 0 ? 13 : 8); // djnz
  } while (regs.b !== 0);

  regs.b = 0x04;
  m.tick(7); // ld b,0x04
  do {
    mem.write8(regs.de, regs.a); // loc_012d -- 0x6088-0x608B
    m.tick(7); // ld (de),a
    regs.e = regs.inc8(regs.e);
    m.tick(4); // inc e
    regs.djnz();
    m.tick(regs.b !== 0 ? 13 : 8); // djnz
  } while (regs.b !== 0);

  mem.write8(0x7d80, regs.a, 10); // audio IRQ off
  m.tick(13);
  mem.write8(0x7c00, regs.a, 10); // ls175.3d sound latch cleared
  m.tick(13);

  m.pop16(); // 0137: ret
  m.tick(10);
}
