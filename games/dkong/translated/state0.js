// SPDX-License-Identifier: GPL-3.0-only

/**
 * Game-state 0 handler and its subtree.
 *
 * Reached from the NMI's `rst 0x28` dispatch on 0x6005 (entry 0 of the table
 * at 0x00CA). This is the attract-mode init: clear the playfield, seed the
 * task list, and queue the first tasks.
 *
 * Every routine carries its ROM range and original mnemonics.
 */

import { NotImplemented } from "../../../boards/dkong/io.js";
import { entry_06b8, sub_0030, sub_0010, sub_0008, handler_05e9, sub_0616 } from "./mainloop.js";
// Circular with nmi.js (which imports handlers from here); safe because these
// are hoisted function declarations called only at run time, never at module
// init. loc_0038 is the `rst 0x38` entry; sub_0057 the pseudo-random stir.
import { loc_0038, sub_0057, sub_0018, sub_0020, sub_0da7, sub_003d, sub_0028 } from "./nmi.js";
import { sub_011c } from "./boot.js";

/**
 * handler_01c3 -- ROM 0x01C3-0x0206  (game state 0)
 *
 *   01c3  cd 74 08     call 0x0874
 *   01c6  21 ba 01     ld   hl,0x01ba
 *   01c9  11 b2 60     ld   de,0x60b2
 *   01cc  01 09 00     ld   bc,0x0009
 *   01cf  ed b0        ldir
 *   01d1  3e 01        ld   a,0x01
 *   01d3  32 07 60     ld   (0x6007),a
 *   01d6  32 29 62     ld   (0x6229),a
 *   01d9  32 28 62     ld   (0x6228),a
 *   01dc  cd b8 06     call 0x06b8
 *   01df  cd 07 02     call 0x0207
 *   01e2  3e 01        ld   a,0x01
 *   01e4  32 82 7d     ld   (0x7d82),a
 *   01e7  32 05 60     ld   (0x6005),a
 *   01ea  32 27 62     ld   (0x6227),a
 *   01ed  af           xor  a
 *   01ee  32 0a 60     ld   (0x600a),a
 *   01f1  cd 53 0a     call 0x0a53
 *   01f4  11 04 03     ld   de,0x0304
 *   01f7  cd 9f 30     call 0x309f
 *   01fa  11 02 02     ld   de,0x0202
 *   01fd  cd 9f 30     call 0x309f
 *   0200  11 00 02     ld   de,0x0200
 *   0203  cd 9f 30     call 0x309f
 *   0206  c9           ret
 *
 * The `ldir` copies NINE BYTES OF DATA from ROM 0x01BA to 0x60B2 -- the
 * task-list area. That is why 0x01BA-0x01C2 shows as unreached in the
 * coverage map: it is data, not unexercised code, and it sits immediately
 * before this handler.
 *
 * Sets game state 0x6005 to 1, so the NEXT vblank dispatches through a
 * different table entry -- this handler runs once.
 */
export function handler_01c3(m) {
  const { regs, mem } = m;

  m.push16(0x01c6);
  m.step(0x0874, 17);
  sub_0874(m);

  regs.hl = 0x01ba;
  m.step(0x01c9, 10);
  regs.de = 0x60b2;
  m.step(0x01cc, 10);
  regs.bc = 0x0009;
  m.step(0x01cf, 10);
  m.ldir(0x01d1);

  regs.a = 0x01;
  m.step(0x01d3, 7);
  mem.write8(0x6007, regs.a);
  m.step(0x01d6, 13);
  mem.write8(0x6229, regs.a);
  m.step(0x01d9, 13);
  mem.write8(0x6228, regs.a);
  m.step(0x01dc, 13);

  // A real `call` here, unlike sub_0350's tail jump into the same routine.
  // Same implementation; only the stack differs, which is exactly why the
  // tracer misclassifies 0x06B8 as never-returning (see README known issues).
  m.push16(0x01df);
  m.step(0x06b8, 17);
  entry_06b8(m);

  m.push16(0x01e2);
  m.step(0x0207, 17);
  sub_0207(m);

  regs.a = 0x01;
  m.step(0x01e4, 7);
  mem.write8(0x7d82, regs.a, 10); // flipscreen = 1
  m.step(0x01e7, 13);
  mem.write8(0x6005, regs.a); // advance the game state
  m.step(0x01ea, 13);
  mem.write8(0x6227, regs.a);
  m.step(0x01ed, 13);
  regs.xor(regs.a);
  m.step(0x01ee, 4);
  mem.write8(0x600a, regs.a);
  m.step(0x01f1, 13);

  m.push16(0x01f4);
  m.step(0x0a53, 17);
  sub_0a53(m);

  // Three tasks queued, each a 16-bit (D,E) pair.
  for (const [de, after, next] of [
    [0x0304, 0x01f7, 0x01fa],
    [0x0202, 0x01fd, 0x0200],
    [0x0200, 0x0203, 0x0206],
  ]) {
    regs.de = de;
    m.step(after, 10);
    m.push16(next);
    m.step(0x309f, 17);
    sub_309f(m);
  }

  m.ret();
}

/**
 * sub_0514 -- ROM 0x0514-0x051B  (descending 3-cell fill; HL,A,DE live-in)
 *
 *   0514  06 03        ld   b,0x03       ; PROLOGUE -- runs once
 *   0516  77           ld   (hl),a       ; loc_0516 -- the djnz target
 *   0517  19           add  hl,de
 *   0518  3d           dec  a
 *   0519  10 fb        djnz 0x0516
 *   051b  c9           ret
 *
 * Flags reaching the caller: S/Z/H/PV/N from the final `dec a`, C from the final
 * `add hl,de` (djnz and ret are flag-neutral).
 */
export function sub_0514(m) {
  const { regs, mem } = m;

  regs.b = 0x03;
  m.step(0x0516, 7); // ld b,0x03 -- PROLOGUE, outside the loop

  do {
    // loc_0516 -- the djnz target is HERE, not the routine entry.
    mem.write8(regs.hl, regs.a);
    m.step(0x0517, 7); // ld (hl),a
    regs.addHl(regs.de); // sets H/N/C, preserves S/Z/PV; the C is live at the ret
    m.step(0x0518, 11); // add hl,de
    regs.a = regs.dec8(regs.a);
    m.step(0x0519, 4); // dec a
    regs.djnz();
    m.step(regs.b !== 0 ? 0x0516 : 0x051b, regs.b !== 0 ? 13 : 8); // djnz 0x0516
  } while (regs.b !== 0);

  m.ret(); // ret (0x051B)
}
/**
 * entry_03fb -- ATTRACT / intro animation + colour-cycle driver.  ROM 0x03FB-0x0513.
 * ONE caller: loc_197a @0x19B0.
 *
 * Reads (0x6227) mode selector; drives a private frame counter (0x6390), animation-table
 * copies (call 0x004e), rst 0x38 sprite offsets (loc_0038, a CALL that returns -- NOT a
 * skip), and colour-column writes (sub_0514) into colour RAM. THREE ret exits (0x04B1 ret z,
 * 0x04B6 ret nz, 0x04BD ret). Flattened from the draft's nested-fn form to module-level
 * loc_* helpers (tree idiom); backward rejoins (0x0450, 0x04AC, 0x04E1, 0x04F9) are plain calls.
 */
export function entry_03fb(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6227);
  m.step(0x03fe, 13); // ld a,(0x6227)
  regs.cp(0x02);
  m.step(0x0400, 7); // cp 0x02
  if (regs.fNZ) { m.step(0x0413, 10); return loc_0413(m); } // jp nz,0x0413
  m.step(0x0403, 10); // jp nz NOT taken -> (6227)==2 arm

  // ---- (6227)==2 arm (COLD on tape) ----
  regs.hl = 0x6908;
  m.step(0x0406, 10); // ld hl,0x6908
  regs.a = mem.read8(0x63a3);
  m.step(0x0409, 13); // ld a,(0x63a3)
  regs.c = regs.a;
  m.step(0x040a, 4); // ld c,a
  m.push16(0x040b); m.step(0x0038, 11); loc_0038(m); // rst 0x38 = CALL loc_0038
  regs.a = mem.read8(0x6910);
  m.step(0x040e, 13); // ld a,(0x6910)
  regs.sub(0x3b);
  m.step(0x0410, 7); // sub 0x3b
  mem.write8(0x63b7, regs.a);
  m.step(0x0413, 13); // ld (0x63b7),a -- falls into 0x0413
  return loc_0413(m);
}

/** loc_0413 -- frame flags: gate on (0x6391)/(0x601A), then fall into loc_0426. */
function loc_0413(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6391);
  m.step(0x0416, 13); // ld a,(0x6391)
  regs.and(regs.a);
  m.step(0x0417, 4); // and a
  if (regs.fNZ) { m.step(0x0426, 10); return loc_0426(m); } // jp nz,0x0426
  m.step(0x041a, 10);
  regs.a = mem.read8(0x601a);
  m.step(0x041d, 13); // ld a,(0x601a)
  regs.and(regs.a);
  m.step(0x041e, 4); // and a
  if (regs.fNZ) { m.step(0x0486, 10); return loc_0486(m); } // jp nz,0x0486
  m.step(0x0421, 10);
  regs.a = 0x01;
  m.step(0x0423, 7); // ld a,0x01
  mem.write8(0x6391, regs.a);
  m.step(0x0426, 13); // ld (0x6391),a -- falls into 0x0426
  return loc_0426(m);
}

/** loc_0426 -- the frame counter (0x6390); 0x80 -> reset (loc_0464); 32-frame boundary -> table copy. */
function loc_0426(m) {
  const { regs, mem } = m;
  regs.hl = 0x6390;
  m.step(0x0429, 10); // ld hl,0x6390
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x042a, 11); // inc (hl) -- (0x6390)++
  regs.a = mem.read8(regs.hl);
  m.step(0x042b, 7); // ld a,(hl)
  regs.cp(0x80);
  m.step(0x042d, 7); // cp 0x80
  if (regs.fZ) { m.step(0x0464, 10); return loc_0464(m); } // jp z,0x0464
  m.step(0x0430, 10);
  regs.a = mem.read8(0x6393);
  m.step(0x0433, 13); // ld a,(0x6393)
  regs.and(regs.a);
  m.step(0x0434, 4); // and a
  if (regs.fNZ) { m.step(0x0486, 10); return loc_0486(m); } // jp nz,0x0486
  m.step(0x0437, 10);
  regs.a = mem.read8(regs.hl); // hl still 0x6390
  m.step(0x0438, 7); // ld a,(hl)
  regs.b = regs.a;
  m.step(0x0439, 4); // ld b,a
  regs.and(0x1f);
  m.step(0x043b, 7); // and 0x1f
  if (regs.fNZ) { m.step(0x0486, 10); return loc_0486(m); } // jp nz,0x0486
  m.step(0x043e, 10); // NOT taken: 32-frame boundary
  regs.hl = 0x39cf;
  m.step(0x0441, 10); // ld hl,0x39cf
  const b5 = regs.bit(5, regs.b);
  m.step(0x0443, 8); // bit 5,b
  if (b5) {
    m.step(0x0448, 12); // jr nz,0x0448 (taken)
  } else {
    m.step(0x0445, 7); // jr nz NOT taken
    regs.hl = 0x39f7;
    m.step(0x0448, 10); // ld hl,0x39f7
  }
  m.push16(0x044b); m.step(0x004e, 17); sub_004e(m); // call 0x004e
  regs.a = 0x03;
  m.step(0x044d, 7); // ld a,0x03
  mem.write8(0x6082, regs.a);
  m.step(0x0450, 13); // ld (0x6082),a -- falls into 0x0450
  return loc_0450(m);
}

/** loc_0450 -- (0x6227) bit dispatch: bit0==0 -> loc_0478; bit1 -> loc_0486; else rst 0x38 sprite. */
function loc_0450(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6227);
  m.step(0x0453, 13); // ld a,(0x6227)
  regs.rrca();
  m.step(0x0454, 4); // rrca -- C = (6227) bit0
  if (regs.fNC) { m.step(0x0478, 10); return loc_0478(m); } // jp nc,0x0478
  m.step(0x0457, 10); // bit0==1
  regs.rrca();
  m.step(0x0458, 4); // rrca -- C = (6227) bit1
  if (regs.fC) { m.step(0x0486, 10); return loc_0486(m); } // jp c,0x0486
  m.step(0x045b, 10); // bit1==0
  regs.hl = 0x690b;
  m.step(0x045e, 10); // ld hl,0x690b
  regs.c = 0xfc;
  m.step(0x0460, 7); // ld c,0xfc (-4)
  m.push16(0x0461); m.step(0x0038, 11); loc_0038(m); // rst 0x38 = CALL loc_0038
  m.step(0x0486, 10); // jp 0x0486
  return loc_0486(m);
}

/** loc_0464 -- counter hit 0x80 -> reset (0x6390)/(0x6391); (0x6393)==0 -> table copy; back to loc_0450. */
function loc_0464(m) {
  const { regs, mem } = m;
  regs.xor(regs.a);
  m.step(0x0465, 4); // xor a
  mem.write8(regs.hl, regs.a); // hl == 0x6390
  m.step(0x0466, 7); // ld (hl),a -- (0x6390)=0
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0467, 6); // inc hl -> 0x6391
  mem.write8(regs.hl, regs.a);
  m.step(0x0468, 7); // ld (hl),a -- (0x6391)=0
  regs.a = mem.read8(0x6393);
  m.step(0x046b, 13); // ld a,(0x6393)
  regs.and(regs.a);
  m.step(0x046c, 4); // and a
  if (regs.fNZ) { m.step(0x0486, 10); return loc_0486(m); } // jp nz,0x0486
  m.step(0x046f, 10); // (6393)==0 (COLD arm)
  regs.hl = 0x385c;
  m.step(0x0472, 10); // ld hl,0x385c
  m.push16(0x0475); m.step(0x004e, 17); sub_004e(m); // call 0x004e
  m.step(0x0450, 10); // jp 0x0450 (BACKWARD rejoin, not a loop)
  return loc_0450(m);
}

/** loc_0478 -- (6227) bit0==0 arm (COLD): rst 0x38 sprite offset, then loc_0486. */
function loc_0478(m) {
  const { regs, mem } = m;
  regs.hl = 0x6908;
  m.step(0x047b, 10); // ld hl,0x6908
  regs.c = 0x44;
  m.step(0x047d, 7); // ld c,0x44
  regs.rrca();
  m.step(0x047e, 4); // rrca -- C = (6227) bit1
  if (regs.fNC) {
    m.step(0x0485, 10); // jp nc,0x0485 (taken)
  } else {
    m.step(0x0481, 10); // bit1==1
    regs.a = mem.read8(0x63b7);
    m.step(0x0484, 13); // ld a,(0x63b7)
    regs.c = regs.a;
    m.step(0x0485, 4); // ld c,a
  }
  m.push16(0x0486); m.step(0x0038, 11); loc_0038(m); // rst 0x38 -> falls into 0x0486
  return loc_0486(m);
}

/** loc_0486 -- colour tail (reached 7 ways): C=frame counter; (6227)==4 -> loc_04be blink block. */
function loc_0486(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6390);
  m.step(0x0489, 13); // ld a,(0x6390)
  regs.c = regs.a;
  m.step(0x048a, 4); // ld c,a -- C = frame counter
  regs.de = 0x0020;
  m.step(0x048d, 10); // ld de,0x0020 (stride for sub_0514)
  regs.a = mem.read8(0x6227);
  m.step(0x0490, 13); // ld a,(0x6227)
  regs.cp(0x04);
  m.step(0x0492, 7); // cp 0x04
  if (regs.fZ) { m.step(0x04be, 10); return loc_04be(m); } // jp z,0x04be
  m.step(0x0495, 10); // (6227)!=4
  regs.a = regs.c;
  m.step(0x0496, 4); // ld a,c
  regs.and(regs.a);
  m.step(0x0497, 4); // and a
  if (regs.fZ) { m.step(0x04a1, 10); return loc_04a1(m); } // jp z,0x04a1
  m.step(0x049a, 10); // counter != 0
  regs.a = 0xef;
  m.step(0x049c, 7); // ld a,0xef
  const b6 = regs.bit(6, regs.c);
  m.step(0x049e, 8); // bit 6,c
  if (b6) { m.step(0x04a3, 10); return loc_04a3(m); } // jp nz,0x04a3 (A stays 0xef)
  m.step(0x04a1, 10); // bit6==0 -> fall to 0x04a1
  return loc_04a1(m);
}

/** loc_04a1 -- A = 0x10, then fall into loc_04a3. */
function loc_04a1(m) {
  const { regs } = m;
  regs.a = 0x10;
  m.step(0x04a3, 7); // ld a,0x10 -- falls into 0x04a3
  return loc_04a3(m);
}

/** loc_04a3 -- write colour column (sub_0514), then read (0x6905) for the blink flip. */
function loc_04a3(m) {
  const { regs, mem } = m;
  regs.hl = 0x75c4;
  m.step(0x04a6, 10); // ld hl,0x75c4
  m.push16(0x04a9); m.step(0x0514, 17); sub_0514(m); // call 0x0514
  regs.a = mem.read8(0x6905);
  m.step(0x04ac, 13); // ld a,(0x6905) -- falls into loc_04ac
  return loc_04ac(m);
}

/** loc_04ac -- SHARED store of (0x6905) + the 3-way blink exit (jp target from 0x04EE, 0x0506). */
function loc_04ac(m) {
  const { regs, mem } = m;
  mem.write8(0x6905, regs.a);
  m.step(0x04af, 13); // ld (0x6905),a
  regs.bit(6, regs.c);
  m.step(0x04b1, 8); // bit 6,c
  if (regs.fZ) { m.ret(11); return; } // ret z (EXIT-1)
  m.step(0x04b2, 5); // ret z NOT taken
  regs.b = regs.a;
  m.step(0x04b3, 4); // ld b,a
  regs.a = regs.c;
  m.step(0x04b4, 4); // ld a,c
  regs.and(0x07);
  m.step(0x04b6, 7); // and 0x07
  if (regs.fNZ) { m.ret(11); return; } // ret nz (EXIT-2)
  m.step(0x04b7, 5); // ret nz NOT taken
  regs.a = regs.b;
  m.step(0x04b8, 4); // ld a,b
  regs.xor(0x03);
  m.step(0x04ba, 7); // xor 0x03 -- flip bits 0,1 of (6905)
  mem.write8(0x6905, regs.a);
  m.step(0x04bd, 13); // ld (0x6905),a
  m.ret(10); // ret (EXIT-3)
}

/** loc_04be -- (6227)==4 blink block (COLD/latent): two colour writes, then bit6/X routing. */
function loc_04be(m) {
  const { regs, mem } = m;
  regs.a = 0x10;
  m.step(0x04c0, 7); // ld a,0x10
  regs.hl = 0x7623;
  m.step(0x04c3, 10); // ld hl,0x7623
  m.push16(0x04c6); m.step(0x0514, 17); sub_0514(m); // call 0x0514
  regs.hl = 0x7583;
  m.step(0x04c9, 10); // ld hl,0x7583
  m.push16(0x04cc); m.step(0x0514, 17); sub_0514(m); // call 0x0514
  regs.bit(6, regs.c);
  m.step(0x04ce, 8); // bit 6,c
  if (regs.fZ) { m.step(0x0509, 10); return loc_0509(m); } // jp z,0x0509
  m.step(0x04d1, 10);
  regs.a = mem.read8(0x6203);
  m.step(0x04d4, 13); // ld a,(0x6203)
  regs.cp(0x80);
  m.step(0x04d6, 7); // cp 0x80
  if (regs.fNC) { m.step(0x04f1, 10); return loc_04f1(m); } // jp nc,0x04f1
  m.step(0x04d9, 10); // (6203) < 0x80
  regs.a = 0xdf;
  m.step(0x04db, 7); // ld a,0xdf
  regs.hl = 0x7623;
  m.step(0x04de, 10); // ld hl,0x7623
  m.push16(0x04e1); m.step(0x0514, 17); sub_0514(m); // call 0x0514 -> falls into 0x04e1
  return loc_04e1(m);
}

/** loc_04e1 -- blink ON: set bit7 of (0x6901) and (0x6905); back to loc_04ac (jp from 0x0511). */
function loc_04e1(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6901);
  m.step(0x04e4, 13); // ld a,(0x6901)
  regs.or(0x80);
  m.step(0x04e6, 7); // or 0x80
  mem.write8(0x6901, regs.a);
  m.step(0x04e9, 13); // ld (0x6901),a
  regs.a = mem.read8(0x6905);
  m.step(0x04ec, 13); // ld a,(0x6905)
  regs.or(0x80);
  m.step(0x04ee, 7); // or 0x80
  m.step(0x04ac, 10); // jp 0x04ac (BACKWARD rejoin)
  return loc_04ac(m);
}

/** loc_04f1 -- colour write then fall into loc_04f9 (blink OFF). */
function loc_04f1(m) {
  const { regs, mem } = m;
  regs.a = 0xef;
  m.step(0x04f3, 7); // ld a,0xef
  regs.hl = 0x7583;
  m.step(0x04f6, 10); // ld hl,0x7583
  m.push16(0x04f9); m.step(0x0514, 17); sub_0514(m); // call 0x0514 -> falls into 0x04f9
  return loc_04f9(m);
}

/** loc_04f9 -- blink OFF: clear bit7 of (0x6901) and (0x6905); back to loc_04ac (jp nc from 0x050E). */
function loc_04f9(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6901);
  m.step(0x04fc, 13); // ld a,(0x6901)
  regs.and(0x7f);
  m.step(0x04fe, 7); // and 0x7f
  mem.write8(0x6901, regs.a);
  m.step(0x0501, 13); // ld (0x6901),a
  regs.a = mem.read8(0x6905);
  m.step(0x0504, 13); // ld a,(0x6905)
  regs.and(0x7f);
  m.step(0x0506, 7); // and 0x7f
  m.step(0x04ac, 10); // jp 0x04ac (BACKWARD rejoin)
  return loc_04ac(m);
}

/** loc_0509 -- (6227)==4, bit6 clear arm: route on X (0x6203) to loc_04f9 / loc_04e1. */
function loc_0509(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6203);
  m.step(0x050c, 13); // ld a,(0x6203)
  regs.cp(0x80);
  m.step(0x050e, 7); // cp 0x80
  if (regs.fNC) { m.step(0x04f9, 10); return loc_04f9(m); } // jp nc,0x04f9
  m.step(0x0511, 10); // (6203) < 0x80
  m.step(0x04e1, 10); // jp 0x04e1 (BACKWARD rejoin)
  return loc_04e1(m);
}

/** loc_06fe's inline jump table -- the site string names the dispatch base. */
const DISPATCH_TABLE_0702 = "0x0702 (0x600A game sub-state)";

/**
 * loc_06fe -- ROM 0x06FE-0x0701  (rst 0x28 dispatch on 0x600A, table at 0x0702)
 *
 *   06fe  3a 0a 60     ld   a,(0x600a)
 *   0701  ef           rst  0x28        ; -> table 0x0702-0x073B, 29 entries
 *
 * SIX ENTRIES ARE 0x0000 (idx 9, 24-28) and A is unchecked (no range check) --
 * a null or out-of-range selector dispatches to 0x0000 / off the table. The ROM
 * has no guard; dispatchGameState surfaces an unimplemented/null target as a
 * loud throw rather than a silent reset.
 */
export function loc_06fe(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x600a);
  m.step(0x0701, 13); // ld a,(0x600a)

  m.push16(0x0702); // rst 0x28 pushes its return address = the TABLE BASE
  m.step(0x0028, 11);
  sub_0028(m, DISPATCH_TABLE_0702); // reads the table from ROM; ends in jp (hl)
}

/**
 * loc_07c3 -- ROM 0x07C3-0x07CA  (0x0748 dispatch table, entry index 5)
 *
 *   07c3  cd 74 08     call 0x0874        ; init/fill; takes NO register input
 *   07c6  21 0a 60     ld   hl,0x600a
 *   07c9  34           inc  (hl)          ; advance the 0x600A sub-state -- RMW MEMORY
 *   07ca  c9           ret
 */
export function loc_07c3(m) {
  const { regs, mem } = m;

  m.push16(0x07c6); // call 0x0874 pushes the return address 0x07C6
  m.step(0x0874, 17); // call 0x0874
  sub_0874(m);

  regs.hl = 0x600a;
  m.step(0x07c9, 10); // ld hl,0x600a
  regs.incMem8(mem, regs.hl); // inc (hl) -- flag-correct RMW on the 0x600A byte
  m.step(0x07ca, 11); // inc (hl)

  m.ret(); // ret (0x07CA)
}

/**
 * loc_084b -- ROM 0x084B-0x0851  (rst 0x20 gate, then clears 0x600A)
 *
 *   084b  e7           rst  0x20          ; skip unless BOTH counters expire
 *   084c  21 0a 60     ld   hl,0x600a
 *   084f  36 00        ld   (hl),0x00     ; 0x600A = 0
 *   0851  c9           ret
 */
export function loc_084b(m) {
  const { regs, mem } = m;

  m.push16(0x084c); // rst 0x20 PUSHES its return address (the rst's own semantics)
  m.step(0x0020, 11); // rst 0x20
  if (!sub_0020(m)) return; // skipped: control went to our caller, 0x600A untouched

  regs.hl = 0x600a;
  m.step(0x084f, 10); // ld hl,0x600a
  mem.write8(regs.hl, 0x00);
  m.step(0x0851, 10); // ld (hl),0x00
  m.ret(); // ret (0x0851)
}

/**
 * loc_08b2 -- ROM 0x08B2-0x08B5  (rst 0x28 dispatch on 0x600A, table at 0x08B6)
 *
 *   08b2  3a 0a 60     ld   a,(0x600a)
 *   08b5  ef           rst  0x28        ; -> table 0x08B6-0x08B9, only TWO entries
 */
export function loc_08b2(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x600a);
  m.step(0x08b5, 13); // ld a,(0x600a)

  m.push16(0x08b6); // rst 0x28 pushes its return address = the TABLE BASE (0x08B6, NOT 0x0702)
  m.step(0x0028, 11);
  sub_0028(m, "0x08B6 (0x600A, 2-entry)"); // reads the table from ROM; ends in jp (hl)
}

/**
 * sub_0852 -- ROM 0x0852-0x0873  (two nested fills)
 *
 *   0852  21 00 74     ld   hl,0x7400
 *   0855  0e 04        ld   c,0x04
 *   0857  06 00        ld   b,0x00      ; B=0 means 256 iterations
 *   0859  3e 10        ld   a,0x10
 *   085b  77           ld   (hl),a
 *   085c  23           inc  hl
 *   085d  10 fc        djnz 0x085b
 *   085f  0d           dec  c
 *   0860  c2 57 08     jp   nz,0x0857   ; HL NOT reloaded -- the walk continues
 *   0863  21 00 69     ld   hl,0x6900
 *   0866  0e 02        ld   c,0x02
 *   0868  06 c0        ld   b,0xc0      ; 192, NOT 256
 *   086a  af           xor  a
 *   086b  77           ld   (hl),a
 *   086c  23           inc  hl
 *   086d  10 fc        djnz 0x086b
 *   086f  0d           dec  c
 *   0870  c2 68 08     jp   nz,0x0868
 *   0873  c9           ret
 */
export function sub_0852(m) {
  const { regs, mem } = m;

  regs.hl = 0x7400;
  m.step(0x0855, 10); // ld hl,0x7400
  regs.c = 0x04;
  m.step(0x0857, 7); // ld c,0x04

  do {
    // -- loc_0857 --
    regs.b = 0x00; // 256 iterations: djnz decrements FIRST
    m.step(0x0859, 7);
    regs.a = 0x10;
    m.step(0x085b, 7);
    do {
      // -- loc_085b --
      mem.write8(regs.hl, regs.a);
      m.step(0x085c, 7); // ld (hl),a
      regs.hl = (regs.hl + 1) & 0xffff; // 16-bit inc -- carries across pages
      m.step(0x085d, 6); // inc hl
      regs.djnz();
      m.step(regs.b !== 0 ? 0x085b : 0x085f, regs.b !== 0 ? 13 : 8); // djnz
    } while (regs.b !== 0);
    regs.c = regs.dec8(regs.c);
    m.step(0x0860, 4); // dec c
    m.step(regs.fNZ ? 0x0857 : 0x0863, 10); // jp nz,0x0857 -- HL NOT reloaded
  } while (regs.fNZ);

  regs.hl = 0x6900;
  m.step(0x0866, 10); // ld hl,0x6900
  regs.c = 0x02;
  m.step(0x0868, 7); // ld c,0x02

  do {
    // -- loc_0868 --
    regs.b = 0xc0; // 192 -- NOT 256
    m.step(0x086a, 7);
    regs.xor(regs.a); // A = 0, and clears flags (unlike ld a,n)
    m.step(0x086b, 4);
    do {
      // -- loc_086b --
      mem.write8(regs.hl, regs.a);
      m.step(0x086c, 7); // ld (hl),a
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x086d, 6); // inc hl
      regs.djnz();
      m.step(regs.b !== 0 ? 0x086b : 0x086f, regs.b !== 0 ? 13 : 8); // djnz
    } while (regs.b !== 0);
    regs.c = regs.dec8(regs.c);
    m.step(0x0870, 4); // dec c
    m.step(regs.fNZ ? 0x0868 : 0x0873, 10); // jp nz,0x0868
  } while (regs.fNZ);

  m.ret(); // ret (0x0873)
}

/**
 * sub_0874 -- ROM 0x0874-0x08B1  "clear the playfield"
 *
 *   0874  21 04 74     ld   hl,0x7404
 *   0877  0e 20        ld   c,0x20
 *   0879  06 1c        ld   b,0x1c
 *   087b  3e 10        ld   a,0x10
 *   087d  11 04 00     ld   de,0x0004
 *   0880  77           ld   (hl),a
 *   0881  23           inc  hl
 *   0882  10 fc        djnz 0x0880
 *   0884  19           add  hl,de
 *   0885  0d           dec  c
 *   0886  c2 79 08     jp   nz,0x0879
 *   0889  21 22 75     ld   hl,0x7522
 *   088c  11 20 00     ld   de,0x0020
 *   088f  0e 02        ld   c,0x02
 *   0891  3e 10        ld   a,0x10
 *   0893  06 0e        ld   b,0x0e
 *   0895  77           ld   (hl),a
 *   0896  19           add  hl,de
 *   0897  10 fc        djnz 0x0895
 *   0899  21 23 75     ld   hl,0x7523
 *   089c  0d           dec  c
 *   089d  c2 93 08     jp   nz,0x0893
 *   08a0  21 00 69     ld   hl,0x6900
 *   08a3  06 00        ld   b,0x00
 *   08a5  3e 00        ld   a,0x00
 *   08a7  77           ld   (hl),a
 *   08a8  23           inc  hl
 *   08a9  10 fc        djnz 0x08a7
 *   08ab  06 80        ld   b,0x80
 *   08ad  77           ld   (hl),a
 *   08ae  23           inc  hl
 *   08af  10 fc        djnz 0x08ad
 *   08b1  c9           ret
 *
 * Three blocks:
 *  1. 32 rows x 28 cells of tile 0x10 from 0x7404, stepping DE=4 between rows
 *     -- the 28-wide playfield inside a 32-wide tilemap, so 4 cells per row
 *     are skipped.
 *  2. two columns at 0x7522/0x7523, 14 cells each, stepping DE=0x20 (one row).
 *  3. **clears 0x6900-0x6A7F, 384 bytes** -- 256 (B=0 means 256) then 128.
 *
 * Block 3 is worth noting: 384 = 96 sprites x 4, and 0x6900 is exactly the
 * i8257 channel-0 source address. Independent corroboration that 0x6900 is
 * the sprite BUFFER the CPU fills, not the destination of the blit.
 */
export function sub_0874(m) {
  const { regs, mem } = m;

  regs.hl = 0x7404;
  m.step(0x0877, 10);
  regs.c = 0x20;
  m.step(0x0879, 7);
  do {
    regs.b = 0x1c;
    m.step(0x087b, 7);
    regs.a = 0x10;
    m.step(0x087d, 7);
    regs.de = 0x0004;
    m.step(0x0880, 10);
    do {
      mem.write8(regs.hl, regs.a);
      m.step(0x0881, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x0882, 6);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x0880 : 0x0884, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
    regs.addHl(regs.de);
    m.step(0x0885, 11);
    regs.c = regs.dec8(regs.c);
    m.step(0x0886, 4);
    m.step(regs.fNZ ? 0x0879 : 0x0889, 10);
  } while (regs.fNZ);

  regs.hl = 0x7522;
  m.step(0x088c, 10);
  regs.de = 0x0020;
  m.step(0x088f, 10);
  regs.c = 0x02;
  m.step(0x0891, 7);
  // `ld a,0x10` at 0x0891 is OUTSIDE the loop: the branch at 0x089D is
  // `jp nz,0x0893`, which re-enters at `ld b,0x0e`, NOT at 0x0891. Having it
  // inside cost one extra 7 T-state load on the second pass -- the exact
  // 7-cycle surplus the write trace and the taps had bracketed.
  regs.a = 0x10;
  m.step(0x0893, 7);
  do {
    regs.b = 0x0e;
    m.step(0x0895, 7);
    do {
      mem.write8(regs.hl, regs.a);
      m.step(0x0896, 7);
      regs.addHl(regs.de);
      m.step(0x0897, 11);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x0895 : 0x0899, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
    regs.hl = 0x7523;
    m.step(0x089c, 10);
    regs.c = regs.dec8(regs.c);
    m.step(0x089d, 4);
    m.step(regs.fNZ ? 0x0893 : 0x08a0, 10);
  } while (regs.fNZ);

  // Clear the sprite buffer: 256 + 128 = 384 bytes at 0x6900-0x6A7F.
  regs.hl = 0x6900;
  m.step(0x08a3, 10);
  regs.b = 0x00; // means 256
  m.step(0x08a5, 7);
  regs.a = 0x00;
  m.step(0x08a7, 7);
  do {
    mem.write8(regs.hl, regs.a);
    m.step(0x08a8, 7);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x08a9, 6);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x08a7 : 0x08ab, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  regs.b = 0x80;
  m.step(0x08ad, 7);
  do {
    mem.write8(regs.hl, regs.a);
    m.step(0x08ae, 7);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x08af, 6);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x08ad : 0x08b1, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret();
}

/**
 * loc_08ba -- ROM 0x08BA-0x08D4  (0x08B2 table arm 0; falls through to loc_08d5)
 *
 *   08ba  cd 74 08     call 0x0874        ; init/fill (no register input)
 *   08bd  af           xor  a
 *   08be  32 07 60     ld   (0x6007),a
 *   08c1  11 0c 03     ld   de,0x030c
 *   08c4  cd 9f 30     call 0x309f
 *   08c7  21 0a 60     ld   hl,0x600a
 *   08ca  34           inc  (hl)          ; advance the selector
 *   08cb  cd 65 09     call 0x0965        ; sees the ALREADY-incremented 0x600A
 *   08ce  af           xor  a
 *   08cf  21 86 7d     ld   hl,0x7d86
 *   08d2  77           ld   (hl),a        ; 0x7D86 = 0
 *   08d3  2c           inc  l
 *   08d4  77           ld   (hl),a        ; 0x7D87 = 0 (NOT 1 -- cf. loc_0c92)
 *   -- falls through into loc_08d5 --
 */
export function loc_08ba(m) {
  const { regs, mem } = m;

  m.push16(0x08bd); // call 0x0874
  m.step(0x0874, 17);
  sub_0874(m);

  regs.xor(regs.a); // xor a -- A = 0
  m.step(0x08be, 4);
  mem.write8(0x6007, regs.a);
  m.step(0x08c1, 13); // ld (0x6007),a

  regs.de = 0x030c;
  m.step(0x08c4, 10); // ld de,0x030c
  m.push16(0x08c7); // call 0x309f -- DE=0x030C is a parameter
  m.step(0x309f, 17);
  sub_309f(m);

  regs.hl = 0x600a;
  m.step(0x08ca, 10); // ld hl,0x600a
  regs.incMem8(mem, regs.hl); // inc (hl) -- advances the selector
  m.step(0x08cb, 11);

  m.push16(0x08ce); // call 0x0965 -- sees the already-incremented 0x600A
  m.step(0x0965, 17);
  sub_0965(m);

  regs.xor(regs.a); // xor a -- A = 0
  m.step(0x08cf, 4);
  regs.hl = 0x7d86;
  m.step(0x08d2, 10); // ld hl,0x7d86
  mem.write8(regs.hl, regs.a, 7); // 0x7D86 = 0
  m.step(0x08d3, 7); // ld (hl),a
  regs.l = regs.inc8(regs.l); // inc l -- 8-bit, no carry into H
  m.step(0x08d4, 4);
  mem.write8(regs.hl, regs.a, 7); // 0x7D87 = 0
  m.step(0x08d5, 7); // ld (hl),a

  return loc_08d5(m); // fall through -- loc_08d5's ret returns for both. NO push16.
}

/**
 * loc_08d5 -- ROM 0x08D5-0x08F7  (-> A = mem[0x7D00] & B)
 *
 *   08d5  06 04        ld   b,0x04
 *   08d7  1e 09        ld   e,0x09
 *   08d9  3a 01 60     ld   a,(0x6001)
 *   08dc  fe 01        cp   0x01
 *   08de  ca e4 08     jp   z,0x08e4      ; ==1 -> B=4,E=9 ; else B=0xC,E=0xA
 *   08e1  06 0c        ld   b,0x0c
 *   08e3  1c           inc  e
 *   08e4  3a 1a 60     ld   a,(0x601a)
 *   08e7  e6 07        and  0x07
 *   08e9  c2 f3 08     jp   nz,0x08f3     ; (0x601A&7)!=0 -> SKIP the two calls
 *   08ec  7b           ld   a,e
 *   08ed  cd e9 05     call 0x05e9        ; handler_05e9 (returns normally)
 *   08f0  cd 16 06     call 0x0616        ; sub_0616
 *   08f3  3a 00 7d     ld   a,(0x7d00)
 *   08f6  a0           and  b
 *   08f7  c9           ret                ; A (and flags) = mem[0x7D00] & B
 */
export function loc_08d5(m) {
  const { regs, mem } = m;

  regs.b = 0x04;
  m.step(0x08d7, 7); // ld b,0x04
  regs.e = 0x09;
  m.step(0x08d9, 7); // ld e,0x09
  regs.a = mem.read8(0x6001);
  m.step(0x08dc, 13); // ld a,(0x6001)
  regs.cp(0x01);
  m.step(0x08de, 7); // cp 0x01

  if (regs.fZ) {
    m.step(0x08e4, 10); // jp z,0x08e4 taken -- B stays 0x04, E stays 0x09
  } else {
    m.step(0x08e1, 10); // jp z not taken
    regs.b = 0x0c;
    m.step(0x08e3, 7); // ld b,0x0c
    regs.e = regs.inc8(regs.e); // inc e -- 8-bit, D untouched
    m.step(0x08e4, 4);
  }

  // -- loc_08e4 --
  regs.a = mem.read8(0x601a);
  m.step(0x08e7, 13); // ld a,(0x601a)
  regs.and(0x07);
  m.step(0x08e9, 7); // and 0x07

  if (regs.fNZ) {
    m.step(0x08f3, 10); // jp nz,0x08f3 -- SKIP the calls (the common case)
  } else {
    m.step(0x08ec, 10); // jp nz not taken
    regs.a = regs.e;
    m.step(0x08ed, 4); // ld a,e
    m.push16(0x08f0); // call 0x05e9
    m.step(0x05e9, 17);
    handler_05e9(m); // returns normally to 0x08F0 (see the header)
    m.push16(0x08f3); // call 0x0616
    m.step(0x0616, 17);
    sub_0616(m);
  }

  // -- loc_08f3 --
  regs.a = mem.read8(0x7d00);
  m.step(0x08f6, 13); // ld a,(0x7d00)
  regs.and(regs.b); // and b -- A and flags are the return value
  m.step(0x08f7, 4);
  m.ret(); // ret (0x08F7)
}

/**
 * handler_0779 -- ROM 0x0779-0x07C2  (game state 1, sub-state 0)
 *
 *   0779  21 86 7d     ld   hl,0x7d86
 *   077c  36 00        ld   (hl),0x00
 *   077e  23           inc  hl
 *   077f  36 00        ld   (hl),0x00
 *   0781  11 1b 03     ld   de,0x031b
 *   0784  cd 9f 30     call 0x309f
 *   0787  1c           inc  e
 *   0788  cd 9f 30     call 0x309f
 *   078b  cd 65 09     call 0x0965
 *   078e  21 09 60     ld   hl,0x6009
 *   0791  36 02        ld   (hl),0x02
 *   0793  23           inc  hl
 *   0794  34           inc  (hl)
 *   0795  cd 74 08     call 0x0874
 *   0798  cd 53 0a     call 0x0a53
 *   079b  3a 0f 60     ld   a,(0x600f)
 *   079e  fe 01        cp   0x01
 *   07a0  cc ee 09     call z,0x09ee
 *   07a3  ed 5b 22 60  ld   de,(0x6022)
 *   07a7  21 6c 75     ld   hl,0x756c
 *   07aa  cd ad 07     call 0x07ad
 *   07ad  73           ld   (hl),e
 *   ...
 *
 * Clears BOTH palette-bank bits by walking HL across 0x7D86 and 0x7D87 with
 * `inc hl` -- so the two bits are written by the same two-byte instruction
 * pattern rather than by two absolute stores. Note these are `ld (hl),n`
 * (10 T = 4 fetch + 3 operand + 3 write), so their write bus cycle is at
 * offset 7, NOT the 10 that `ld (nn),a` uses.
 *
 * `call 0x07ad` at 0x07AA calls the instruction IMMEDIATELY FOLLOWING it, so
 * the block at 0x07AD runs once as a subroutine, returns to 0x07AD, and then
 * runs AGAIN as straight-line code -- a two-iteration loop with no loop
 * counter. Translating this as a plain call would execute the body once.
 */
export function handler_0779(m) {
  const { regs, mem } = m;

  regs.hl = 0x7d86;
  m.step(0x077c, 10);
  mem.write8(regs.hl, 0x00, 7); // ld (hl),n -- bus cycle at +7, not +10
  m.step(0x077e, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x077f, 6);
  mem.write8(regs.hl, 0x00, 7);
  m.step(0x0781, 10);

  regs.de = 0x031b;
  m.step(0x0784, 10);
  m.push16(0x0787);
  m.step(0x309f, 17);
  sub_309f(m);

  regs.e = regs.inc8(regs.e);
  m.step(0x0788, 4);
  m.push16(0x078b);
  m.step(0x309f, 17);
  sub_309f(m);

  m.push16(0x078e);
  m.step(0x0965, 17);
  sub_0965(m);

  regs.hl = 0x6009;
  m.step(0x0791, 10);
  mem.write8(regs.hl, 0x02, 7); // ld (hl),n
  m.step(0x0793, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0794, 6);
  // `inc (hl)` is a read-modify-write: M1 4 + read 3 + internal 1 = 8 before
  // the write bus cycle, so +8 -- not the +7 of `ld (hl),n` two lines up.
  // Both are "write through HL" and they do NOT share a timestamp. The
  // offset is inert at 0x600A (work RAM is not in the hardware write trace);
  // it is passed for the case where this idiom lands on a latch.
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)), 8);
  m.step(0x0795, 11);

  m.push16(0x0798);
  m.step(0x0874, 17);
  sub_0874(m);

  m.push16(0x079b);
  m.step(0x0a53, 17);
  sub_0a53(m);

  regs.a = mem.read8(0x600f);
  m.step(0x079e, 13);
  regs.cp(0x01);
  m.step(0x07a0, 7);
  if (regs.fZ) {
    m.push16(0x07a3);
    m.step(0x09ee, 17);
    sub_09ee(m);
  } else {
    m.step(0x07a3, 10); // call not taken: 10, not 17
  }

  regs.de = mem.read16(0x6022);
  m.step(0x07a7, 20); // ld de,(nn) is ED-prefixed: 20, not 16
  regs.hl = 0x756c;
  m.step(0x07aa, 10);

  // The two-iteration idiom documented above. Called with (hl,de) set here,
  // then re-entered by FALLING THROUGH into the same bytes with whatever
  // (hl,de) the first pass left behind -- which is why sub_07ad ends by
  // loading them rather than preserving them.
  m.push16(0x07ad);
  m.step(0x07ad, 17);
  sub_07ad(m);
  sub_07ad(m);
}

/**
 * sub_07ad -- ROM 0x07AD-0x07C2
 *
 *   07ad  73           ld   (hl),e
 *   07ae  23           inc  hl
 *   07af  23           inc  hl
 *   07b0  72           ld   (hl),d
 *   07b1  7a           ld   a,d
 *   07b2  d6 0a        sub  0x0a
 *   07b4  c2 bc 07     jp   nz,0x07bc
 *   07b7  77           ld   (hl),a
 *   07b8  3c           inc  a
 *   07b9  32 8e 75     ld   (0x758e),a
 *   07bc  11 01 02     ld   de,0x0201
 *   07bf  21 8c 76     ld   hl,0x768c
 *   07c2  c9           ret
 *
 * Writes E and D two bytes apart in video RAM -- the gap is because tilemap
 * columns are 2 apart in this address layout, so this is placing two digits
 * side by side, not writing a 16-bit value.
 *
 * The `sub 0x0a` is a comparison that KEEPS its result: when D is exactly 10
 * the zero it computed is stored as the tile, turning a would-be "10" into a
 * literal 0 digit and setting the carry digit at 0x758E. So the branch is
 * both the test and the arithmetic, which is why `ld (hl),a` can store A
 * without reloading it.
 *
 * Ends by loading DE and HL with the SECOND pass's arguments. It does not
 * preserve them -- it hands them over, which is the whole mechanism behind
 * the call-then-fall-through at 0x07AA.
 */
function sub_07ad(m) {
  const { regs, mem } = m;

  mem.write8(regs.hl, regs.e);
  m.step(0x07ae, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x07af, 6);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x07b0, 6);
  mem.write8(regs.hl, regs.d);
  m.step(0x07b1, 7);
  regs.a = regs.d;
  m.step(0x07b2, 4);
  // `regs.sub` MUTATES A and returns nothing, unlike `regs.inc8` which is
  // pure and returns its result. The two call sites look identical, so
  // `regs.a = regs.sub(...)` silently stores undefined -- and then survives
  // because `write8` masks it to 0, which happens to be the right byte on
  // the Z path. It would have gone unnoticed until the digit reached 10.
  regs.sub(0x0a);
  m.step(0x07b4, 7);

  if (!regs.fZ) {
    m.step(0x07bc, 10);
  } else {
    m.step(0x07b7, 10);
    mem.write8(regs.hl, regs.a);
    m.step(0x07b8, 7);
    regs.a = regs.inc8(regs.a);
    m.step(0x07b9, 4);
    mem.write8(0x758e, regs.a);
    m.step(0x07bc, 13);
  }

  regs.de = 0x0201;
  m.step(0x07bf, 10);
  regs.hl = 0x768c;
  m.step(0x07c2, 10);
  m.ret();
}

/**
 * sub_09ee -- ROM 0x09EE-0x09FD
 *
 *   09ee  3e 02        ld   a,0x02
 *   09f0  32 e0 74     ld   (0x74e0),a
 *   09f3  3e 25        ld   a,0x25
 *   09f5  32 c0 74     ld   (0x74c0),a
 *   09f8  3e 20        ld   a,0x20
 *   09fa  32 a0 74     ld   (0x74a0),a
 *   09fd  c9           ret
 *
 * Three video RAM stores 0x20 apart -- one tilemap column, three rows apart
 * in the rotated layout. Called from two places (0x07A0 conditionally, and
 * 0x0A2E unconditionally), so it is a shared drawing fragment rather than
 * part of either caller.
 */
function sub_09ee(m) {
  const { regs, mem } = m;

  regs.a = 0x02;
  m.step(0x09f0, 7);
  mem.write8(0x74e0, regs.a);
  m.step(0x09f3, 13);
  regs.a = 0x25;
  m.step(0x09f5, 7);
  mem.write8(0x74c0, regs.a);
  m.step(0x09f8, 13);
  regs.a = 0x20;
  m.step(0x09fa, 7);
  mem.write8(0x74a0, regs.a);
  m.step(0x09fd, 13);
  m.ret();
}
/** sub_09d6 -- clear palette latches, enqueue 0x0302/0x0201, 0x600A=5, then the shared sub_09ee tail. ROM 0x09D6-0x09ED. */
export function sub_09d6(m) {
  const { regs, mem } = m;
  regs.xor(regs.a);
  m.step(0x09d7, 4);
  mem.write8(0x7d86, regs.a);
  m.step(0x09da, 13);
  mem.write8(0x7d87, regs.a);
  m.step(0x09dd, 13);
  regs.de = 0x0302;
  m.step(0x09e0, 10);
  m.push16(0x09e3); m.step(0x309f, 17); sub_309f(m);
  regs.de = 0x0201;
  m.step(0x09e6, 10);
  m.push16(0x09e9); m.step(0x309f, 17); sub_309f(m);
  regs.a = 0x05;
  m.step(0x09eb, 7);
  mem.write8(0x600a, regs.a);
  m.step(0x09ee, 13); // 0x600A = 5 -> fall into sub_09ee
  return sub_09ee(m);
}
/** sub_09fe -- copy 0x6048->0x6228[8], set board id (0x6227) from (0x622A) deref, arm 0x6009=0x78/0x600A=4. ROM 0x09FE-0x0A1A. */
export function sub_09fe(m) {
  const { regs, mem } = m;
  regs.hl = 0x6048;
  m.step(0x0a01, 10);
  regs.de = 0x6228;
  m.step(0x0a04, 10);
  regs.bc = 0x0008;
  m.step(0x0a07, 10);
  m.ldirAt(0x0a07, 0x0a09); // 8-byte copy
  regs.hl = mem.read16(0x622a);
  m.step(0x0a0c, 16); // ld hl,(0x622a)
  regs.a = mem.read8(regs.hl);
  m.step(0x0a0d, 7);
  mem.write8(0x6227, regs.a);
  m.step(0x0a10, 13); // board id
  regs.a = 0x78;
  m.step(0x0a12, 7);
  mem.write8(0x6009, regs.a);
  m.step(0x0a15, 13);
  regs.a = 0x04;
  m.step(0x0a17, 7);
  mem.write8(0x600a, regs.a);
  m.step(0x0a1a, 13);
  m.ret(10);
}
/** sub_0a1b -- clear palette latches, enqueue 0x0303/0x0201, shared sub_09ee tail, 0x600A=5. ROM 0x0A1B-0x0A36. */
export function sub_0a1b(m) {
  const { regs, mem } = m;
  regs.xor(regs.a);
  m.step(0x0a1c, 4);
  mem.write8(0x7d86, regs.a);
  m.step(0x0a1f, 13);
  mem.write8(0x7d87, regs.a);
  m.step(0x0a22, 13);
  regs.de = 0x0303;
  m.step(0x0a25, 10);
  m.push16(0x0a28); m.step(0x309f, 17); sub_309f(m);
  regs.de = 0x0201;
  m.step(0x0a2b, 10);
  m.push16(0x0a2e); m.step(0x309f, 17); sub_309f(m);
  m.push16(0x0a31); m.step(0x09ee, 17); sub_09ee(m); // shared tail
  regs.a = 0x05;
  m.step(0x0a33, 7);
  mem.write8(0x600a, regs.a);
  m.step(0x0a36, 13);
  m.ret(10);
}

/**
 * sub_0965 -- ROM 0x0965-0x0976
 *
 *   0965  11 00 04     ld   de,0x0400
 *   0968  cd 9f 30     call 0x309f
 *   096b  11 14 03     ld   de,0x0314
 *   096e  06 06        ld   b,0x06
 *   0970  cd 9f 30     call 0x309f        ; loop
 *   0973  1c           inc  e
 *   0974  10 fa        djnz 0x0970
 *   0976  c9           ret
 *
 * Queues one task 0x0400, then six consecutive tasks 0x0314..0x0319 -- the
 * payload byte increments while the handler index stays 0x03. So six
 * instances of the same handler, each with a different parameter, which is
 * how the attract screen draws several strings from one routine.
 */
function sub_0965(m) {
  const { regs } = m;

  regs.de = 0x0400;
  m.step(0x0968, 10);
  m.push16(0x096b);
  m.step(0x309f, 17);
  sub_309f(m);

  regs.de = 0x0314;
  m.step(0x096e, 10);
  regs.b = 0x06;
  m.step(0x0970, 7);
  do {
    m.push16(0x0973);
    m.step(0x309f, 17);
    sub_309f(m);
    regs.e = regs.inc8(regs.e);
    m.step(0x0974, 4);
    regs.b = (regs.b - 1) & 0xff; // djnz -- no flags
    m.step(regs.b !== 0 ? 0x0970 : 0x0976, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret();
}

/**
 * loc_08f8 -- ROM 0x08F8-0x095D  (arm 1 of 0x08B2's table; exits the sub-state machine)
 *
 * Consumes loc_08d5's RETURN VALUE in A (= mem[0x7D00] & B), then:
 *   A == 0x04 -> loc_0906 (zero 8 bytes at 0x6048, HL = 0x0000) -> loc_0938
 *   A == 0x08 -> loc_0919 (0x0977 TWICE, copy block to 0x6048, HL = 0x0100) -> loc_0938
 *   else      -> ret, having changed NOTHING (A == 0x0C also lands here)
 *
 * loc_0938 is a SHARED TAIL entered with arm-dependent HL, stored to 0x600E. It ENDS the
 * machine: 0x600A = 0 (this dispatcher's selector) and 0x6005 = 3 (GAME STATE advance).
 * The two ldir blocks (0x091F.. arm-2, 0x093E.. tail) differ ONLY in DE = 0x6048/0x0101
 * vs 0x6040/0x0100 (verified byte-exact vs ROM). The ldir source at 0x095E is live DATA,
 * read twice (tracer marks it "unreached" = not executed, not dead).
 */
export function loc_08f8(m) {
  const { regs, mem } = m;

  m.push16(0x08fb);
  m.step(0x08d5, 17);
  loc_08d5(m); // A = mem[0x7D00] & B -- the return VALUE is what we test

  regs.cp(0x04);
  m.step(0x08fd, 7); // cp 0x04 -- overwrites loc_08d5's flags
  const isFour = regs.fZ;
  m.step(isFour ? 0x0906 : 0x0900, 10); // jp z,0x0906

  if (isFour) {
    // -- loc_0906 --
    m.push16(0x0909);
    m.step(0x0977, 17);
    sub_0977(m);
    regs.hl = 0x6048;
    m.step(0x090c, 10); // ld hl,0x6048
    regs.b = 0x08;
    m.step(0x090e, 7); // ld b,0x08
    regs.xor(regs.a); // A = 0
    m.step(0x090f, 4);
    do {
      mem.write8(regs.hl, regs.a);
      m.step(0x0910, 7); // ld (hl),a
      regs.l = regs.inc8(regs.l); // inc l -- 8-bit
      m.step(0x0911, 4);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x090f : 0x0913, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
    regs.hl = 0x0000; // the JOIN value for this arm
    m.step(0x0916, 10); // ld hl,0x0000
    m.step(0x0938, 10); // jp 0x0938
  } else {
    regs.cp(0x08);
    m.step(0x0902, 7); // cp 0x08
    if (!regs.fZ) {
      m.step(0x0905, 10); // jp z NOT taken
      m.ret(); // does NOTHING -- and A == 0x0C lands here too
      return;
    }
    // -- loc_0919 --
    m.step(0x0919, 10);
    m.push16(0x091c);
    m.step(0x0977, 17);
    sub_0977(m); // FIRST call
    m.push16(0x091f);
    m.step(0x0977, 17);
    sub_0977(m); // SECOND call -- not a duplicate

    regs.de = 0x6048; // <-- 0x6048 HERE; the tail uses 0x6040
    m.step(0x0922, 10);
    regs.a = mem.read8(0x6020);
    m.step(0x0925, 13);
    mem.write8(regs.de, regs.a);
    m.step(0x0926, 7); // ld (de),a
    regs.e = regs.inc8(regs.e); // inc e -- 8-bit
    m.step(0x0927, 4);
    regs.hl = 0x095e; // the "unreached"-labelled data
    m.step(0x092a, 10);
    regs.bc = 0x0007;
    m.step(0x092d, 10);
    m.ldir(0x092f); // ldir -- a LOOP

    regs.de = 0x0101; // <-- 0x0101 HERE; the tail uses 0x0100
    m.step(0x0932, 10);
    m.push16(0x0935);
    m.step(0x309f, 17);
    sub_309f(m);
    regs.hl = 0x0100; // the JOIN value for this arm
    m.step(0x0938, 10); // ld hl,0x0100
  }

  // -- loc_0938: SHARED TAIL, HL is arm-dependent --
  mem.write16(0x600e, regs.hl); // ld (nn),hl -- 16-bit, writes 0x600E AND 0x600F
  m.step(0x093b, 16);
  m.push16(0x093e);
  m.step(0x0874, 17);
  sub_0874(m); // edge -- not mine

  regs.de = 0x6040; // <-- 0x6040, NOT 0x6048
  m.step(0x0941, 10);
  regs.a = mem.read8(0x6020);
  m.step(0x0944, 13);
  mem.write8(regs.de, regs.a);
  m.step(0x0945, 7); // ld (de),a
  regs.e = regs.inc8(regs.e);
  m.step(0x0946, 4); // inc e
  regs.hl = 0x095e;
  m.step(0x0949, 10);
  regs.bc = 0x0007;
  m.step(0x094c, 10);
  m.ldir(0x094e);

  regs.de = 0x0100; // <-- 0x0100, NOT 0x0101
  m.step(0x0951, 10);
  m.push16(0x0954);
  m.step(0x309f, 17);
  sub_309f(m);

  regs.xor(regs.a); // A = 0
  m.step(0x0955, 4);
  mem.write8(0x600a, regs.a); // reset THIS dispatcher's selector
  m.step(0x0958, 13);
  regs.a = 0x03;
  m.step(0x095a, 7);
  mem.write8(0x6005, regs.a); // ADVANCE THE GAME STATE
  m.step(0x095d, 13);
  m.ret();
}
/**
 * sub_0977 -- ROM 0x0977-0x0985  (BCD-decrement 0x6001, then enqueue)
 *
 *   0977  21 01 60     ld   hl,0x6001
 *   097a  3e 99        ld   a,0x99
 *   097c  86           add  a,(hl)        ; A = 0x99 + (0x6001)
 *   097d  27           daa                ; -> BCD ((0x6001) - 1)
 *   097e  77           ld   (hl),a
 *   097f  11 00 04     ld   de,0x0400
 *   0982  cd 9f 30     call 0x309f
 *   0985  c9           ret
 */
export function sub_0977(m) {
  const { regs, mem } = m;

  regs.hl = 0x6001;
  m.step(0x097a, 10); // ld hl,0x6001
  regs.a = 0x99;
  m.step(0x097c, 7); // ld a,0x99
  regs.add(mem.read8(regs.hl)); // add a,(hl) -- sets H/C that daa consumes
  m.step(0x097d, 7);
  regs.daa(); // -> BCD (v - 1); N=0 branch
  m.step(0x097e, 4);
  mem.write8(regs.hl, regs.a);
  m.step(0x097f, 7); // ld (hl),a

  regs.de = 0x0400;
  m.step(0x0982, 10); // ld de,0x0400
  m.push16(0x0985); // call 0x309f -- balanced, not skip-capable
  m.step(0x309f, 17);
  sub_309f(m);
  m.ret(); // ret (0x0985)
}

export function loc_0986(m) {
  const { regs, mem } = m;

  m.push16(0x0989);
  m.step(0x0852, 17); // call 0x0852
  sub_0852(m);
  m.push16(0x098c);
  m.step(0x011c, 17); // call 0x011c
  sub_011c(m);

  regs.de = 0x7d82;
  m.step(0x098f, 10); // ld de,0x7d82
  regs.a = 0x01;
  m.step(0x0991, 7); // ld a,0x01
  mem.write8(regs.de, regs.a, 7); // ld (de),a -- 0x7D82 = 1 (flipscreen)
  m.step(0x0992, 7);
  regs.hl = 0x600a;
  m.step(0x0995, 10); // ld hl,0x600a
  regs.a = mem.read8(0x600e);
  m.step(0x0998, 13); // ld a,(0x600e)
  regs.and(regs.a); // Z iff 0x600E == 0
  m.step(0x0999, 4);

  if (regs.fZ) {
    m.step(0x099c, 10); // jp nz NOT taken
    mem.write8(regs.hl, 0x01); // 0x600A = 1
    m.step(0x099e, 10);
    m.ret();
    return;
  }
  m.step(0x099f, 10); // jp nz,0x099f

  regs.a = mem.read8(0x6026);
  m.step(0x09a2, 13); // ld a,(0x6026)
  regs.a = regs.dec8(regs.a);
  m.step(0x09a3, 4); // dec a
  if (regs.fZ) {
    m.step(0x09a8, 10); // jp z,0x09a8 -- 0x6026 == 1, keep 0x7D82 = 1
  } else {
    m.step(0x09a6, 10); // jp z NOT taken
    regs.xor(regs.a); // A = 0
    m.step(0x09a7, 4);
    mem.write8(regs.de, regs.a, 7); // 0x7D82 = 0 -- DE still 0x7D82
    m.step(0x09a8, 7);
  }
  mem.write8(regs.hl, 0x03); // 0x600A = 3
  m.step(0x09aa, 10);
  m.ret(); // ret (0x09AA)
}

/**
 * loc_09ab -- ROM 0x09AB-0x09D5  (copy 8 bytes, deref a pointer, arm state)
 *
 *   09ab  21 40 60     ld   hl,0x6040
 *   09ae  11 28 62     ld   de,0x6228
 *   09b1  01 08 00     ld   bc,0x0008
 *   09b4  ed b0        ldir                 ; 0x6040..0x6047 -> 0x6228..0x622F
 *   09b6  2a 2a 62     ld   hl,(0x622a)     ; INDIRECT -- the word AT 0x622A
 *   09b9  7e           ld   a,(hl)
 *   09ba  32 27 62     ld   (0x6227),a
 *   09bd  3a 0f 60     ld   a,(0x600f)
 *   09c0  a7           and  a               ; Z iff 0x600F == 0
 *   09c1  21 09 60     ld   hl,0x6009
 *   09c4  11 0a 60     ld   de,0x600a
 *   09c7  ca d0 09     jp   z,0x09d0        ; ==0 -> (1,5) ; else (0x78,2)
 *   09ca  36 78        ld   (hl),0x78
 *   09cc  eb           ex   de,hl
 *   09cd  36 02        ld   (hl),0x02
 *   09cf  c9           ret
 *   09d0  36 01        ld   (hl),0x01       ; loc_09d0
 *   09d2  eb           ex   de,hl
 *   09d3  36 05        ld   (hl),0x05
 *   09d5  c9           ret
 */
export function loc_09ab(m) {
  const { regs, mem } = m;

  regs.hl = 0x6040;
  m.step(0x09ae, 10); // ld hl,0x6040
  regs.de = 0x6228;
  m.step(0x09b1, 10); // ld de,0x6228
  regs.bc = 0x0008;
  m.step(0x09b4, 10); // ld bc,0x0008
  m.ldir(0x09b6); // ldir -- copies 8 bytes 0x6040 -> 0x6228

  regs.hl = mem.read16(0x622a); // INDIRECT: HL = the word AT 0x622A
  m.step(0x09b9, 16); // ld hl,(0x622a)
  regs.a = mem.read8(regs.hl); // deref
  m.step(0x09ba, 7); // ld a,(hl)
  mem.write8(0x6227, regs.a);
  m.step(0x09bd, 13); // ld (0x6227),a

  regs.a = mem.read8(0x600f);
  m.step(0x09c0, 13); // ld a,(0x600f)
  regs.and(regs.a); // and a -- Z iff 0x600F == 0
  m.step(0x09c1, 4);
  regs.hl = 0x6009;
  m.step(0x09c4, 10); // ld hl,0x6009
  regs.de = 0x600a;
  m.step(0x09c7, 10); // ld de,0x600a

  if (regs.fZ) {
    // -- loc_09d0 -- 0x600F == 0
    m.step(0x09d0, 10); // jp z,0x09d0
    mem.write8(regs.hl, 0x01); // 0x6009 = 1
    m.step(0x09d2, 10); // ld (hl),0x01
    regs.exDeHl(); // HL = 0x600A
    m.step(0x09d3, 4); // ex de,hl
    mem.write8(regs.hl, 0x05); // 0x600A = 5
    m.step(0x09d5, 10); // ld (hl),0x05
    m.ret(); // ret (0x09D5)
    return;
  }
  m.step(0x09ca, 10); // jp z NOT taken

  mem.write8(regs.hl, 0x78); // 0x6009 = 0x78
  m.step(0x09cc, 10); // ld (hl),0x78
  regs.exDeHl(); // HL = 0x600A
  m.step(0x09cd, 4); // ex de,hl
  mem.write8(regs.hl, 0x02); // 0x600A = 2
  m.step(0x09cf, 10); // ld (hl),0x02
  m.ret(); // ret (0x09CF)
}

/**
 * loc_0a37 -- ROM 0x0A37-0x0A62  (enqueue 4 tasks, advance 0x600A, seed video)
 */
export function loc_0a37(m) {
  const { regs, mem } = m;

  regs.de = 0x0304;
  m.step(0x0a3a, 10); // ld de,0x0304
  m.push16(0x0a3d);
  m.step(0x309f, 17); // call 0x309f
  sub_309f(m);
  regs.de = 0x0202;
  m.step(0x0a40, 10); // ld de,0x0202
  m.push16(0x0a43);
  m.step(0x309f, 17); // call 0x309f
  sub_309f(m);
  regs.de = 0x0200;
  m.step(0x0a46, 10); // ld de,0x0200
  m.push16(0x0a49);
  m.step(0x309f, 17); // call 0x309f
  sub_309f(m);
  regs.de = 0x0600;
  m.step(0x0a4c, 10); // ld de,0x0600
  m.push16(0x0a4f);
  m.step(0x309f, 17); // call 0x309f
  sub_309f(m);

  regs.hl = 0x600a;
  m.step(0x0a52, 10); // ld hl,0x600a
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance the 0x600A selector
  m.step(0x0a53, 11);

  regs.a = 0x01;
  m.step(0x0a55, 7); // ld a,0x01
  mem.write8(0x7740, regs.a, 10); // ld (0x7740),a
  m.step(0x0a58, 13);
  regs.a = 0x25;
  m.step(0x0a5a, 7); // ld a,0x25
  mem.write8(0x7720, regs.a, 10); // ld (0x7720),a
  m.step(0x0a5d, 13);
  regs.a = 0x20;
  m.step(0x0a5f, 7); // ld a,0x20
  mem.write8(0x7700, regs.a, 10); // ld (0x7700),a
  m.step(0x0a62, 13);
  m.ret(); // ret (0x0A62)
}

/**
 * loc_0a76 -- ROM 0x0A76-0x0A79  (rst 0x28 dispatch on 0x6385, table at 0x0A7A)
 *
 *   0a76  3a 85 63     ld   a,(0x6385)
 *   0a79  ef           rst  0x28        ; -> table 0x0A7A-0x0A89, 8 entries
 */
export function loc_0a76(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6385);
  m.step(0x0a79, 13); // ld a,(0x6385)

  m.push16(0x0a7a); // rst 0x28 pushes its return address = the TABLE BASE (0x0A7A)
  m.step(0x0028, 11);
  sub_0028(m, "0x0A7A (0x6385 sequence)"); // reads the table from ROM; ends in jp (hl)
}

/**
 * loc_0a63 -- ROM 0x0A63-0x0A75  (rst 0x18 gate; re-arm and advance 0x600A by 1 or 2)
 *
 *   0a63  df           rst  0x18
 *   0a64  cd 74 08     call 0x0874
 *   0a67  21 09 60     ld   hl,0x6009
 *   0a6a  36 01        ld   (hl),0x01     ; re-arm the countdown to 1
 *   0a6c  2c           inc  l             ; HL = 0x600A
 *   0a6d  34           inc  (hl)          ; 0x600A += 1
 *   0a6e  11 2c 62     ld   de,0x622c
 *   0a71  1a           ld   a,(de)
 *   0a72  a7           and  a             ; Z iff 0x622C == 0
 *   0a73  c0           ret  nz            ; != 0 -> advance stays +1
 *   0a74  34           inc  (hl)          ; == 0 -> 0x600A += 2 total
 *   0a75  c9           ret
 */
export function loc_0a63(m) {
  const { regs, mem } = m;

  m.push16(0x0a64); // rst 0x18 pushes its return address
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // counter still ticking -- skipped to our caller

  m.push16(0x0a67);
  m.step(0x0874, 17); // call 0x0874
  sub_0874(m);

  regs.hl = 0x6009;
  m.step(0x0a6a, 10); // ld hl,0x6009
  mem.write8(regs.hl, 0x01); // re-arm to 1 (absolute)
  m.step(0x0a6c, 10); // ld (hl),0x01
  regs.l = regs.inc8(regs.l); // inc l -- 8-bit; HL = 0x600A
  m.step(0x0a6d, 4);
  regs.incMem8(mem, regs.hl); // inc (hl) -- 0x600A += 1
  m.step(0x0a6e, 11);

  regs.de = 0x622c;
  m.step(0x0a71, 10); // ld de,0x622c
  regs.a = mem.read8(regs.de);
  m.step(0x0a72, 7); // ld a,(de)
  regs.and(regs.a); // and a -- Z iff 0x622C == 0
  m.step(0x0a73, 4);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- 0x622C != 0, advance stays +1
    return;
  }
  m.step(0x0a74, 5); // ret nz NOT taken

  regs.incMem8(mem, regs.hl); // inc (hl) AGAIN -- 0x600A += 2 total
  m.step(0x0a75, 11);
  m.ret(); // ret (0x0A75)
}

/**
 * loc_0a8a -- ROM 0x0A8A-0x0ABE  (state setup; seed the two walk pointers)
 */
export function loc_0a8a(m) {
  const { regs, mem } = m;

  regs.xor(regs.a); // A = 0
  m.step(0x0a8b, 4);
  mem.write8(0x7d86, regs.a, 10); // ld (0x7d86),a -- palette latch = 0
  m.step(0x0a8e, 13);
  regs.a = regs.inc8(regs.a); // A = 1
  m.step(0x0a8f, 4);
  mem.write8(0x7d87, regs.a, 10); // ld (0x7d87),a -- palette latch = 1
  m.step(0x0a92, 13);

  regs.de = 0x380d;
  m.step(0x0a95, 10); // ld de,0x380d
  m.push16(0x0a98);
  m.step(0x0da7, 17);
  sub_0da7(m);

  regs.a = 0x10;
  m.step(0x0a9a, 7); // ld a,0x10
  mem.write8(0x76a3, regs.a, 10); // ld (0x76a3),a
  m.step(0x0a9d, 13);
  mem.write8(0x7663, regs.a, 10); // ld (0x7663),a
  m.step(0x0aa0, 13);
  regs.a = 0xd4;
  m.step(0x0aa2, 7); // ld a,0xd4
  mem.write8(0x75aa, regs.a, 10); // ld (0x75aa),a
  m.step(0x0aa5, 13);
  regs.xor(regs.a); // A = 0
  m.step(0x0aa6, 4);
  mem.write8(0x62af, regs.a); // ld (0x62af),a -- work RAM
  m.step(0x0aa9, 13);

  regs.hl = 0x38b4;
  m.step(0x0aac, 10); // ld hl,0x38b4
  mem.write16(0x63c2, regs.hl); // seed loc_0b06's walk pointer
  m.step(0x0aaf, 16);
  regs.hl = 0x38cb;
  m.step(0x0ab2, 10); // ld hl,0x38cb
  mem.write16(0x63c4, regs.hl); // seed loc_0b68's walk pointer
  m.step(0x0ab5, 16);

  regs.a = 0x40;
  m.step(0x0ab7, 7); // ld a,0x40
  mem.write8(0x6009, regs.a); // arm the countdown to 64
  m.step(0x0aba, 13); // ld (0x6009),a
  regs.hl = 0x6385;
  m.step(0x0abd, 10); // ld hl,0x6385
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance the sequence
  m.step(0x0abe, 11);
  m.ret(); // ret (0x0ABE)
}

export function loc_0abf(m) {
  const { regs, mem } = m;

  m.push16(0x0ac0);
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // countdown not expired -- aborted to caller

  regs.hl = 0x388c;
  m.step(0x0ac3, 10); // ld hl,0x388c
  m.push16(0x0ac6);
  m.step(0x004e, 17);
  sub_004e(m); // copy 0x28 bytes ROM 0x388C -> 0x6908

  regs.hl = 0x6908;
  m.step(0x0ac9, 10); // ld hl,0x6908
  regs.c = 0x30;
  m.step(0x0acb, 7); // ld c,0x30
  m.push16(0x0acc);
  m.step(0x0038, 11); // rst 0x38 -- add-pass 1
  loc_0038(m);

  regs.hl = 0x690b;
  m.step(0x0acf, 10); // ld hl,0x690b
  regs.c = 0x99;
  m.step(0x0ad1, 7); // ld c,0x99
  m.push16(0x0ad2);
  m.step(0x0038, 11); // rst 0x38 -- add-pass 2 (different HL, C)
  loc_0038(m);

  regs.a = 0x1f;
  m.step(0x0ad4, 7); // ld a,0x1f
  mem.write8(0x638e, regs.a);
  m.step(0x0ad7, 13); // ld (0x638e),a
  regs.xor(regs.a); // A = 0
  m.step(0x0ad8, 4);
  mem.write8(0x690c, regs.a);
  m.step(0x0adb, 13); // ld (0x690c),a

  regs.hl = 0x608a;
  m.step(0x0ade, 10); // ld hl,0x608a
  mem.write8(regs.hl, 0x01); // 0x608A = 1
  m.step(0x0ae0, 10); // ld (hl),0x01
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0ae1, 6); // inc hl
  mem.write8(regs.hl, 0x03); // 0x608B = 3
  m.step(0x0ae3, 10); // ld (hl),0x03

  regs.hl = 0x6385;
  m.step(0x0ae6, 10); // ld hl,0x6385
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance the sequence
  m.step(0x0ae7, 11);
  m.ret(); // ret (0x0AE7)
}

export function loc_0ae8(m) {
  const { regs, mem } = m;

  m.push16(0x0aeb);
  m.step(0x306f, 17);
  sub_306f(m);

  regs.a = mem.read8(0x62af);
  m.step(0x0aee, 13); // ld a,(0x62af)
  regs.and(0x0f);
  m.step(0x0af0, 7); // and 0x0f

  if (regs.fZ) {
    m.push16(0x0af3);
    m.step(0x304a, 17); // call z,0x304a taken
    sub_304a(m);
  } else {
    m.step(0x0af3, 10); // call z NOT taken
  }

  regs.a = mem.read8(0x690b);
  m.step(0x0af6, 13); // ld a,(0x690b)
  regs.cp(0x5d);
  m.step(0x0af8, 7); // cp 0x5d
  if (regs.fNC) {
    m.ret(11); // ret nc -- 0x690B >= 0x5D
    return;
  }
  m.step(0x0af9, 5); // ret nc NOT taken

  regs.a = 0x20;
  m.step(0x0afb, 7); // ld a,0x20
  mem.write8(0x6009, regs.a); // arm countdown to 32
  m.step(0x0afe, 13); // ld (0x6009),a
  regs.hl = 0x6385;
  m.step(0x0b01, 10); // ld hl,0x6385
  regs.incMem8(mem, regs.hl); // inc (hl) -- HL stays 0x6385
  m.step(0x0b02, 11);
  mem.write16(0x63c0, regs.hl); // seed the 0x63C0 pointer
  m.step(0x0b05, 16); // ld (0x63c0),hl
  m.ret(); // ret (0x0B05)
}

/**
 * sub_0a53 -- ROM 0x0A53-0x0A62
 *
 *   0a53  3e 01        ld   a,0x01
 *   0a55  32 40 77     ld   (0x7740),a
 *   0a58  3e 25        ld   a,0x25
 *   0a5a  32 20 77     ld   (0x7720),a
 *   0a5d  3e 20        ld   a,0x20
 *   0a5f  32 00 77     ld   (0x7700),a
 *   0a62  c9           ret
 *
 * Writes three fixed tiles one row apart (0x7740, 0x7720, 0x7700 -- 0x20
 * apart, one tilemap row) -- the same three cells sub_0315 maintains.
 */
export function sub_0a53(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  m.step(0x0a55, 7);
  mem.write8(0x7740, regs.a);
  m.step(0x0a58, 13);
  regs.a = 0x25;
  m.step(0x0a5a, 7);
  mem.write8(0x7720, regs.a);
  m.step(0x0a5d, 13);
  regs.a = 0x20;
  m.step(0x0a5f, 7);
  mem.write8(0x7700, regs.a);
  m.step(0x0a62, 13);
  m.ret();
}

/**
 * loc_0bb3 -- ROM 0x0BB3-0x0BD9  (wrap the 0x6385 sequence, advance the selectors)
 *
 *   0bb3  21 8a 60     ld   hl,0x608a
 *   0bb6  3a 09 60     ld   a,(0x6009)
 *   0bb9  fe 90        cp   0x90
 *   0bbb  20 0b        jr   nz,0x0bc8
 *   0bbd  36 0f        ld   (hl),0x0f     ; 0x608A = 0x0F
 *   0bbf  23           inc  hl
 *   0bc0  36 03        ld   (hl),0x03     ; 0x608B = 0x03
 *   0bc2  21 19 69     ld   hl,0x6919
 *   0bc5  34           inc  (hl)
 *   0bc6  18 09        jr   0x0bd1
 *   0bc8  fe 18        cp   0x18          ; loc_0bc8
 *   0bca  20 05        jr   nz,0x0bd1
 *   0bcc  21 19 69     ld   hl,0x6919
 *   0bcf  35           dec  (hl)
 *   0bd0  00           nop
 *   0bd1  df           rst  0x18          ; loc_0bd1 -- the merge + gate
 *   0bd2  af           xor  a
 *   0bd3  32 85 63     ld   (0x6385),a    ; wrap the sequence to arm 0
 *   0bd6  34           inc  (hl)          ; 0x6009 (HL = 0x6009, rst side effect)
 *   0bd7  23           inc  hl
 *   0bd8  34           inc  (hl)          ; 0x600A -- the outer selector
 *   0bd9  c9           ret
 */
export function loc_0bb3(m) {
  const { regs, mem } = m;

  regs.hl = 0x608a;
  m.step(0x0bb6, 10); // ld hl,0x608a
  regs.a = mem.read8(0x6009);
  m.step(0x0bb9, 13); // ld a,(0x6009)
  regs.cp(0x90);
  m.step(0x0bbb, 7); // cp 0x90

  if (regs.fNZ) {
    m.step(0x0bc8, 12); // jr nz,0x0bc8 taken
    regs.cp(0x18);
    m.step(0x0bca, 7); // cp 0x18
    if (regs.fNZ) {
      m.step(0x0bd1, 12); // jr nz,0x0bd1 -- HL still 0x608A (dead)
    } else {
      m.step(0x0bcc, 7); // jr nz not taken
      regs.hl = 0x6919;
      m.step(0x0bcf, 10); // ld hl,0x6919
      regs.decMem8(mem, regs.hl); // dec (hl) -- flag-correct RMW
      m.step(0x0bd0, 11);
      m.step(0x0bd1, 4); // nop -- REAL instruction, do not elide
    }
  } else {
    m.step(0x0bbd, 7); // jr nz not taken
    mem.write8(regs.hl, 0x0f);
    m.step(0x0bbf, 10); // ld (hl),0x0f
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0bc0, 6); // inc hl
    mem.write8(regs.hl, 0x03);
    m.step(0x0bc2, 10); // ld (hl),0x03
    regs.hl = 0x6919;
    m.step(0x0bc5, 10); // ld hl,0x6919
    regs.incMem8(mem, regs.hl); // inc (hl)
    m.step(0x0bc6, 11);
    m.step(0x0bd1, 12); // jr 0x0bd1
  }

  // -- loc_0bd1: the merge. HL from above is DEAD; sub_0018 sets HL = 0x6009. --
  m.push16(0x0bd2); // rst 0x18 PUSHES its return address
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // countdown not expired -- skipped to our caller

  regs.xor(regs.a); // xor a -- A = 0
  m.step(0x0bd3, 4);
  mem.write8(0x6385, regs.a); // sequence wraps to arm 0
  m.step(0x0bd6, 13);
  regs.incMem8(mem, regs.hl); // inc (hl) -- HL == 0x6009 (rst side effect)
  m.step(0x0bd7, 11);
  regs.hl = (regs.hl + 1) & 0xffff; // HL = 0x600A
  m.step(0x0bd8, 6);
  regs.incMem8(mem, regs.hl); // inc (hl) -- 0x600A, the OUTER selector
  m.step(0x0bd9, 11);
  m.ret(); // ret (0x0BD9)
}

/**
 * loc_0b06 -- ROM 0x0B06-0x0B67  (walk a ROM table, or terminal setup)
 */
export function loc_0b06(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x601a);
  m.step(0x0b09, 13); // ld a,(0x601a)
  regs.rrca();
  m.step(0x0b0a, 4); // rrca
  if (regs.fC) {
    m.ret(11); // ret c -- 0x601A bit 0 was set
    return;
  }
  m.step(0x0b0b, 5); // ret c NOT taken

  regs.hl = mem.read16(0x63c2); // INDIRECT walk pointer
  m.step(0x0b0e, 16); // ld hl,(0x63c2)
  regs.a = mem.read8(regs.hl);
  m.step(0x0b0f, 7); // ld a,(hl)
  regs.cp(0x7f);
  m.step(0x0b11, 7); // cp 0x7f

  if (!regs.fZ) {
    m.step(0x0b14, 10); // jp z NOT taken -- walk a non-sentinel byte
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0b15, 6); // inc hl
    mem.write16(0x63c2, regs.hl); // advance the walk pointer
    m.step(0x0b18, 16);
    regs.c = regs.a;
    m.step(0x0b19, 4); // ld c,a
    regs.hl = 0x690b;
    m.step(0x0b1c, 10); // ld hl,0x690b
    m.push16(0x0b1d);
    m.step(0x0038, 11); // rst 0x38 -- add the table byte
    loc_0038(m);
    m.ret();
    return;
  }
  m.step(0x0b1e, 10); // jp z,0x0b1e -- the 0x7F sentinel: terminal setup

  regs.hl = 0x385c;
  m.step(0x0b21, 10); // ld hl,0x385c
  m.push16(0x0b24);
  m.step(0x004e, 17);
  sub_004e(m); // copies 0x28 bytes; LEAVES HL = 0x3884

  regs.de = 0x6900; // HL is NOT reloaded -- it is 0x3884 from sub_004e
  m.step(0x0b27, 10); // ld de,0x6900
  regs.bc = 0x0008;
  m.step(0x0b2a, 10); // ld bc,0x0008
  m.ldir(0x0b2c); // ldir FROM 0x3884

  regs.hl = 0x6908;
  m.step(0x0b2f, 10); // ld hl,0x6908
  regs.c = 0x50;
  m.step(0x0b31, 7); // ld c,0x50
  m.push16(0x0b32);
  m.step(0x0038, 11); // rst 0x38
  loc_0038(m);
  regs.hl = 0x690b;
  m.step(0x0b35, 10); // ld hl,0x690b
  regs.c = 0xfc;
  m.step(0x0b37, 7); // ld c,0xfc
  m.push16(0x0b38);
  m.step(0x0038, 11); // rst 0x38
  loc_0038(m);

  // do { call 0x304A } while (0x638E != 0x0A)
  for (;;) {
    m.push16(0x0b3b);
    m.step(0x304a, 17);
    sub_304a(m); // advances 0x638E toward 0x0A
    regs.a = mem.read8(0x638e);
    m.step(0x0b3e, 13); // ld a,(0x638e)
    regs.cp(0x0a);
    m.step(0x0b40, 7); // cp 0x0a
    if (regs.fZ) {
      m.step(0x0b43, 10); // jp nz NOT taken -> exit loop
      break;
    }
    m.step(0x0b38, 10); // jp nz,0x0b38 -- loop
  }

  regs.a = 0x03;
  m.step(0x0b45, 7); // ld a,0x03
  mem.write8(0x6082, regs.a);
  m.step(0x0b48, 13); // ld (0x6082),a
  regs.de = 0x392c;
  m.step(0x0b4b, 10); // ld de,0x392c
  m.push16(0x0b4e);
  m.step(0x0da7, 17);
  sub_0da7(m);

  regs.a = 0x10;
  m.step(0x0b50, 7); // ld a,0x10
  mem.write8(0x74aa, regs.a, 10); // ld (0x74aa),a
  m.step(0x0b53, 13);
  mem.write8(0x748a, regs.a, 10); // ld (0x748a),a
  m.step(0x0b56, 13);
  regs.a = 0x05;
  m.step(0x0b58, 7); // ld a,0x05
  mem.write8(0x638d, regs.a);
  m.step(0x0b5b, 13); // ld (0x638d),a
  regs.a = 0x20;
  m.step(0x0b5d, 7); // ld a,0x20
  mem.write8(0x6009, regs.a); // arm the countdown to 32
  m.step(0x0b60, 13); // ld (0x6009),a
  regs.hl = 0x6385;
  m.step(0x0b63, 10); // ld hl,0x6385
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance the sequence; HL stays 0x6385
  m.step(0x0b64, 11);
  mem.write16(0x63c0, regs.hl); // seed loc_3069's pointer
  m.step(0x0b67, 16); // ld (0x63c0),hl
  m.ret(); // ret (0x0B67)
}

/**
 * loc_0b68 -- ROM 0x0B68-0x0BB2  (walk 0x63C4 table, render records, count down)
 */
export function loc_0b68(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x601a);
  m.step(0x0b6b, 13); // ld a,(0x601a)
  regs.rrca();
  m.step(0x0b6c, 4); // rrca
  if (regs.fC) {
    m.ret(11); // ret c -- gate
    return;
  }
  m.step(0x0b6d, 5); // ret c NOT taken

  regs.hl = mem.read16(0x63c4); // INDIRECT walk pointer
  m.step(0x0b70, 16); // ld hl,(0x63c4)
  regs.a = mem.read8(regs.hl);
  m.step(0x0b71, 7); // ld a,(hl)
  regs.cp(0x7f);
  m.step(0x0b73, 7); // cp 0x7f

  if (!regs.fZ) {
    m.step(0x0b76, 10); // jp z NOT taken
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0b77, 6); // inc hl
    mem.write16(0x63c4, regs.hl); // advance the walk pointer
    m.step(0x0b7a, 16);
    regs.hl = 0x690b;
    m.step(0x0b7d, 10); // ld hl,0x690b
    regs.c = regs.a;
    m.step(0x0b7e, 4); // ld c,a
    m.push16(0x0b7f);
    m.step(0x0038, 11); // rst 0x38 -- add the table byte
    loc_0038(m);
    regs.hl = 0x6908;
    m.step(0x0b82, 10); // ld hl,0x6908
    regs.c = 0xff;
    m.step(0x0b84, 7); // ld c,0xff -- adds -1
    m.push16(0x0b85);
    m.step(0x0038, 11); // rst 0x38
    loc_0038(m);
    m.ret();
    return;
  }
  m.step(0x0b86, 10); // jp z,0x0b86 -- the 0x7F sentinel

  regs.hl = 0x38cb;
  m.step(0x0b89, 10); // ld hl,0x38cb
  mem.write16(0x63c4, regs.hl); // RESET the walk pointer -- loop the table
  m.step(0x0b8c, 16);
  regs.a = 0x03;
  m.step(0x0b8e, 7); // ld a,0x03
  mem.write8(0x6082, regs.a);
  m.step(0x0b91, 13); // ld (0x6082),a
  regs.hl = 0x38dc;
  m.step(0x0b94, 10); // ld hl,0x38dc
  regs.a = mem.read8(0x638d); // the record INDEX
  m.step(0x0b97, 13); // ld a,(0x638d)
  regs.a = regs.dec8(regs.a);
  m.step(0x0b98, 4); // dec a
  regs.rlca();
  m.step(0x0b99, 4); // rlca
  regs.rlca();
  m.step(0x0b9a, 4); // rlca
  regs.rlca();
  m.step(0x0b9b, 4); // rlca
  regs.rlca();
  m.step(0x0b9c, 4); // rlca -- four rlca = nibble swap = *16 for A < 16
  regs.e = regs.a;
  m.step(0x0b9d, 4); // ld e,a
  regs.d = 0x00;
  m.step(0x0b9f, 7); // ld d,0x00
  regs.addHl(regs.de); // add hl,de -- HL = 0x38DC + (0x638D-1)*16
  m.step(0x0ba0, 11);
  regs.exDeHl(); // DE = the record address
  m.step(0x0ba1, 4); // ex de,hl
  m.push16(0x0ba4);
  m.step(0x0da7, 17);
  sub_0da7(m); // render the record

  regs.hl = 0x638d;
  m.step(0x0ba7, 10); // ld hl,0x638d
  regs.decMem8(mem, regs.hl); // dec (hl) -- the counter
  m.step(0x0ba8, 11);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- more records to render
    return;
  }
  m.step(0x0ba9, 5); // ret nz NOT taken

  regs.a = 0xb0;
  m.step(0x0bab, 7); // ld a,0xb0
  mem.write8(0x6009, regs.a); // arm the countdown to 176
  m.step(0x0bae, 13); // ld (0x6009),a
  regs.hl = 0x6385;
  m.step(0x0bb1, 10); // ld hl,0x6385
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance the sequence
  m.step(0x0bb2, 11);
  m.ret(); // ret (0x0BB2)
}

export function loc_0bda(m) {
  const { regs, mem } = m;

  m.push16(0x0bdd);
  m.step(0x011c, 17); // call 0x011c -- UNCONDITIONAL, before the gate
  sub_011c(m);

  m.push16(0x0bde);
  m.step(0x0018, 11); // rst 0x18 -- gate on everything after
  if (!sub_0018(m)) return; // skipped -> aborted to caller

  m.push16(0x0be1);
  m.step(0x0874, 17); // call 0x0874
  sub_0874(m);

  regs.d = 0x06;
  m.step(0x0be3, 7); // ld d,0x06
  regs.a = mem.read8(0x6200);
  m.step(0x0be6, 13); // ld a,(0x6200)
  regs.e = regs.a;
  m.step(0x0be7, 4); // ld e,a
  m.push16(0x0bea);
  m.step(0x309f, 17); // call 0x309f -- enqueue DE = (0x06, mem[0x6200])
  sub_309f(m);

  // -- seed state --
  regs.hl = 0x7d86;
  m.step(0x0bed, 10); // ld hl,0x7d86
  mem.write8(regs.hl, 0x01, 7); // 0x7D86 = 1
  m.step(0x0bef, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0bf0, 6); // inc hl
  mem.write8(regs.hl, 0x00, 7); // 0x7D87 = 0
  m.step(0x0bf2, 10);
  regs.hl = 0x608a;
  m.step(0x0bf5, 10); // ld hl,0x608a
  mem.write8(regs.hl, 0x02); // 0x608A = 2
  m.step(0x0bf7, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0bf8, 6); // inc hl
  mem.write8(regs.hl, 0x03); // 0x608B = 3
  m.step(0x0bfa, 10);
  regs.hl = 0x63a7;
  m.step(0x0bfd, 10); // ld hl,0x63a7
  mem.write8(regs.hl, 0x00); // 0x63A7 = 0
  m.step(0x0bff, 10);
  regs.hl = 0x76dc;
  m.step(0x0c02, 10); // ld hl,0x76dc
  mem.write16(0x63a8, regs.hl); // 0x63A8 = 0x76DC (the IX walk pointer)
  m.step(0x0c05, 16);

  // -- clamp 0x622E to <= 5 --
  regs.a = mem.read8(0x622e);
  m.step(0x0c08, 13); // ld a,(0x622e)
  regs.cp(0x06);
  m.step(0x0c0a, 7); // cp 0x06
  if (regs.fC) {
    m.step(0x0c11, 12); // jr c,0x0c11 -- < 6, keep
  } else {
    m.step(0x0c0c, 7); // jr c not taken
    regs.a = 0x05;
    m.step(0x0c0e, 7); // ld a,0x05
    mem.write8(0x622e, regs.a);
    m.step(0x0c11, 13); // ld (0x622e),a
  }

  // -- compare 0x622F vs 0x622A --
  regs.a = mem.read8(0x622f);
  m.step(0x0c14, 13); // ld a,(0x622f)
  regs.b = regs.a;
  m.step(0x0c15, 4); // ld b,a
  regs.a = mem.read8(0x622a);
  m.step(0x0c18, 13); // ld a,(0x622a)
  regs.cp(regs.b);
  m.step(0x0c19, 4); // cp b
  if (regs.fZ) {
    m.step(0x0c1f, 12); // jr z,0x0c1f -- equal, skip inc
  } else {
    m.step(0x0c1b, 7); // jr z not taken
    regs.hl = 0x622e;
    m.step(0x0c1e, 10); // ld hl,0x622e
    regs.incMem8(mem, regs.hl); // inc (hl) -- 0x622E++
    m.step(0x0c1f, 11);
  }
  mem.write8(0x622f, regs.a); // 0x622F = mem[0x622A]
  m.step(0x0c22, 13); // ld (0x622f),a

  // -- outer loop prep --
  regs.a = mem.read8(0x622e);
  m.step(0x0c25, 13); // ld a,(0x622e)
  regs.b = regs.a;
  m.step(0x0c26, 4); // ld b,a -- B = outer count
  regs.hl = 0x75bc;
  m.step(0x0c29, 10); // ld hl,0x75bc

  // ===== OUTER LOOP (loc_0c29) =====
  for (;;) {
    regs.c = 0x50;
    m.step(0x0c2b, 7); // ld c,0x50

    // ----- INNER fill (loc_0c2b): 4 bytes/group, stride 0x23, until C+3 == 0x67 -----
    for (;;) {
      mem.write8(regs.hl, regs.c);
      m.step(0x0c2c, 7); // ld (hl),c
      regs.c = (regs.c + 1) & 0xff;
      m.step(0x0c2d, 4); // inc c
      regs.hl = (regs.hl - 1) & 0xffff;
      m.step(0x0c2e, 6); // dec hl
      mem.write8(regs.hl, regs.c);
      m.step(0x0c2f, 7); // ld (hl),c
      regs.c = (regs.c + 1) & 0xff;
      m.step(0x0c30, 4); // inc c
      regs.hl = (regs.hl - 1) & 0xffff;
      m.step(0x0c31, 6); // dec hl
      mem.write8(regs.hl, regs.c);
      m.step(0x0c32, 7); // ld (hl),c
      regs.c = (regs.c + 1) & 0xff;
      m.step(0x0c33, 4); // inc c
      regs.hl = (regs.hl - 1) & 0xffff;
      m.step(0x0c34, 6); // dec hl
      mem.write8(regs.hl, regs.c);
      m.step(0x0c35, 7); // ld (hl),c -- 4th write (C is C+3)
      regs.a = regs.c;
      m.step(0x0c36, 4); // ld a,c
      regs.cp(0x67);
      m.step(0x0c38, 7); // cp 0x67
      if (regs.fZ) {
        m.step(0x0c43, 10); // jp z,0x0c43 -- exit inner
        break;
      }
      m.step(0x0c3b, 10); // jp z not taken
      regs.c = (regs.c + 1) & 0xff;
      m.step(0x0c3c, 4); // inc c
      regs.de = 0x0023;
      m.step(0x0c3f, 10); // ld de,0x0023
      regs.addHl(regs.de);
      m.step(0x0c40, 11); // add hl,de
      m.step(0x0c2b, 10); // jp 0x0c2b -- loop inner
    }

    // ----- IX sprite copy (loc_0c43) -----
    regs.a = mem.read8(0x63a7);
    m.step(0x0c46, 13); // ld a,(0x63a7)
    regs.a = regs.inc8(regs.a);
    m.step(0x0c47, 4); // inc a
    mem.write8(0x63a7, regs.a);
    m.step(0x0c4a, 13); // ld (0x63a7),a
    regs.a = regs.dec8(regs.a);
    m.step(0x0c4b, 4); // dec a -- A = old 0x63A7
    regs.a = regs.sla(regs.a); // sla a
    m.step(0x0c4d, 8);
    regs.a = regs.sla(regs.a); // sla a -- A = (old 0x63A7) * 4
    m.step(0x0c4f, 8);

    m.push16(regs.hl); // push hl -- save the tile-fill pointer
    m.step(0x0c50, 11);
    regs.hl = 0x3cf0;
    m.step(0x0c53, 10); // ld hl,0x3cf0
    m.push16(regs.bc); // push bc -- save the outer counter
    m.step(0x0c54, 11);
    regs.ix = mem.read16(0x63a8); // ld ix,(0x63a8) -- INDIRECT
    m.step(0x0c58, 20);
    regs.c = regs.a;
    m.step(0x0c59, 4); // ld c,a
    regs.b = 0x00;
    m.step(0x0c5b, 7); // ld b,0x00
    regs.addHl(regs.bc); // add hl,bc -- HL = 0x3CF0 + A*4 (the sprite record)
    m.step(0x0c5c, 11);

    regs.a = mem.read8(regs.hl);
    m.step(0x0c5d, 7); // ld a,(hl)
    mem.write8((regs.ix + 0x60) & 0xffff, regs.a); // ld (ix+0x60),a
    m.step(0x0c60, 19);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0c61, 6); // inc hl
    regs.a = mem.read8(regs.hl);
    m.step(0x0c62, 7); // ld a,(hl)
    mem.write8((regs.ix + 0x40) & 0xffff, regs.a); // ld (ix+0x40),a
    m.step(0x0c65, 19);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0c66, 6); // inc hl
    regs.a = mem.read8(regs.hl);
    m.step(0x0c67, 7); // ld a,(hl)
    mem.write8((regs.ix + 0x20) & 0xffff, regs.a); // ld (ix+0x20),a
    m.step(0x0c6a, 19);
    mem.write8((regs.ix - 0x20) & 0xffff, 0x8b); // ld (ix-0x20),0x8b -- NEGATIVE disp
    m.step(0x0c6e, 19);

    regs.bc = m.pop16(); // pop bc
    m.step(0x0c6f, 10);
    m.push16(regs.ix); // push ix
    m.step(0x0c71, 15);
    regs.hl = m.pop16(); // pop hl -- HL = IX
    m.step(0x0c72, 10);
    regs.de = 0xfffc;
    m.step(0x0c75, 10); // ld de,0xfffc (= -4)
    regs.addHl(regs.de); // add hl,de -- HL = IX - 4
    m.step(0x0c76, 11);
    mem.write16(0x63a8, regs.hl); // 0x63A8 = IX - 4 (next sprite slot)
    m.step(0x0c79, 16);
    regs.hl = m.pop16(); // pop hl -- restore the tile-fill pointer
    m.step(0x0c7a, 10);
    regs.de = 0xff5f;
    m.step(0x0c7d, 10); // ld de,0xff5f (= -0xA1)
    regs.addHl(regs.de); // add hl,de -- HL -= 0xA1 (next row, downward)
    m.step(0x0c7e, 11);
    regs.b = (regs.b - 1) & 0xff;
    m.step(0x0c7f, 4); // dec b
    if (regs.b !== 0) {
      m.step(0x0c29, 10); // jp nz,0x0c29 -- outer loop
      continue;
    }
    m.step(0x0c82, 10); // jp nz not taken -> exit
    break;
  }

  // -- epilogue --
  regs.de = 0x0307;
  m.step(0x0c85, 10); // ld de,0x0307
  m.push16(0x0c88);
  m.step(0x309f, 17); // call 0x309f -- enqueue DE = 0x0307
  sub_309f(m);

  regs.hl = 0x6009;
  m.step(0x0c8b, 10); // ld hl,0x6009
  mem.write8(regs.hl, 0xa0); // 0x6009 = 0xA0 (arm countdown)
  m.step(0x0c8d, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0c8e, 6); // inc hl -- HL = 0x600A
  regs.incMem8(mem, regs.hl); // inc (hl) -- 0x600A += 1
  m.step(0x0c8f, 11);
  regs.incMem8(mem, regs.hl); // inc (hl) -- 0x600A += 2 total
  m.step(0x0c90, 11);
  m.ret(); // ret (0x0C90)
}

/**
 * sub_309f -- ROM 0x309F-0x30BC  "enqueue a task"
 *
 *   309f  e5           push hl
 *   30a0  21 c0 60     ld   hl,0x60c0
 *   30a3  3a b0 60     ld   a,(0x60b0)
 *   30a6  6f           ld   l,a
 *   30a7  cb 7e        bit  7,(hl)
 *   30a9  ca bb 30     jp   z,0x30bb
 *   30ac  72           ld   (hl),d
 *   30ad  2c           inc  l
 *   30ae  73           ld   (hl),e
 *   30af  2c           inc  l
 *   30b0  7d           ld   a,l
 *   30b1  fe c0        cp   0xc0
 *   30b3  d2 b8 30     jp   nc,0x30b8
 *   30b6  3e c0        ld   a,0xc0
 *   30b8  32 b0 60     ld   (0x60b0),a
 *   30bb  e1           pop  hl
 *   30bc  c9           ret
 *
 * The task ring lives in page 0x60 with the write pointer at 0x60B0. A slot
 * is free when its bit 7 is SET -- which is why boot fills 0x60C0-0x60FF with
 * 0xFF: 0xFF is the empty marker, not zero. If the slot is occupied the
 * enqueue is silently dropped (`jp z,0x30bb` straight to the pop).
 *
 * L wraps back to 0xC0 rather than 0x00, so the ring is 0x60C0-0x60FF. Note
 * `inc l` is 8-bit: H stays 0x60 throughout.
 */
export function sub_309f(m) {
  const { regs, mem } = m;

  m.push16(regs.hl);
  m.step(0x30a0, 11);
  regs.hl = 0x60c0;
  m.step(0x30a3, 10);
  regs.a = mem.read8(0x60b0);
  m.step(0x30a6, 13);
  regs.l = regs.a;
  m.step(0x30a7, 4);

  const free = regs.bit(7, mem.read8(regs.hl));
  m.step(0x30a9, 12); // bit 7,(hl)
  if (!free) {
    m.step(0x30bb, 10); // jp z -- slot occupied, drop the task
    regs.hl = m.pop16();
    m.step(0x30bc, 10);
    m.ret();
    return;
  }
  m.step(0x30ac, 10);

  mem.write8(regs.hl, regs.d);
  m.step(0x30ad, 7);
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x30ae, 4);
  mem.write8(regs.hl, regs.e);
  m.step(0x30af, 7);
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x30b0, 4);
  regs.a = regs.l;
  m.step(0x30b1, 4);
  regs.cp(0xc0);
  m.step(0x30b3, 7);
  if (regs.fC) {
    m.step(0x30b6, 10); // jp nc not taken -- wrapped below 0xC0
    regs.a = 0xc0;
    m.step(0x30b8, 7);
  } else {
    m.step(0x30b8, 10);
  }
  mem.write8(0x60b0, regs.a);
  m.step(0x30bb, 13);
  regs.hl = m.pop16();
  m.step(0x30bc, 10);
  m.ret();
}

/**
 * sub_30e4 -- ROM 0x30E4-0x30EC  (9 bytes, 6 instructions)
 *
 *   30e4  7d           ld   a,l
 *   30e5  36 00        ld   (hl),0x00     ; loc_30e5 -- the djnz target
 *   30e7  c6 04        add  a,0x04
 *   30e9  6f           ld   l,a
 *   30ea  10 f9        djnz 0x30e5
 *   30ec  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher. Reached
 * only through handler_1977, which is not translated.
 *
 * Zeros up to B bytes at stride 4, walking L ONLY. `ld a,l` is a PROLOGUE
 * (the djnz targets 0x30E5, not the entry), and it is memory/register/flag-
 * identical whether inside or outside the loop -- it differs by 20 T only,
 * because `ld l,a` already leaves A == L at the top of each pass. Third member
 * of the state-diff-invisible / cycle-visible class (with loc_1131's ld bc,nn
 * and sub_11fa's inc e).
 *
 * FIVE ENTRY PATHS, and two are not `call`s: a TAIL JUMP at 0x30D8 (jp 0x30e4,
 * pushes nothing, so this ret returns to sub_30bd's caller) and a FALLTHROUGH
 * from entry_30db. Those callers are also >= 0x3000 (mine) and land later in
 * the drain; drafting the tail jump as a call would push 0x30DB = entry_30db,
 * running an extra six-store pass. Reported by the drafter, not absorbed.
 *
 * H IS PRESERVED ONLY BECAUSE NOTHING HERE WRITES IT, and 0x30C5/0x30CC depend
 * on that (they reload L alone). The NEVER-WRITTEN kind of preservation -- an
 * edit touching H breaks two call sites silently.
 *
 * `ld l,a` writes L ONLY -- deliberately not `regs.hl += 4`, which would carry
 * into H on an L wrap the Z80 does not do here. No entry path reaches the wrap
 * (highest exit L = 0xE4), so the 16-bit form is indistinguishable on every
 * existing path -- latent, and pinned with a SYNTHETIC boundary test.
 *
 * S8: every store is the CONSTANT 0x00 to a distinct address, so reordering or
 * miscounting the loop is invisible to final memory and to a state diff --
 * only the write trace records it. Stronger than sub_11fa, where the seven
 * stored values at least pinned each address.
 *
 * B0 = 0 would run 256 passes (djnz decrements then tests). No entry path does
 * it; not defended against because the ROM does not.
 */
export function sub_30e4(m) {
  const { regs, mem } = m;

  regs.a = regs.l;
  m.step(0x30e5, 4); // ld a,l -- PROLOGUE, the djnz target is 0x30E5 not here

  do {
    mem.write8(regs.hl, 0x00); // constant 0x00 -- order invisible to state diff
    m.step(0x30e7, 10); // ld (hl),0x00
    regs.add(0x04);
    m.step(0x30e9, 7); // add a,0x04
    regs.l = regs.a; // L ONLY -- no carry into H, unlike regs.hl += 4
    m.step(0x30ea, 4); // ld l,a
    regs.djnz();
    m.step(regs.b !== 0 ? 0x30e5 : 0x30ec, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 30ec
}

/**
 * sub_3096 -- ROM 0x3096-0x309E  (9 bytes, 7 instructions)
 *
 *   3096  06 02        ld   b,0x02
 *   3098  79           ld   a,c           ; loc_3098 -- the djnz target
 *   3099  ae           xor  (hl)
 *   309a  77           ld   (hl),a
 *   309b  19           add  hl,de
 *   309c  10 fa        djnz 0x3098
 *   309e  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher. Reached
 * only via sub_306f, itself in the untranslated 1977 subtree.
 *
 * XORs C into two bytes at HL, stride DE. B is fixed at 2. THREE LIVE-INS: HL
 * (dest), C (mask), DE (stride). DE is never set here and never set by the
 * caller sub_306f -- it is 0x0004, left as a side effect of loc_0038's
 * `ld de,0x0004` up the call chain. Both call sites are in
 * sub_306f; no other caller.
 *
 * `xor (hl)` is a READ-modify-write: it XORs the EXISTING byte with C, so the
 * read of (HL) is load-bearing -- writing C directly would be a different
 * result. The final `add hl,de` carry escapes to the caller (dead on both
 * current paths). `add hl,de` writes H/N/C; regs.addHl is required, not a bare
 * 16-bit add.
 */
export function sub_3096(m) {
  const { regs, mem } = m;

  regs.b = 0x02;
  m.step(0x3098, 7); // ld b,0x02

  do {
    regs.a = regs.c; // C is the mask, reloaded each pass and never modified
    m.step(0x3099, 4); // ld a,c
    regs.xor(mem.read8(regs.hl)); // RMW -- XOR the EXISTING byte, not just C
    m.step(0x309a, 7); // xor (hl)
    mem.write8(regs.hl, regs.a);
    m.step(0x309b, 7); // ld (hl),a
    regs.addHl(regs.de); // DE = 0x0004 live-in; carry escapes to the caller
    m.step(0x309c, 11); // add hl,de
    regs.djnz();
    m.step(regs.b !== 0 ? 0x3098 : 0x309e, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 309e
}

/**
 * entry_30db -- ROM 0x30DB-0x30E3, then FALLS THROUGH into sub_30e4
 *
 *   30db  21 4c 69     ld   hl,0x694c
 *   30de  36 00        ld   (hl),0x00
 *   30e0  2e 58        ld   l,0x58
 *   30e2  06 06        ld   b,0x06
 *   (falls through into sub_30e4 at 0x30E4)
 *
 * The FIFTH entry to sub_30e4, and a fallthrough, not a call:
 * nothing is pushed at 0x30E2->0x30E4, so sub_30e4's `ret` returns to
 * entry_30db's OWN caller. Writes 0x00 to 0x694C, then sets HL = 0x6958 and
 * B = 6 so sub_30e4 zeros 0x6958/5C/60/64/68/6C. `ld l,0x58` writes L only,
 * leaving H = 0x69.
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 */
export function entry_30db(m) {
  const { regs, mem } = m;

  regs.hl = 0x694c;
  m.step(0x30de, 10); // ld hl,0x694c
  mem.write8(regs.hl, 0x00);
  m.step(0x30e0, 10); // ld (hl),0x00
  regs.l = 0x58; // L only -- HL becomes 0x6958
  m.step(0x30e2, 7); // ld l,0x58
  regs.b = 0x06;
  m.step(0x30e4, 7); // ld b,0x06

  // FALLTHROUGH into sub_30e4, no push -- its ret returns to OUR caller.
  return sub_30e4(m);
}

/**
 * sub_3064 -- ROM 0x3064-0x3068  (5 bytes, 5 instructions)
 *
 *   3064  09           add  hl,bc
 *   3065  7e           ld   a,(hl)
 *   3066  19           add  hl,de
 *   3067  77           ld   (hl),a
 *   3068  c9           ret
 *
 * Copies one byte from (HL+BC) to (HL+BC+DE). Three live-ins: HL, BC, DE.
 * Both `add hl,rr` write H/N/C (regs.addHl); the final carry escapes to the
 * caller. Not yet wired into the live dispatcher.
 */
export function sub_3064(m) {
  const { regs, mem } = m;

  regs.addHl(regs.bc);
  m.step(0x3065, 11); // add hl,bc
  regs.a = mem.read8(regs.hl);
  m.step(0x3066, 7); // ld a,(hl)
  regs.addHl(regs.de);
  m.step(0x3067, 11); // add hl,de
  mem.write8(regs.hl, regs.a);
  m.step(0x3068, 7); // ld (hl),a

  m.ret(); // 3068
}

/**
 * entry_3009 -- ROM 0x3009-0x3049  (65 bytes, 40 instructions)
 *
 *   3009  57           ld   d,a          ; save the input in D
 *   300a  0f           rrca
 *   300b  da 22 30     jp   c,0x3022
 *   300e  0e 93        ld   c,0x93
 *   3010  0f           rrca
 *   3011  0f           rrca
 *   3012  d2 17 30     jp   nc,0x3017
 *   3015  0e 6c        ld   c,0x6c
 *   3017  07           rlca                ; loc_3017
 *   3018  da 31 30     jp   c,0x3031
 *   301b  79           ld   a,c
 *   301c  e6 f0        and  0xf0
 *   301e  4f           ld   c,a
 *   301f  c3 31 30     jp   0x3031
 *   3022  0e b4        ld   c,0xb4          ; entry_3022 -- INTERIOR label, see below
 *   3024  0f           rrca
 *   3025  0f           rrca
 *   3026  d2 2b 30     jp   nc,0x302b
 *   3029  0e 1e        ld   c,0x1e
 *   302b  cb 50        bit  2,b             ; loc_302b
 *   302d  ca 31 30     jp   z,0x3031
 *   3030  05           dec  b
 *   3031  79           ld   a,c             ; loc_3031 -- 3-way JOIN + LOOP HEAD
 *   3032  0f           rrca
 *   3033  0f           rrca
 *   3034  4f           ld   c,a
 *   3035  e6 03        and  0x03
 *   3037  b8           cp   b
 *   3038  c2 31 30     jp   nz,0x3031       ; loop while low2(C ror 2) != B
 *   303b  79           ld   a,c
 *   303c  0f           rrca
 *   303d  0f           rrca
 *   303e  e6 03        and  0x03
 *   3040  fe 03        cp   0x03
 *   3042  c0           ret  nz
 *   3043  cb 92        res  2,d
 *   3045  15           dec  d
 *   3046  c0           ret  nz
 *   3047  3e 04        ld   a,0x04
 *   3049  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher. Its
 * three call sites (0x1C9E, 0x1CBA, 0x23F4) all live in the untranslated
 * 1977 subtree.
 *
 * A and B are LIVE-IN. D holds the ORIGINAL input across the whole routine
 * (`ld d,a` at 0x3009, then nothing writes D until `res 2,d`/`dec d` at the
 * exit) -- a reuse of D in between would corrupt the exit test.
 *
 * WHAT IT DOES (mechanism only; the constants 0x93/0x6C/0xB4/0x1E are data I did
 * not interpret):
 *   0x3009-0x3030  bit-extract dispatch. rrca/rlca rotate the input; each
 *                  `jp c`/`jp nc` reads the ROTATE'S CARRY-OUT to select one of
 *                  the C constants. rrca/rlca MUST set carry from the rotated-out
 *                  bit (regs.rrca/rlca do); a plain >>/<< breaks every branch.
 *   0x3031-0x3038  the rotate-to-match LOOP. `ld a,c / rrca rrca / ld c,a` sets
 *                  C = C ror 2 each pass; `and 0x03 / cp b` stops when C's low
 *                  two bits equal B. rrca rrca is an 8-bit ror-by-2, so after 4
 *                  passes C returns to its start: the loop scans C's four 2-bit
 *                  fields for a match to B.
 *   0x303b-0x3049  two-stage exit. (C ror 2)&3 vs 3: `ret nz` returns early with
 *                  A = that value and CARRY from `cp 0x03` (0x23F7 reads it with
 *                  `rra`). Otherwise clear bit 2 of the saved input, `dec d`;
 *                  `ret nz` if non-zero, else return A = 0x04.
 *
 * FAITHFUL NON-TERMINATION: if no 2-bit field of C equals B, the
 * loop never terminates. B is live-in (and `dec`'d at 0x3030 on the bit-2 path).
 * A `for(;;)` reproduces the ROM's own hang exactly. NO iteration guard is
 * added -- the ROM has none, and a `for(i<4)` cap would silently turn the hang
 * into a wrong-but-terminating result, invisible to every terminating input.
 *
 * `res 2,d` (0x3043) is now expressible: cpu.js gained `res`/`set` in b7f5da0
 * (the draft predated it and marked this line the sole blocker). regs.res leaves
 * ALL flags unchanged, which matters here: `dec d` at 0x3045 sets the Z that the
 * `ret nz` at 0x3046 reads, so a res that clobbered a flag would be a
 * compensating-error shape -- correct D, corrupt control flow.
 *
 * `entry_3022` is an INTERIOR label despite the `entry_` prefix (a tracer
 * artifact: a run boundary observed mid-routine). Its only reference is the
 * `jp c,0x3022` at 0x300B -- no call, no external jp, no table slot. Likewise
 * loc_3017 and loc_3031 are purely internal; 0x3031 is a 3-way forward join
 * (0x3018/0x301F/0x302D) AND the loop back-edge (0x3038).
 *
 * STEP TARGET: `cp b` at 0x3037 is one byte, so its next instruction is 0x3038;
 * `m.step(0x3038, 4)` -- NOT the jp's destination (0x303B/0x3031), which would
 * skip the `jp nz` at 0x3038. Both are valid instruction boundaries, so the
 * correct target was confirmed by hand-auditing every step against the listing.
 */
export function entry_3009(m) {
  const { regs } = m;

  regs.d = regs.a; // save the input; D is untouched until the exit test
  m.step(0x300a, 4); // ld d,a
  regs.rrca();
  m.step(0x300b, 4); // rrca -- carry = old bit 0

  if (regs.fC) {
    m.step(0x3022, 10); // jp c,0x3022 TAKEN
    regs.c = 0xb4;
    m.step(0x3024, 7); // ld c,0xb4
    regs.rrca();
    m.step(0x3025, 4); // rrca
    regs.rrca();
    m.step(0x3026, 4); // rrca
    if (regs.fNC) {
      m.step(0x302b, 10); // jp nc,0x302b TAKEN
    } else {
      m.step(0x3029, 10); // jp nc,0x302b NOT taken -- fall through
      regs.c = 0x1e;
      m.step(0x302b, 7); // ld c,0x1e
    }
    // loc_302b
    regs.bit(2, regs.b); // sets Z = !bit2(B); B is unchanged
    m.step(0x302d, 8); // bit 2,b
    if (regs.fZ) {
      m.step(0x3031, 10); // jp z,0x3031 TAKEN -> join
    } else {
      m.step(0x3030, 10); // jp z,0x3031 NOT taken -- fall through
      regs.b = regs.dec8(regs.b);
      m.step(0x3031, 4); // dec b -- the loop matches against B-1 on this path
    }
  } else {
    m.step(0x300e, 10); // jp c,0x3022 NOT taken -- fall through
    regs.c = 0x93;
    m.step(0x3010, 7); // ld c,0x93
    regs.rrca();
    m.step(0x3011, 4); // rrca
    regs.rrca();
    m.step(0x3012, 4); // rrca
    if (regs.fC) {
      m.step(0x3015, 10); // jp nc,0x3017 NOT taken -- fall through
      regs.c = 0x6c;
      m.step(0x3017, 7); // ld c,0x6c
    } else {
      m.step(0x3017, 10); // jp nc,0x3017 TAKEN
    }
    // loc_3017
    regs.rlca();
    m.step(0x3018, 4); // rlca -- carry = old bit 7
    if (regs.fC) {
      m.step(0x3031, 10); // jp c,0x3031 TAKEN -> join
    } else {
      m.step(0x301b, 10); // jp c,0x3031 NOT taken -- fall through
      regs.a = regs.c;
      m.step(0x301c, 4); // ld a,c
      regs.and(0xf0);
      m.step(0x301e, 7); // and 0xf0
      regs.c = regs.a;
      m.step(0x301f, 4); // ld c,a
      m.step(0x3031, 10); // jp 0x3031 -> join
    }
  }

  // loc_3031 -- 3-way JOIN and LOOP HEAD. Rotate C right 2 per pass; stop when
  // its low 2 bits equal B. FAITHFUL non-termination if no field of C matches B.
  for (;;) {
    regs.a = regs.c;
    m.step(0x3032, 4); // ld a,c
    regs.rrca();
    m.step(0x3033, 4); // rrca
    regs.rrca();
    m.step(0x3034, 4); // rrca -- A = C ror 2
    regs.c = regs.a;
    m.step(0x3035, 4); // ld c,a
    regs.and(0x03);
    m.step(0x3037, 7); // and 0x03 -- A = (C ror 2) & 3
    regs.cp(regs.b);
    m.step(0x3038, 4); // cp b -- next instr is the jp nz at 0x3038 (STEP FIX)
    if (regs.fNZ) {
      m.step(0x3031, 10); // jp nz,0x3031 TAKEN -- loop back
      continue;
    }
    m.step(0x303b, 10); // jp nz,0x3031 NOT taken -- fall through, C holds the match
    break;
  }

  regs.a = regs.c;
  m.step(0x303c, 4); // ld a,c
  regs.rrca();
  m.step(0x303d, 4); // rrca
  regs.rrca();
  m.step(0x303e, 4); // rrca -- A = C ror 2
  regs.and(0x03);
  m.step(0x3040, 7); // and 0x03
  regs.cp(0x03);
  m.step(0x3042, 7); // cp 0x03
  if (regs.fNZ) {
    m.ret(11); // ret nz TAKEN -- returns A = (C ror 2)&3, CARRY from `cp 0x03`
    return;
  }
  m.step(0x3043, 5); // ret nz NOT taken -- fall through

  regs.d = regs.res(2, regs.d); // res 2,d -- clear bit 2 of the saved input; NO flags
  m.step(0x3045, 8); // res 2,d
  regs.d = regs.dec8(regs.d);
  m.step(0x3046, 4); // dec d -- sets the Z the next ret nz reads
  if (regs.fNZ) {
    m.ret(11); // ret nz TAKEN
    return;
  }
  m.step(0x3047, 5); // ret nz NOT taken -- fall through

  regs.a = 0x04;
  m.step(0x3049, 7); // ld a,0x04
  m.ret(); // 3049 -- returns A = 0x04
}

/**
 * sub_304a -- ROM 0x304A-0x3063  (26 bytes, 11 instructions)
 *
 *   304a  11 e0 ff     ld   de,0xffe0     ; DE = -0x20 (two's complement)
 *   304d  3a 8e 63     ld   a,(0x638e)    ; A = the index at 0x638E
 *   3050  4f           ld   c,a
 *   3051  06 00        ld   b,0x00        ; BC = A (0..255), B forced to 0
 *   3053  21 00 76     ld   hl,0x7600
 *   3056  cd 64 30     call 0x3064        ; copy (0x7600+BC) -> (0x7600+BC-0x20)
 *   3059  21 c0 75     ld   hl,0x75c0
 *   305c  cd 64 30     call 0x3064        ; copy (0x75C0+BC) -> (0x75C0+BC-0x20)
 *   305f  21 8e 63     ld   hl,0x638e
 *   3062  35           dec  (hl)          ; index at 0x638E -= 1
 *   3063  c9           ret
 *
 * Its
 * callers (0x0AF0 `call z`, 0x0B38 `call`) live in an untranslated routine, and
 * nothing in translated src references 0x304A -- so this function is dormant and
 * adding it is not yet wired into the live dispatcher.
 *
 * NO live-in registers: DE, A, C, B, HL are all set before any read (A from
 * memory). Straight-line, no branch, one unconditional ret.
 *
 * WHAT IT DOES (mechanism; 0x638E's meaning not named): loads the index at
 * 0x638E into BC (B=0), then calls sub_3064 twice to copy one byte each from
 * 0x7600+BC and 0x75C0+BC to 0x20 bytes LOWER, then decrements the index.
 *   - `ld de,0xffe0` is -0x20: sub_3064's `add hl,de` is a 16-bit add that wraps
 *     (0x7600+BC+0xFFE0 = 0x7600+BC-0x20). A naive `de = 0x0020` (reading it as a
 *     +32 forward stride) would write 0x20 too HIGH -- the discriminating hazard.
 *   - 0x75A0-0x7600 is VIDEO RAM (0x7400-0x77FF); 0x20 = one 32-col tilemap row,
 *     so each copy moves a cell one row. Stated as fact, not as purpose.
 *   - sub_3064 preserves BC and DE (touches only HL, A, flags), so the second
 *     call correctly reuses BC=index and DE=-0x20 set once at the top. This is a
 *     real cross-call dependency; it holds because sub_3064 never writes BC/DE.
 *   - `dec (hl)` at 0x638E is a work-RAM RMW; its flags escape to the caller
 *     (ret is unconditional), a live-out this unit cannot resolve (untranslated
 *     callers) -- dec8 sets them faithfully regardless (cf. entry_3009's carry).
 */
export function sub_304a(m) {
  const { regs, mem } = m;

  regs.de = 0xffe0; // -0x20; sub_3064's `add hl,de` subtracts 0x20 via wrap
  m.step(0x304d, 10); // ld de,0xffe0
  regs.a = mem.read8(0x638e);
  m.step(0x3050, 13); // ld a,(0x638e)
  regs.c = regs.a;
  m.step(0x3051, 4); // ld c,a
  regs.b = 0x00; // BC = the index, B forced to 0
  m.step(0x3053, 7); // ld b,0x00
  regs.hl = 0x7600;
  m.step(0x3056, 10); // ld hl,0x7600

  m.push16(0x3059); // call 0x3064 -- real call, sub_3064 rets back to 0x3059
  m.step(0x3064, 17);
  sub_3064(m); // preserves BC and DE

  regs.hl = 0x75c0;
  m.step(0x305c, 10); // ld hl,0x75c0

  m.push16(0x305f); // call 0x3064 -- reuses BC and DE preserved across the first
  m.step(0x3064, 17);
  sub_3064(m);

  regs.hl = 0x638e;
  m.step(0x3062, 10); // ld hl,0x638e
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)), 8); // dec (hl) -- RMW, work RAM
  m.step(0x3063, 11); // dec (hl)

  m.ret(); // 3063
}

/**
 * sub_30bd -- ROM 0x30BD-0x30DA  (30 bytes, 12 instructions)
 *
 *   30bd  21 50 69     ld   hl,0x6950
 *   30c0  06 02        ld   b,0x02
 *   30c2  cd e4 30     call 0x30e4        ; zero 2 bytes stride 4 from 0x6950
 *   30c5  2e 80        ld   l,0x80        ; L only -- HL = 0x6980 (H stays 0x69)
 *   30c7  06 0a        ld   b,0x0a
 *   30c9  cd e4 30     call 0x30e4        ; zero 10 bytes from 0x6980
 *   30cc  2e b8        ld   l,0xb8        ; HL = 0x69b8
 *   30ce  06 0b        ld   b,0x0b
 *   30d0  cd e4 30     call 0x30e4        ; zero 11 bytes from 0x69b8
 *   30d3  21 0c 6a     ld   hl,0x6a0c
 *   30d6  06 05        ld   b,0x05
 *   30d8  c3 e4 30     jp   0x30e4        ; TAIL JUMP -- 30e4's ret returns to OUR caller
 *
 * Callers
 * 0x12A3/0x1615 are in untranslated routines (0x12A3 is past handler_123c, which
 * ends 0x127B), and nothing in translated src invokes sub_30bd
 *
 * Clears four disjoint stride-4 runs in work RAM page 0x69/0x6A by calling the
 * already-integrated sub_30e4 (zero B bytes at stride 4, walking L only) four
 * times. NO live-ins (HL and B set before use).
 *
 * THE STACK SPLICE (the judgement point): the first THREE are real `call`s
 * (push a return, sub_30e4 rets back). The FOURTH is a `jp` -- a TAIL JUMP that
 * pushes NOTHING, so sub_30e4's `ret` returns to sub_30bd's OWN caller. Modelled
 * `m.step(0x30e4, 10); return sub_30e4(m)` with no push16 -- identical to
 * entry_30db's fallthrough, differing only in charging the jp's 10 T-states.
 * Translating the tail jump as a call (an extra push + an implied ret) would
 * splice a phantom frame onto the stack (the tail-jump-is-not-a-call trap;
 * cf. the rst 0x28 dispatcher that leaked a slot for the whole project).
 *
 * CROSS-CALL DEPENDENCY: `ld l,0x80` / `ld l,0xb8` reload L only, so H must
 * survive each call. sub_30e4 writes only A, L, B and flags -- never H -- so H
 * stays 0x69 across the first three runs. The fourth run reloads the full HL
 * (0x6A0C). Holds because sub_30e4 never writes H (verified in its body).
 */
export function sub_30bd(m) {
  const { regs } = m;

  regs.hl = 0x6950;
  m.step(0x30c0, 10); // ld hl,0x6950
  regs.b = 0x02;
  m.step(0x30c2, 7); // ld b,0x02
  m.push16(0x30c5); // call 0x30e4 -- real call, rets back to 0x30c5
  m.step(0x30e4, 17);
  sub_30e4(m); // preserves H

  regs.l = 0x80; // L only -- HL = 0x6980, H preserved at 0x69
  m.step(0x30c7, 7); // ld l,0x80
  regs.b = 0x0a;
  m.step(0x30c9, 7); // ld b,0x0a
  m.push16(0x30cc); // call 0x30e4 -- rets back to 0x30cc
  m.step(0x30e4, 17);
  sub_30e4(m);

  regs.l = 0xb8; // HL = 0x69b8
  m.step(0x30ce, 7); // ld l,0xb8
  regs.b = 0x0b;
  m.step(0x30d0, 7); // ld b,0x0b
  m.push16(0x30d3); // call 0x30e4 -- rets back to 0x30d3
  m.step(0x30e4, 17);
  sub_30e4(m);

  regs.hl = 0x6a0c; // full HL reload for the last run
  m.step(0x30d6, 10); // ld hl,0x6a0c
  regs.b = 0x05;
  m.step(0x30d8, 7); // ld b,0x05

  // TAIL JUMP: no push. sub_30e4's ret returns to sub_30bd's caller.
  m.step(0x30e4, 10); // jp 0x30e4
  return sub_30e4(m);
}

/**
 * sub_306f -- ROM 0x306F-0x3095  (39 bytes, 19 instructions)
 *
 *   306f  21 af 62     ld   hl,0x62af
 *   3072  34           inc  (hl)
 *   3073  7e           ld   a,(hl)
 *   3074  e6 07        and  0x07
 *   3076  c0           ret  nz
 *   3077  21 0b 69     ld   hl,0x690b
 *   307a  0e fc        ld   c,0xfc
 *   307c  ff           rst  0x38        ; = call 0x0038 (loc_0038), NOT a skip
 *   307d  0e 81        ld   c,0x81
 *   307f  21 09 69     ld   hl,0x6909
 *   3082  cd 96 30     call 0x3096
 *   3085  21 1d 69     ld   hl,0x691d
 *   3088  cd 96 30     call 0x3096
 *   308b  cd 57 00     call 0x0057
 *   308e  e6 80        and  0x80
 *   3090  21 2d 69     ld   hl,0x692d
 *   3093  ae           xor  (hl)
 *   3094  77           ld   (hl),a
 *   3095  c9           ret
 *
 *
 * Callers 0x0AE8/0x1732/0x1757 are untranslated, and
 * nothing in translated src invokes sub_306f.
 *
 * EVERY-8TH-CALL GATE: `inc (hl)` bumps the counter at 0x62AF, and
 * `ret nz` after `and 0x07` returns on 7 of every 8 calls. The body (0x3077+)
 * runs only when the counter is a multiple of 8. `ret nz` FALLS THROUGH on Z --
 * stated, not assumed terminal (the drafter-contract's named defect class).
 *
 * `rst 0x38` (0x307C) is a PLAIN CALL into loc_0038, NOT the conditional-skip
 * semantics of rst 0x08/0x10. Modelled exactly as the existing
 * rst 0x38 site at nmi.js (push the return, step 11 T to 0x0038, call the
 * handler whose `ret` pops it) -- the same ld hl,0x690b / ld c,0xfc setup even
 * appears there.
 *
 * DE IS NEVER SET IN THIS ROUTINE. sub_3096's stride comes from
 * loc_0038's `ld de,0x0004` SIDE EFFECT: loc_0038 sets DE=0x0004, and neither
 * sub_003d (loc_0038's loop) nor sub_3096 writes DE, so DE=0x0004 survives from
 * the rst into both `call 0x3096`. Load-bearing and invisible -- reordering the
 * rst after the calls, or a loc_0038 that dropped the DE write, would break the
 * stride with nothing red in sub_306f. Verified against loc_0038's body.
 *
 * C is reloaded across the rst deliberately: 0xFC (=-4) is the addend
 * loc_0038 subtracts; 0x81 is the XOR mask sub_3096 applies. loc_0038 reads C
 * but never writes it, so the reload is a genuine operand change, not a restore.
 *
 * `call 0x0057` returns the pseudo-random sum in A; `and 0x80` keeps bit 7, and
 * `xor (hl) / ld (hl),a` toggles bit 7 of 0x692D on it. `xor (hl)`
 * is a RMW of the existing byte (like sub_3096). Both exits leave live flags:
 * the `ret nz` hands back `and 0x07`'s, the `ret` `xor (hl)`'s.
 */
export function sub_306f(m) {
  const { regs, mem } = m;

  regs.hl = 0x62af;
  m.step(0x3072, 10); // ld hl,0x62af
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (hl) -- counter++, inc8 preserves carry
  m.step(0x3073, 11); // inc (hl)
  regs.a = mem.read8(regs.hl);
  m.step(0x3074, 7); // ld a,(hl)
  regs.and(0x07);
  m.step(0x3076, 7); // and 0x07
  if (regs.fNZ) {
    m.ret(11); // ret nz -- 7 of every 8 calls exit here
    return;
  }
  m.step(0x3077, 5); // ret nz NOT taken -- fall through

  regs.hl = 0x690b;
  m.step(0x307a, 10); // ld hl,0x690b
  regs.c = 0xfc; // -4: loc_0038 subtracts 4 from each of 10 bytes
  m.step(0x307c, 7); // ld c,0xfc

  // rst 0x38 -- a real CALL to loc_0038 (push the return, ret pops it), NOT a
  // skip. loc_0038 sets DE=0x0004 as the side effect the sub_3096 calls need.
  m.push16(0x307d);
  m.step(0x0038, 11); // rst 0x38
  loc_0038(m); // sets DE=0x0004; leaves it (sub_003d only reads DE)

  regs.c = 0x81; // XOR mask for the two sub_3096 calls
  m.step(0x307f, 7); // ld c,0x81
  regs.hl = 0x6909;
  m.step(0x3082, 10); // ld hl,0x6909
  m.push16(0x3085);
  m.step(0x3096, 17); // call 0x3096
  sub_3096(m); // DE=0x0004 from the rst; preserves DE and C

  regs.hl = 0x691d;
  m.step(0x3088, 10); // ld hl,0x691d
  m.push16(0x308b);
  m.step(0x3096, 17); // call 0x3096
  sub_3096(m); // DE still 0x0004 from the rst

  m.push16(0x308e);
  m.step(0x0057, 17); // call 0x0057
  sub_0057(m); // A = (0x6018)+(0x601A)+(0x6019), written back to 0x6018

  regs.and(0x80); // keep bit 7 of the sum
  m.step(0x3090, 7); // and 0x80
  regs.hl = 0x692d;
  m.step(0x3093, 10); // ld hl,0x692d
  regs.xor(mem.read8(regs.hl)); // xor (hl) -- RMW, toggle bit 7 of 0x692D
  m.step(0x3094, 7); // xor (hl)
  mem.write8(regs.hl, regs.a);
  m.step(0x3095, 7); // ld (hl),a

  m.ret(); // 3095 -- xor (hl) flags escape to the caller
}

/**
 * entry_313c -- ROM 0x313C-0x31B0  (117 bytes, 50 instructions)
 *
 * A per-object state machine: scans 5 objects (stride 0x20 from 0x6400), counts
 * the non-empty ones in 0x63A1, and on ZERO count does a CONDITIONAL STACK SPLICE
 * (0x3179: inc sp x2 then ret) -- the caller's-caller-skip class (entry_24b4 /
 * guard_3110 idiom, precedented at state0.js inc-sp splices). It discards
 * entry_30ed's pushed return (0x30F3) and returns to entry_30ed's OWN caller,
 * skipping entry_30ed's remaining `call 0x31b1` / `call 0x34f3`.
 *
 *   3176  cp   0x00
 *   3178  ret  nz            ; counter != 0 -> NORMAL return to 0x30F3
 *   3179  inc  sp            ; counter == 0 -> SPLICE:
 *   317a  inc  sp            ;   discard the caller's return address
 *   317b  ret                ;   -> return to the CALLER'S CALLER
 *
 * SKIP-CAPABLE: returns a boolean per the caller-skip convention (cf. sub_33a1) --
 * `true` on a normal ret (0x3178 ret nz / 0x3194 ret z), `false` on the splice --
 * so its future caller entry_30ed guards it with `if (!entry_313c(m)) return;`.
 * (The draft skeleton used bare `return`; the integrator applied the boolean form
 * that callcheck detects via `return false;`.)
 *
 * Calls nothing (self-contained; no callee edges). entry_3195/loc_317c are
 * INTERIOR labels -- raw-ROM (maincpu.bin) reference scan: 0x3195 has one literal
 * ref (jp nz @318a, interior), 0x317c one (jp z @314f, interior), zero external
 * (a byte-scan FLOOR). `add ix,de` uses regs.addIx (add16 flags),
 * NOT open-coded (the sub_0593 lesson).
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: only caller is 0x30F0 (entry_30ed, the
 * orchestrator), which is not translated -- nothing in translated src reaches it.
 */
export function entry_313c(m) {
  const { regs, mem } = m;

  regs.ix = 0x6400;
  m.step(0x3140, 14); // ld ix,0x6400
  regs.xor(regs.a);
  m.step(0x3141, 4); // xor a
  mem.write8(0x63a1, regs.a); // counter = 0
  m.step(0x3144, 13); // ld (0x63a1),a
  regs.b = 0x05;
  m.step(0x3146, 7); // ld b,0x05
  regs.de = 0x0020;
  m.step(0x3149, 10); // ld de,0x0020

  for (;;) {
    // loc_3149
    regs.a = mem.read8((regs.ix + 0x00) & 0xffff);
    m.step(0x314c, 19); // ld a,(ix+0x00)
    regs.cp(0x00);
    m.step(0x314e, 7); // cp 0x00
    if (regs.fZ) {
      m.step(0x317c, 10); // jp z,0x317c -- empty slot
      // -- loc_317c: empty-slot handling --
      regs.a = mem.read8(0x63a1);
      m.step(0x317f, 13); // ld a,(0x63a1)
      regs.cp(0x05);
      m.step(0x3181, 7); // cp 0x05
      if (regs.fZ) {
        m.step(0x316a, 10); // jp z,0x316a -- counter==5, continue loop
      } else {
        m.step(0x3184, 10);
        regs.a = mem.read8(0x6227);
        m.step(0x3187, 13); // ld a,(0x6227)
        regs.cp(0x02);
        m.step(0x3189, 7); // cp 0x02
        let atInsert = false;
        if (!regs.fZ) {
          m.step(0x3195, 10); // jp nz,0x3195
          atInsert = true;
        } else {
          m.step(0x318c, 10);
          regs.a = mem.read8(0x63a1);
          m.step(0x318f, 13); // ld a,(0x63a1)
          regs.c = regs.a;
          m.step(0x3190, 4); // ld c,a
          regs.a = mem.read8(0x6380);
          m.step(0x3193, 13); // ld a,(0x6380)
          regs.cp(regs.c);
          m.step(0x3194, 4); // cp c
          if (regs.fZ) { m.ret(11); return true; } // ret z -- 0x6380==counter, NORMAL
          m.step(0x3195, 5); // ret z NOT taken
          atInsert = true;
        }
        if (atInsert) {
          // -- entry_3195: insertion --
          regs.a = mem.read8(0x63a0);
          m.step(0x3198, 13); // ld a,(0x63a0)
          regs.cp(0x01);
          m.step(0x319a, 7); // cp 0x01
          if (!regs.fZ) {
            m.step(0x316a, 10); // jp nz,0x316a -- continue loop
          } else {
            m.step(0x319d, 10);
            mem.write8((regs.ix + 0x00) & 0xffff, regs.a); // A = 1 here
            m.step(0x31a0, 19); // ld (ix+0x00),a
            mem.write8((regs.ix + 0x18) & 0xffff, regs.a);
            m.step(0x31a3, 19); // ld (ix+0x18),a
            regs.xor(regs.a);
            m.step(0x31a4, 4); // xor a
            mem.write8(0x63a0, regs.a); // clear 0x63a0
            m.step(0x31a7, 13); // ld (0x63a0),a
            regs.a = mem.read8(0x63a1);
            m.step(0x31aa, 13); // ld a,(0x63a1)
            regs.a = regs.inc8(regs.a);
            m.step(0x31ab, 4); // inc a
            mem.write8(0x63a1, regs.a); // counter++
            m.step(0x31ae, 13); // ld (0x63a1),a
            m.step(0x316a, 10); // jp 0x316a
          }
        }
      }
    } else {
      // -- object non-empty --
      m.step(0x3151, 10); // jp z,0x317c NOT taken
      regs.a = mem.read8(0x63a1);
      m.step(0x3154, 13); // ld a,(0x63a1)
      regs.a = regs.inc8(regs.a);
      m.step(0x3155, 4); // inc a
      mem.write8(0x63a1, regs.a); // counter++
      m.step(0x3158, 13); // ld (0x63a1),a
      regs.a = 0x01;
      m.step(0x315a, 7); // ld a,0x01
      mem.write8((regs.ix + 0x08) & 0xffff, regs.a); // (ix+8) = 1
      m.step(0x315d, 19); // ld (ix+0x08),a
      regs.a = mem.read8(0x6217);
      m.step(0x3160, 13); // ld a,(0x6217)
      regs.cp(0x01);
      m.step(0x3162, 7); // cp 0x01
      if (!regs.fZ) {
        m.step(0x316a, 10); // jp nz,0x316a
      } else {
        m.step(0x3165, 10);
        regs.a = 0x00;
        m.step(0x3167, 7); // ld a,0x00
        mem.write8((regs.ix + 0x08) & 0xffff, regs.a); // (ix+8) = 0 if 0x6217==1
        m.step(0x316a, 19); // ld (ix+0x08),a
      }
    }

    // loc_316a -- loop tail
    regs.addIx(regs.de);
    m.step(0x316c, 15); // add ix,de
    regs.djnz();
    m.step(regs.b !== 0 ? 0x3149 : 0x316e, regs.b !== 0 ? 13 : 8); // djnz
    if (regs.b === 0) break;
  }

  // after loop
  regs.hl = 0x63a0;
  m.step(0x3171, 10); // ld hl,0x63a0
  mem.write8(regs.hl, 0x00); // clear 0x63a0
  m.step(0x3173, 10); // ld (hl),0x00
  regs.a = mem.read8(0x63a1);
  m.step(0x3176, 13); // ld a,(0x63a1)
  regs.cp(0x00);
  m.step(0x3178, 7); // cp 0x00
  if (!regs.fZ) { m.ret(11); return true; } // ret nz -- counter != 0, NORMAL return
  m.step(0x3179, 5); // ret nz NOT taken

  // *** SPLICE: counter == 0. Discard the caller's return address (inc sp x2),
  // *** then ret to the caller's caller (0x30F3 was discarded). guard_3110 idiom.
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x317a, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x317b, 6); // inc sp
  m.ret(); // returns to the CALLER'S CALLER
  return false; // SKIP-CAPABLE: false == caller (entry_30ed) was spliced past
}

/**
 * sub_31dd -- ROM 0x31DD-0x31F5  (25 bytes, 13 instructions)
 *
 *   31dd  3a 80 63     ld   a,(0x6380)
 *   31e0  fe 03        cp   0x03
 *   31e2  f8           ret  m             ; SIGNED return (A-3 negative), NOT ret c
 *   31e3  cd f6 31     call 0x31f6        ; callee returns a value in A
 *   31e6  fe 01        cp   0x01
 *   31e8  c0           ret  nz
 *   31e9  21 39 64     ld   hl,0x6439
 *   31ec  3e 02        ld   a,0x02
 *   31ee  77           ld   (hl),a
 *   31ef  21 79 64     ld   hl,0x6479
 *   31f2  3e 02        ld   a,0x02
 *   31f4  77           ld   (hl),a
 *   31f5  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: only caller is 0x31B1 (entry_31b1, the object
 * processor, untranslated), and nothing in translated src invokes sub_31dd.
 *
 * A three-part gated write: writes 2 to 0x6439 AND 0x6479 only when 0x6380 >= 3
 * (signed) AND sub_31f6() == 1 (i.e. (0x6018&3)==1 AND 0x601a==1). Now unblocked
 * -- its callee sub_31f6 landed in drain #10.
 *
 * `ret m` (0x31E2) is the FIRST translated use of the SIGN flag in control flow.
 * It returns on fM (F_S = bit 7 of A-3), NOT carry: for A >= 0x83 it diverges
 * from `ret c` (A=0x83 -> A-3=0x80, sign set -> ret m returns, carry clear -> ret
 * c would not). Latent on real tapes (sub_30fa clamps 0x6380 < 6), but the
 * instruction is signed -- pinned by a SYNTHETIC 0x83 test. fM reads F_S,
 * which `cp` sets correctly (already tested); no cpu.js change needed. Both
 * conditional rets FALL THROUGH; 0x6380/0x6439/0x6479 not interpreted.
 */
export function sub_31dd(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6380);
  m.step(0x31e0, 13); // ld a,(0x6380)
  regs.cp(0x03);
  m.step(0x31e2, 7); // cp 0x03
  if (regs.fM) {
    m.ret(11); // ret m -- SIGNED (fM = sign of A-3), NOT fC
    return;
  }
  m.step(0x31e3, 5); // ret m NOT taken -- fall through

  m.push16(0x31e6);
  m.step(0x31f6, 17); // call 0x31f6
  sub_31f6(m); // returns a value in A; cp 0x01 below re-sets the flags

  regs.cp(0x01);
  m.step(0x31e8, 7); // cp 0x01
  if (regs.fNZ) {
    m.ret(11); // ret nz -- A != 1
    return;
  }
  m.step(0x31e9, 5); // ret nz NOT taken -- fall through

  regs.hl = 0x6439;
  m.step(0x31ec, 10); // ld hl,0x6439
  regs.a = 0x02;
  m.step(0x31ee, 7); // ld a,0x02
  mem.write8(regs.hl, regs.a);
  m.step(0x31ef, 7); // ld (hl),a
  regs.hl = 0x6479;
  m.step(0x31f2, 10); // ld hl,0x6479
  regs.a = 0x02;
  m.step(0x31f4, 7); // ld a,0x02
  mem.write8(regs.hl, regs.a);
  m.step(0x31f5, 7); // ld (hl),a

  m.ret(); // 31f5
}

/**
 * sub_31f6 -- ROM 0x31F6-0x3201  (12 bytes, 6 instructions)
 *
 *   31f6  3a 18 60     ld   a,(0x6018)
 *   31f9  e6 03        and  0x03
 *   31fb  fe 01        cp   0x01
 *   31fd  c0           ret  nz            ; returns A = 0x6018&3 (0/2/3), != 1
 *   31fe  3a 1a 60     ld   a,(0x601a)
 *   3201  c9           ret                ; returns A = 0x601a
 *
 *
 * only caller is 0x31E3 inside the untranslated sub_31dd, and nothing in
 * translated src references sub_31f6. Leaf.
 *
 * A value-returning helper: A = mem[0x6018] & 3; if that is 1, return
 * A = mem[0x601a], else return A = mem[0x6018] & 3 (one of 0/2/3). A is LIVE-OUT
 * -- sub_31dd does `cp 0x01` on it immediately -- so the early `ret nz` returns
 * a REAL value (0/2/3), not "nothing". `ret nz` FALLS THROUGH on Z;
 * stated, not assumed terminal. 0x6018/0x601a not interpreted.
 */
export function sub_31f6(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6018);
  m.step(0x31f9, 13); // ld a,(0x6018)
  regs.and(0x03);
  m.step(0x31fb, 7); // and 0x03
  regs.cp(0x01);
  m.step(0x31fd, 7); // cp 0x01
  if (regs.fNZ) {
    m.ret(11); // ret nz -- returns A = 0x6018&3 (!= 1), a real value
    return;
  }
  m.step(0x31fe, 5); // ret nz NOT taken -- fall through

  regs.a = mem.read8(0x601a);
  m.step(0x3201, 13); // ld a,(0x601a)
  m.ret(); // 3201 -- returns A = 0x601a
}

/**
 * loc_3445 -- ROM 0x3445-0x3477, the table-walk + finalize TAIL of sub_342c.
 *
 *   3445  7e           ld   a,(hl)
 *   3446  fe aa        cp   0xaa           ; terminator?
 *   3448  ca 56 34     jp   z,0x3456
 *   344b  dd 77 05     ld   (ix+0x05),a    ; store the current entry
 *   344e  23           inc  hl
 *   344f  dd 75 1a     ld   (ix+0x1a),l    ; save the advanced pointer
 *   3452  dd 74 1b     ld   (ix+0x1b),h
 *   3455  c9           ret
 *   3456  af           xor  a               ; loc_3456 -- finalize
 *   3457  dd 77 13     ld   (ix+0x13),a
 *   345a  dd 77 18     ld   (ix+0x18),a
 *   345d  dd 77 0d     ld   (ix+0x0d),a
 *   3460  dd 77 1c     ld   (ix+0x1c),a
 *   3463  dd 7e 03     ld   a,(ix+0x03)
 *   3466  dd 77 0e     ld   (ix+0x0e),a
 *   3469  dd 7e 05     ld   a,(ix+0x05)
 *   346c  dd 77 0f     ld   (ix+0x0f),a
 *   346f  dd 36 1a 00  ld   (ix+0x1a),0x00  ; clear the saved pointer
 *   3473  dd 36 1b 00  ld   (ix+0x1b),0x00
 *   3477  c9           ret
 *
 * FACTORED OUT BECAUSE IT IS SHARED: sub_3478 (the twin) does `jp 0x3445` from
 * 0x34A5 and 0x34B6, jumping INTO this tail rather than calling it -- so both
 * routines' rets are this block's rets. Same shape as loc_0038/sub_003d in
 * nmi.js. sub_342c falls through into it; sub_3478 will jump to it.
 */
function loc_3445(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = mem.read8(regs.hl);
  m.step(0x3446, 7); // ld a,(hl)
  regs.cp(0xaa);
  m.step(0x3448, 7); // cp 0xaa
  if (regs.fZ) {
    // loc_3456 -- terminator reached: finalize the object's fields
    m.step(0x3456, 10); // jp z,0x3456 TAKEN
    regs.xor(regs.a); // xor a -- A = 0
    m.step(0x3457, 4); // xor a
    mem.write8(R(0x13), regs.a);
    m.step(0x345a, 19); // ld (ix+0x13),a
    mem.write8(R(0x18), regs.a);
    m.step(0x345d, 19); // ld (ix+0x18),a
    mem.write8(R(0x0d), regs.a);
    m.step(0x3460, 19); // ld (ix+0x0d),a
    mem.write8(R(0x1c), regs.a);
    m.step(0x3463, 19); // ld (ix+0x1c),a
    regs.a = mem.read8(R(0x03));
    m.step(0x3466, 19); // ld a,(ix+0x03)
    mem.write8(R(0x0e), regs.a);
    m.step(0x3469, 19); // ld (ix+0x0e),a
    regs.a = mem.read8(R(0x05));
    m.step(0x346c, 19); // ld a,(ix+0x05)
    mem.write8(R(0x0f), regs.a);
    m.step(0x346f, 19); // ld (ix+0x0f),a
    mem.write8(R(0x1a), 0x00);
    m.step(0x3473, 19); // ld (ix+0x1a),0x00
    mem.write8(R(0x1b), 0x00);
    m.step(0x3477, 19); // ld (ix+0x1b),0x00
    m.ret(); // 3477
    return;
  }
  m.step(0x344b, 10); // jp z NOT taken -- an ordinary entry

  mem.write8(R(0x05), regs.a);
  m.step(0x344e, 19); // ld (ix+0x05),a
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x344f, 6); // inc hl -- 16-bit, unlike the inc l elsewhere
  mem.write8(R(0x1a), regs.l);
  m.step(0x3452, 19); // ld (ix+0x1a),l
  mem.write8(R(0x1b), regs.h);
  m.step(0x3455, 19); // ld (ix+0x1b),h

  m.ret(); // 3455
}

/**
 * sub_342c -- ROM 0x342C-0x3477  (76 bytes, 26 instructions)
 *
 *   342c  dd 6e 1a     ld   l,(ix+0x1a)     ; reload the saved table pointer
 *   342f  dd 66 1b     ld   h,(ix+0x1b)
 *   3432  af           xor  a               ; A = 0 AND carry CLEARED
 *   3433  01 00 00     ld   bc,0x0000
 *   3436  ed 4a        adc  hl,bc           ; 16-bit ZERO TEST on HL
 *   3438  c2 42 34     jp   nz,0x3442
 *   343b  21 8c 3a     ld   hl,0x3a8c       ; first use: point at the table
 *   343e  dd 36 03 26  ld   (ix+0x03),0x26
 *   3442  dd 34 03     inc  (ix+0x03)       ; loc_3442
 *   (falls through into loc_3445 -- see above)
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x32CE (sub_32bd, untranslated).
 * Calls nothing; IX live-in.
 *
 * Walks an animation table one entry per call: the saved pointer lives in
 * (ix+0x1a):(ix+0x1b); if it is zero this is the first call, so HL is pointed at
 * the table (0x3A8C) and (ix+0x03) seeded to 0x26. Either way (ix+0x03) is then
 * incremented and the tail (loc_3445) stores the entry and advances the pointer,
 * or finalizes on the 0xAA terminator. Table contents / field meanings not
 * interpreted.
 *
 * THE ZERO TEST IS WHY adcHl EXISTS. `xor a` clears carry AND zeroes A; `ld
 * bc,0`; `adc hl,bc` then computes HL + 0 + 0 = HL purely to SET Z from the
 * 16-bit result. `add hl,bc` PRESERVES Z and would never produce this branch --
 * the draft's S6 claimed the form had precedent and it did not, so adcHl was
 * pinned against MAME 0.288 and landed first.
 *
 * S7 TWIN: sub_3478 shares this routine's prefix instruction-for-instruction AND
 * jumps into its loc_3445 tail. loc_3445 is factored out for that reason; the
 * twins are NOT interchangeable and must not be written from one another.
 */
export function sub_342c(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.l = mem.read8(R(0x1a));
  m.step(0x342f, 19); // ld l,(ix+0x1a)
  regs.h = mem.read8(R(0x1b));
  m.step(0x3432, 19); // ld h,(ix+0x1b)
  regs.xor(regs.a); // xor a -- A = 0, and CARRY CLEARED for the adc below
  m.step(0x3433, 4); // xor a
  regs.bc = 0x0000;
  m.step(0x3436, 10); // ld bc,0x0000
  regs.adcHl(regs.bc); // adc hl,bc -- sets Z iff the saved pointer is zero
  m.step(0x3438, 15); // adc hl,bc
  if (regs.fNZ) {
    m.step(0x3442, 10); // jp nz,0x3442 TAKEN -- pointer already established
  } else {
    m.step(0x343b, 10); // jp nz NOT taken -- first call, initialise
    regs.hl = 0x3a8c;
    m.step(0x343e, 10); // ld hl,0x3a8c
    mem.write8(R(0x03), 0x26);
    m.step(0x3442, 19); // ld (ix+0x03),0x26
  }

  // loc_3442
  regs.incMem8(mem, R(0x03)); // inc (ix+0x03)
  m.step(0x3445, 23); // inc (ix+0x03)

  // FALLTHROUGH into loc_3445 -- its rets are this routine's rets.
  return loc_3445(m);
}

/**
 * entry_3e88 -- ROM 0x3E88-0x3E98  (5 code bytes + 12 inline-table bytes)
 *
 *   3e88  3a 27 62    ld   a,(0x6227)
 *  3e8b e5 push hl ; handed to the dispatch target
 *   3e8c  ef          rst  0x28              ; TAIL dispatch through the table below
 *   ; table 0x3E8D-0x3E98:  0x0000  0x3E99  0x28B0  0x28E0  0x2901  0x0000
 *
 * the 12-byte table is read from ROM by sub_0028, not
 * transcribed.
 * Not yet wired into the live dispatcher: called only from 0x286B (< 0x3000,
 * untranslated); nothing in translated src invokes entry_3e88, and its four
 * dispatch targets are reached ONLY through THIS table -- never through the
 * executed NMI (0x00CA) / substate (0x0748) / sub_30fa (0x3104) dispatches
 * (grep-confirmed). Wiring the four targets into dispatchGameState (nmi.js)
 * becomes relevant only once handler_1977 lands and this chain actually runs.
 *
 * THE PUSH/POP-ACROSS-DISPATCH SHAPE (why this is NOT the sub_30fa tail case,
 * even though both end in rst 0x28). entry_3e88 does `push hl` BEFORE the rst
 * precisely because sub_0028 clobbers HL (its own `pop hl` takes the table base
 * 0x3E8D into HL). The pushed HL sits BELOW that on the stack; the target
 * (entry_3e99, table entry 1) recovers it with its first instruction, `pop hl`,
 * and passes H/L down to entry_3ec3 as collision bounds. So the push is a
 * live-in hand-off across the dispatch boundary, not decorative.
 *
 * STILL A TAIL DISPATCH for frame accounting: the rst is entry_3e88's LAST
 * instruction (0x3E8D+ is table DATA), so entry_3e88 has no frame of its own when
 * the target rets -- the target returns straight to entry_3e88's caller.
 * `return sub_0028(...)` therefore passes the target's value up transparently, and
 * the extra pushed HL is balanced by the target's `pop hl`.
 *
 * THE STACK-BALANCE CROSS-REGION INVARIANT.
 * The table's non-null targets are entry_3e99 (mine) and 0x28B0/0x28E0/0x2901
 *  (< 0x3000). entry_3e99 pops the pushed HL; whether the three
 * targets also pop is THEIR units' business. A target that does not pop leaves
 * the stack unbalanced across the dispatch. Inert today; load-bearing
 * when 0x1977 lands. Two `dw 0x0000` guards (indices 0 and 5) are the
 * reset-vector null guard for an out-of-range 0x6227 (its writers' business).
 * `rst 0x28` is precedented (sub_0028), applied with table base 0x3E8D, not
 * re-derived. 0x6227 not interpreted.
 */
export function entry_3e88(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6227);
  m.step(0x3e8b, 13); // ld a,(0x6227)
  m.push16(regs.hl); // push hl -- handed to the dispatch target through the stack
  m.step(0x3e8c, 11); // push hl

  // rst 0x28 -- TAIL dispatch through the inline table at 0x3E8D. rst pushes the
  // table base (0x3E8D); sub_0028 pops it, indexes table[A] from ROM, dispatches,
  // and returns the target's value, which we pass straight up.
  m.push16(0x3e8d);
  m.step(0x0028, 11); // rst 0x28
  return sub_0028(m, "0x3E8D (entry_3e88 dispatch)");
}

/**
 * entry_3e99 -- ROM 0x3E99-0x3EC2  (42 bytes, 20 instructions)
 *
 *   3e99  e1           pop  hl            ; recover entry_3e88's pushed HL
 *   3e9a  af           xor  a
 *   3e9b  32 60 60     ld   (0x6060),a    ; clear the collision counter
 *   3e9e  06 0a        ld   b,0x0a
 *   3ea0  11 20 00     ld   de,0x0020
 *   3ea3  dd 21 00 67  ld   ix,0x6700
 *   3ea7  cd c3 3e     call 0x3ec3        ; count overlaps in group 1 (10 objects)
 *   3eaa  06 05        ld   b,0x05        ; entry_3eaa
 *   3eac  dd 21 00 64  ld   ix,0x6400
 *   3eb0  cd c3 3e     call 0x3ec3        ; count overlaps in group 2 (5 objects)
 *   3eb3  3a 60 60     ld   a,(0x6060)
 *   3eb6  a7           and  a
 *   3eb7  c8           ret  z             ; count 0 -> code 0
 *   3eb8  fe 01        cp   0x01
 *   3eba  c8           ret  z             ; count 1 -> code 1
 *   3ebb  fe 03        cp   0x03
 *   3ebd  3e 03        ld   a,0x03
 *   3ebf  d8           ret  c             ; count 2 (< 3) -> code 3
 *   3ec0  3e 07        ld   a,0x07
 *   3ec2  c9           ret                ; count >= 3 -> code 7
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: reached ONLY via entry_3e88's rst 0x28 table
 * (entry 1), which is untranslated. Its two callees are both entry_3ec3
 * (drain #26). LIVE-INS: HL (off the stack), IY, C, H, L (the last four passed
 * through to entry_3ec3).
 *
 * THE PUSH/POP-ACROSS-DISPATCH SHAPE (this is why it is NOT the 30fa tail case).
 * entry_3e88 does `push hl` BEFORE its rst 0x28 precisely because sub_0028 clobbers
 * HL: sub_0028's own `pop hl` takes the table base into HL. entry_3e99's first
 * instruction, `pop hl`, RECOVERS entry_3e88's saved HL from beneath that. So
 * the pop is not decorative -- it restores a live-in that the dispatch mechanism
 * destroyed. Modelled `regs.hl = m.pop16()`.
 *
 * NOT skip-capable: no inc sp, all exits are ordinary `ret`. It returns a
 * collision-severity CODE in A (count 0/1/2/>=3 -> 0/1/3/7), not a boolean, so
 * when entry_3e88 lands its dispatchGameState arm is a plain `return
 * entry_3e99(m)` like the game-state handlers. `cp 0x03` then `ld a,0x03` then
 * `ret c` reads the carry from the cp ACROSS the flag-neutral `ld` -- the value
 * 0x03 is loaded before the branch that decides whether to return it. 0x6060 /
 * the object fields not interpreted.
 */
export function entry_3e99(m) {
  const { regs, mem } = m;

  regs.hl = m.pop16(); // pop hl -- recover entry_3e88's saved HL (sub_0028 clobbered it)
  m.step(0x3e9a, 10); // pop hl
  regs.xor(regs.a); // xor a -- A = 0
  m.step(0x3e9b, 4); // xor a
  mem.write8(0x6060, regs.a);
  m.step(0x3e9e, 13); // ld (0x6060),a -- clear the counter
  regs.b = 0x0a;
  m.step(0x3ea0, 7); // ld b,0x0a
  regs.de = 0x0020;
  m.step(0x3ea3, 10); // ld de,0x0020
  regs.ix = 0x6700;
  m.step(0x3ea7, 14); // ld ix,0x6700

  m.push16(0x3eaa);
  m.step(0x3ec3, 17); // call 0x3ec3
  entry_3ec3(m); // group 1; leaves 0x6060 = overlap count so far

  regs.b = 0x05;
  m.step(0x3eac, 7); // ld b,0x05
  regs.ix = 0x6400;
  m.step(0x3eb0, 14); // ld ix,0x6400 -- DE still 0x0020 from above

  m.push16(0x3eb3);
  m.step(0x3ec3, 17); // call 0x3ec3
  entry_3ec3(m); // group 2; accumulates into the same 0x6060

  regs.a = mem.read8(0x6060);
  m.step(0x3eb6, 13); // ld a,(0x6060)
  regs.and(regs.a); // and a
  m.step(0x3eb7, 4); // and a
  if (regs.fZ) {
    m.ret(11); // ret z -- count 0 -> code 0
    return;
  }
  m.step(0x3eb8, 5); // ret z NOT taken
  regs.cp(0x01);
  m.step(0x3eba, 7); // cp 0x01
  if (regs.fZ) {
    m.ret(11); // ret z -- count 1 -> code 1
    return;
  }
  m.step(0x3ebb, 5); // ret z NOT taken
  regs.cp(0x03); // sets carry if count < 3
  m.step(0x3ebd, 7); // cp 0x03
  regs.a = 0x03; // flag-neutral -- carry from cp 0x03 survives
  m.step(0x3ebf, 7); // ld a,0x03
  if (regs.fC) {
    m.ret(11); // ret c -- count 2 (< 3) -> code 3
    return;
  }
  m.step(0x3ec0, 5); // ret c NOT taken
  regs.a = 0x07;
  m.step(0x3ec2, 7); // ld a,0x07
  m.ret(); // 3ec2 -- count >= 3 -> code 7
}

/**
 * sub_30fa -- ROM 0x30FA-0x3103 code + 0x3104-0x310F inline table (22 bytes)
 *
 *   30fa  3a 80 63     ld   a,(0x6380)
 *   30fd  fe 06        cp   0x06
 *   30ff  38 02        jr   c,0x3103      ; A < 6 -> dispatch as-is
 *   3101  3e 05        ld   a,0x05        ; A >= 6 -> clamp to 5
 *   3103  ef           rst  0x28          ; TAIL dispatch through the table below
 *   3104: 10 31 10 31 1b 31 26 31 26 31 31 31   (dw 3110 3110 311b 3126 3126 3131)
 *
 * the 12-byte table is read from ROM by sub_0028, not
 * transcribed.
 * Not yet wired into the live dispatcher: reached only from entry_30ed
 * (untranslated), and the guard targets are reached ONLY through this table --
 * never through the executed NMI/substate dispatches (grep-confirmed). The
 * sub_0028 correctness-gate inversion only fires once handler_1977 integrates
 * and this chain actually runs.
 *
 * Clamps the index at 0x6380 to [0,5] (>= 6 becomes 5), then `rst 0x28`
 * dispatches through the inline table to one of the four 0x3110-family guards.
 *
 * THE TAIL CASE (lead ruling condition 3). The rst 0x28 is sub_30fa's LAST
 * instruction -- 0x3104+ is table data, not code -- so sub_30fa has NO frame of
 * its own when the guard rets: the guard returns straight to sub_30fa's caller.
 * `return sub_0028(m, ...)` therefore passes the guard's skip-boolean up
 * TRANSPARENTLY. A caller of sub_30fa that dispatches a skip-capable target must
 * consume it: `if (!sub_30fa(m)) return;`. (3e88/3e99 do NOT share this shape --
 * they push HL across the dispatch -- and must be derived from their own bytes.)
 *
 * rst 0x28 pushes 0x3104 (the address after the opcode = the TABLE BASE); sub_0028
 * pops that, indexes table[A] from ROM, and dispatches. 0x6380 not interpreted.
 */
export function sub_30fa(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6380);
  m.step(0x30fd, 13); // ld a,(0x6380)
  regs.cp(0x06);
  m.step(0x30ff, 7); // cp 0x06
  if (regs.fC) {
    m.step(0x3103, 12); // jr c,0x3103 TAKEN (A < 6) -- jr taken = 12
  } else {
    m.step(0x3101, 7); // jr c NOT taken -- jr not taken = 7
    regs.a = 0x05;
    m.step(0x3103, 7); // ld a,0x05 -- clamp
  }

  // rst 0x28 -- TAIL dispatch. Push the table base (0x3104); sub_0028 indexes it
  // and returns the selected guard's skip-boolean, which we pass straight up.
  m.push16(0x3104);
  m.step(0x0028, 11); // rst 0x28
  return sub_0028(m, "0x3104 (sub_30fa dispatch)");
}

/**
 * THE 0x3110 GUARD FAMILY -- four rst-0x28 dispatch targets, 11 bytes each,
 * ROM 0x3110-0x313B. Reached from entry_30fa's inline jump table.
 *
 * All four share ONE shape and differ in THREE places. Written from their own
 * bytes individually; the table is the differencing record, not a template:
 *
 *   addr    reads    mask   cp    cond     returns NORMALLY when
 *   3110    0x601a   & 1    0x01  ret z    (0x601a & 1) == 1   -- bit 0 SET
 *   311b    0x601a   & 7    0x05  ret m    (0x601a & 7) <  5
 *   3126    0x601a   & 3    0x03  ret m    (0x601a & 3) <  3
 *   3131    0x601a   & 7    0x07  ret m    (0x601a & 7) <  7
 *
 *   3110  3a 1a 60 / e6 01 / fe 01 / c8 / 33 / 33 / c9
 *   311b  3a 1a 60 / e6 07 / fe 05 / f8 / 33 / 33 / c9
 *   3126  3a 1a 60 / e6 03 / fe 03 / f8 / 33 / 33 / c9
 *   3131  3a 1a 60 / e6 07 / fe 07 / f8 / 33 / 33 / c9
 *
 * THE POLARITY TRAP IS LIVE HERE. 0x3110 uses `ret z` (0xC8) -- an EQUALITY
 * test; the other three use `ret m` (0xF8) -- the SIGN flag. They are one
 * opcode apart and mean different things, and the masks and compares differ
 * too. Copying any one of these onto another is silently wrong, and the
 * write-gate cannot see it (work RAM only). At 0x601a = 0x00, ONLY 0x3110
 * splices; at 0x601a = 0x07, ONLY 0x3110 returns normally -- the family is
 * genuinely inverted at both ends of its range.
 *
 * `ret m` reads the SIGN of (A - n). After `and`, A is 0..7 and n is 3..7, so
 * A-n cannot overflow and the sign is exactly "A < n" -- but it is the sign
 * flag, NOT carry, and is not interchangeable with `ret c` in general.
 *
 * EVERY ONE IS A CALLER-SKIP: on the non-returning path they `inc sp / inc sp /
 * ret`, discarding their own return address so control lands in their caller's
 * CALLER. Each returns a boolean under the settled convention (sub_0008,
 * mainloop.js:172-183): true = the caller was returned to normally, false = the
 * caller is skipped and must `return` immediately.
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: reached only through entry_30fa's rst 0x28
 * table, which is untranslated. 0x601a is not interpreted.
 */
function guard_3110(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x601a);
  m.step(0x3113, 13); // ld a,(0x601a)
  regs.and(0x01);
  m.step(0x3115, 7); // and 0x01
  regs.cp(0x01);
  m.step(0x3117, 7); // cp 0x01
  if (regs.fZ) {
    m.ret(11); // ret z -- EQUALITY, not sign
    return true;
  }
  m.step(0x3118, 5); // ret z NOT taken
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x3119, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x311a, 6); // inc sp
  m.ret(); // 311a -- to the caller's CALLER
  return false;
}

function guard_311b(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x601a);
  m.step(0x311e, 13); // ld a,(0x601a)
  regs.and(0x07);
  m.step(0x3120, 7); // and 0x07
  regs.cp(0x05);
  m.step(0x3122, 7); // cp 0x05
  if (regs.fM) {
    m.ret(11); // ret m -- SIGN, i.e. (0x601a & 7) < 5
    return true;
  }
  m.step(0x3123, 5); // ret m NOT taken
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x3124, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x3125, 6); // inc sp
  m.ret(); // 3125
  return false;
}

function guard_3126(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x601a);
  m.step(0x3129, 13); // ld a,(0x601a)
  regs.and(0x03);
  m.step(0x312b, 7); // and 0x03
  regs.cp(0x03);
  m.step(0x312d, 7); // cp 0x03
  if (regs.fM) {
    m.ret(11); // ret m -- (0x601a & 3) < 3
    return true;
  }
  m.step(0x312e, 5); // ret m NOT taken
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x312f, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x3130, 6); // inc sp
  m.ret(); // 3130
  return false;
}

function guard_3131(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x601a);
  m.step(0x3134, 13); // ld a,(0x601a)
  regs.and(0x07);
  m.step(0x3136, 7); // and 0x07
  regs.cp(0x07);
  m.step(0x3138, 7); // cp 0x07
  if (regs.fM) {
    m.ret(11); // ret m -- (0x601a & 7) < 7
    return true;
  }
  m.step(0x3139, 5); // ret m NOT taken
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x313a, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x313b, 6); // inc sp
  m.ret(); // 313b
  return false;
}

export { guard_3110, guard_311b, guard_3126, guard_3131 };

/**
 * entry_3ec3 -- ROM 0x3EC3-0x3EFE  (60 bytes, 25 instructions)
 *
 *   3ec3  dd cb 00 46  bit  0,(ix+0x00)   ; loc_3ec3 -- the djnz target
 *   3ec7  ca fa 3e     jp   z,0x3efa      ; inactive -> just advance
 *   3eca  79           ld   a,c
 *   3ecb  dd 96 05     sub  (ix+0x05)
 *   3ece  d2 d3 3e     jp   nc,0x3ed3
 *   3ed1  ed 44        neg                ; |C - (ix+5)|
 *   3ed3  3c           inc  a             ; loc_3ed3
 *   3ed4  95           sub  l
 *   3ed5  da de 3e     jp   c,0x3ede
 *   3ed8  dd 96 0a     sub  (ix+0x0a)
 *   3edb  d2 fa 3e     jp   nc,0x3efa     ; no overlap -> advance
 *   3ede  fd 7e 03     ld   a,(iy+0x03)   ; loc_3ede -- the other axis
 *   3ee1  dd 96 03     sub  (ix+0x03)
 *   3ee4  d2 e9 3e     jp   nc,0x3ee9
 *   3ee7  ed 44        neg
 *   3ee9  94           sub  h             ; loc_3ee9
 *   3eea  da f3 3e     jp   c,0x3ef3
 *   3eed  dd 96 09     sub  (ix+0x09)
 *   3ef0  d2 fa 3e     jp   nc,0x3efa     ; no overlap -> advance
 *   3ef3  3a 60 60     ld   a,(0x6060)    ; loc_3ef3 -- count it
 *   3ef6  3c           inc  a
 *   3ef7  32 60 60     ld   (0x6060),a
 *   3efa  dd 19        add  ix,de         ; loc_3efa -- next object
 *   3efc  10 c5        djnz 0x3ec3
 *   3efe  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher. Calls nothing.
 *
 * A djnz loop over B objects at stride DE from IX. For each ACTIVE object (bit 0
 * of (ix+0x00) set) it takes |C - (ix+0x05)| on one axis and |(iy+0x03) -
 * (ix+0x03)| on the other, compares each against a threshold in L / H and a
 * per-object span in (ix+0x0a) / (ix+0x09), and increments the counter at 0x6060
 * when both axes pass. LIVE-INS: IX (object base), IY, B (count), C, DE (stride),
 * H and L (the thresholds). Fields and 0x6060 not interpreted.
 *
 * Both `neg` sites are the absolute-value idiom: `sub` then, only on borrow,
 * negate -- so the code takes |difference| without a signed compare.
 *
 * S6 measured across the UNION of both trees (per the ruling): (iy+d) 11
 * precedents, neg 4, add ix,de 11 -- but `bit n,(ix+d)` has ZERO in either tree.
 * cpu.js has carried the `yxFrom` parameter for the indexed form since it was
 * pinned for entry_2913, and THIS IS THE FIRST CALL SITE EVER TO USE IT. The
 * indexed form takes F3/F5 from the EFFECTIVE-ADDRESS HIGH BYTE, not from the
 * operand (MAME 0.288 z80.cpp:543), so the EA high byte is passed explicitly.
 * Getting that wrong is invisible in Z -- only F3/F5 differ, and nothing here
 * reads them -- which is exactly why it is passed rather than defaulted.
 */
export function entry_3ec3(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  do {
    // loc_3ec3 -- the djnz target
    const ea0 = R(0x00);
    regs.bit(0, mem.read8(ea0), (ea0 >> 8) & 0xff); // INDEXED: F3/F5 from the EA high byte
    m.step(0x3ec7, 20); // bit 0,(ix+0x00)
    if (regs.fZ) {
      m.step(0x3efa, 10); // jp z,0x3efa -- inactive, straight to the advance
    } else {
      m.step(0x3eca, 10); // jp z NOT taken
      regs.a = regs.c;
      m.step(0x3ecb, 4); // ld a,c
      regs.sub(mem.read8(R(0x05)));
      m.step(0x3ece, 19); // sub (ix+0x05)
      if (regs.fNC) {
        m.step(0x3ed3, 10); // jp nc,0x3ed3 -- already non-negative
      } else {
        m.step(0x3ed1, 10); // jp nc NOT taken
        regs.neg(); // absolute value
        m.step(0x3ed3, 8); // neg
      }

      // loc_3ed3
      regs.a = regs.inc8(regs.a);
      m.step(0x3ed4, 4); // inc a
      regs.sub(regs.l);
      m.step(0x3ed5, 4); // sub l
      let axis2 = false;
      if (regs.fC) {
        m.step(0x3ede, 10); // jp c,0x3ede
        axis2 = true;
      } else {
        m.step(0x3ed8, 10); // jp c NOT taken
        regs.sub(mem.read8(R(0x0a)));
        m.step(0x3edb, 19); // sub (ix+0x0a)
        if (regs.fNC) {
          m.step(0x3efa, 10); // jp nc,0x3efa -- no overlap on this axis
        } else {
          m.step(0x3ede, 10); // fall through into loc_3ede
          axis2 = true;
        }
      }

      if (axis2) {
        // loc_3ede -- the second axis
        regs.a = mem.read8((regs.iy + 0x03) & 0xffff);
        m.step(0x3ee1, 19); // ld a,(iy+0x03)
        regs.sub(mem.read8(R(0x03)));
        m.step(0x3ee4, 19); // sub (ix+0x03)
        if (regs.fNC) {
          m.step(0x3ee9, 10); // jp nc,0x3ee9
        } else {
          m.step(0x3ee7, 10); // jp nc NOT taken
          regs.neg();
          m.step(0x3ee9, 8); // neg
        }

        // loc_3ee9
        regs.sub(regs.h);
        m.step(0x3eea, 4); // sub h
        let count = false;
        if (regs.fC) {
          m.step(0x3ef3, 10); // jp c,0x3ef3
          count = true;
        } else {
          m.step(0x3eed, 10); // jp c NOT taken
          regs.sub(mem.read8(R(0x09)));
          m.step(0x3ef0, 19); // sub (ix+0x09)
          if (regs.fNC) {
            m.step(0x3efa, 10); // jp nc,0x3efa -- no overlap
          } else {
            m.step(0x3ef3, 10); // fall through into loc_3ef3
            count = true;
          }
        }

        if (count) {
          // loc_3ef3 -- both axes overlap
          regs.a = mem.read8(0x6060);
          m.step(0x3ef6, 13); // ld a,(0x6060)
          regs.a = regs.inc8(regs.a);
          m.step(0x3ef7, 4); // inc a
          mem.write8(0x6060, regs.a);
          m.step(0x3efa, 13); // ld (0x6060),a
        }
      }
    }

    // loc_3efa -- every path converges here
    regs.addIx(regs.de);
    m.step(0x3efc, 15); // add ix,de
    regs.djnz();
    m.step(regs.b !== 0 ? 0x3ec3 : 0x3efe, regs.b !== 0 ? 13 : 8); // djnz 0x3ec3
  } while (regs.b !== 0);

  m.ret(); // 3efe
}

/**
 * loc_3069 -- ROM 0x3069-0x306E  (6 bytes, 4 instructions)
 *
 *   3069  df           rst  0x18            ; caller-skip vector
 *   306a  2a c0 63     ld   hl,(0x63c0)     ; INDIRECT: HL = the WORD AT 0x63C0
 *   306d  34           inc  (hl)
 *   306e  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: reached only via a dw jump table (2 refs), all
 * in untranslated code.
 *
 * Increments the byte POINTED AT by 0x63C0 -- `ld hl,(nn)` is the indirect load
 * (0x2A), so HL is the word stored at 0x63C0, NOT the address 0x63C0 itself. The
 * pointer cell is untouched; only the target byte moves.
 *
 * rst 0x18 POLARITY (the third one -- do not read it as rst 08/10): sub_0018 is
 * `ld hl,0x6009 / dec (hl) / ret z / inc sp / inc sp / ret`, so the BODY RUNS
 * WHEN THE COUNTER EXPIRES (reaches zero) and is SKIPPED while it is still
 * counting down. Reading it the other way inverts the routine.
 *
 * Returns TRUE on both paths, and never FALSE, because it CANNOT skip its
 * caller: sub_0018's skip arm discards the rst's own return and rets to
 * loc_3069's return address -- exactly where our `ret` would have gone -- so it
 * cuts THIS body short and the caller continues either way (the entry_06b8
 * scope-error lesson). TRUE rather than void so a future erroneous
 * `if (!loc_3069(m)) return;` is INERT rather than a live defect.
 *
 * `ld hl,(nn)` has 10 precedents in the ROM. Not a novel form.
 *
 * REGISTER CONTRACT: sub_0018 sets HL = 0x6009 as a side effect. Harmless here
 * because 0x306A overwrites HL immediately -- but it is a side effect, not a
 * pure predicate, so do not "simplify" the vector into a boolean-only helper.
 */
export function loc_3069(m) {
  const { regs, mem } = m;

  m.push16(0x306a);
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return true; // counter still counting -- body cut short, caller continues

  regs.hl = mem.read16(0x63c0); // INDIRECT -- the word AT 0x63C0, not 0x63C0
  m.step(0x306d, 16); // ld hl,(0x63c0)
  regs.incMem8(mem, regs.hl); // inc (hl) -- flag-correct RMW
  m.step(0x306e, 11); // inc (hl)

  m.ret(); // 306e
  return true;
}

/**
 * sub_33a1 -- ROM 0x33A1-0x33AC  (12 bytes, 8 instructions)
 *
 *   33a1  3e 07        ld   a,0x07
 *   33a3  f7           rst  0x30            ; CALLER-SKIP GATE
 *   33a4  dd 7e 0f     ld   a,(ix+0x0f)
 *   33a7  fe 59        cp   0x59
 *   33a9  d0           ret  nc              ; normal return when (ix+0x0f) >= 0x59
 *   33aa  33           inc  sp              ; STACK SPLICE
 *   33ab  33           inc  sp
 *   33ac  c9           ret                  ; -> the caller's CALLER
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x334A (entry_333d, untranslated).
 * IX live-in.
 *
 * TWELVE BYTES WITH TWO DIFFERENT CALLER-SKIPS, AND THEY ARE NOT THE SAME SKIP.
 * Per the ROM-wide rst doctrine (rst 08/10/18/20/30 are one-byte "abort my
 * caller" guard clauses; 28 and 38 are NOT):
 *
 *   1. `rst 0x30` (0x33A3) aborts THIS routine. sub_0030 rotates A (=0x07) right
 *      by the count at 0x6227 and, when the selected bit is clear, discards the
 *      rst's return address and rets -- so control lands back in entry_333d at
 *      the instruction after `call 0x33a1`. From entry_333d's point of view that
 *      is a NORMAL (just early) return, which is why this path returns TRUE.
 *   2. `inc sp / inc sp / ret` (0x33AA) discards sub_33a1's OWN return address,
 *      so the ret goes to entry_333d's CALLER -- entry_333d is SKIPPED. That
 *      path returns FALSE, and entry_333d must `if (!sub_33a1(m)) return;`.
 *
 * So the boolean here means "was entry_333d returned to normally?", NOT "did the
 * gate fire". Conflating the two would make the rst path look like a skip and
 * strand entry_333d's continuation. Modelled on the settled convention
 * (sub_0008, mainloop.js:172-183 -- the identical ret-nc/inc-sp/inc-sp/ret
 * shape) rather than a new one.
 *
 * `ret nc` is the UNSIGNED test: `cp 0x59` sets carry when (ix+0x0f) < 0x59, so
 * the splice fires BELOW 0x59 and the normal return is at-or-above it.
 */
export function sub_33a1(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = 0x07;
  m.step(0x33a3, 7); // ld a,0x07

  m.push16(0x33a4);
  m.step(0x0030, 11); // rst 0x30 -- caller-skip gate
  if (!sub_0030(m)) return true; // gate fired: entry_333d WAS returned to (early)

  regs.a = mem.read8(R(0x0f));
  m.step(0x33a7, 19); // ld a,(ix+0x0f)
  regs.cp(0x59);
  m.step(0x33a9, 7); // cp 0x59
  if (regs.fNC) {
    m.ret(11); // ret nc -- normal return, (ix+0x0f) >= 0x59
    return true;
  }
  m.step(0x33aa, 5); // ret nc NOT taken -- (ix+0x0f) < 0x59

  // STACK SPLICE: drop our own return address so the ret below lands in
  // entry_333d's CALLER. entry_333d is skipped entirely.
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x33ab, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x33ac, 6); // inc sp
  m.ret(); // 33ac -- returns to the caller's CALLER
  return false; // entry_333d must return immediately
}

/**
 * sub_32bd -- ROM 0x32BD-0x32D5  (25 bytes, 11 instructions)
 *
 *   32bd  3a 27 62     ld   a,(0x6227)
 *   32c0  fe 01        cp   0x01
 *   32c2  ca ce 32     jp   z,0x32ce       ; == 1 -> sub_342c
 *   32c5  fe 02        cp   0x02
 *   32c7  ca d2 32     jp   z,0x32d2       ; == 2 -> sub_3478
 *   32ca  cd b9 34     call 0x34b9         ; default
 *   32cd  c9           ret
 *   32ce  cd 2c 34     call 0x342c         ; loc_32ce
 *   32d1  c9           ret
 *   32d2  cd 78 34     call 0x3478         ; loc_32d2
 *   32d5  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x327A (entry_3202, untranslated).
 * CLOSES THE 32bd SUBTREE: all three callees landed in drains #19/#20/#21.
 *
 * A 3-way dispatch on 0x6227: == 1 calls sub_342c, == 2 calls sub_3478, and
 * everything else (including 0 and >= 3) falls through to sub_34b9 -- there is
 * no range check. Each arm is a real call followed by a ret, so whatever the
 * handler leaves in A/flags passes up through this ret. 0x6227 not interpreted.
 *
 * SHARED-LOAD DISCIPLINE: `A` is loaded ONCE at 0x32BD and the `cp 0x01` /
 * `cp 0x02` chain both test that same value -- `cp` does not modify A, and the
 * ROM does not reload it. Re-reading 0x6227 before the second compare would be
 * a different program if anything could write it in between.
 *
 * Note sub_3478 has no `ret` of its own (it tail-jumps into loc_3445), so the
 * 0x32D5 return address pushed here is consumed by THAT tail's ret -- the
 * balance still works out because the tail-jump pushes nothing.
 */
export function sub_32bd(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6227);
  m.step(0x32c0, 13); // ld a,(0x6227)
  regs.cp(0x01);
  m.step(0x32c2, 7); // cp 0x01
  if (regs.fZ) {
    // loc_32ce
    m.step(0x32ce, 10); // jp z,0x32ce TAKEN
    m.push16(0x32d1);
    m.step(0x342c, 17); // call 0x342c
    sub_342c(m);
    m.ret(); // 32d1
    return;
  }
  m.step(0x32c5, 10); // jp z NOT taken

  regs.cp(0x02); // same A -- not reloaded
  m.step(0x32c7, 7); // cp 0x02
  if (regs.fZ) {
    // loc_32d2
    m.step(0x32d2, 10); // jp z,0x32d2 TAKEN
    m.push16(0x32d5);
    m.step(0x3478, 17); // call 0x3478
    sub_3478(m); // no ret of its own -- loc_3445's ret consumes 0x32D5
    m.ret(); // 32d5
    return;
  }
  m.step(0x32ca, 10); // jp z NOT taken -- default arm

  m.push16(0x32cd);
  m.step(0x34b9, 17); // call 0x34b9
  sub_34b9(m);

  m.ret(); // 32cd
}

/**
 * sub_34b9 -- ROM 0x34B9-0x34F2  (58 bytes, 26 instructions)
 *
 *   34b9  3a 27 62     ld   a,(0x6227)
 *   34bc  fe 03        cp   0x03
 *   34be  c8           ret  z               ; early out
 *   34bf  3a 03 62     ld   a,(0x6203)
 *   34c2  cb 7f        bit  7,a             ; two-table select
 *   34c4  c2 ed 34     jp   nz,0x34ed
 *   34c7  21 c4 3a     ld   hl,0x3ac4       ; bit 7 CLEAR
 *   34ca  06 00        ld   b,0x00          ; loc_34ca -- SHARED tail
 *   34cc  3a 19 60     ld   a,(0x6019)
 *   34cf  e6 06        and  0x06            ; index 0/2/4/6 (2-byte entries)
 *   34d1  4f           ld   c,a
 *   34d2  09           add  hl,bc
 *   34d3  7e           ld   a,(hl)
 *   34d4  dd 77 03     ld   (ix+0x03),a
 *   34d7  dd 77 0e     ld   (ix+0x0e),a
 *   34da  23           inc  hl
 *   34db  7e           ld   a,(hl)
 *   34dc  dd 77 05     ld   (ix+0x05),a
 *   34df  dd 77 0f     ld   (ix+0x0f),a
 *   34e2  af           xor  a
 *   34e3  dd 77 0d     ld   (ix+0x0d),a
 *   34e6  dd 77 18     ld   (ix+0x18),a
 *   34e9  dd 77 1c     ld   (ix+0x1c),a
 *   34ec  c9           ret
 *   34ed  21 d4 3a     ld   hl,0x3ad4       ; loc_34ed -- bit 7 SET
 *   34f0  c3 ca 34     jp   0x34ca
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x32CA (sub_32bd, untranslated).
 * Calls nothing; IX live-in. With #19 and #20 this completes sub_32bd's callees.
 *
 * A table initializer: returns immediately if 0x6227 == 3; otherwise selects one
 * of two tables by BIT 7 of 0x6203 (set -> 0x3AD4, clear -> 0x3AC4), indexes it
 * by (0x6019 & 6) -- masking to {0,2,4,6}, i.e. 2-byte-aligned entries -- and
 * loads the entry into PAIRED object fields: byte 0 into both (ix+0x03) and
 * (ix+0x0e), byte 1 into both (ix+0x05) and (ix+0x0f), then clears (ix+0x0d),
 * (ix+0x18) and (ix+0x1c). Tables / 0x6019 / 0x6203 / 0x6227 not interpreted.
 *
 * loc_34ca is a SHARED tail: both table branches converge on it with different
 * HL, so the select is purely which base address is in HL when it arrives.
 * `add hl,bc` here is a PLAIN add (0x09 -> regs.addHl), not the adc hl,bc
 * zero-test idiom the twins 342c/3478 use.
 */
export function sub_34b9(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = mem.read8(0x6227);
  m.step(0x34bc, 13); // ld a,(0x6227)
  regs.cp(0x03);
  m.step(0x34be, 7); // cp 0x03
  if (regs.fZ) {
    m.ret(11); // ret z -- early out
    return;
  }
  m.step(0x34bf, 5); // ret z NOT taken

  regs.a = mem.read8(0x6203);
  m.step(0x34c2, 13); // ld a,(0x6203)
  regs.bit(7, regs.a); // sets Z = !bit7
  m.step(0x34c4, 8); // bit 7,a
  if (regs.fNZ) {
    // loc_34ed -- bit 7 SET
    m.step(0x34ed, 10); // jp nz,0x34ed TAKEN
    regs.hl = 0x3ad4;
    m.step(0x34f0, 10); // ld hl,0x3ad4
    m.step(0x34ca, 10); // jp 0x34ca
  } else {
    m.step(0x34c7, 10); // jp nz NOT taken -- bit 7 CLEAR
    regs.hl = 0x3ac4;
    m.step(0x34ca, 10); // ld hl,0x3ac4
  }

  // loc_34ca -- shared tail, HL already holds the selected table base
  regs.b = 0x00;
  m.step(0x34cc, 7); // ld b,0x00
  regs.a = mem.read8(0x6019);
  m.step(0x34cf, 13); // ld a,(0x6019)
  regs.and(0x06); // index 0/2/4/6 -- NOT &7, NOT &0xE
  m.step(0x34d1, 7); // and 0x06
  regs.c = regs.a;
  m.step(0x34d2, 4); // ld c,a
  regs.addHl(regs.bc); // add hl,bc -- PLAIN add (0x09), not adc
  m.step(0x34d3, 11); // add hl,bc
  regs.a = mem.read8(regs.hl);
  m.step(0x34d4, 7); // ld a,(hl)
  mem.write8(R(0x03), regs.a);
  m.step(0x34d7, 19); // ld (ix+0x03),a
  mem.write8(R(0x0e), regs.a); // SAME byte into a second field
  m.step(0x34da, 19); // ld (ix+0x0e),a
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x34db, 6); // inc hl -- 16-bit
  regs.a = mem.read8(regs.hl);
  m.step(0x34dc, 7); // ld a,(hl)
  mem.write8(R(0x05), regs.a);
  m.step(0x34df, 19); // ld (ix+0x05),a
  mem.write8(R(0x0f), regs.a); // SAME byte into a second field
  m.step(0x34e2, 19); // ld (ix+0x0f),a
  regs.xor(regs.a); // xor a -- A = 0
  m.step(0x34e3, 4); // xor a
  mem.write8(R(0x0d), regs.a);
  m.step(0x34e6, 19); // ld (ix+0x0d),a
  mem.write8(R(0x18), regs.a);
  m.step(0x34e9, 19); // ld (ix+0x18),a
  mem.write8(R(0x1c), regs.a);
  m.step(0x34ec, 19); // ld (ix+0x1c),a

  m.ret(); // 34ec
}

/**
 * sub_3478 -- ROM 0x3478-0x34B8  (65 bytes, 22 instructions)
 *
 *   3478  dd 6e 1a     ld   l,(ix+0x1a)
 *   347b  dd 66 1b     ld   h,(ix+0x1b)
 *   347e  af           xor  a
 *   347f  01 00 00     ld   bc,0x0000
 *   3482  ed 4a        adc  hl,bc           ; same zero test as sub_342c
 *   3484  c2 9a 34     jp   nz,0x349a
 *   3487  21 ac 3a     ld   hl,0x3aac       ; DIFFERENT table from sub_342c's 0x3A8C
 *   348a  3a 03 62     ld   a,(0x6203)
 *   348d  cb 7f        bit  7,a             ; direction select
 *   348f  ca a8 34     jp   z,0x34a8
 *   3492  dd 36 0d 01  ld   (ix+0x0d),0x01  ; forward
 *   3496  dd 36 03 7e  ld   (ix+0x03),0x7e
 *   349a  dd 7e 0d     ld   a,(ix+0x0d)     ; loc_349a
 *   349d  fe 01        cp   0x01
 *   349f  c2 b3 34     jp   nz,0x34b3
 *   34a2  dd 34 03     inc  (ix+0x03)       ; forward: index up
 *   34a5  c3 45 34     jp   0x3445          ; TAIL JUMP into sub_342c's tail
 *   34a8  dd 36 0d 02  ld   (ix+0x0d),0x02  ; loc_34a8 -- backward
 *   34ac  dd 36 03 80  ld   (ix+0x03),0x80
 *   34b0  c3 9a 34     jp   0x349a
 *   34b3  dd 35 03     dec  (ix+0x03)       ; loc_34b3 -- backward: index down
 *   34b6  c3 45 34     jp   0x3445          ; TAIL JUMP
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x32D2 (sub_32bd, untranslated).
 * IX live-in.
 *
 * THE TWIN OF sub_342c -- WRITTEN FROM ITS OWN BYTES, NOT FROM 342c (S7). The
 * two share the pointer zero-test prefix instruction-for-instruction, but differ
 * in the middle: sub_342c uses table 0x3A8C with a flat `(ix+0x03)=0x26, inc`;
 * sub_3478 uses table 0x3AAC and a DIRECTION STATE MACHINE keyed on bit 7 of
 * 0x6203 -- forward sets (ix+0x0d)=1 and base 0x7E and INCREMENTS the index,
 * backward sets (ix+0x0d)=2 and base 0x80 and DECREMENTS it. Reusing 342c's init
 * here would be silently wrong on both the table and the direction.
 *
 * IT HAS NO `ret`. Both exits (0x34A5, 0x34B6) are `jp 0x3445`, jumping INTO
 * sub_342c's shared loc_3445 tail with NOTHING pushed -- so loc_3445's ret
 * returns to sub_3478's OWN caller. Modelled `m.step(0x3445, 10); return
 * loc_3445(m)`. Treating either exit as a call (push + ret) would splice a
 * phantom frame; treating it as a duplicated tail would double the code the ROM
 * shares. Note a `jp` into a shared tail never appears in a call-graph walk,
 * so this edge is invisible to exactly the tooling used to find callees --
 * second instance of the shape after loc_0038/sub_003d.
 *
 * 0x6203 / the tables / the direction meaning are not interpreted.
 */
export function sub_3478(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.l = mem.read8(R(0x1a));
  m.step(0x347b, 19); // ld l,(ix+0x1a)
  regs.h = mem.read8(R(0x1b));
  m.step(0x347e, 19); // ld h,(ix+0x1b)
  regs.xor(regs.a); // xor a -- A = 0, carry CLEARED for the adc
  m.step(0x347f, 4); // xor a
  regs.bc = 0x0000;
  m.step(0x3482, 10); // ld bc,0x0000
  regs.adcHl(regs.bc); // adc hl,bc -- Z iff the saved pointer is zero
  m.step(0x3484, 15); // adc hl,bc
  if (regs.fNZ) {
    m.step(0x349a, 10); // jp nz,0x349a TAKEN -- continue an existing walk
  } else {
    m.step(0x3487, 10); // jp nz NOT taken -- reinitialise
    regs.hl = 0x3aac; // NOT 0x3A8C -- this twin's own table
    m.step(0x348a, 10); // ld hl,0x3aac
    regs.a = mem.read8(0x6203);
    m.step(0x348d, 13); // ld a,(0x6203)
    regs.bit(7, regs.a); // sets Z = !bit7
    m.step(0x348f, 8); // bit 7,a
    if (regs.fZ) {
      // loc_34a8 -- bit 7 CLEAR: backward
      m.step(0x34a8, 10); // jp z,0x34a8 TAKEN
      mem.write8(R(0x0d), 0x02);
      m.step(0x34ac, 19); // ld (ix+0x0d),0x02
      mem.write8(R(0x03), 0x80);
      m.step(0x34b0, 19); // ld (ix+0x03),0x80
      m.step(0x349a, 10); // jp 0x349a
    } else {
      m.step(0x3492, 10); // jp z NOT taken -- bit 7 SET: forward
      mem.write8(R(0x0d), 0x01);
      m.step(0x3496, 19); // ld (ix+0x0d),0x01
      mem.write8(R(0x03), 0x7e);
      m.step(0x349a, 19); // ld (ix+0x03),0x7e
    }
  }

  // loc_349a -- direction dispatch
  regs.a = mem.read8(R(0x0d));
  m.step(0x349d, 19); // ld a,(ix+0x0d)
  regs.cp(0x01);
  m.step(0x349f, 7); // cp 0x01
  if (regs.fNZ) {
    // loc_34b3 -- backward
    m.step(0x34b3, 10); // jp nz,0x34b3 TAKEN
    regs.decMem8(mem, R(0x03)); // dec (ix+0x03)
    m.step(0x34b6, 23); // dec (ix+0x03)
    m.step(0x3445, 10); // jp 0x3445 -- TAIL JUMP, nothing pushed
    return loc_3445(m);
  }
  m.step(0x34a2, 10); // jp nz NOT taken -- forward
  regs.incMem8(mem, R(0x03)); // inc (ix+0x03)
  m.step(0x34a5, 23); // inc (ix+0x03)
  m.step(0x3445, 10); // jp 0x3445 -- TAIL JUMP, nothing pushed
  return loc_3445(m);
}

/**
 * sub_32d6 -- ROM 0x32D6-0x330E  (57 bytes, 20 instructions)
 *
 *   32d6  dd 7e 1c     ld   a,(ix+0x1c)
 *   32d9  fe 00        cp   0x00
 *   32db  c2 fd 32     jp   nz,0x32fd
 *   32de  dd 7e 1d     ld   a,(ix+0x1d)
 *   32e1  fe 01        cp   0x01
 *   32e3  c2 0b 33     jp   nz,0x330b
 *   32e6  dd 36 1d 00  ld   (ix+0x1d),0x00
 *   32ea  3a 05 62     ld   a,(0x6205)
 *   32ed  dd 46 0f     ld   b,(ix+0x0f)
 *   32f0  90           sub  b               ; carry = UNSIGNED borrow
 *   32f1  da 03 33     jp   c,0x3303
 *   32f4  dd 36 1c ff  ld   (ix+0x1c),0xff  ; reload counter
 *   32f8  dd 36 0d 00  ld   (ix+0x0d),0x00  ; loc_32f8 (JOIN)
 *   32fc  c9           ret
 *   32fd  dd 35 1c     dec  (ix+0x1c)       ; loc_32fd
 *   3300  c2 f8 32     jp   nz,0x32f8       ; READS the dec's Z flag
 *   3303  dd 36 19 00  ld   (ix+0x19),0x00  ; loc_3303 (JOIN)
 *   3307  dd 36 1c 00  ld   (ix+0x1c),0x00
 *   330b  cd 0f 33     call 0x330f          ; loc_330b (JOIN)
 *   330e  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x327E (entry_3202, untranslated).
 * Unblocked by drain #14 (its only callee, entry_330f). IX live-in.
 *
 * An object down-counter with reload: (ix+0x1c) counts down; on reaching 0 (or
 * when armed via (ix+0x1d) == 1) it compares 0x6205 against (ix+0x0f), then
 * either reloads (ix+0x1c) to 0xFF or zeroes (ix+0x19)/(ix+0x1c), and calls
 * entry_330f. Object fields / 0x6205 not interpreted.
 *
 * THIS IS THE CASE THE SHARED PRIMITIVE WAS BUILT FOR. `dec (ix+0x1c)` at 0x32FD
 * is a memory RMW whose Z flag is READ by the `jp nz` at 0x3300 -- the first
 * consumer where dropping the flags changes CONTROL FLOW rather than leaving a
 * dead flag. regs.decMem8 sets S/Z/H/PV (carry preserved); the open-coded
 * `(v-1)&0xff` would leave the branch reading a STALE Z from the earlier
 * `cp 0x00`, which is always NZ on this path -- so the counter would never take
 * the hit-zero branch. Pinned by TEST 3.
 *
 * `sub b` (0x32F0) sets carry as the UNSIGNED borrow (A < (ix+0x0f)), read by
 * `jp c` -- regs.sub, not a bare subtraction.
 *
 * Three joins are written out inline because the ROM reaches them from multiple
 * predecessors: loc_32f8 (no-borrow fall-through and the jp nz), loc_3303 (jp c
 * and the dec-hit-zero fall-through), loc_330b (jp nz at 0x32E3 and the 0x3303
 * fall-through). Each copy emits the identical step sequence.
 */
export function sub_32d6(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  // loc_330b -- call 0x330f then ret; reached from two predecessors.
  const tail_330b = () => {
    m.push16(0x330e);
    m.step(0x330f, 17); // call 0x330f
    entry_330f(m);
    m.ret(); // 330e
  };
  // loc_3303 -- zero two fields, then fall into loc_330b.
  const tail_3303 = () => {
    mem.write8(R(0x19), 0x00);
    m.step(0x3307, 19); // ld (ix+0x19),0x00
    mem.write8(R(0x1c), 0x00);
    m.step(0x330b, 19); // ld (ix+0x1c),0x00
    tail_330b();
  };

  regs.a = mem.read8(R(0x1c));
  m.step(0x32d9, 19); // ld a,(ix+0x1c)
  regs.cp(0x00);
  m.step(0x32db, 7); // cp 0x00
  if (regs.fNZ) {
    // loc_32fd -- counter non-zero: decrement it
    m.step(0x32fd, 10); // jp nz,0x32fd TAKEN
    regs.decMem8(mem, R(0x1c)); // dec (ix+0x1c) -- SETS the Z the jp nz reads
    m.step(0x3300, 23); // dec (ix+0x1c)
    if (regs.fNZ) {
      // loc_32f8 -- still counting
      m.step(0x32f8, 10); // jp nz,0x32f8 TAKEN
      mem.write8(R(0x0d), 0x00);
      m.step(0x32fc, 19); // ld (ix+0x0d),0x00
      m.ret(); // 32fc
      return;
    }
    m.step(0x3303, 10); // jp nz NOT taken -- counter hit zero, fall into loc_3303
    tail_3303();
    return;
  }
  m.step(0x32de, 10); // jp nz NOT taken -- counter already zero

  regs.a = mem.read8(R(0x1d));
  m.step(0x32e1, 19); // ld a,(ix+0x1d)
  regs.cp(0x01);
  m.step(0x32e3, 7); // cp 0x01
  if (regs.fNZ) {
    m.step(0x330b, 10); // jp nz,0x330b TAKEN -- not armed
    tail_330b();
    return;
  }
  m.step(0x32e6, 10); // jp nz NOT taken -- armed ((ix+0x1d) == 1)

  mem.write8(R(0x1d), 0x00);
  m.step(0x32ea, 19); // ld (ix+0x1d),0x00
  regs.a = mem.read8(0x6205);
  m.step(0x32ed, 13); // ld a,(0x6205)
  regs.b = mem.read8(R(0x0f));
  m.step(0x32f0, 19); // ld b,(ix+0x0f)
  regs.sub(regs.b); // sub b -- carry = unsigned borrow
  m.step(0x32f1, 4); // sub b
  if (regs.fC) {
    m.step(0x3303, 10); // jp c,0x3303 TAKEN -- borrow
    tail_3303();
    return;
  }
  m.step(0x32f4, 10); // jp c NOT taken -- no borrow

  mem.write8(R(0x1c), 0xff);
  m.step(0x32f8, 19); // ld (ix+0x1c),0xff -- reload
  mem.write8(R(0x0d), 0x00);
  m.step(0x32fc, 19); // ld (ix+0x0d),0x00
  m.ret(); // 32fc
}

/**
 * entry_33e7 -- ROM 0x33E7-0x3408  (34 bytes, 13 instructions)
 *
 *   33e7  cd 09 34     call 0x3409         ; runs FIRST, before any field access
 *   33ea  dd 7e 0d     ld   a,(ix+0x0d)
 *   33ed  fe 08        cp   0x08
 *   33ef  c2 05 34     jp   nz,0x3405
 *   33f2  dd 7e 14     ld   a,(ix+0x14)
 *   33f5  a7           and  a
 *   33f6  c2 01 34     jp   nz,0x3401
 *   33f9  dd 36 14 02  ld   (ix+0x14),0x02 ; reload sub-timer
 *   33fd  dd 35 0f     dec  (ix+0x0f)
 *   3400  c9           ret
 *   3401  dd 35 14     dec  (ix+0x14)      ; loc_3401
 *   3404  c9           ret
 *   3405  dd 34 0f     inc  (ix+0x0f)      ; loc_3405
 *   3408  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x3291 (entry_3202, untranslated).
 * Unblocked by drain #15 (its only callee, sub_3409). IX live-in.
 *
 * Adjusts (ix+0x0f) up or down according to the state (ix+0x0d) and a period-2
 * sub-timer (ix+0x14):
 *   state != 8            -> inc (ix+0x0f)
 *   state == 8, timer != 0 -> dec (ix+0x14)
 *   state == 8, timer == 0 -> (ix+0x14) = 2, dec (ix+0x0f)
 * Object fields not interpreted. The `call 0x3409` runs BEFORE any field
 * access, so sub_3409's own effects on (ix+0x15)/(ix+0x07) land first.
 *
 * All three memory RMW (dec (ix+0x0f), dec (ix+0x14), inc (ix+0x0f)) go through
 * regs.decMem8 / regs.incMem8 -- flag-correct; each ret follows its RMW directly,
 * so those flags escape to the caller (S5). SCOPE: another caller of the
 * primitive, NOT an exercise of it -- this routine is itself unreachable, so
 * incMem8/decMem8 still has zero execution coverage.
 */
export function entry_33e7(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  m.push16(0x33ea); // call 0x3409 -- real call, rets back to 0x33EA
  m.step(0x3409, 17);
  sub_3409(m);

  regs.a = mem.read8(R(0x0d));
  m.step(0x33ed, 19); // ld a,(ix+0x0d)
  regs.cp(0x08);
  m.step(0x33ef, 7); // cp 0x08
  if (regs.fNZ) {
    // loc_3405 -- state != 8
    m.step(0x3405, 10); // jp nz,0x3405 TAKEN
    regs.incMem8(mem, R(0x0f)); // inc (ix+0x0f)
    m.step(0x3408, 23); // inc (ix+0x0f)
    m.ret(); // 3408
    return;
  }
  m.step(0x33f2, 10); // jp nz NOT taken -- state == 8

  regs.a = mem.read8(R(0x14));
  m.step(0x33f5, 19); // ld a,(ix+0x14)
  regs.and(regs.a); // and a -- sets Z
  m.step(0x33f6, 4); // and a
  if (regs.fNZ) {
    // loc_3401 -- sub-timer still running
    m.step(0x3401, 10); // jp nz,0x3401 TAKEN
    regs.decMem8(mem, R(0x14)); // dec (ix+0x14)
    m.step(0x3404, 23); // dec (ix+0x14)
    m.ret(); // 3404
    return;
  }
  m.step(0x33f9, 10); // jp nz NOT taken -- sub-timer expired

  mem.write8(R(0x14), 0x02);
  m.step(0x33fd, 19); // ld (ix+0x14),0x02 -- reload
  regs.decMem8(mem, R(0x0f)); // dec (ix+0x0f)
  m.step(0x3400, 23); // dec (ix+0x0f)

  m.ret(); // 3400
}

/**
 * sub_3409 -- ROM 0x3409-0x342B  (35 bytes, 15 instructions)
 *
 *   3409  dd 7e 15     ld   a,(ix+0x15)
 *   340c  a7           and  a
 *   340d  c2 28 34     jp   nz,0x3428      ; timer != 0 -> dec it
 *   3410  dd 36 15 02  ld   (ix+0x15),0x02 ; reload timer to 2
 *   3414  dd 34 07     inc  (ix+0x07)      ; advance frame
 *   3417  dd 7e 07     ld   a,(ix+0x07)
 *   341a  e6 0f        and  0x0f
 *   341c  fe 0f        cp   0x0f
 *   341e  c0           ret  nz             ; not at the nibble boundary
 *   341f  dd 7e 07     ld   a,(ix+0x07)
 *   3422  ee 02        xor  0x02           ; TOGGLE bit 1 (not +2, not |2)
 *   3424  dd 77 07     ld   (ix+0x07),a
 *   3427  c9           ret
 *   3428  dd 35 15     dec  (ix+0x15)      ; loc_3428
 *   342b  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x33E7 (entry_33e7) and 0x33C0
 * (entry_33ad), both untranslated; nothing in translated src invokes sub_3409.
 * Calls nothing; IX live-in. Unblocks entry_33ad and entry_33e7.
 *
 * A frame timer: (ix+0x15) down-counts; on expiry it reloads to 2 and advances
 * the frame (ix+0x07). When the frame's LOW NIBBLE reaches 0x0F, bit 1 is
 * TOGGLED via `xor 0x02` -- a toggle, not an increment or an OR: if bit 1 was
 * already set, xor CLEARS it. Frame field / xor meaning not interpreted.
 *
 * Both `inc (ix+0x07)` and `dec (ix+0x15)` are MEMORY RMW and go through the
 * shared primitives regs.incMem8 / regs.decMem8 -- flag-correct (S/Z/H/PV set,
 * carry preserved). A bare (v+/-1)&0xff would drop those flags; the RMW rets
 * here carry them to the caller (S5).
 */
export function sub_3409(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff; // (ix+d) effective address

  regs.a = mem.read8(R(0x15));
  m.step(0x340c, 19); // ld a,(ix+0x15)
  regs.and(regs.a); // and a -- sets Z
  m.step(0x340d, 4); // and a
  if (regs.fNZ) {
    // loc_3428 -- timer still counting down
    m.step(0x3428, 10); // jp nz,0x3428 TAKEN
    regs.decMem8(mem, R(0x15)); // dec (ix+0x15) -- flag-correct RMW
    m.step(0x342b, 23); // dec (ix+0x15)
    m.ret(); // 342b
    return;
  }
  m.step(0x3410, 10); // jp nz NOT taken -- timer expired

  mem.write8(R(0x15), 0x02);
  m.step(0x3414, 19); // ld (ix+0x15),0x02 -- reload
  regs.incMem8(mem, R(0x07)); // inc (ix+0x07) -- flag-correct RMW
  m.step(0x3417, 23); // inc (ix+0x07)
  regs.a = mem.read8(R(0x07));
  m.step(0x341a, 19); // ld a,(ix+0x07)
  regs.and(0x0f);
  m.step(0x341c, 7); // and 0x0f
  regs.cp(0x0f);
  m.step(0x341e, 7); // cp 0x0f
  if (regs.fNZ) {
    m.ret(11); // ret nz -- not at the nibble boundary
    return;
  }
  m.step(0x341f, 5); // ret nz NOT taken -- fall through

  regs.a = mem.read8(R(0x07));
  m.step(0x3422, 19); // ld a,(ix+0x07)
  regs.xor(0x02); // TOGGLE bit 1 -- clears it if it was set
  m.step(0x3424, 7); // xor 0x02
  mem.write8(R(0x07), regs.a);
  m.step(0x3427, 19); // ld (ix+0x07),a

  m.ret(); // 3427
}

/**
 * entry_33c3 -- ROM 0x33C3-0x33D8  (22 bytes, 8 instructions)
 *
 *   33c3  3a 27 62     ld   a,(0x6227)
 *   33c6  fe 01        cp   0x01
 *   33c8  c0           ret  nz            ; 0x6227 != 1 -> return
 *   33c9  dd 66 0e     ld   h,(ix+0x0e)
 *   33cc  dd 6e 0f     ld   l,(ix+0x0f)   ; HL = (ix+0x0e):(ix+0x0f)
 *   33cf  dd 46 0d     ld   b,(ix+0x0d)
 *  33d2 cd 33 23 call 0x2333 ; entry_2333 (< 0x3000) -> modified L
 *   33d5  dd 75 0f     ld   (ix+0x0f),l
 *   33d8  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x32AB (entry_3202, untranslated)
 * AND reached by fall-through from entry_33ad; nothing in translated src invokes
 * entry_33c3. IX live-in. One callee edge: entry_2333 (< 0x3000), which
 * takes HL/B and returns a modified L -- that register contract is load-bearing.
 *
 * SHARED TAIL WITH entry_33ad. entry_33ad has no ret of its own:
 * after its own field adjustments + call 0x3409 it FALLS THROUGH into this body
 * at 0x33C3, and this routine's ret ends both. The `0x6227 != 1` early-out means
 * entry_33ad's field work still happens, but the entry_2333 call stays gated on
 * 0x6227 == 1. 0x6227 / the object fields not interpreted.
 */
export function entry_33c3(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = mem.read8(0x6227);
  m.step(0x33c6, 13); // ld a,(0x6227)
  regs.cp(0x01);
  m.step(0x33c8, 7); // cp 0x01
  if (regs.fNZ) {
    m.ret(11); // ret nz -- 0x6227 != 1
    return;
  }
  m.step(0x33c9, 5); // ret nz NOT taken

  regs.h = mem.read8(R(0x0e));
  m.step(0x33cc, 19); // ld h,(ix+0x0e)
  regs.l = mem.read8(R(0x0f));
  m.step(0x33cf, 19); // ld l,(ix+0x0f) -- HL = (ix+0x0e):(ix+0x0f)
  regs.b = mem.read8(R(0x0d));
  m.step(0x33d2, 19); // ld b,(ix+0x0d)

  m.push16(0x33d5);
  m.step(0x2333, 17); // call 0x2333
  entry_2333(m); // entry_2333 (< 0x3000) -- returns a modified L

  mem.write8(R(0x0f), regs.l); // store the returned L
  m.step(0x33d8, 19); // ld (ix+0x0f),l
  m.ret(); // 33d8
}

/**
 * entry_33ad -- ROM 0x33AD-0x33C2 + 0x33D9-0x33E5  (13 insns, interleaved with entry_33c3)
 *
 *   33ad  dd 7e 0d     ld   a,(ix+0x0d)
 *   33b0  fe 01        cp   0x01
 *   33b2  ca d9 33     jp   z,0x33d9      ; ==1 -> set bit 7, inc (ix+0x0e)
 *   33b5  dd 7e 07     ld   a,(ix+0x07)
 *   33b8  e6 7f        and  0x7f          ; clear bit 7
 *   33ba  dd 77 07     ld   (ix+0x07),a
 *   33bd  dd 35 0e     dec  (ix+0x0e)
 *   33c0  cd 09 34     call 0x3409
 *                      (FALL THROUGH into entry_33c3 -- NO ret of its own)
 *   33d9  dd 7e 07     ld   a,(ix+0x07)   ; the ==1 arm, physically AFTER 33c3's body
 *   33dc  f6 80        or   0x80          ; set bit 7
 *   33de  dd 77 07     ld   (ix+0x07),a
 *   33e1  dd 34 0e     inc  (ix+0x0e)
 *   33e4  c3 c0 33     jp   0x33c0
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x323B (entry_3202, untranslated);
 * nothing in translated src invokes entry_33ad. IX live-in. One callee edge:
 * sub_3409 (integrated), shared by both arms before the fall-through.
 *
 * NO RET OF ITS OWN -- it FALLS THROUGH into entry_33c3. Modelled
 * as `return entry_33c3(m)` with NO push16: entry_33ad has no frame of its own at
 * that point, so entry_33c3's ret ends both. The two routines are physically
 * INTERLEAVED -- the ==1 arm (0x33D9-0x33E5) sits after entry_33c3's body and
 * jumps back to the shared 0x33C0.
 *
 * TWO NEAR-MIRROR ARMS: on (ix+0x0d)==1, set bit 7 of (ix+0x07) (or 0x80)
 * and inc (ix+0x0e); else clear bit 7 (and 0x7f) and dec (ix+0x0e). Same shape,
 * INVERSE ops -- each arm derived from its own bytes, not copied (or<->and, mask
 * 0x80<->0x7f, inc<->dec all flip). The inc/dec (ix+0x0e) are memory RMW through
 * regs.incMem8/decMem8 (flag-correct), though those flags die before entry_33c3
 * re-tests via cp. Object fields not interpreted.
 */
export function entry_33ad(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = mem.read8(R(0x0d));
  m.step(0x33b0, 19); // ld a,(ix+0x0d)
  regs.cp(0x01);
  m.step(0x33b2, 7); // cp 0x01
  if (regs.fZ) {
    // 0x33d9 -- (ix+0x0d)==1 arm (physically after entry_33c3's body)
    m.step(0x33d9, 10); // jp z,0x33d9 TAKEN
    regs.a = mem.read8(R(0x07));
    m.step(0x33dc, 19); // ld a,(ix+0x07)
    regs.or(0x80); // set bit 7
    m.step(0x33de, 7); // or 0x80
    mem.write8(R(0x07), regs.a);
    m.step(0x33e1, 19); // ld (ix+0x07),a
    regs.incMem8(mem, R(0x0e)); // inc (ix+0x0e) -- flag-correct RMW
    m.step(0x33e4, 23); // inc (ix+0x0e)
    m.step(0x33c0, 10); // jp 0x33c0
  } else {
    // 0x33b5 -- else arm
    m.step(0x33b5, 10); // jp z NOT taken
    regs.a = mem.read8(R(0x07));
    m.step(0x33b8, 19); // ld a,(ix+0x07)
    regs.and(0x7f); // clear bit 7
    m.step(0x33ba, 7); // and 0x7f
    mem.write8(R(0x07), regs.a);
    m.step(0x33bd, 19); // ld (ix+0x07),a
    regs.decMem8(mem, R(0x0e)); // dec (ix+0x0e) -- flag-correct RMW
    m.step(0x33c0, 23); // dec (ix+0x0e)
  }

  // 0x33c0: shared call 0x3409, then FALL THROUGH into entry_33c3 (NO ret here)
  m.push16(0x33c3);
  m.step(0x3409, 17); // call 0x3409
  sub_3409(m);
  return entry_33c3(m); // FALL THROUGH -- entry_33c3's ret ends both
}

/**
 * entry_330f -- ROM 0x330F-0x333C  (46 bytes, 16 instructions)
 *
 *   330f  dd 7e 16     ld   a,(ix+0x16)
 *   3312  fe 00        cp   0x00
 *   3314  c2 32 33     jp   nz,0x3332      ; timer != 0 -> just dec it
 *   3317  dd 36 16 2b  ld   (ix+0x16),0x2b ; reload timer (43)
 *   331b  dd 36 0d 00  ld   (ix+0x0d),0x00 ; reset state
 *   331f  3a 18 60     ld   a,(0x6018)
 *   3322  0f           rrca                ; carry = 0x6018 bit 0
 *   3323  d2 32 33     jp   nc,0x3332
 *   3326  dd 7e 0d     ld   a,(ix+0x0d)    ; = 0, just reset
 *   3329  fe 01        cp   0x01
 *   332b  ca 36 33     jp   z,0x3336       ; NEVER TAKEN -- see below
 *   332e  dd 36 0d 01  ld   (ix+0x0d),0x01 ; state := 1
 *   3332  dd 35 16     dec  (ix+0x16)      ; loc_3332
 *   3335  c9           ret
 *   3336  dd 36 0d 02  ld   (ix+0x0d),0x02 ; loc_3336 -- UNREACHABLE
 *   333a  c3 32 33     jp   0x3332
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x330B (sub_32d6) and the
 * entry_31b1->entry_3202 chain, all untranslated; nothing in translated src
 * invokes entry_330f. Self-contained: calls NOTHING, normal ret, no splice (the
 * draft corrected the assignment, which claimed ~59 insns and two callees --
 * a crude scan had walked past the ret at 0x3335 into entry_333d/sub_33a1).
 *
 * A periodic object timer: if (ix+0x16) != 0 just decrement it; on expiry reload
 * it to 0x2B, reset state (ix+0x0d) to 0, and if 0x6018 bit 0 is set advance the
 * state to 1. Every path falls through loc_3332's `dec (ix+0x16)`, so the reload
 * path yields 0x2A. IX is LIVE-IN (the object pointer). Timer/state/0x6018 bit 0
 * not interpreted.
 *
 * FINDING, flagged not resolved: `loc_3336` (state := 2) is
 * UNREACHABLE via this routine's own flow. The only path to 0x3326 passes
 * 0x331B, which sets (ix+0x0d) = 0, so the `cp 0x01` at 0x3329 never matches and
 * the `jp z,0x3336` never fires. Whether that is intentional dead code, a ROM bug
 * (the reset defeating the state==1 check), or a path via an indirect entry to
 * 0x3336 (no external reference found) is NOT decided here -- the translation
 * reproduces the unreachability faithfully: the branch is emitted and simply
 * never taken. TEST 2 pins that state=2 is not producible.
 *
 * `rrca` (0x3322): only the carry-out is used -- A's rotated value is dead
 * (overwritten at 0x3326). regs.rrca() keeps it faithful to the 0F byte.
 *
 * `dec (ix+0x16)` (0x3332) is a MEMORY RMW and is the first consumer of
 * regs.decMem8 -- it sets S/Z/H/PV (carry preserved), which a bare
 * `(v-1)&0xff` would drop. Dead before this ret, but sub_32d6's own
 * `dec (ix+0x1c)` / `jp nz` is exactly why the primitive exists.
 */
export function entry_330f(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff; // (ix+d) effective address

  regs.a = mem.read8(R(0x16));
  m.step(0x3312, 19); // ld a,(ix+0x16)
  regs.cp(0x00);
  m.step(0x3314, 7); // cp 0x00
  if (regs.fNZ) {
    m.step(0x3332, 10); // jp nz,0x3332 TAKEN -- timer still counting down
  } else {
    m.step(0x3317, 10); // jp nz NOT taken -- timer expired
    mem.write8(R(0x16), 0x2b);
    m.step(0x331b, 19); // ld (ix+0x16),0x2b -- reload
    mem.write8(R(0x0d), 0x00);
    m.step(0x331f, 19); // ld (ix+0x0d),0x00 -- reset state (this is what makes 0x3336 dead)
    regs.a = mem.read8(0x6018);
    m.step(0x3322, 13); // ld a,(0x6018)
    regs.rrca(); // carry = bit 0; the rotated A is dead
    m.step(0x3323, 4); // rrca
    if (regs.fNC) {
      m.step(0x3332, 10); // jp nc,0x3332 TAKEN -- bit 0 clear
    } else {
      m.step(0x3326, 10); // jp nc NOT taken -- bit 0 set
      regs.a = mem.read8(R(0x0d)); // = 0 (reset at 0x331B)
      m.step(0x3329, 19); // ld a,(ix+0x0d)
      regs.cp(0x01);
      m.step(0x332b, 7); // cp 0x01
      if (regs.fZ) {
        // loc_3336 -- UNREACHABLE via this flow (state is 0 here). Emitted
        // faithfully so the ROM's structure is preserved; it never fires.
        m.step(0x3336, 10); // jp z,0x3336
        mem.write8(R(0x0d), 0x02);
        m.step(0x333a, 19); // ld (ix+0x0d),0x02
        m.step(0x3332, 10); // jp 0x3332
      } else {
        m.step(0x332e, 10); // jp z NOT taken
        mem.write8(R(0x0d), 0x01);
        m.step(0x3332, 19); // ld (ix+0x0d),0x01 -- state := 1
      }
    }
  }

  // loc_3332 -- every path converges here
  regs.decMem8(mem, R(0x16)); // dec (ix+0x16) -- flag-correct RMW (cpu.js primitive)
  m.step(0x3335, 23); // dec (ix+0x16)

  m.ret(); // 3335 -- NORMAL ret
}

/**
 * entry_333d -- ROM 0x333D-0x33A0  (movement/collision state machine on (ix+0x0d))
 *
 *   333d  dd 7e 0d     ld   a,(ix+0x0d)
 *   3340  fe 08        cp   0x08
 *   3342  ca 71 33     jp   z,0x3371       ; state 8 -> entry_3371
 *   3345  fe 04        cp   0x04
 *   3347  ca 8a 33     jp   z,0x338a       ; state 4 -> loc_338a
 *   334a  cd a1 33     call 0x33a1         ; MAY SPLICE (skip-capable) -- guarded
 *   334d  dd 7e 0f     ld   a,(ix+0x0f)
 *   3350  c6 08        add  a,0x08
 *   3352  57           ld   d,a            ; D = (ix+0x0f)+8
 *   3353  dd 7e 0e     ld   a,(ix+0x0e)    ; A = (ix+0x0e) (search key)
 *   3356  01 15 00     ld   bc,0x0015
 *   3359  cd 6e 23     call 0x236e         ; MISS-UNWINDS (skip-capable) -- guarded
 *   335c  a7           and  a
 *   335d  ca 99 33     jp   z,0x3399       ; 236e result A==0 -> entry_3399
 *   3360  dd 70 1f     ld   (ix+0x1f),b
 *   3363  3a 05 62     ld   a,(0x6205)
 *   3366  47           ld   b,a
 *   3367  dd 7e 0f     ld   a,(ix+0x0f)
 *   336a  90           sub  b
 *   336b  d0           ret  nc             ; (ix+0x0f) >= (0x6205) -> stay
 *   336c  dd 36 0d 04  ld   (ix+0x0d),0x04 ; else advance to state 4
 *   3370  c9           ret
 *   3371  dd 7e 0f     ld   a,(ix+0x0f)    ; entry_3371 (state 8)
 *   3374  c6 08        add  a,0x08
 *   3376  dd 46 1f     ld   b,(ix+0x1f)
 *   3379  b8           cp   b
 *   337a  c0           ret  nz             ; not at target -> wait
 *   337b  dd 36 0d 00  ld   (ix+0x0d),0x00 ; reached -> state 0
 *   337f  dd 7e 19     ld   a,(ix+0x19)
 *   3382  fe 02        cp   0x02
 *   3384  c0           ret  nz
 *   3385  dd 36 1d 01  ld   (ix+0x1d),0x01 ; (ix+0x19)==2 tail (entry_3371 ONLY)
 *   3389  c9           ret
 *   338a  dd 7e 0f     ld   a,(ix+0x0f)    ; loc_338a (state 4) -- twin, no tail
 *   338d  c6 08        add  a,0x08
 *   338f  dd 46 1f     ld   b,(ix+0x1f)
 *   3392  b8           cp   b
 *   3393  c0           ret  nz
 *   3394  dd 36 0d 00  ld   (ix+0x0d),0x00
 *   3398  c9           ret
 *   3399  dd 70 1f     ld   (ix+0x1f),b    ; entry_3399 (236e A==0)
 *   339c  dd 36 0d 08  ld   (ix+0x0d),0x08
 *   33a0  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x3230 (entry_3202, untranslated);
 * nothing in translated src invokes entry_333d. IX live-in. A 3-way state machine
 * on (ix+0x0d): 8 -> entry_3371, 4 -> loc_338a, else -> the movement path.
 *
 * TWO SKIP-CAPABLE MOVEMENT-PATH CALLEES, both boolean-guarded:
 *   0x334A call sub_33a1 (mine) -- a rst-0x30 dispatcher that, on (ix+0x0f) < 0x59,
 *     does `inc sp / inc sp / ret` and unwinds to entry_333d's CALLER, returning
 *     false. Guard: `if (!sub_33a1(m)) return;`.
 *  0x3359 call sub_236e (< 0x3000) -- on its cpir-miss path does
 *     `pop hl / ret` at 0x239A and unwinds to entry_333d's CALLER, returning
 *     false. Guard: `if (!sub_236e(m)) return;`. On the FOUND path it returns
 *     A (0/1, steering the `and a / jp z`) and B (stored to (ix+0x1f)).
 * A plain call at either site would let this JS keep running after the machine
 * already returned to entry_3202 -- double execution, the 216d defect class.
 *
 * entry_3371 and loc_338a are NEAR-IDENTICAL (both: (ix+0x0f)+8 cp (ix+0x1f) /
 * ret nz / (ix+0x0d)=0); entry_3371 alone adds the (ix+0x19)==2 -> (ix+0x1d)=1
 * tail -- written from their own bytes, not copied. Interior labels reached only
 * by internal jp z. Object fields / 0x6205 / movement semantics not interpreted.
 */
export function entry_333d(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = mem.read8(R(0x0d));
  m.step(0x3340, 19); // ld a,(ix+0x0d)
  regs.cp(0x08);
  m.step(0x3342, 7); // cp 0x08
  if (regs.fZ) {
    // entry_3371 -- (ix+0x0d) == 8
    m.step(0x3371, 10); // jp z,0x3371 taken
    regs.a = mem.read8(R(0x0f));
    m.step(0x3374, 19); // ld a,(ix+0x0f)
    regs.add(0x08);
    m.step(0x3376, 7); // add a,0x08
    regs.b = mem.read8(R(0x1f));
    m.step(0x3379, 19); // ld b,(ix+0x1f)
    regs.cp(regs.b);
    m.step(0x337a, 4); // cp b
    if (regs.fNZ) {
      m.ret(11); // ret nz -- not at target
      return;
    }
    m.step(0x337b, 5); // ret nz NOT taken
    mem.write8(R(0x0d), 0x00);
    m.step(0x337f, 19); // ld (ix+0x0d),0x00
    regs.a = mem.read8(R(0x19));
    m.step(0x3382, 19); // ld a,(ix+0x19)
    regs.cp(0x02);
    m.step(0x3384, 7); // cp 0x02
    if (regs.fNZ) {
      m.ret(11); // ret nz
      return;
    }
    m.step(0x3385, 5); // ret nz NOT taken
    mem.write8(R(0x1d), 0x01);
    m.step(0x3389, 19); // ld (ix+0x1d),0x01 -- entry_3371-only tail
    m.ret(); // 3389
    return;
  }
  m.step(0x3345, 10); // jp z,0x3371 NOT taken
  regs.cp(0x04);
  m.step(0x3347, 7); // cp 0x04
  if (regs.fZ) {
    // loc_338a -- (ix+0x0d) == 4 (twin of entry_3371, no tail)
    m.step(0x338a, 10); // jp z,0x338a taken
    regs.a = mem.read8(R(0x0f));
    m.step(0x338d, 19); // ld a,(ix+0x0f)
    regs.add(0x08);
    m.step(0x338f, 7); // add a,0x08
    regs.b = mem.read8(R(0x1f));
    m.step(0x3392, 19); // ld b,(ix+0x1f)
    regs.cp(regs.b);
    m.step(0x3393, 4); // cp b
    if (regs.fNZ) {
      m.ret(11); // ret nz -- not at target
      return;
    }
    m.step(0x3394, 5); // ret nz NOT taken
    mem.write8(R(0x0d), 0x00);
    m.step(0x3398, 19); // ld (ix+0x0d),0x00
    m.ret(); // 3398
    return;
  }
  m.step(0x334a, 10); // jp z,0x338a NOT taken

  // -- movement path (0x334A) --
  m.push16(0x334d);
  m.step(0x33a1, 17); // call 0x33a1
  if (!sub_33a1(m)) return; // sub_33a1 spliced (inc sp/inc sp/ret) -> 333d skipped

  regs.a = mem.read8(R(0x0f));
  m.step(0x3350, 19); // ld a,(ix+0x0f)
  regs.add(0x08);
  m.step(0x3352, 7); // add a,0x08
  regs.d = regs.a;
  m.step(0x3353, 4); // ld d,a -- D = (ix+0x0f)+8
  regs.a = mem.read8(R(0x0e));
  m.step(0x3356, 19); // ld a,(ix+0x0e) -- search key
  regs.bc = 0x0015;
  m.step(0x3359, 10); // ld bc,0x0015

  m.push16(0x335c);
  m.step(0x236e, 17); // call 0x236e
  if (!sub_236e(m)) return; // 236e cpir-miss unwound -> 333d skipped (HL = 0x335C)

  regs.and(regs.a);
  m.step(0x335d, 4); // and a -- test 236e's result A
  if (regs.fZ) {
    // entry_3399 -- 236e returned A == 0
    m.step(0x3399, 10); // jp z,0x3399 taken
    mem.write8(R(0x1f), regs.b);
    m.step(0x339c, 19); // ld (ix+0x1f),b
    mem.write8(R(0x0d), 0x08);
    m.step(0x33a0, 19); // ld (ix+0x0d),0x08
    m.ret(); // 33a0
    return;
  }
  m.step(0x3360, 10); // jp z,0x3399 NOT taken

  mem.write8(R(0x1f), regs.b);
  m.step(0x3363, 19); // ld (ix+0x1f),b
  regs.a = mem.read8(0x6205);
  m.step(0x3366, 13); // ld a,(0x6205)
  regs.b = regs.a;
  m.step(0x3367, 4); // ld b,a
  regs.a = mem.read8(R(0x0f));
  m.step(0x336a, 19); // ld a,(ix+0x0f)
  regs.sub(regs.b);
  m.step(0x336b, 4); // sub b -- carry = unsigned borrow
  if (regs.fNC) {
    m.ret(11); // ret nc -- (ix+0x0f) >= (0x6205), stay
    return;
  }
  m.step(0x336c, 5); // ret nc NOT taken
  mem.write8(R(0x0d), 0x04);
  m.step(0x3370, 19); // ld (ix+0x0d),0x04 -- advance to state 4
  m.ret(); // 3370
}

/**
 * entry_3202 -- ROM 0x3202-0x32BC  (per-object state machine; the closure hub)
 *
 * Loads the object at (0x63C8), branches on its (ix+d) state fields, dispatches
 * to EIGHT callees, does a 0x3A7A table lookup, and writes back several fields.
 * Two rets: 0x3279 (after the table lookup) and 0x327D (after call 0x32bd).
 * IX is RELOADED from (0x63C8)
 * at 0x3202/0x3246/0x3297 because the callees clobber it -- (0x63C8) is the
 * object pointer entry_31b1 maintains (its store-back). NOT a splice.
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x31CD (entry_31b1, untranslated);
 * nothing in translated src invokes entry_3202.
 *
 * TWO INTEGRATION DECISIONS:
 *  (1) entry_333d TOLERATES-EARLY-RETURN (integrator note). The
 *      call at 0x3230 is a PLAIN call. entry_333d has two hidden exits (its
 *      sub_33a1 splice and sub_236e miss), but BOTH unwind to *this* routine at
 *      0x3233 -- the exact address this call pushes -- and so does 333d's normal
 *      ret. So whether 333d finishes or bails, the machine returns to 0x3233 and
 *      this JS falls straight into `case 0x3233` (switch fall-through). No boolean
 *      guard is needed on 3202's side; 3202 just continues at 0x3233 and reads
 *      whatever object state 333d did or did not write. Decision stated per the note.
 *  (2) The other 7 callees all return NORMALLY (verified: none is skip-capable /
 *      returns a boolean), so all are plain calls. sub_298c's return A is tested
 *      by `cp 0x01 / jp z` at 0x3241 (cross-routine dispatch steer).
 *
 * HAZARDS honoured: `jp p` (0x3213/0x3238) is SIGNED -> regs.fP (bit-7-clear),
 * NOT jp nc (nmi.js loc_0e4f precedent); `add a,c` (0x3275) flags are LIVE at the
 * 0x3279 ret (S5) -> regs.add; inc/dec (ix+0x0e) (0x32A5/0x32B3) are flag-correct
 * RMW via regs.decMem8/incMem8. Irreducible CFG (backward cross-jumps) -> a
 * label-dispatch loop, ROM labels as cases, jumps as `label=X; continue`, ROM
 * fall-through as switch fall-through. Object fields / 0x3A7A table / 0x6018 not
 * interpreted.
 */
export function entry_3202(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  const ld_ix = () => { regs.ix = mem.read16(0x63c8); };
  let label = 0x3202;
  for (;;) {
    switch (label) {
      case 0x3202:
        ld_ix();
        m.step(0x3206, 20); // ld ix,(0x63c8)
        regs.a = mem.read8(R(0x18));
        m.step(0x3209, 19); // ld a,(ix+0x18)
        regs.cp(0x01);
        m.step(0x320b, 7); // cp 0x01
        if (regs.fZ) { label = 0x327a; continue; } // jp z,0x327a
        m.step(0x320e, 10); // jp z NOT taken
        regs.a = mem.read8(R(0x0d));
        m.step(0x3211, 19); // ld a,(ix+0x0d)
        regs.cp(0x04);
        m.step(0x3213, 7); // cp 0x04
        if (regs.fP) { label = 0x3230; continue; } // jp p (SIGNED) -> 0x3230
        m.step(0x3216, 10); // jp p NOT taken
        regs.a = mem.read8(R(0x19));
        m.step(0x3219, 19); // ld a,(ix+0x19)
        regs.cp(0x02);
        m.step(0x321b, 7); // cp 0x02
        if (regs.fZ) { label = 0x327e; continue; } // jp z,0x327e
        m.step(0x321e, 10); // jp z NOT taken
        m.push16(0x3221);
        m.step(0x330f, 17); // call 0x330f
        entry_330f(m);
      // fall into 0x3221
      case 0x3221:
        regs.a = mem.read8(0x6018);
        m.step(0x3224, 13); // ld a,(0x6018)
        regs.and(0x03);
        m.step(0x3226, 7); // and 0x03
        if (regs.fNZ) { label = 0x3233; continue; } // jp nz,0x3233
        m.step(0x3229, 10); // jp nz NOT taken
      // fall into 0x3229
      case 0x3229:
        regs.a = mem.read8(R(0x0d));
        m.step(0x322c, 19); // ld a,(ix+0x0d)
        regs.and(regs.a);
        m.step(0x322d, 4); // and a
        if (regs.fZ) { label = 0x3257; continue; } // jp z,0x3257
        m.step(0x3230, 10); // jp z NOT taken
      // fall into 0x3230
      case 0x3230:
        m.push16(0x3233);
        m.step(0x333d, 17); // call 0x333d -- MAY RETURN EARLY; either way lands 0x3233
        entry_333d(m);
      // fall into 0x3233 (3202 tolerates 333d's early return -- see header decision 1)
      case 0x3233:
        regs.a = mem.read8(R(0x0d));
        m.step(0x3236, 19); // ld a,(ix+0x0d)
        regs.cp(0x04);
        m.step(0x3238, 7); // cp 0x04
        if (regs.fP) { label = 0x3291; continue; } // jp p (SIGNED) -> 0x3291
        m.step(0x323b, 10); // jp p NOT taken
        m.push16(0x323e);
        m.step(0x33ad, 17); // call 0x33ad (falls through into entry_33c3, rets to 0x323e)
        entry_33ad(m);
        m.push16(0x3241);
        m.step(0x298c, 17); // call 0x298c (tile-in-range predicate)
        sub_298c(m);
        regs.cp(0x01);
        m.step(0x3243, 7); // cp 0x01 -- test 298c's return A
        if (regs.fZ) { label = 0x3297; continue; } // jp z,0x3297 (298c returned 1)
        m.step(0x3246, 10); // jp z NOT taken
        ld_ix();
        m.step(0x324a, 20); // ld ix,(0x63c8) -- RELOAD (callees clobbered IX)
        regs.a = mem.read8(R(0x0e));
        m.step(0x324d, 19); // ld a,(ix+0x0e)
        regs.cp(0x10);
        m.step(0x324f, 7); // cp 0x10
        if (regs.fC) { label = 0x328c; continue; } // jp c,0x328c ((ix+0x0e) < 0x10)
        m.step(0x3252, 10); // jp c NOT taken
        regs.cp(0xf0);
        m.step(0x3254, 7); // cp 0xf0
        if (regs.fNC) { label = 0x3284; continue; } // jp nc,0x3284 ((ix+0x0e) >= 0xf0)
        m.step(0x3257, 10); // jp nc NOT taken
      // fall into 0x3257
      case 0x3257:
        regs.a = mem.read8(R(0x13));
        m.step(0x325a, 19); // ld a,(ix+0x13)
        regs.cp(0x00);
        m.step(0x325c, 7); // cp 0x00
        if (regs.fNZ) { label = 0x32b9; continue; } // jp nz,0x32b9
        m.step(0x325f, 10); // jp nz NOT taken
        regs.a = 0x11;
        m.step(0x3261, 7); // ld a,0x11 -- default table index
      // fall into 0x3261
      case 0x3261:
        mem.write8(R(0x13), regs.a);
        m.step(0x3264, 19); // ld (ix+0x13),a
        regs.d = 0x00;
        m.step(0x3266, 7); // ld d,0x00
        regs.e = regs.a;
        m.step(0x3267, 4); // ld e,a -- DE = index
        regs.hl = 0x3a7a;
        m.step(0x326a, 10); // ld hl,0x3a7a -- table base
        regs.addHl(regs.de);
        m.step(0x326b, 11); // add hl,de
        regs.a = mem.read8(regs.hl);
        m.step(0x326c, 7); // ld a,(hl) -- table[index]
        regs.b = mem.read8(R(0x0e));
        m.step(0x326f, 19); // ld b,(ix+0x0e)
        mem.write8(R(0x03), regs.b);
        m.step(0x3272, 19); // ld (ix+0x03),b
        regs.c = mem.read8(R(0x0f));
        m.step(0x3275, 19); // ld c,(ix+0x0f)
        regs.add(regs.c);
        m.step(0x3276, 4); // add a,c -- flags LIVE at the 0x3279 ret (S5)
        mem.write8(R(0x05), regs.a);
        m.step(0x3279, 19); // ld (ix+0x05),a
        m.ret(); // 3279 EXIT
        return;
      case 0x327a:
        m.push16(0x327d);
        m.step(0x32bd, 17); // call 0x32bd
        sub_32bd(m);
        m.ret(); // 327d EXIT -- ret passes 32bd's A/flags up
        return;
      case 0x327e:
        m.push16(0x3281);
        m.step(0x32d6, 17); // call 0x32d6
        sub_32d6(m);
        m.step(0x3229, 10); // jp 0x3229 (backward)
        label = 0x3229;
        continue;
      case 0x3284:
        regs.a = 0x02;
        m.step(0x3286, 7); // ld a,0x02
      // fall into 0x3286
      case 0x3286:
        mem.write8(R(0x0d), regs.a);
        m.step(0x3289, 19); // ld (ix+0x0d),a
        m.step(0x3257, 10); // jp 0x3257
        label = 0x3257;
        continue;
      case 0x328c:
        regs.a = 0x01;
        m.step(0x328e, 7); // ld a,0x01
        m.step(0x3286, 10); // jp 0x3286
        label = 0x3286;
        continue;
      case 0x3291:
        m.push16(0x3294);
        m.step(0x33e7, 17); // call 0x33e7
        entry_33e7(m);
        m.step(0x3257, 10); // jp 0x3257
        label = 0x3257;
        continue;
      case 0x3297:
        ld_ix();
        m.step(0x329b, 20); // ld ix,(0x63c8) -- RELOAD
        regs.a = mem.read8(R(0x0d));
        m.step(0x329e, 19); // ld a,(ix+0x0d)
        regs.cp(0x01);
        m.step(0x32a0, 7); // cp 0x01
        if (regs.fNZ) { label = 0x32b1; continue; } // jp nz,0x32b1
        m.step(0x32a3, 10); // jp nz NOT taken
        regs.a = 0x02;
        m.step(0x32a5, 7); // ld a,0x02
        regs.decMem8(mem, R(0x0e));
        m.step(0x32a8, 23); // dec (ix+0x0e) -- flag-correct RMW
        label = 0x32a8;
        continue;
      case 0x32a8:
        mem.write8(R(0x0d), regs.a);
        m.step(0x32ab, 19); // ld (ix+0x0d),a
        m.push16(0x32ae);
        m.step(0x33c3, 17); // call 0x33c3
        entry_33c3(m);
        m.step(0x3257, 10); // jp 0x3257
        label = 0x3257;
        continue;
      case 0x32b1:
        regs.a = 0x01;
        m.step(0x32b3, 7); // ld a,0x01
        regs.incMem8(mem, R(0x0e));
        m.step(0x32b6, 23); // inc (ix+0x0e) -- flag-correct RMW
        m.step(0x32a8, 10); // jp 0x32a8
        label = 0x32a8;
        continue;
      case 0x32b9:
        regs.a = regs.dec8(regs.a);
        m.step(0x32ba, 4); // dec a
        m.step(0x3261, 10); // jp 0x3261 (backward)
        label = 0x3261;
        continue;
    }
  }
}

/**
 * entry_31b1 -- ROM 0x31B1-0x31DC  (loop over 5 strided objects, process each)
 *
 *   31b1  cd dd 31     call 0x31dd        ; init/mode-setup
 *   31b4  af           xor  a
 *   31b5  32 a2 63     ld   (0x63a2),a    ; counter = 0
 *   31b8  21 e0 63     ld   hl,0x63e0
 *   31bb  22 c8 63     ld   (0x63c8),hl   ; pointer = 0x63E0 (in MEMORY)
 *   31be  2a c8 63     ld   hl,(0x63c8)   ; loc_31be -- load pointer
 *   31c1  01 20 00     ld   bc,0x0020
 *   31c4  09           add  hl,bc         ; advance BEFORE the read
 *   31c5  22 c8 63     ld   (0x63c8),hl   ; STORE BACK -- 0x3202 reads 0x63c8
 *   31c8  7e           ld   a,(hl)
 *   31c9  a7           and  a
 *   31ca  ca d0 31     jp   z,0x31d0      ; empty object -> skip the call
 *   31cd  cd 02 32     call 0x3202        ; process non-empty object
 *   31d0  3a a2 63     ld   a,(0x63a2)    ; loc_31d0
 *   31d3  3c           inc  a
 *   31d4  32 a2 63     ld   (0x63a2),a
 *   31d7  fe 05        cp   0x05
 *   31d9  c2 be 31     jp   nz,0x31be     ; loop while counter != 5
 *   31dc  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: called from 0x30F3 (entry_30ed, untranslated);
 * nothing in translated src invokes entry_31b1.
 *
 * Walks 5 objects at stride 0x20 (processed addresses 0x6400/20/40/60/80 -- the
 * add hl,0x20 PRECEDES the read, so the 0x63E0 base is never read), calling
 * entry_3202 for each whose first byte is non-zero. NOT a stack splice.
 *
 * THE POINTER STORE-BACK IS LOAD-BEARING: the iteration pointer lives at
 * 0x63C8, not a register. The `ld (0x63c8),hl` at 0x31C5 hands the current object
 * pointer to entry_3202 THROUGH MEMORY -- entry_3202's first act is
 * `ld ix,(0x63c8)`. Keeping the pointer only in HL would leave 0x63C8 stale and
 * entry_3202 would process the wrong cell every iteration.
 *
 * Both callees return NORMALLY (verified: sub_31dd and entry_3202 are neither
 * skip-capable nor boolean-returning), so both are plain calls. The `jp nz`
 * loop-back at 0x31D9 charges its own 10T to 0x31BE (a faithful loop, not a
 * bare do-while). 0x63A2 counter / 0x63C8 pointer / object meaning not
 * interpreted.
 */
export function entry_31b1(m) {
  const { regs, mem } = m;

  m.push16(0x31b4);
  m.step(0x31dd, 17); // call 0x31dd -- init/mode-setup
  sub_31dd(m);

  regs.xor(regs.a);
  m.step(0x31b5, 4); // xor a
  mem.write8(0x63a2, regs.a);
  m.step(0x31b8, 13); // ld (0x63a2),a -- counter = 0
  regs.hl = 0x63e0;
  m.step(0x31bb, 10); // ld hl,0x63e0
  mem.write16(0x63c8, regs.hl);
  m.step(0x31be, 16); // ld (0x63c8),hl -- pointer = 0x63E0

  for (;;) {
    // loc_31be -- top of the 5-object loop
    regs.hl = mem.read16(0x63c8);
    m.step(0x31c1, 16); // ld hl,(0x63c8)
    regs.bc = 0x0020;
    m.step(0x31c4, 10); // ld bc,0x0020
    regs.addHl(regs.bc);
    m.step(0x31c5, 11); // add hl,bc -- advance BEFORE the read
    mem.write16(0x63c8, regs.hl);
    m.step(0x31c8, 16); // ld (0x63c8),hl -- STORE BACK (entry_3202 reads 0x63c8)
    regs.a = mem.read8(regs.hl);
    m.step(0x31c9, 7); // ld a,(hl)
    regs.and(regs.a);
    m.step(0x31ca, 4); // and a
    if (regs.fZ) {
      m.step(0x31d0, 10); // jp z,0x31d0 taken -- empty object, skip
    } else {
      m.step(0x31cd, 10); // jp z NOT taken -- non-empty
      m.push16(0x31d0);
      m.step(0x3202, 17); // call 0x3202
      entry_3202(m);
    }

    // loc_31d0
    regs.a = mem.read8(0x63a2);
    m.step(0x31d3, 13); // ld a,(0x63a2)
    regs.a = regs.inc8(regs.a);
    m.step(0x31d4, 4); // inc a
    mem.write8(0x63a2, regs.a);
    m.step(0x31d7, 13); // ld (0x63a2),a
    regs.cp(0x05);
    m.step(0x31d9, 7); // cp 0x05
    if (regs.fNZ) {
      m.step(0x31be, 10); // jp nz,0x31be taken -- loop while counter != 5
      continue;
    }
    m.step(0x31dc, 10); // jp nz NOT taken -- fall to ret
    break;
  }

  m.ret(); // 31dc
}

/**
 * entry_30ed -- ROM 0x30ED-0x30F9  (orchestrator: four sequenced calls, then ret)
 *
 *   30ed  cd fa 30     call 0x30fa        ; SKIP-CAPABLE (rst-28 guard dispatch) -- guarded
 *   30f0  cd 3c 31     call 0x313c        ; SKIP-CAPABLE (inc sp splice) -- guarded
 *   30f3  cd b1 31     call 0x31b1
 *   30f6  cd f3 34     call 0x34f3
 *   30f9  c9           ret
 *
 * The HEAD of the >=0x3000 closure chain (30ed -> 31b1 -> 3202 -> 333d ...)
 * and the LAST of it to integrate.
 * Not yet wired into the live dispatcher: called from 0x198C
 * (< 0x3000, in the untranslated handler_1977 region -- the run stops at 0x1977),
 * and nothing in translated src invokes entry_30ed. The whole chain becomes
 * reachable only when handler_1977 (finale) lands.
 *
 * TWO of the four callees are SKIP-CAPABLE and are boolean-guarded (
 * resolved against the INTEGRATED callees -- the drafter did not open them):
 *   0x30FA call sub_30fa -- a rst-0x28 TAIL dispatcher to the 0x3110 guard family;
 *     a guard that splices (inc sp/inc sp/ret) unwinds PAST entry_30ed to its
 *     caller. sub_30fa passes that skip-boolean up via `return sub_0028(...)`.
 *     Guard: `if (!sub_30fa(m)) return;`.
 *   0x313C call entry_313c -- on counter==0 it does inc sp/inc sp/ret (its own
 *     comment names entry_30ed as the spliced caller) and returns false.
 *     Guard: `if (!entry_313c(m)) return;`.
 * The other two (entry_31b1, entry_34f3) return NORMALLY (verified: no boolean,
 * no inc sp) -> plain calls. entry_30f0 (the 0x313c call site) has NO static
 * caller -- ruled an interior/tracer-artifact label, not a second entry.
 */
export function entry_30ed(m) {
  m.push16(0x30f0);
  m.step(0x30fa, 17); // call 0x30fa
  if (!sub_30fa(m)) return; // sub_30fa's dispatched guard spliced -> entry_30ed skipped

  // 0x30f0 (entry_30f0 label -- interior)
  m.push16(0x30f3);
  m.step(0x313c, 17); // call 0x313c
  if (!entry_313c(m)) return; // entry_313c spliced (counter==0) -> entry_30ed skipped

  m.push16(0x30f6);
  m.step(0x31b1, 17); // call 0x31b1
  entry_31b1(m);

  m.push16(0x30f9);
  m.step(0x34f3, 17); // call 0x34f3
  entry_34f3(m);

  m.ret(); // 30f9
}

/**
 * entry_34f3 -- ROM 0x34F3-0x3528  (54 bytes, 40 instructions)
 *
 *   34f3  21 00 64     ld   hl,0x6400     ; source base (5 objects, stride 0x20)
 *   34f6  11 d0 69     ld   de,0x69d0     ; dest base (4-byte records)
 *   34f9  06 05        ld   b,0x05
 *   34fb  7e           ld   a,(hl)        ; loc_34fb -- occupancy flag (offset 0)
 *   34fc  a7           and  a
 *   34fd  ca 1e 35     jp   z,0x351e      ; empty -> skip copy, still advance
 *   ... non-empty: dest[0..3] = mem[P+3], mem[P+7], mem[P+8], mem[P+5] ...
 *   3516  13           inc  de            ; commit record (16-bit)
 *   3517  3e 1b/85/6f  ld a,0x1b/add a,l/ld l,a ; loc_3517 -- L += 0x1B (net +0x20)
 *   351b  10 de        djnz 0x34fb
 *   351d  c9           ret                ; NORMAL ret (no splice)
 *   351e  3e 05/85/6f/3e 04/83/5f/c3 17 35  loc_351e: L += 5, E += 4, jp 0x3517
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: only caller is 0x30F6 (entry_30ed,
 * untranslated), nothing in translated src invokes entry_34f3. Calls NOTHING; a
 * normal ret, NOT a stack splice (the draft corrected the assignment on both).
 *
 * A scatter-gather: for each of 5 objects at stride 0x20 from 0x6400, if the
 * occupancy flag (offset 0) is non-zero, gather 4 bytes in the order
 * [+3, +7, +8, +5] into a 4-byte record at 0x69D0+. Offset 0 (the flag) is NOT
 * copied. An EMPTY object still advances both pointers (L by 0x20, DE by 4) so
 * records stay aligned. Object fields not interpreted.
 *
 * POINTER ARITHMETIC (the marquee): source HL advances by `inc l`/
 * `dec l` (8-bit -- L wraps within the page, no carry to H); dest DE advances by
 * three `inc e` (8-bit) then one `inc de` (16-bit, CAN carry). The 8/16-bit mix
 * is load-bearing; using inc de for all four (or inc e for all four) diverges at
 * a page boundary. Latent here (E from 0xD0, no wrap). The empty path advances
 * DE by 8-bit `add a,0x04 / ld e,a` -- same +4, different carry behaviour.
 *
 * Flag-correct ALU primitives (regs.add / inc8 / dec8) used throughout, matching
 * convention (boot.js) -- the inc/dec/add flags are overwritten by `add a,l`
 * (0x3519) before the ret, so behaviour is identical to bare masks, but the
 * escaping ret flags are faithful. `inc de` (0x3516) is the one 16-bit inc and
 * sets no flags: bare `(de+1)&0xffff`.
 */
export function entry_34f3(m) {
  const { regs, mem } = m;

  regs.hl = 0x6400;
  m.step(0x34f6, 10); // ld hl,0x6400
  regs.de = 0x69d0;
  m.step(0x34f9, 10); // ld de,0x69d0
  regs.b = 0x05;
  m.step(0x34fb, 7); // ld b,0x05

  for (;;) {
    // loc_34fb
    regs.a = mem.read8(regs.hl);
    m.step(0x34fc, 7); // ld a,(hl) -- occupancy flag
    regs.and(regs.a); // and a -- sets Z; the jp z below reads it
    m.step(0x34fd, 4); // and a
    if (regs.fZ) {
      // loc_351e -- empty object: skip the copy, advance both pointers by +0x20/+4
      m.step(0x351e, 10); // jp z,0x351e TAKEN
      regs.a = 0x05;
      m.step(0x3520, 7); // ld a,0x05
      regs.add(regs.l);
      m.step(0x3521, 4); // add a,l
      regs.l = regs.a;
      m.step(0x3522, 4); // ld l,a -- L += 5
      regs.a = 0x04;
      m.step(0x3524, 7); // ld a,0x04
      regs.add(regs.e);
      m.step(0x3525, 4); // add a,e
      regs.e = regs.a; // E += 4 (8-bit -- NO carry to D, unlike inc de)
      m.step(0x3526, 4); // ld e,a
      m.step(0x3517, 10); // jp 0x3517
    } else {
      m.step(0x3500, 10); // jp z NOT taken -- non-empty
      // dest[0] = mem[P+3]
      regs.l = regs.inc8(regs.l);
      m.step(0x3501, 4); // inc l
      regs.l = regs.inc8(regs.l);
      m.step(0x3502, 4); // inc l
      regs.l = regs.inc8(regs.l);
      m.step(0x3503, 4); // inc l -- L = P+3
      regs.a = mem.read8(regs.hl);
      m.step(0x3504, 7); // ld a,(hl)
      mem.write8(regs.de, regs.a);
      m.step(0x3505, 7); // ld (de),a -- dest[0]
      // dest[1] = mem[P+7]
      regs.a = 0x04;
      m.step(0x3507, 7); // ld a,0x04
      regs.add(regs.l);
      m.step(0x3508, 4); // add a,l
      regs.l = regs.a; // L = P+7
      m.step(0x3509, 4); // ld l,a
      regs.e = regs.inc8(regs.e);
      m.step(0x350a, 4); // inc e (8-bit)
      regs.a = mem.read8(regs.hl);
      m.step(0x350b, 7); // ld a,(hl)
      mem.write8(regs.de, regs.a);
      m.step(0x350c, 7); // ld (de),a -- dest[1]
      // dest[2] = mem[P+8]
      regs.l = regs.inc8(regs.l);
      m.step(0x350d, 4); // inc l -- L = P+8
      regs.e = regs.inc8(regs.e);
      m.step(0x350e, 4); // inc e
      regs.a = mem.read8(regs.hl);
      m.step(0x350f, 7); // ld a,(hl)
      mem.write8(regs.de, regs.a);
      m.step(0x3510, 7); // ld (de),a -- dest[2]
      // dest[3] = mem[P+5]
      regs.l = regs.dec8(regs.l);
      m.step(0x3511, 4); // dec l
      regs.l = regs.dec8(regs.l);
      m.step(0x3512, 4); // dec l
      regs.l = regs.dec8(regs.l);
      m.step(0x3513, 4); // dec l -- L = P+5
      regs.e = regs.inc8(regs.e);
      m.step(0x3514, 4); // inc e
      regs.a = mem.read8(regs.hl);
      m.step(0x3515, 7); // ld a,(hl)
      mem.write8(regs.de, regs.a);
      m.step(0x3516, 7); // ld (de),a -- dest[3]
      regs.de = (regs.de + 1) & 0xffff; // inc de -- 16-bit, CAN carry to D, sets no flags
      m.step(0x3517, 6); // inc de
    }

    // loc_3517 -- advance L to the next object (net +0x20), loop
    regs.a = 0x1b;
    m.step(0x3519, 7); // ld a,0x1b
    regs.add(regs.l);
    m.step(0x351a, 4); // add a,l
    regs.l = regs.a; // L += 0x1B
    m.step(0x351b, 4); // ld l,a
    regs.djnz();
    m.step(regs.b !== 0 ? 0x34fb : 0x351d, regs.b !== 0 ? 13 : 8); // djnz 0x34fb
    if (regs.b === 0) break;
  }

  m.ret(); // 351d -- NORMAL ret
}

/**
 * sub_3fc0 -- ROM 0x3FC0-0x3FC7  (8 bytes, 5 instructions)
 *
 *   3fc0  21 4d 69     ld   hl,0x694d
 *   3fc3  36 03        ld   (hl),0x03
 *   3fc5  2c           inc  l             ; HL -> 0x694E (no write)
 *   3fc6  2c           inc  l             ; HL -> 0x694F (no write)
 *   3fc7  c9           ret
 *
 * Translated for completeness; not yet wired into the live dispatcher.
 * Not yet wired into the live dispatcher: only caller is 0x2285 (untranslated), and
 * nothing in translated src invokes sub_3fc0. Leaf, calls nothing.
 *
 * Writes mem[0x694D] = 3, then advances HL to 0x694F (skipping 0x694E, unwritten)
 * via two `inc l`. HL is LIVE-OUT at 0x694F -- the two write-free `inc l` are the
 * routine's only product besides the store, so the caller consumes HL.
 *
 * `inc l` is a REGISTER inc (L only, not `inc hl`): regs.inc8(regs.l), which sets
 * S/Z/H/PV (carry preserved) -- flags the ret leaves live. inc8, NOT incMem8:
 * this is a register inc, not a memory RMW. A plain `regs.l+1` would drop the
 * flags (the sub_0593 lesson); `inc hl` would carry into H at a page wrap (latent
 * here -- L runs 0x4D->0x4F, no wrap; the routine hardcodes HL so no input can
 * reach the boundary, so the inc-l-vs-inc-hl divergence is untestable as written).
 */
export function sub_3fc0(m) {
  const { regs, mem } = m;

  regs.hl = 0x694d;
  m.step(0x3fc3, 10); // ld hl,0x694d
  mem.write8(regs.hl, 0x03);
  m.step(0x3fc5, 10); // ld (hl),0x03
  regs.l = regs.inc8(regs.l); // inc l -- L only, sets flags; HL -> 0x694E
  m.step(0x3fc6, 4); // inc l
  regs.l = regs.inc8(regs.l); // inc l -- HL -> 0x694F
  m.step(0x3fc7, 4); // inc l

  m.ret(); // 3fc7 -- HL = 0x694F live-out, flags = last inc l
}

/**
 * sub_0207 -- ROM 0x0207-0x0265  "decode the dip switches"
 *
 *   0207  3a 80 7d     ld   a,(0x7d80)
 *   020a  4f           ld   c,a
 *   020b  21 20 60     ld   hl,0x6020
 *   020e  e6 03        and  0x03
 *   0210  c6 03        add  a,0x03
 *   0212  77           ld   (hl),a
 *   0213  23           inc  hl
 *   0214  79           ld   a,c
 *   0215  0f           rrca
 *   0216  0f           rrca
 *   0217  e6 03        and  0x03
 *   0219  47           ld   b,a
 *   021a  3e 07        ld   a,0x07
 *   021c  ca 26 02     jp   z,0x0226
 *   021f  3e 05        ld   a,0x05
 *   0221  c6 05        add  a,0x05           ; loc_0221
 *   0223  27           daa
 *   0224  10 fb        djnz 0x0221
 *   0226  77           ld   (hl),a           ; loc_0226
 *   0227  23           inc  hl
 *   0228  79           ld   a,c
 *   0229  01 01 01     ld   bc,0x0101
 *   022c  11 02 01     ld   de,0x0102
 *   022f  e6 70        and  0x70
 *   0231  17           rla
 *   0232  17           rla
 *   0233  17           rla
 *   0234  17           rla
 *   0235  ca 47 02     jp   z,0x0247
 *   0238  da 41 02     jp   c,0x0241
 *   023b  3c           inc  a
 *   023c  4f           ld   c,a
 *   023d  5a           ld   e,d
 *   023e  c3 47 02     jp   0x0247
 *   0241  c6 02        add  a,0x02           ; loc_0241
 *   0243  47           ld   b,a
 *   0244  57           ld   d,a
 *   0245  87           add  a,a
 *   0246  5f           ld   e,a
 *   0247  72           ld   (hl),d           ; loc_0247
 *   0248  23           inc  hl
 *   0249  73           ld   (hl),e
 *   024a  23           inc  hl
 *   024b  70           ld   (hl),b
 *   024c  23           inc  hl
 *   024d  71           ld   (hl),c
 *   024e  23           inc  hl
 *   024f  3a 80 7d     ld   a,(0x7d80)
 *   0252  07           rlca
 *   0253  3e 01        ld   a,0x01
 *   0255  da 59 02     jp   c,0x0259
 *   0258  3d           dec  a
 *   0259  77           ld   (hl),a           ; loc_0259
 *   025a  21 65 35     ld   hl,0x3565
 *   025d  11 00 61     ld   de,0x6100
 *   0260  01 aa 00     ld   bc,0x00aa
 *   0263  ed b0        ldir
 *   0265  c9           ret
 *
 * Unpacks DSW0 into the settings block at 0x6020:
 *   bits 0-1  lives          -> 0x6020 = value + 3
 *   bits 2-3  bonus life     -> 0x6021, BCD: 7 when zero, else 5+5n via `daa`
 *   bits 4-6  coinage        -> 0x6022-0x6025 as four related counters
 *   bit 7     (re-read)      -> 0x6026, the two-player/alternation flag
 *
 * NOTE the `jp z` at 0x021C tests the `and 0x03` from 0x0217 -- the two `ld`s
 * between them do not touch flags. Same shape as the NMI's control read.
 *
 * The bonus threshold is genuine BCD (`add a,0x05 / daa`), so it depends on
 * exact DAA semantics. Its result feeds 0x6021, which sub_0350 compares the
 * packed score against.
 *
 * Ends with an `ldir` of 0xAA bytes from ROM 0x3565 to 0x6100 -- a 170-byte
 * table copied into work RAM, so that ROM span is data.
 */
function sub_0207(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x7d80); // DSW0
  m.step(0x020a, 13);
  regs.c = regs.a;
  m.step(0x020b, 4);
  regs.hl = 0x6020;
  m.step(0x020e, 10);
  regs.and(0x03);
  m.step(0x0210, 7);
  regs.add(0x03);
  m.step(0x0212, 7);
  mem.write8(regs.hl, regs.a); // lives
  m.step(0x0213, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0214, 6);

  regs.a = regs.c;
  m.step(0x0215, 4);
  regs.rrca();
  m.step(0x0216, 4);
  regs.rrca();
  m.step(0x0217, 4);
  regs.and(0x03);
  m.step(0x0219, 7);
  const zero = regs.fZ; // captured BEFORE the flag-neutral loads below
  regs.b = regs.a;
  m.step(0x021a, 4);
  regs.a = 0x07;
  m.step(0x021c, 7);
  if (zero) {
    m.step(0x0226, 10); // jp z taken -- bonus stays 7
  } else {
    m.step(0x021f, 10);
    regs.a = 0x05;
    m.step(0x0221, 7);
    do {
      regs.add(0x05);
      m.step(0x0223, 7);
      regs.daa(); // BCD -- exact semantics matter here
      m.step(0x0224, 4);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x0221 : 0x0226, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
  }

  mem.write8(regs.hl, regs.a); // bonus threshold
  m.step(0x0227, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0228, 6);
  regs.a = regs.c;
  m.step(0x0229, 4);
  regs.bc = 0x0101;
  m.step(0x022c, 10);
  regs.de = 0x0102;
  m.step(0x022f, 10);
  regs.and(0x70); // coinage bits
  m.step(0x0231, 7);
  for (const nxt of [0x0232, 0x0233, 0x0234, 0x0235]) {
    regs.rla();
    m.step(nxt, 4);
  }

  if (regs.fZ) {
    m.step(0x0247, 10); // jp z -- defaults already in BC/DE
  } else {
    m.step(0x0238, 10);
    if (regs.fC) {
      m.step(0x0241, 10);
      regs.add(0x02);
      m.step(0x0243, 7);
      regs.b = regs.a;
      m.step(0x0244, 4);
      regs.d = regs.a;
      m.step(0x0245, 4);
      regs.add(regs.a); // add a,a
      m.step(0x0246, 4);
      regs.e = regs.a;
      m.step(0x0247, 4);
    } else {
      m.step(0x023b, 10);
      regs.a = regs.inc8(regs.a);
      m.step(0x023c, 4);
      regs.c = regs.a;
      m.step(0x023d, 4);
      regs.e = regs.d;
      m.step(0x023e, 4);
      m.step(0x0247, 10); // jp 0x0247
    }
  }

  // loc_0247: store D, E, B, C into 0x6022-0x6025
  for (const [v, nxt, inc] of [
    [regs.d, 0x0248, 0x0249], [regs.e, 0x024a, 0x024b],
    [regs.b, 0x024c, 0x024d], [regs.c, 0x024e, 0x024f],
  ]) {
    mem.write8(regs.hl, v);
    m.step(nxt, 7);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(inc, 6);
  }

  regs.a = mem.read8(0x7d80); // DSW0 again
  m.step(0x0252, 13);
  regs.rlca(); // bit 7 into carry
  m.step(0x0253, 4);
  regs.a = 0x01;
  m.step(0x0255, 7);
  if (regs.fC) {
    m.step(0x0259, 10); // jp c taken -- A stays 1
  } else {
    m.step(0x0258, 10);
    regs.a = regs.dec8(regs.a); // A = 0
    m.step(0x0259, 4);
  }
  mem.write8(regs.hl, regs.a);
  m.step(0x025a, 7);

  regs.hl = 0x3565;
  m.step(0x025d, 10);
  regs.de = 0x6100;
  m.step(0x0260, 10);
  regs.bc = 0x00aa;
  m.step(0x0263, 10);
  m.ldirAt(0x0263, 0x0265);

  m.ret();
}

/**
 * sub_2ff0 -- ROM 0x2FF0-0x3008  "(y,x) -> video RAM address"
 *
 *   2ff0  7d           ld   a,l
 *   2ff1  0f           rrca
 *   2ff2  0f           rrca
 *   2ff3  0f           rrca
 *   2ff4  e6 1f        and  0x1f
 *   2ff6  6f           ld   l,a
 *   2ff7  7c           ld   a,h
 *   2ff8  2f           cpl
 *   2ff9  e6 f8        and  0xf8
 *   2ffb  5f           ld   e,a
 *   2ffc  af           xor  a
 *   2ffd  67           ld   h,a
 *   2ffe  cb 13        rl   e
 *   3000  17           rla
 *   3001  cb 13        rl   e
 *   3003  17           rla
 *   3004  c6 74        add  a,0x74
 *   3006  57           ld   d,a
 *   3007  19           add  hl,de
 *   3008  c9           ret
 *
 * Takes H = y, L = x in PIXELS and returns HL = the video RAM address of the
 * tile containing that pixel. Computed as
 *
 *     col = (x >> 3) & 0x1f
 *     row = (255 - y) >> 3          <- note the complement
 *     HL  = 0x7400 + row * 32 + col
 *
 * THE `cpl` IS THE INTERESTING PART: the ROM complements Y before dividing
 * by 8, so its own address arithmetic is VERTICALLY MIRRORED. The 180-degree
 * rotation we render is not something MAME imposes on top of a
 * conventionally-addressed tilemap -- the game computes flipped addresses
 * itself, and our `renderRowRGB` flip is reproducing a transform the ROM
 * already assumes. Two independent expressions of the same geometry.
 *
 * The THREE `rrca` + `and 0x1f` is a divide-by-8 done as a ROTATE, so the low
 * three bits of x wrap into the top of A and are then masked off -- which is
 * why the mask is 0x1F and not 0x3F. (This said "four" while the note below
 * recorded that emitting four was the bug being fixed. The stale count
 * survived in the prose directly above its own correction, in the one place
 * a reader would go to check it.)
 *
 * `rl e / rla` twice is a 16-BIT LEFT SHIFT by two: each pair shifts E left
 * and catches the bit falling out of it in A. That turns (255-y)&0xF8, which
 * is row*8, into row*32 spread across A:E. `add a,0x74` then makes A the
 * page byte, so DE is the row offset from 0x7400 and HL = DE + col.
 *
 * NOTE `rl e` is CB-prefixed and sets the FULL flag set including Z and
 * parity, unlike the `rla` interleaved with it which preserves S/Z/PV. They
 * look like the same instruction and are not.
 */
export function sub_2ff0(m) {
  const { regs } = m;

  // Transcribed one instruction at a time against the listing. A first
  // version used a loop for the rrca run and emitted FOUR rotations where the
  // ROM has THREE (0x2FF1-0x2FF3), shifting every address after it. The
  // suite stayed green because nothing reaches this routine yet -- a latent
  // bug behind a passing test, which is exactly what a loop over an
  // instruction run buys you for the two lines it saves.
  regs.a = regs.l;
  m.step(0x2ff1, 4);
  regs.rrca();
  m.step(0x2ff2, 4);
  regs.rrca();
  m.step(0x2ff3, 4);
  regs.rrca();
  m.step(0x2ff4, 4);
  regs.and(0x1f);
  m.step(0x2ff6, 7);
  regs.l = regs.a;
  m.step(0x2ff7, 4);

  regs.a = regs.h;
  m.step(0x2ff8, 4);
  regs.cpl();
  m.step(0x2ff9, 4);
  regs.and(0xf8);
  m.step(0x2ffb, 7);
  regs.e = regs.a;
  m.step(0x2ffc, 4);
  regs.xor(regs.a);
  m.step(0x2ffd, 4);
  regs.h = regs.a;
  m.step(0x2ffe, 4);

  // The 16-bit left shift, twice. `rl e` is CB-prefixed at 8 T; `rla` is 4.
  regs.e = regs.rl(regs.e);
  m.step(0x3000, 8);
  regs.rla();
  m.step(0x3001, 4);
  regs.e = regs.rl(regs.e);
  m.step(0x3003, 8);
  regs.rla();
  m.step(0x3004, 4);

  regs.add(0x74);
  m.step(0x3006, 7);
  regs.d = regs.a;
  m.step(0x3007, 4);
  regs.addHl(regs.de);
  m.step(0x3008, 11);
  m.ret();
}

/**
 * sub_0f56 -- ROM 0x0F56-0x0FCA, tail at 0x0FCB flagged and NOT translated
 *
 *   0f56  06 27        ld   b,0x27
 *   0f58  21 00 62     ld   hl,0x6200
 *   0f5b  af           xor  a
 * loc_0f5c:
 *   0f5c  77           ld   (hl),a
 *   0f5d  2c           inc  l
 *   0f5e  10 fc        djnz 0x0f5c
 *   0f60  0e 11        ld   c,0x11
 *   0f62  16 80        ld   d,0x80
 *   0f64  21 80 62     ld   hl,0x6280
 * loc_0f67:
 *   0f67  42           ld   b,d
 * loc_0f68:
 *   0f68  77           ld   (hl),a
 *   0f69  23           inc  hl
 *   0f6a  10 fc        djnz 0x0f68
 *   0f6c  0d           dec  c
 *   0f6d  20 f8        jr   nz,0x0f67
 *   0f6f  21 9c 3d     ld   hl,0x3d9c
 *   0f72  11 80 62     ld   de,0x6280
 *   0f75  01 40 00     ld   bc,0x0040
 *   0f78  ed b0        ldir
 *   0f7a  3a 29 62     ld   a,(0x6229)
 *   0f7d  47           ld   b,a
 *   0f7e  a7           and  a
 *   0f7f  17           rla
 *   0f80  a7           and  a
 *   0f81  17           rla
 *   0f82  a7           and  a
 *   0f83  17           rla
 *   0f84  80           add  a,b
 *   0f85  80           add  a,b
 *   0f86  c6 28        add  a,0x28
 *   0f88  fe 51        cp   0x51
 *   0f8a  38 02        jr   c,0x0f8e
 *   0f8c  3e 50        ld   a,0x50
 * loc_0f8e:
 *   0f8e  21 b0 62     ld   hl,0x62b0
 *   0f91  06 03        ld   b,0x03
 * loc_0f93:
 *   0f93  77           ld   (hl),a
 *   0f94  2c           inc  l
 *   0f95  10 fc        djnz 0x0f93
 *   0f97  87           add  a,a
 *   0f98  47           ld   b,a
 *   0f99  3e dc        ld   a,0xdc
 *   0f9b  90           sub  b
 *   0f9c  fe 28        cp   0x28
 *   0f9e  30 02        jr   nc,0x0fa2
 *   0fa0  3e 28        ld   a,0x28
 * loc_0fa2:
 *   0fa2  77           ld   (hl),a
 *   0fa3  2c           inc  l
 *   0fa4  77           ld   (hl),a
 *   0fa5  21 09 62     ld   hl,0x6209
 *   0fa8  36 04        ld   (hl),0x04
 *   0faa  2c           inc  l
 *   0fab  36 08        ld   (hl),0x08
 *   0fad  3a 27 62     ld   a,(0x6227)
 *   0fb0  4f           ld   c,a
 *   0fb1  cb 57        bit  2,a
 *   0fb3  20 16        jr   nz,0x0fcb
 *   0fb5  21 00 6a     ld   hl,0x6a00
 *   0fb8  3e 4f        ld   a,0x4f
 *   0fba  06 03        ld   b,0x03
 * loc_0fbc:
 *   0fbc  77           ld   (hl),a
 *   0fbd  2c           inc  l
 *   0fbe  36 3a        ld   (hl),0x3a
 *   0fc0  2c           inc  l
 *   0fc1  36 0f        ld   (hl),0x0f
 *   0fc3  2c           inc  l
 *   0fc4  36 18        ld   (hl),0x18
 *   0fc6  2c           inc  l
 *   0fc7  c6 10        add  a,0x10
 *   0fc9  10 f1        djnz 0x0fbc
 * loc_0fcb:
 *   0fcb  79           ld   a,c        <-- NOT TRANSLATED
 *   0fcc  ef           rst  0x28       <-- NOT TRANSLATED (dispatcher)
 *
 * Called once, from `call 0x0f56` at 0x0D5F. CONTAINS NO `ret`: the only exit
 * from this routine is the `rst 0x28` at 0x0FCC. What that does to the return
 * address pushed at 0x0D5F is deliberately NOT modelled here.
 *
 * BOTH exits from the translated body land on 0x0FCB: the `jr nz` at 0x0FB3
 * and the fallthrough off the `djnz` at 0x0FC9.
 */
export function sub_0f56(m) {
  const { regs, mem } = m;

  // ---- clear 0x6200-0x6226, 0x27 bytes ----
  regs.b = 0x27;
  m.step(0x0f58, 7);
  regs.hl = 0x6200;
  m.step(0x0f5b, 10);
  regs.xor(regs.a); // A = 0 -- the fill value for BOTH clear loops
  m.step(0x0f5c, 4);
  do {
    mem.write8(regs.hl, regs.a);
    m.step(0x0f5d, 7);
    regs.l = regs.inc8(regs.l); // `inc l`, NOT `inc hl` -- no carry into H
    m.step(0x0f5e, 4);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x0f5c : 0x0f60, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  // ---- clear 17 blocks of 0x80 from 0x6280 -> 0x6280-0x6AFF ----
  regs.c = 0x11;
  m.step(0x0f62, 7);
  regs.d = 0x80;
  m.step(0x0f64, 7);
  regs.hl = 0x6280;
  m.step(0x0f67, 10);
  do {
    regs.b = regs.d;
    m.step(0x0f68, 4);
    do {
      mem.write8(regs.hl, regs.a);
      m.step(0x0f69, 7);
      regs.hl = (regs.hl + 1) & 0xffff; // `inc hl` here, full 16-bit
      m.step(0x0f6a, 6);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x0f68 : 0x0f6c, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
    regs.c = regs.dec8(regs.c);
    m.step(0x0f6d, 4);
    m.step(regs.fNZ ? 0x0f67 : 0x0f6f, regs.fNZ ? 12 : 7);
  } while (regs.fNZ);

  // ---- copy 0x40 bytes of ROM DATA 0x3D9C-0x3DDB to 0x6280-0x62BF ----
  regs.hl = 0x3d9c;
  m.step(0x0f72, 10);
  regs.de = 0x6280;
  m.step(0x0f75, 10);
  regs.bc = 0x0040;
  m.step(0x0f78, 10);
  m.ldirAt(0x0f78, 0x0f7a); // NOT the 0x01CF-hardcoded ldir()

  // ---- A = min( (0x6229)*10 + 0x28 , 0x50 ) -- ALL MOD 256 ----
  regs.a = mem.read8(0x6229);
  m.step(0x0f7d, 13);
  regs.b = regs.a;
  m.step(0x0f7e, 4);
  // `and a` clears carry so the following `rla` shifts a 0 into bit 0 and the
  // bit shifted OUT of bit 7 is discarded. Three pairs = A = (A*8) & 0xFF.
  for (const [andNext, rlaNext] of [[0x0f7f, 0x0f80], [0x0f81, 0x0f82],
                                    [0x0f83, 0x0f84]]) {
    regs.and(regs.a);
    m.step(andNext, 4);
    regs.rla();
    m.step(rlaNext, 4);
  }
  regs.add(regs.b); // A = A*8 + A0
  m.step(0x0f85, 4);
  regs.add(regs.b); // A = A*8 + 2*A0  == A0*10 mod 256
  m.step(0x0f86, 4);
  regs.add(0x28);
  m.step(0x0f88, 7);
  regs.cp(0x51);
  m.step(0x0f8a, 7);
  if (regs.fC) {
    m.step(0x0f8e, 12);
  } else {
    m.step(0x0f8c, 7);
    regs.a = 0x50; // clamp -- bounds the RESULT, does NOT detect wrap
    m.step(0x0f8e, 7);
  }

  // ---- store that value at 0x62B0,B1,B2 ----
  regs.hl = 0x62b0;
  m.step(0x0f91, 10);
  regs.b = 0x03;
  m.step(0x0f93, 7);
  do {
    mem.write8(regs.hl, regs.a);
    m.step(0x0f94, 7);
    regs.l = regs.inc8(regs.l);
    m.step(0x0f95, 4);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x0f93 : 0x0f97, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);
  // HL is NOT reloaded below -- it carries out of this loop as 0x62B3

  // ---- A = max( 0xDC - 2*A , 0x28 ) ----
  regs.add(regs.a); // add a,a -- A = 2A
  m.step(0x0f98, 4);
  regs.b = regs.a;
  m.step(0x0f99, 4);
  regs.a = 0xdc;
  m.step(0x0f9b, 7);
  regs.sub(regs.b);
  m.step(0x0f9c, 4);
  regs.cp(0x28);
  m.step(0x0f9e, 7);
  if (regs.fNC) {
    m.step(0x0fa2, 12);
  } else {
    m.step(0x0fa0, 7);
    regs.a = 0x28; // Is this reachable at all?
    m.step(0x0fa2, 7);
  }

  // ---- store at 0x62B3, 0x62B4 (HL carried from the 0x0F93 loop) ----
  mem.write8(regs.hl, regs.a);
  m.step(0x0fa3, 7);
  regs.l = regs.inc8(regs.l);
  m.step(0x0fa4, 4);
  mem.write8(regs.hl, regs.a);
  m.step(0x0fa5, 7);

  // ---- 0x6209 = 4, 0x620A = 8 ----
  regs.hl = 0x6209;
  m.step(0x0fa8, 10);
  mem.write8(regs.hl, 0x04);
  m.step(0x0faa, 10);
  regs.l = regs.inc8(regs.l);
  m.step(0x0fab, 4);
  mem.write8(regs.hl, 0x08);
  m.step(0x0fad, 10);

  // ---- C = (0x6227). C IS THE DISPATCHER INDEX -- live to 0x0FCB ----
  regs.a = mem.read8(0x6227);
  m.step(0x0fb0, 13);
  regs.c = regs.a;
  m.step(0x0fb1, 4);
  const bit2 = regs.bit(2, regs.a); // does not modify A; preserves carry
  m.step(0x0fb3, 8);
  if (bit2) {
    m.step(0x0fcb, 12); // Branches straight INTO the withheld unit
  } else {
    m.step(0x0fb5, 7);

    // ---- seed 3 x 4 bytes at 0x6A00-0x6A0B ----
    regs.hl = 0x6a00;
    m.step(0x0fb8, 10);
    regs.a = 0x4f;
    m.step(0x0fba, 7);
    regs.b = 0x03;
    m.step(0x0fbc, 7);
    do {
      mem.write8(regs.hl, regs.a);
      m.step(0x0fbd, 7);
      regs.l = regs.inc8(regs.l);
      m.step(0x0fbe, 4);
      mem.write8(regs.hl, 0x3a);
      m.step(0x0fc0, 10);
      regs.l = regs.inc8(regs.l);
      m.step(0x0fc1, 4);
      mem.write8(regs.hl, 0x0f);
      m.step(0x0fc3, 10);
      regs.l = regs.inc8(regs.l);
      m.step(0x0fc4, 4);
      mem.write8(regs.hl, 0x18);
      m.step(0x0fc6, 10);
      regs.l = regs.inc8(regs.l);
      m.step(0x0fc7, 4);
      regs.add(0x10);
      m.step(0x0fc9, 7);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x0fbc : 0x0fcb, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
  }

  // ---- 0x0FCB: ld a,c / rst 0x28 -- the inline-jump-table dispatcher ----
  regs.a = regs.c;
  m.step(0x0fcc, 4);
  m.push16(0x0fcd); // rst 0x28 pushes the address AFTER it -- the TABLE BASE
  m.step(0x0028, 11);


  //
  // The draft flagged that sub_0f56 contains no `ret` and asked what becomes
  // of the 0x0D62 pushed by `call 0x0f56` at 0x0D5F. The 2441 draft went
  // further: if the rst consumed its CALLER'S return address as inline table
  // data, then `cd 41 24` at 0x0D62 would be a DECODE ARTIFACT rather than an
  // executed instruction.
  //
  // It does not. `rst 0x28` pushes ITS OWN continuation (0x0FCD) and the
  // dispatcher's `pop hl` takes exactly that back off as the table base. The
  // caller's 0x0D62 is never touched -- it sits one slot deeper throughout,
  // and it is what the dispatched target's `ret` eventually pops.
  //
  // So `call 0x2441` at 0x0D62 IS executed, and the coverage data showing
  // 0x2441 running is consistent with it being reached that way after all.
  // A routine having no `ret` of its own is real, and is NOT the same claim
  // as its caller not being returned to -- which is the conflation the
  // tracer's `returns_normally` makes.
  //
  // Table at 0x0FCD, five entries, indexed by C = (0x6227):
  //   0 -> 0x0000 (unused)   1 -> 0x0FD7   2 -> 0x101F
  //   3 -> 0x1087            4 -> 0x1131
  // THE rst 0x28 BODY, MODELLED RATHER THAN SUMMARISED -- ROM 0x0028-0x0037:
  //
  //   0028  87        add  a,a     ; A = 2*index
  //   0029  e1        pop  hl      ; HL = 0x0FCD, THE TABLE BASE -- this is
  //                                ;   the pop that consumes the push above
  //   002a  5f        ld   e,a
  //   002b  16 00     ld   d,0x00  ; DE = 2*index
  //   002d  c3 32 00  jp   0x0032
  //   0032  19        add  hl,de   ; HL = table base + 2*index
  //   0033  5e        ld   e,(hl)
  //   0034  23        inc  hl
  //   0035  56        ld   d,(hl)
  //   0036  eb        ex   de,hl   ; HL = the target
  //   0037  e9        jp   (hl)
  //
  // 4+10+4+7+10+11+7+6+7+4+4 = 74 T, which is exactly the constant this site
  // already carried -- the faithful body reproduces the summary's timing.
  //
  // THE `pop hl` WAS PREVIOUSLY NOT MODELLED AT ALL. The push above ran, this
  // pop did not, and every dispatch therefore left one extra slot on the
  // stack. It stayed invisible for exactly as long as no dispatched target
  // reached a `ret` -- loc_0fd7 threw NotImplemented first. Completing
  // loc_0fd7 made the first such `ret` execute and it popped the stale 0x0FCD
  // instead of the caller's 0x0D62.
  //
  // The comment above this one states the mechanism CORRECTLY and the code
  // implemented half of it: the push was modelled because it was written as a
  // push, the pop was dissolved into a 74-cycle summary. The assertion
  // was true of the ROM and false of the model, and the prose being right is
  // what stopped anyone checking. Registers were dropped the same way; they
  // happen to be dead into loc_0fd7, which overwrites HL, DE and BC before
  // reading anything and contains no conditional, but the other four table
  // entries are next and nothing guarantees that for them.
  regs.add(regs.a);
  m.step(0x0029, 4); // add a,a
  regs.hl = m.pop16(); // pop hl -- the table base, balancing the push
  m.step(0x002a, 10);
  regs.e = regs.a;
  m.step(0x002b, 4); // ld e,a
  regs.d = 0x00;
  m.step(0x002d, 7); // ld d,0x00
  m.step(0x0032, 10); // jp 0x0032
  regs.addHl(regs.de); // sets H, N, C -- dead into loc_0fd7, not in general
  m.step(0x0033, 11); // add hl,de
  regs.e = mem.read8(regs.hl);
  m.step(0x0034, 7); // ld e,(hl)
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0035, 6); // inc hl
  regs.d = mem.read8(regs.hl);
  m.step(0x0036, 7); // ld d,(hl)
  const target = regs.de; // ex de,hl: HL becomes the target, DE the pointer
  regs.de = regs.hl;
  regs.hl = target;
  m.step(0x0037, 4); // ex de,hl
  m.step(target, 4); // jp (hl)

  if (target === 0x0fd7) return loc_0fd7(m);
  if (target === 0x101f) return loc_101f(m); // board 2 (0x6227==2, 0x0FCD table idx 2)
  if (target === 0x1087) return loc_1087(m); // board 3 (0x0FCD table idx 3)
  if (target === 0x1131) return loc_1131(m); // board 4 (0x0FCD table idx 4)
  throw new NotImplemented(
    `sub_0f56 dispatches via rst 0x28 to ROM 0x${target.toString(16).padStart(4, "0")} ` +
      `(table at 0x0FCD, index C=${regs.c}), which is not translated.`,
  );
}

export function loc_0f35(m) {
  const { regs, mem } = m;

  do {
    regs.a = mem.read8(0x63b5); // re-read every iteration
    m.step(0x0f38, 13); // ld a,(0x63b5)
    mem.write8(regs.hl, regs.a); // HL is runtime-computed
    m.step(0x0f39, 7); // ld (hl),a
    regs.bc = 0x0020;
    m.step(0x0f3c, 10); // ld bc,0x0020 -- INSIDE the loop (10 T/iter)
    regs.addHl(regs.bc); // carry set here is DEAD (overwritten at 0x0F42)
    m.step(0x0f3d, 11); // add hl,bc
    regs.a = mem.read8(0x63b1);
    m.step(0x0f40, 13); // ld a,(0x63b1)
    regs.sub(0x08); // THIS is the carry the branch tests
    m.step(0x0f42, 7); // sub 0x08
    mem.write8(0x63b1, regs.a); // wrapped byte written back on borrow
    m.step(0x0f45, 13); // ld (0x63b1),a
    m.step(regs.fNC ? 0x0f35 : 0x0f48, 10); // jp nc,0x0f35 -- falls through on borrow
  } while (regs.fNC);

  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0f49, 6); // inc de

  m.step(0x0da7, 10); // jp 0x0da7 -- TAIL JUMP, nothing pushed
  sub_0da7(m); // its ret returns for us
}

/**
 * loc_0fd7 -- ROM 0x0FD7-0x101A  (rst 0x28 table entry 1)
 *
 *   0fd7  21 dc 3d     ld   hl,0x3ddc
 *   0fda  11 a8 69     ld   de,0x69a8
 *   0fdd  01 10 00     ld   bc,0x0010
 *   0fe0  ed b0        ldir
 *   0fe2  21 ec 3d     ld   hl,0x3dec
 *   0fe5  11 07 64     ld   de,0x6407
 *   0fe8  0e 1c        ld   c,0x1c
 *   0fea  06 05        ld   b,0x05
 *   0fec  cd 2a 12     call 0x122a
 *   ... four more helper calls, then `ret` at 0x101A
 *
 * THIS IS WHERE SPRITES COME FROM. The destinations include 0x69A8 and
 * 0x69FC, which are inside 0x6900-0x6A7F -- the sprite buffer the i8257
 * blits to 0x7000 every vblank. sub_0874 clears exactly that range at boot;
 * this is the routine that fills it.
 *
 * NOTE the source at 0x1006 is `ld hl,0x101b` -- four bytes of DATA
 * (00 00 02 02) sitting immediately after this routine's `ret`, which is why
 * 0x101B-0x101E shows as UNREACHED in the coverage map. It is data, not
 * unexercised code, and the same shape as the 9 bytes before handler_01c3.
 */
function loc_0fd7(m) {
  const { regs } = m;

  regs.hl = 0x3ddc;
  m.step(0x0fda, 10);
  regs.de = 0x69a8; // INSIDE the sprite buffer
  m.step(0x0fdd, 10);
  regs.bc = 0x0010;
  m.step(0x0fe0, 10);
  m.ldirAt(0x0fe0, 0x0fe2);

  regs.hl = 0x3dec;
  m.step(0x0fe5, 10);
  regs.de = 0x6407;
  m.step(0x0fe8, 10);
  regs.c = 0x1c;
  m.step(0x0fea, 7);
  regs.b = 0x05;
  m.step(0x0fec, 7);

  m.push16(0x0fef);
  m.step(0x122a, 17);
  sub_122a(m);

  // HL here is a LIVE-IN PARAMETER to sub_11fa (0x3DF4), not a value sub_11fa
  // sets. sub_122a has left C = 0x1C and HL = 0x3DEC, both dead across this.
  regs.hl = 0x3df4;
  m.step(0x0ff2, 10);
  m.push16(0x0ff5);
  m.step(0x11fa, 17);
  sub_11fa(m);

  regs.hl = 0x3e00;
  m.step(0x0ff8, 10);
  regs.de = 0x69fc; // INSIDE the sprite buffer, like the 0x69A8 above
  m.step(0x0ffb, 10);
  regs.bc = 0x0004;
  m.step(0x0ffe, 10);
  m.ldirAt(0x0ffe, 0x1000);

  // HL is a LIVE-IN PARAMETER of sub_11a6, which passes it straight through to
  // sub_11ec without ever setting it. All three of sub_11a6's call sites supply
  // it -- 0x3E0C here, 0x3E10 at 0x1073, 0x3E14 at 0x1140, stride 4.
  regs.hl = 0x3e0c;
  m.step(0x1003, 10);
  m.push16(0x1006);
  m.step(0x11a6, 17);
  sub_11a6(m);

  // 0x101B is the four DATA bytes (00 00 02 02) after this routine's `ret`.
  regs.hl = 0x101b;
  m.step(0x1009, 10);
  regs.de = 0x6707;
  m.step(0x100c, 10);
  regs.bc = 0x081c; // B = 8 passes, C = 0x1C stride
  m.step(0x100f, 10);
  m.push16(0x1012);
  m.step(0x122a, 17);
  sub_122a(m);

  // Reloads DE and B ONLY -- not HL, not C. This is the site that proves
  // sub_122a preserves both; see the note on sub_122a.
  regs.de = 0x6807;
  m.step(0x1015, 10);
  regs.b = 0x02;
  m.step(0x1017, 7);
  m.push16(0x101a);
  m.step(0x122a, 17);
  sub_122a(m);

  m.ret(); // 101a
}

/**
 * sub_11fa -- ROM 0x11FA-0x1229  (48 bytes, 28 instructions)
 *
 *   11fa  dd 21 a0 66  ld   ix,0x66a0
 *   11fe  11 28 6a     ld   de,0x6a28
 *   1201  dd 36 00 01  ld   (ix+0x00),0x01
 *   1205  7e           ld   a,(hl)
 *   1206  dd 77 03     ld   (ix+0x03),a
 *   1209  12           ld   (de),a
 *   120a  1c           inc  e
 *   120b  23           inc  hl
 *   120c  7e           ld   a,(hl)
 *   120d  dd 77 07     ld   (ix+0x07),a
 *   1210  12           ld   (de),a
 *   1211  1c           inc  e
 *   1212  23           inc  hl
 *   1213  7e           ld   a,(hl)
 *   1214  dd 77 08     ld   (ix+0x08),a
 *   1217  12           ld   (de),a
 *   1218  1c           inc  e
 *   1219  23           inc  hl
 *   121a  7e           ld   a,(hl)
 *   121b  dd 77 05     ld   (ix+0x05),a
 *   121e  12           ld   (de),a
 *   121f  23           inc  hl
 *   1220  7e           ld   a,(hl)
 *   1221  dd 77 09     ld   (ix+0x09),a
 *   1224  23           inc  hl
 *   1225  7e           ld   a,(hl)
 *   1226  dd 77 0a     ld   (ix+0x0a),a
 *   1229  c9           ret
 *
 * Two call sites: 0x0FF2 (here) and 0x104C.
 *
 * NOT A LOOP AND NOT sub_122a'S TWIN. It shares the `ld a,(hl)` / `ld (de),a` /
 * `inc e` / `inc hl` idiom with sub_122a and sub_11ec and is a DIFFERENT
 * routine: straight-line, no djnz, no branch, 28 instructions to a `ret`.
 * sub_11ec is the worked example of why the idiom decides nothing -- it is
 * near-identical to sub_122a in bytes and inverted in behaviour by one
 * push/pop pair.
 *
 * HL IS A LIVE-IN PARAMETER -- never set here. Six consecutive bytes are read
 * from (HL); HL is left at source+5, NOT source+6, because the last read at
 * 0x1225 is not followed by an `inc hl`.
 *
 * Both callers supply HL adjacently with `ld hl,nn`: 0x3DF4 at 0x0FEF, 0x3DFA
 * at 0x1049 -- stride 6, and this routine reads exactly six bytes. THE STRIDE
 * AND THE READ COUNT AGREE; that agreement is arithmetic and is NOT recorded
 * here as evidence that the six bytes are one record. Nobody has read those
 * bytes.
 *
 * THE IX WRITE ORDER IS LOAD-BEARING: +0x00, +0x03, +0x07, +0x08, +0x05,
 * +0x09, +0x0A -- note +0x05 lands AFTER +0x08. All seven addresses are
 * distinct, so sorting them into ascending order leaves final memory
 * IDENTICAL and no state diff would notice. The write TRACE, however, is
 * gated, so the tidy version goes red. Left in ROM order deliberately.
 *
 * Offsets +0x01, +0x02, +0x04 and +0x06 are not written here. Whether they are
 * padding, written elsewhere, or unused is not established.
 *
 * `inc e`, NOT `inc de`: 8-bit, no carry into D, and it SETS FLAGS where
 * `inc de` sets none. E runs 0x28..0x2B here so the wrap is unexercised, and
 * the flags die at the `ret` -- a wrong version is byte-identical on any real
 * tape. Latent, not absent.
 *
 * The FOURTH (de) write at 0x121E is NOT followed by an `inc e`, so DE exits
 * at 0x6A2B pointing AT the byte just written rather than one past it. The
 * three earlier writes each advance. The asymmetry is real in the bytes.
 */
export function sub_11fa(m) {
  const { regs, mem } = m;

  regs.ix = 0x66a0;
  m.step(0x11fe, 14); // ld ix,0x66a0
  regs.de = 0x6a28;
  m.step(0x1201, 10); // ld de,0x6a28
  // `ld (ix+d),n` -- the IMMEDIATE form (dd 36 d n, 4 bytes), a different
  // instruction from `ld (ix+d),a` (dd 77 d, 3 bytes). Both are 19 T.
  mem.write8((regs.ix + 0x00) & 0xffff, 0x01);
  m.step(0x1205, 19); // ld (ix+0x00),0x01

  regs.a = mem.read8(regs.hl); // HL is the caller's, never set here
  m.step(0x1206, 7); // ld a,(hl)
  mem.write8((regs.ix + 0x03) & 0xffff, regs.a);
  m.step(0x1209, 19); // ld (ix+0x03),a
  mem.write8(regs.de, regs.a);
  m.step(0x120a, 7); // ld (de),a
  regs.e = regs.inc8(regs.e); // `inc e`, NOT `inc de` -- D untouched
  m.step(0x120b, 4); // inc e
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x120c, 6); // inc hl

  regs.a = mem.read8(regs.hl);
  m.step(0x120d, 7); // ld a,(hl)
  mem.write8((regs.ix + 0x07) & 0xffff, regs.a);
  m.step(0x1210, 19); // ld (ix+0x07),a
  mem.write8(regs.de, regs.a);
  m.step(0x1211, 7); // ld (de),a
  regs.e = regs.inc8(regs.e);
  m.step(0x1212, 4); // inc e
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1213, 6); // inc hl

  regs.a = mem.read8(regs.hl);
  m.step(0x1214, 7); // ld a,(hl)
  mem.write8((regs.ix + 0x08) & 0xffff, regs.a);
  m.step(0x1217, 19); // ld (ix+0x08),a
  mem.write8(regs.de, regs.a);
  m.step(0x1218, 7); // ld (de),a
  regs.e = regs.inc8(regs.e);
  m.step(0x1219, 4); // inc e
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x121a, 6); // inc hl

  regs.a = mem.read8(regs.hl);
  m.step(0x121b, 7); // ld a,(hl)
  mem.write8((regs.ix + 0x05) & 0xffff, regs.a); // +0x05 AFTER +0x08 -- see above
  m.step(0x121e, 19); // ld (ix+0x05),a
  mem.write8(regs.de, regs.a);
  m.step(0x121f, 7); // ld (de),a
  // No `inc e` here. DE stays at 0x6A2B.
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1220, 6); // inc hl

  regs.a = mem.read8(regs.hl);
  m.step(0x1221, 7); // ld a,(hl)
  mem.write8((regs.ix + 0x09) & 0xffff, regs.a);
  m.step(0x1224, 19); // ld (ix+0x09),a
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1225, 6); // inc hl

  regs.a = mem.read8(regs.hl); // HL exits at source+5
  m.step(0x1226, 7); // ld a,(hl)
  mem.write8((regs.ix + 0x0a) & 0xffff, regs.a);
  m.step(0x1229, 19); // ld (ix+0x0a),a

  m.ret(); // 1229
}

/**
 * sub_11ec -- ROM 0x11EC-0x11F9  (14 bytes, 13 instructions)
 *
 *   11ec  7e           ld   a,(hl)
 *   11ed  12           ld   (de),a
 *   11ee  23           inc  hl
 *   11ef  1c           inc  e
 *   11f0  1c           inc  e
 *   11f1  7e           ld   a,(hl)
 *   11f2  12           ld   (de),a
 *   11f3  23           inc  hl
 *   11f4  7b           ld   a,e
 *   11f5  81           add  a,c
 *   11f6  5f           ld   e,a
 *   11f7  10 f3        djnz 0x11ec
 *   11f9  c9           ret
 *
 * Three call sites: 0x10C0, 0x1157, 0x11AC.
 *
 * THIS IS sub_122a'S TWIN WITH THE SOURCE BEHAVIOUR INVERTED, and it is the
 * reason no reading of this family may be settled from a routine's SHAPE.
 * sub_122a brackets its inner loop in `push hl` / `pop hl`, so every outer pass
 * re-reads the SAME four source bytes. This routine has NO push/pop at all, so
 * HL advances CUMULATIVELY (+2 per pass) and it walks 2*B0 consecutive source
 * bytes. Near-identical bytes, opposite source semantics. They must NOT share a
 * parameterised helper -- one keyed on C alone is wrong for one of the two.
 *
 * The two stores per pass land at E and E+2; E+1 is NEVER written by this
 * routine. Effective stride between passes is C+2, against sub_122a's C+4,
 * because the `inc e` counts differ.
 *
 * THE DJNZ TARGETS THE ROUTINE ENTRY, so the entire body is loop, and there is
 * no setup instruction to hoist -- the sub_3fa6 trap, total here.
 *
 * HL IS A LIVE-IN: read by `ld a,(hl)` at instruction one, never loaded here.
 * At two of the three call sites the caller sets it a few instructions before.
 * At the third -- 0x11AC, inside sub_11a6 -- it is INHERITED from sub_11a6's
 * own caller and passed straight through. That is what makes sub_11a6's HL
 * parameter invisible: at the other two sites the value is in the instruction.
 *
 * Note the asymmetry in the pointer arithmetic: HL uses `inc hl` and DOES carry
 * into H, so the source may cross a page; E uses `inc e` and `add a,c` through
 * A, both 8-bit, and D is never written, so the destination CANNOT.
 *
 * The carry out of the final `add a,c` escapes through the `ret` -- `ld e,a`,
 * `djnz` and `ret` write no flags and `inc e` preserves C. Same shape as the
 * sub_3f24 finding, and invisible to a memory diff.
 *
 * B0 = 0 would give 256 passes (djnz decrements then tests). No call site is
 * known to do it; not defended against here because the ROM does not.
 */
export function sub_11ec(m) {
  const { regs, mem } = m;

  do {
    // Loop body, NOT setup -- the djnz at 0x11F7 lands here.
    regs.a = mem.read8(regs.hl); // HL is a live-in, and it is NOT restored
    m.step(0x11ed, 7);
    mem.write8(regs.de, regs.a); // writes at E
    m.step(0x11ee, 7);
    regs.hl = (regs.hl + 1) & 0xffff; // `inc hl` -- full 16-bit, carries into H
    m.step(0x11ef, 6);

    // TWO increments: the next store lands at E+2 and E+1 is skipped.
    regs.e = regs.inc8(regs.e);
    m.step(0x11f0, 4);
    regs.e = regs.inc8(regs.e);
    m.step(0x11f1, 4);

    regs.a = mem.read8(regs.hl);
    m.step(0x11f2, 7);
    mem.write8(regs.de, regs.a); // writes at E+2
    m.step(0x11f3, 7);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x11f4, 6);

    regs.a = regs.e;
    m.step(0x11f5, 4);
    regs.add(regs.c); // mutates A; carry escapes via the ret
    m.step(0x11f6, 4);
    regs.e = regs.a; // 8-bit -- D untouched, destination wraps in its page
    m.step(0x11f7, 4);

    regs.djnz();
    m.step(regs.b !== 0 ? 0x11ec : 0x11f9, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 11f9
}

/**
 * sub_11d3 -- ROM 0x11D3-0x11EB  (25 bytes, 15 instructions)
 *
 *   11d3  dd 7e 03     ld   a,(ix+0x03)
 *   11d6  77           ld   (hl),a
 *   11d7  2c           inc  l
 *   11d8  dd 7e 07     ld   a,(ix+0x07)
 *   11db  77           ld   (hl),a
 *   11dc  2c           inc  l
 *   11dd  dd 7e 08     ld   a,(ix+0x08)
 *   11e0  77           ld   (hl),a
 *   11e1  2c           inc  l
 *   11e2  dd 7e 05     ld   a,(ix+0x05)
 *   11e5  77           ld   (hl),a
 *   11e6  2c           inc  l
 *   11e7  dd 19        add  ix,de
 *   11e9  10 e8        djnz 0x11d3
 *   11eb  c9           ret
 *
 * FIVE call sites: 0x1046, 0x10DB, 0x117A, 0x119E, 0x11CF.
 *
 * Inputs, ALL caller-supplied and none initialised here: B = pass count,
 * HL = destination, IX = source base, DE = the IX stride.
 *
 * THE DJNZ TARGETS THE ROUTINE ENTRY. The first instruction of the routine is
 * also the first instruction of the loop, so there is no setup to hoist at all
 * -- the sub_3fa6 trap in its total form.
 *
 * A PERMUTING GATHER, NOT A BLOCK COPY. The source offsets are +3, +7, +8, +5
 * -- in that order, with +5 read AFTER +7 and +8, and +4 and +6 never read at
 * all -- written to four CONSECUTIVE destination bytes. A translation looping
 * over +3,+4,+5,+6 would look entirely reasonable and be wrong.
 *
 * Those four offsets are the same four sub_11fa writes, in the same order.
 * Recorded as an observation; what the structure is has not been established
 * and no code here depends on it.
 *
 * `inc l`, NOT `inc hl`: H is never modified anywhere in this routine, so L
 * advances 4 per pass and WRAPS WITHIN THE PAGE H selects. B0 >= 64 wraps L a
 * full page; whether any of the five callers can reach that is not established
 * here, and the routine has no defence against it.
 *
 * `add ix,de` is NOT a bare 16-bit add -- it writes H, N and C (and F3/F5) and
 * PRESERVES S, Z and PV. regs.addIx is required; `regs.ix = (regs.ix +
 * regs.de) & 0xffff` is arithmetically right and flag-wise wrong. That exact
 * defect was already found and fixed in this repo at mainloop.js:878.
 *
 * The carry from the FINAL `add ix,de` escapes to the caller: `djnz` and `ret`
 * write no flags and `inc l` preserves C. Do not record it as dead -- from
 * sub_11a6 it survives that routine's `ret` too, and dies only at the
 * `add a,c` inside a later sub_122a call. "No reader in this routine" is not
 * "no reader".
 *
 * B0 = 0 would give 256 passes, writing 1024 bytes through HL. Not defended
 * against, because no known call site does it.
 *
 * ── FLAGS AT THE ret, and they come from TWO different instructions ─────────
 *
 * "The flags are whatever the last instruction left" is the natural reading
 * and it is WRONG here, because `add ix,de` writes only three of them:
 *
 *   S   from the FINAL `inc l` (0x11E6)   -- bit 7 of L after the 4th increment
 *   Z   from the FINAL `inc l` (0x11E6)   -- set if that L wrapped to 0x00
 *   PV  from the FINAL `inc l` (0x11E6)   -- set if L went 0x7F -> 0x80
 *   H   from the FINAL `add ix,de` (0x11E7) -- carry out of bit 11
 *   N   from the FINAL `add ix,de` (0x11E7) -- always 0; `add` clears N
 *   C   from the FINAL `add ix,de` (0x11E7) -- the 16-bit carry, i.e. whether
 *       IX crossed 0xFFFF on the last pass
 *   F3/F5 (undocumented) from the final `add ix,de`, taken from result >> 8
 *
 * `add ix,rr` PRESERVES S, Z and PV -- confirmed against mame0288's z80.lst,
 * whose add16 macro is commented `// keep szv` -- and `djnz` and `ret` write
 * no flags at all, so the S/Z/PV set by the `inc l` four instructions earlier
 * survives the add, the branch and the return.
 *
 * ALL SIX ESCAPE TO THE CALLER. No caller is currently known to read them;
 * that is a fact about today's call sites, not about this routine, and it is
 * exactly the "no reader in this routine is not no reader" trap. The
 * implementation uses regs.inc8 and regs.addIx, so every one of these is
 * produced correctly whether or not anyone reads it.
 */
export function sub_11d3(m) {
  const { regs, mem } = m;

  do {
    // Loop body, NOT setup -- the djnz at 0x11E9 lands on the routine entry.
    // The offsets are +3, +7, +8, +5 IN THIS ORDER. Not a block copy.
    for (const [disp, afterLoad, afterInc] of [
      [0x03, 0x11d6, 0x11d8],
      [0x07, 0x11db, 0x11dd],
      [0x08, 0x11e0, 0x11e2],
      [0x05, 0x11e5, 0x11e7],
    ]) {
      regs.a = mem.read8((regs.ix + disp) & 0xffff);
      m.step(afterLoad, 19); // ld a,(ix+d)
      mem.write8(regs.hl, regs.a);
      m.step(afterLoad + 1, 7); // ld (hl),a
      regs.l = regs.inc8(regs.l); // `inc l` -- H untouched, wraps in page
      m.step(afterInc, 4); // inc l
    }

    regs.addIx(regs.de); // writes H, N, C -- the carry escapes via the ret
    m.step(0x11e9, 15); // add ix,de

    regs.djnz();
    m.step(regs.b !== 0 ? 0x11d3 : 0x11eb, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 11eb
}

/**
 * sub_11a6 -- ROM 0x11A6-0x11D2  (45 bytes, 15 instructions)
 *
 *   11a6  11 83 66     ld   de,0x6683
 *   11a9  01 0e 02     ld   bc,0x020e
 *   11ac  cd ec 11     call 0x11ec
 *   11af  21 08 3e     ld   hl,0x3e08
 *   11b2  11 87 66     ld   de,0x6687
 *   11b5  01 0c 02     ld   bc,0x020c
 *   11b8  cd 2a 12     call 0x122a
 *   11bb  dd 21 80 66  ld   ix,0x6680
 *   11bf  dd 36 00 01  ld   (ix+0x00),0x01
 *   11c3  dd 36 10 01  ld   (ix+0x10),0x01
 *   11c7  21 18 6a     ld   hl,0x6a18
 *   11ca  06 02        ld   b,0x02
 *   11cc  11 10 00     ld   de,0x0010
 *   11cf  cd d3 11     call 0x11d3
 *   11d2  c9           ret
 *
 * Three call sites: 0x1003 (here), 0x1073, 0x1140.
 *
 * SUB_11A6 TAKES AN UNDOCUMENTED HL PARAMETER, and the dependency graph does
 * not record it. HL is not set anywhere in this routine, and the `call 0x11ec`
 * at 0x11AC hands it straight to a routine whose first instruction is
 * `ld a,(hl)`. All three call sites supply it adjacently with `ld hl,nn`:
 *
 *     1000  ld hl,0x3e0c   1003  call 0x11a6
 *     1070  ld hl,0x3e10   1073  call 0x11a6
 *     113d  ld hl,0x3e14   1140  call 0x11a6
 *
 * "On every path" was checked three ways, not assumed: the `ld hl,nn` is the
 * IMMEDIATELY preceding instruction at all three sites; a grep for references
 * to all six addresses finds ZERO, so nothing jumps into them; and none of the
 * three containing blocks holds an internal label or any branch. BOUND: those
 * last two rest on a listing that is reachability-driven at 77% coverage, so
 * they rule out a KNOWN entry, not a computed jump from unreached code.
 *
 * The stride-4 run continues INTO this routine -- 0x11AF loads HL = 0x3E08,
 * four below the lowest caller-supplied value. So 0x3E08 / 0x3E0C / 0x3E10 /
 * 0x3E14 are one stride-4 run. That the four are 4 apart is a fact; what the
 * run contains is NOT established. Nobody has read those bytes.
 *
 * DE CHANGES ROLE ACROSS THE THREE CALLS -- a 16-bit address (0x6683, 0x6687),
 * then a STRIDE (0x0010). HL likewise: an inherited pointer, then a ROM table
 * pointer (0x3E08), then a destination (0x6A18). Naming either register by
 * role names it wrongly for at least one call.
 *
 * C IS NEVER SET BEFORE THE THIRD CALL. It is written 0x0E at 0x11A9 and 0x0C
 * at 0x11B5 and never again -- `ld b,0x02` at 0x11CA writes B only. So C on
 * entry to sub_11d3 is whatever sub_122a left, which is 0x0C: sub_122a
 * restores BC via `pop bc`. sub_11d3 does not read C at all, so nothing here
 * depends on it; recorded because the question is natural and the answer is
 * not visible from this routine alone.
 *
 * B is loaded 0x02 THREE times (0x11A9, 0x11B5, 0x11CA). Both callees clobber
 * B -- each runs its own djnz to zero -- so none of the three is redundant.
 *
 * `ld (ix+d),n` is the IMMEDIATE form (dd 36 d n, 4 bytes, 19 T), a different
 * instruction from `ld (ix+d),a` (dd 77 d, 3 bytes, 19 T).
 *
 * Two (ix+d),0x01 writes land 0x10 apart off IX = 0x6680, i.e. at 0x6680 and
 * 0x6690, and the count and stride then handed to sub_11d3 (B = 0x02,
 * DE = 0x0010) agree with that pair. The three numbers agreeing is a fact;
 * what they describe is not established here.
 */
export function sub_11a6(m) {
  const { regs, mem } = m;

  regs.de = 0x6683; // an ADDRESS here
  m.step(0x11a9, 10); // ld de,0x6683
  regs.bc = 0x020e;
  m.step(0x11ac, 10); // ld bc,0x020e

  // HL is NOT set here -- it is this routine's live-in, passed through.
  m.push16(0x11af);
  m.step(0x11ec, 17); // call 0x11ec
  sub_11ec(m);

  regs.hl = 0x3e08; // ROM table pointer, 4 below the caller's 0x3E0C
  m.step(0x11b2, 10); // ld hl,0x3e08
  regs.de = 0x6687; // still an ADDRESS
  m.step(0x11b5, 10); // ld de,0x6687
  regs.bc = 0x020c;
  m.step(0x11b8, 10); // ld bc,0x020c

  m.push16(0x11bb);
  m.step(0x122a, 17); // call 0x122a
  sub_122a(m);

  regs.ix = 0x6680;
  m.step(0x11bf, 14); // ld ix,0x6680
  mem.write8((regs.ix + 0x00) & 0xffff, 0x01);
  m.step(0x11c3, 19); // ld (ix+0x00),0x01  -> 0x6680
  mem.write8((regs.ix + 0x10) & 0xffff, 0x01);
  m.step(0x11c7, 19); // ld (ix+0x10),0x01  -> 0x6690, stride 0x10

  regs.hl = 0x6a18; // a DESTINATION here
  m.step(0x11ca, 10); // ld hl,0x6a18
  regs.b = 0x02; // B only -- C still holds sub_122a's restored 0x0C
  m.step(0x11cc, 7); // ld b,0x02
  regs.de = 0x0010; // a STRIDE here, unlike 0x11A6 and 0x11B2
  m.step(0x11cf, 10); // ld de,0x0010

  m.push16(0x11d2);
  m.step(0x11d3, 17); // call 0x11d3
  sub_11d3(m);

  m.ret(); // 11d2
}

/**
 * sub_122a -- ROM 0x122A-0x123B  (18 bytes, 15 instructions)
 *
 *   122a  e5           push hl
 *   122b  c5           push bc
 *   122c  06 04        ld   b,0x04
 * loc_122e:
 *   122e  7e           ld   a,(hl)
 *   122f  12           ld   (de),a
 *   1230  23           inc  hl
 *   1231  1c           inc  e
 *   1232  10 fa        djnz 0x122e
 *   1234  c1           pop  bc
 *   1235  e1           pop  hl
 *   1236  7b           ld   a,e
 *   1237  81           add  a,c
 *   1238  5f           ld   e,a
 *   1239  10 ef        djnz 0x122a
 *   123b  c9           ret
 *
 * Eleven call sites: 0fec 100f 1017 1028 1037 1090 10cc 113a 1163 118f 11b8.
 *
 * WHAT IT IS: a struct-field initialiser, NOT a blitter. It replicates ONE
 * 4-byte source group down B0 destinations spaced C+4 apart.
 *
 * The `push hl`/`pop hl` bracket discards the inner loop's four `inc hl`, so
 * every outer pass re-reads the SAME four bytes. What that means is settled by
 * the CALLER, at 0x100F-0x1017:
 *
 *     1006  ld hl,0x101b     source
 *     100c  ld bc,0x081c     B=8, C=0x1c
 *     100f  call 0x122a
 *     1012  ld de,0x6807     <- reloads DE and B ONLY
 *     1015  ld b,0x02
 *     1017  call 0x122a      <- same HL, same C, still correct
 *
 * The second call reloads neither HL nor C. It is only correct if this routine
 * preserves both -- which is exactly what the two pushes buy. The ROM's own
 * usage is the proof; the register trace is not needed to reach it.
 *
 * THE OUTER `djnz` TARGETS THE ROUTINE ENTRY, so `push hl`, `push bc` and
 * `ld b,0x04` are LOOP BODY, not setup. Hoisting them out breaks the routine
 * catastrophically -- pass 2 would pop the caller's stack and unbalance the
 * `ret`. Same trap as sub_3fa6.
 *
 * TWIN HAZARD -- READ BEFORE TRANSLATING sub_11ec.
 * sub_11ec (ROM 0x11EC) is this routine's twin with the source behaviour
 * INVERTED: it has NO push/pop at all, so its HL advances cumulatively across
 * passes and it walks 2*B0 CONSECUTIVE source bytes. Its stride is C+2, not
 * C+4, because its `inc e` count differs; and it stores at E and E+2, never
 * writing E+1. The two differ in exactly one structural respect and it
 * reverses what the source pointer does. They must NOT share a parameterised
 * helper -- one keyed on C alone is wrong for one of the two.
 *
 * E arithmetic is 8-bit throughout: `inc e` (not `inc de`) and `add a,c` via
 * A. D is never modified, so the destination is confined to the page D selects
 * and WRAPS within it. A 16-bit `regs.de++` would silently turn a wrap into a
 * page crossing, and `inc e` also sets flags where `inc de` sets none.
 *
 * The carry out of the FINAL `add a,c` escapes through the `ret` to the
 * caller: `ld e,a`, `djnz` and `ret` write no flags, and `inc e` preserves C.
 * Same shape as the sub_3f24 finding -- invisible to a memory diff.
 *
 * B0 = 0 would give 256 passes (djnz decrements then tests). No call site is
 * known to do it; not defended against here because the ROM does not.
 *
 * ── THE FULL REGISTER CONTRACT, stated once because three routines depend on
 *    it from outside and none of them can see it ─────────────────────────────
 *
 * Derived from the 18 bytes, which are exhaustively:
 *   e5 c5 06 04 7e 12 23 1c 10 fa c1 e1 7b 81 5f 10 ef c9
 *
 *   HL   PRESERVED, actively -- `push hl` / `pop hl` bracket the inner loop,
 *        discarding its four `inc hl`. Proven from the CALLER at 0x1012, which
 *  reloads DE and B and neither HL nor C.
 *   C    PRESERVED, actively -- restored by `pop bc` at 0x1234.
 *   B    CLOBBERED -- 0 at the ret; both djnz run to zero.
 *   DE   D untouched; E advanced by B0*(C+4), 8-bit, wrapping in D's page.
 *   A    CLOBBERED, NOT AN INPUT. Its first touch is `ld a,(hl)` at 0x122E, a
 *        WRITE, and the inner loop always runs (B is loaded 0x04, never 0), so
 *        that write always precedes the only read of A -- `add a,c` at 0x1237,
 *        which is itself preceded by `ld a,e` at 0x1236 in the same pass. A is
 *        never read before being written. It exits equal to E.
 *   IX   PASSED THROUGH UNTOUCHED -- and this is a DIFFERENT guarantee from
 *        HL's. There is no DD or FD prefix byte anywhere in the routine, so IX
 *        and IY are neither read nor written. HL survives because the routine
 *        actively saves it; IX survives because the routine cannot see it.
 *        Both are "preserved for the caller", and only one of them would still
 *        hold if the body changed.
 *   F    the carry out of the FINAL `add a,c` escapes through the `ret`; see
 *        the note above.
 *
 * WHY THIS BLOCK EXISTS. C is loaded via `ld bc,nn`, survives this call, and
 * is consumed by a later `call 0x11d3` WITHOUT being reloaded -- because the
 * intervening load writes B only. That happens in three separate routines:
 *
 *     1186   C set 0x118C -> call here 0x118F -> 0x1199 loads B ONLY -> 0x119E
 *     1131   C set 0x1160 -> call here 0x1163 -> 0x1175 loads B ONLY -> 0x117A
 *     101f   C set 0x1034 -> call here 0x1037 -> 0x1044 loads B ONLY -> 0x1046
 *
 * The dependency is load-bearing in all three and invisible from any one of
 * them. It is satisfied only by the `pop bc` above.
 */
export function sub_122a(m) {
  const { regs, mem } = m;

  do {
    // Loop body, NOT setup -- the outer djnz at 0x1239 lands here.
    m.push16(regs.hl);
    m.step(0x122b, 11);
    m.push16(regs.bc);
    m.step(0x122c, 11);
    regs.b = 0x04; // inner count, always 4, never 0
    m.step(0x122e, 7);

    do {
      regs.a = mem.read8(regs.hl);
      m.step(0x122f, 7);
      mem.write8(regs.de, regs.a);
      m.step(0x1230, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x1231, 6);
      regs.e = regs.inc8(regs.e); // `inc e`, NOT `inc de` -- D untouched
      m.step(0x1232, 4);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x122e : 0x1234, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);

    regs.bc = m.pop16(); // restores the OUTER counter B *and* the stride C
    m.step(0x1235, 10);
    regs.hl = m.pop16(); // discards the inner loop's four `inc hl`
    m.step(0x1236, 10);

    regs.a = regs.e;
    m.step(0x1237, 4);
    regs.add(regs.c); // mutates A; carry escapes via the ret
    m.step(0x1238, 4);
    regs.e = regs.a;
    m.step(0x1239, 4);

    regs.djnz();
    m.step(regs.b !== 0 ? 0x122a : 0x123b, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 123b
}

/**
 * loc_127c -- ROM 0x127C-0x127E  (0x0748 table entry 4: sub_1dbd then dispatch)
 *
 *   127c  cd bd 1d     call 0x1dbd
 *   (falls through into entry_127f)
 */
export function loc_127c(m) {
  m.push16(0x127f);
  m.step(0x1dbd, 17); // call 0x1dbd
  sub_1dbd(m);
  return entry_127f(m); // fall through -- entry_127f's dispatch tail returns for us
}

/**
 * entry_127f -- ROM 0x127F-0x128A  (rst 0x28 dispatch on 0x639D, table at 0x1283)
 *
 *   127f  3a 9d 63     ld   a,(0x639d)
 *   1282  ef           rst  0x28        ; -> table 0x1283: 0x128B 0x12AC 0x12DE 0x0000
 */
export function entry_127f(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x639d);
  m.step(0x1282, 13); // ld a,(0x639d)

  m.push16(0x1283); // rst 0x28 pushes its return address = the TABLE BASE (0x1283)
  m.step(0x0028, 11);
  sub_0028(m, "0x1283 (0x639D dispatch)"); // reads the table from ROM; ends in jp (hl)
}

export function entry_128b(m) {
  const { regs, mem } = m;

  m.push16(0x128c);
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // (0x6009) not expired -> body skipped

  regs.hl = 0x694d;
  m.step(0x128f, 10); // ld hl,0x694d
  regs.a = 0xf0;
  m.step(0x1291, 7); // ld a,0xf0
  mem.write8(regs.hl, regs.rl(mem.read8(regs.hl))); // rl (hl) -- C <- old bit7
  m.step(0x1293, 15);
  regs.rra(); // A = 0xF0>>1 | (C<<7)
  m.step(0x1294, 4);
  mem.write8(regs.hl, regs.a); // (0x694D) := 0x78/0xF8
  m.step(0x1295, 7);
  regs.hl = 0x639d;
  m.step(0x1298, 10); // ld hl,0x639d
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (hl) -- advance the state
  m.step(0x1299, 11);
  regs.a = 0x0d;
  m.step(0x129b, 7); // ld a,0x0d
  mem.write8(0x639e, regs.a); // 0x639E := 0x0D
  m.step(0x129e, 13);
  regs.a = 0x08;
  m.step(0x12a0, 7); // ld a,0x08
  mem.write8(0x6009, regs.a); // re-arm the rst 0x18 timer
  m.step(0x12a3, 13);
  m.push16(0x12a6);
  m.step(0x30bd, 17); // call 0x30bd
  sub_30bd(m);
  regs.a = 0x03;
  m.step(0x12a8, 7); // ld a,0x03
  mem.write8(0x6088, regs.a); // 0x6088 := 3
  m.step(0x12ab, 13);
  m.ret(10); // ret (0x12AB)
}

/**
 * loc_12ac -- ROM 0x12AC-0x12DD  (0x639D arm 1: animate 0x694D/0x694E, or advance state)
 *
 *   12ac  df           rst  0x18
 *   12af  3e 08        ld   a,0x08
 *   12b1  32 09 60     ld   (0x6009),a    ; reload the rst 0x18 counter: 8 ticks
 *   12b5  21 9e 63     ld   hl,0x639e
 *   12b6  35           dec  (hl)
 *   12b7  ca cb 12     jp   z,0x12cb      ; 0x639E hit 0 -> advance state (tail)
 *   ... else animate the two-cell blinker at 0x694D/0x694E, then ret
 */
export function loc_12ac(m) {
  const { regs, mem } = m;

  m.push16(0x12ad);
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // counter did not expire -- dispatch abandoned

  regs.a = 0x08;
  m.step(0x12af, 7); // ld a,0x08
  mem.write8(0x6009, regs.a); // reload the rst 0x18 counter: 8 ticks
  m.step(0x12b2, 13);

  regs.hl = 0x639e;
  m.step(0x12b5, 10); // ld hl,0x639e
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl))); // dec (hl) -- carry preserved
  m.step(0x12b6, 11);
  if (regs.fZ) {
    m.step(0x12cb, 10); // jp z,0x12cb -- 0x639E reached 0
    return tail12cb(m);
  }
  m.step(0x12b9, 10); // jp z NOT taken

  // ---- animate: toggle bit 0 of (0x694D) and bit 7 of (0x694E) ----
  regs.hl = 0x694d;
  m.step(0x12bc, 10); // ld hl,0x694d
  regs.a = mem.read8(regs.hl);
  m.step(0x12bd, 7); // ld a,(hl)
  regs.rra(); // value DEAD; carry-out = bit 0 of (0x694D)
  m.step(0x12be, 4); // rra
  regs.a = 0x02;
  m.step(0x12c0, 7); // ld a,0x02
  regs.rra(); // A = 0x81 if bit0 of (0x694D) was set, else 0x01
  m.step(0x12c1, 4); // rra
  regs.b = regs.a;
  m.step(0x12c2, 4); // ld b,a
  regs.xor(mem.read8(regs.hl));
  m.step(0x12c3, 7); // xor (hl)
  mem.write8(regs.hl, regs.a);
  m.step(0x12c4, 7); // ld (hl),a
  regs.l = regs.inc8(regs.l); // inc l -- 8-bit (0x694D -> 0x694E)
  m.step(0x12c5, 4);
  regs.a = regs.b;
  m.step(0x12c6, 4); // ld a,b
  regs.and(0x80);
  m.step(0x12c8, 7); // and 0x80
  regs.xor(mem.read8(regs.hl));
  m.step(0x12c9, 7); // xor (hl)
  mem.write8(regs.hl, regs.a);
  m.step(0x12ca, 7); // ld (hl),a
  m.ret(10); // ret (0x12CA)
}

/**
 * loc_12cb -- 12AC's interior tail (0x12CB-0x12DD): advance the 0x639D state.
 */
function tail12cb(m) {
  const { regs, mem } = m;

  regs.hl = 0x694d;
  m.step(0x12ce, 10); // ld hl,0x694d
  regs.a = 0xf4;
  m.step(0x12d0, 7); // ld a,0xf4
  mem.write8(regs.hl, regs.rl(mem.read8(regs.hl))); // rl (hl) -- result overwritten
  m.step(0x12d2, 15);
  regs.rra(); // A = 0xFA if old bit7 of (0x694D) was set, else 0x7A
  m.step(0x12d3, 4); // rra
  mem.write8(regs.hl, regs.a); // discards the rl result
  m.step(0x12d4, 7); // ld (hl),a

  regs.hl = 0x639d;
  m.step(0x12d7, 10); // ld hl,0x639d
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // advance state 1 -> 2
  m.step(0x12d8, 11); // inc (hl)
  regs.a = 0x80;
  m.step(0x12da, 7); // ld a,0x80
  mem.write8(0x6009, regs.a); // reload the rst 0x18 counter: 128 ticks, NOT 8
  m.step(0x12dd, 13);
  m.ret(10); // ret (0x12DD)
}

/**
 * loc_12de -- ROM 0x12DE-0x12F1  (0x639D arm 2: advance 0x600A, re-arm the gate)
 *
 *   12de  df           rst  0x18
 *   12df  cd db 30     call 0x30db        ; entry_30db (falls through to sub_30e4)
 *   12e2  21 0a 60     ld   hl,0x600a
 *   12e5  3a 0e 60     ld   a,(0x600e)    ; player index
 *   12e8  a7           and  a
 *   12e9  ca ed 12     jp   z,0x12ed      ; player 1 -> one inc; player 2 -> two
 *   12ec  34           inc  (hl)          ; the EXTRA inc (player 2 only)
 *   12ed  34           inc  (hl)          ; ALWAYS
 *   12ee  2b           dec  hl            ; 0x600A -> 0x6009
 *   12ef  36 01        ld   (hl),0x01     ; 0x6009 = 1 -> next rst 0x18 expires now
 *   12f1  c9           ret
 */
export function loc_12de(m) {
  const { regs, mem } = m;

  m.push16(0x12df);
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // counter did not expire -- dispatch abandoned

  m.push16(0x12e2);
  m.step(0x30db, 17); // call 0x30db -- entry_30db, falls through into sub_30e4
  entry_30db(m);

  regs.hl = 0x600a;
  m.step(0x12e5, 10); // ld hl,0x600a
  regs.a = mem.read8(0x600e); // the player index
  m.step(0x12e8, 13); // ld a,(0x600e)
  regs.and(regs.a);
  m.step(0x12e9, 4); // and a
  if (regs.fZ) {
    m.step(0x12ed, 10); // jp z,0x12ed -- player 1: only one inc
  } else {
    m.step(0x12ec, 10); // jp z NOT taken
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // the EXTRA inc (player 2)
    m.step(0x12ed, 11);
  }

  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // ALWAYS executed
  m.step(0x12ee, 11); // inc (hl)
  regs.hl = (regs.hl - 1) & 0xffff; // dec hl -- 16-bit, no flags. 0x600A -> 0x6009
  m.step(0x12ef, 6);
  mem.write8(regs.hl, 0x01); // 0x6009 = 1 -> next rst 0x18 expires immediately
  m.step(0x12f1, 10);
  m.ret(10); // ret (0x12F1)
}
/**
 * loc_12f2 -- ROM 0x12F2-0x1343  (dispatch idx 14: counter-gated state setup; TWIN of loc_1344)
 *
 *   call 0x011c ; 0x622C=0 ; dec (0x6228) ; ldir 8 bytes 0x6228->0x6040 ; and a
 *   counter != 0 -> loc_1334 (0x600A = 0x08, or 0x17 if 0x600F != 0)
 *   counter == 0 -> call 0x13ca(HL=0x60B2,A=0x01) ; render (0x309F/1826/309F) ;
 *                   0x6009=0xC0 ; 0x600A=0x10 ; ret
 *
 * TWIN of loc_1344 (differs in constants). The call 0x13ca needs NO caller-skip guard --
 * sub_13ca's own rst-0x08 abort returns here (to 0x1312) either way.
 * Translated for completeness; not yet wired into the live dispatcher.
 */
export function loc_12f2(m) {
  const { regs, mem } = m;

  m.push16(0x12f5);
  m.step(0x011c, 17);
  sub_011c(m);
  regs.xor(regs.a); // A = 0
  m.step(0x12f6, 4);
  mem.write8(0x622c, regs.a);
  m.step(0x12f9, 13); // ld (0x622c),a
  regs.hl = 0x6228;
  m.step(0x12fc, 10); // ld hl,0x6228
  regs.decMem8(mem, regs.hl); // dec (hl) -- Z-correct
  m.step(0x12fd, 11);
  regs.a = mem.read8(regs.hl); // A = counter
  m.step(0x12fe, 7); // ld a,(hl)
  regs.de = 0x6040;
  m.step(0x1301, 10); // ld de,0x6040
  regs.bc = 0x0008;
  m.step(0x1304, 10); // ld bc,0x0008
  m.ldir(0x1306); // ldir -- 8 bytes from HL=0x6228 to 0x6040
  regs.and(regs.a); // test the counter
  m.step(0x1307, 4); // and a
  if (regs.fNZ) {
    // -- loc_1334: counter != 0 --
    m.step(0x1334, 10); // jp nz,0x1334
    regs.c = 0x08;
    m.step(0x1336, 7); // ld c,0x08
    regs.a = mem.read8(0x600f);
    m.step(0x1339, 13); // ld a,(0x600f)
    regs.and(regs.a);
    m.step(0x133a, 4); // and a
    if (regs.fZ) {
      m.step(0x133f, 10); // jp z,0x133f -- keep C=0x08
    } else {
      m.step(0x133d, 10); // jp z not taken
      regs.c = 0x17;
      m.step(0x133f, 7); // ld c,0x17
    }
    regs.a = regs.c;
    m.step(0x1340, 4); // ld a,c
    mem.write8(0x600a, regs.a); // 0x600A = 0x08 or 0x17
    m.step(0x1343, 13);
    m.ret();
    return;
  }
  m.step(0x130a, 10); // jp nz not taken

  regs.a = 0x01;
  m.step(0x130c, 7); // ld a,0x01
  regs.hl = 0x60b2;
  m.step(0x130f, 10); // ld hl,0x60b2
  m.push16(0x1312);
  m.step(0x13ca, 17);
  sub_13ca(m); // HL=0x60B2, A=0x01 -- ordinary call, no guard

  regs.hl = 0x76d4;
  m.step(0x1315, 10); // ld hl,0x76d4
  regs.a = mem.read8(0x600f);
  m.step(0x1318, 13); // ld a,(0x600f)
  regs.and(regs.a);
  m.step(0x1319, 4); // and a
  if (regs.fZ) {
    m.step(0x1322, 12); // jr z,0x1322
  } else {
    m.step(0x131b, 7); // jr z not taken
    regs.de = 0x0302;
    m.step(0x131e, 10); // ld de,0x0302
    m.push16(0x1321);
    m.step(0x309f, 17);
    sub_309f(m);
    regs.hl = (regs.hl - 1) & 0xffff; // dec hl -- HL = 0x76D3
    m.step(0x1322, 6);
  }
  m.push16(0x1325);
  m.step(0x1826, 17);
  sub_1826(m); // fill helper -- HL live-in 0x76D4 or 0x76D3
  regs.de = 0x0300;
  m.step(0x1328, 10); // ld de,0x0300
  m.push16(0x132b);
  m.step(0x309f, 17);
  sub_309f(m);

  regs.hl = 0x6009;
  m.step(0x132e, 10); // ld hl,0x6009
  mem.write8(regs.hl, 0xc0); // arm countdown
  m.step(0x1330, 10); // ld (hl),0xc0
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1331, 6); // inc hl
  mem.write8(regs.hl, 0x10); // 0x600A = 0x10
  m.step(0x1333, 10); // ld (hl),0x10
  m.ret();
}

/**
 * loc_138f -- ROM 0x138F-0x13A0  (rst 0x18 gate; 0x600A := 0x17 or 0x14 per 0x6048)
 *
 *   138f  df           rst  0x18
 *   1390  0e 17        ld   c,0x17
 *   1392  3a 48 60     ld   a,(0x6048)
 *   1395  34           inc  (hl)          ; loc_1395 -- re-arm 0x6009 (HL from sub_0018)
 *   1396  a7           and  a
 *   1397  c2 9c 13     jp   nz,0x139c     ; 0x6048 != 0 -> C stays 0x17
 *   139a  0e 14        ld   c,0x14        ; else C = 0x14 (falls through)
 *   139c  79           ld   a,c
 *   139d  32 0a 60     ld   (0x600a),a
 *   13a0  c9           ret
 */
export function loc_138f(m) {
  const { regs, mem } = m;

  m.push16(0x1390);
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // counter did not expire -- dispatch abandoned

  regs.c = 0x17;
  m.step(0x1392, 7); // ld c,0x17
  regs.a = mem.read8(0x6048); // the source byte (0x6048 -- vs loc_13a1's)
  m.step(0x1395, 13); // ld a,(0x6048)

  // -- loc_1395: HL is 0x6009 (set by sub_0018), NOT by the caller --
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (hl) -- re-arm 0 -> 1
  m.step(0x1396, 11);
  regs.and(regs.a); // tests the 0x6048 byte -- inc (hl) left A alone
  m.step(0x1397, 4);
  if (regs.fNZ) {
    m.step(0x139c, 10); // jp nz -- C stays 0x17
  } else {
    m.step(0x139a, 10); // jp nz NOT taken
    regs.c = 0x14; // C = 0x14, falls through into 0x139c
    m.step(0x139c, 7);
  }

  regs.a = regs.c;
  m.step(0x139d, 4); // ld a,c
  mem.write8(0x600a, regs.a); // 0x17 if 0x6048 was non-zero, else 0x14
  m.step(0x13a0, 13);
  m.ret(10); // ret (0x13A0)
}

/**
 * loc_13a1 -- ROM 0x13A1-0x13A9  (0x0702 table idx17; TWIN of loc_138f, reads 0x6040)
 *   13a1 df rst 0x18   13a2 0e 17 ld c,0x17   13a4 3a 40 60 ld a,(0x6040)   13a7 c3 95 13 jp 0x1395
 * Converges on loc_1395 (inline in loc_138f). Wired after the 0x0702
 * table-audit found idx17 -> 0x13A1 un-wired. loc_1395 tail
 * duplicated here rather than refactoring the gated loc_138f.
 */
export function loc_13a1(m) {
  const { regs, mem } = m;
  m.push16(0x13a2);
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // counter did not expire -- dispatch abandoned
  regs.c = 0x17;
  m.step(0x13a4, 7); // ld c,0x17
  regs.a = mem.read8(0x6040); // 0x6040 (vs loc_138f's 0x6048)
  m.step(0x13a7, 13); // ld a,(0x6040)
  m.step(0x1395, 10); // jp 0x1395 -- converge on the loc_1395 tail
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (hl) -- HL=0x6009 from sub_0018
  m.step(0x1396, 11);
  regs.and(regs.a); // tests the 0x6040 byte
  m.step(0x1397, 4);
  if (regs.fNZ) {
    m.step(0x139c, 10); // jp nz -- C stays 0x17
  } else {
    m.step(0x139a, 10);
    regs.c = 0x14;
    m.step(0x139c, 7);
  }
  regs.a = regs.c;
  m.step(0x139d, 4); // ld a,c
  mem.write8(0x600a, regs.a);
  m.step(0x13a0, 13);
  m.ret(10); // ret (0x13A0)
}
/**
 * sub_13ca -- ROM 0x13CA-0x141D  (shared helper: BCD unpack + fill + 3-byte-subtract sort pass)
 *
 * PARAMETERS: HL = 3-byte source (ldir), A = value stored to 0x61C6. From both callers:
 * loc_12f2 (HL=0x60B2, A=0x01), loc_1344 (HL=0x60B5, A=0x03).
 *
 * !! rst 0x08 (0x13CE) is a CALLER-SKIP -- SKIPS when bit0 of 0x6007 SET. push16 + guard. !!
 * !! FOUR rrca (0x13DC-0x13DF) -- emit EXPLICITLY, NOT a loop. !!
 * !! sub (hl)/sbc a,(hl)/sbc a,(hl) is a 3-byte multi-precision subtract; the carry chain is
 *    load-bearing. sbc a,(hl) is a FIRST-USE of the memory form. !!
 * Translated for completeness; not yet wired into the live dispatcher.
 */
export function sub_13ca(m) {
  const { regs, mem } = m;

  regs.de = 0x61c6;
  m.step(0x13cd, 10); // ld de,0x61c6
  mem.write8(regs.de, regs.a); // ld (de),a -- store the A parameter
  m.step(0x13ce, 7);

  m.push16(0x13cf); // rst 0x08 pushes its return address
  m.step(0x0008, 11); // rst 0x08
  if (!sub_0008(m)) return; // SKIP: bit0 of 0x6007 set -> aborted to caller

  regs.de = (regs.de + 1) & 0xffff; // inc de -- DE = 0x61C7
  m.step(0x13d0, 6);
  regs.bc = 0x0003;
  m.step(0x13d3, 10); // ld bc,0x0003
  m.ldir(0x13d5); // ldir -- copy 3 bytes from HL(param) to 0x61C7. Leaves DE=0x61CA, HL=src+3

  // -- BCD unpack loop (x3): each source byte -> high nibble then low nibble --
  regs.b = 0x03;
  m.step(0x13d7, 7); // ld b,0x03
  regs.hl = 0x61b1;
  m.step(0x13da, 10); // ld hl,0x61b1
  do {
    regs.de = (regs.de - 1) & 0xffff; // dec de
    m.step(0x13db, 6);
    regs.a = mem.read8(regs.de); // ld a,(de)
    m.step(0x13dc, 7);
    regs.rrca(); m.step(0x13dd, 4); // rrca  (FOUR explicit -- NOT a loop)
    regs.rrca(); m.step(0x13de, 4); // rrca
    regs.rrca(); m.step(0x13df, 4); // rrca
    regs.rrca(); m.step(0x13e0, 4); // rrca
    regs.and(0x0f); // high nibble
    m.step(0x13e2, 7); // and 0x0f
    mem.write8(regs.hl, regs.a);
    m.step(0x13e3, 7); // ld (hl),a
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x13e4, 6); // inc hl
    regs.a = mem.read8(regs.de); // ld a,(de) -- re-read
    m.step(0x13e5, 7);
    regs.and(0x0f); // low nibble
    m.step(0x13e7, 7); // and 0x0f
    mem.write8(regs.hl, regs.a);
    m.step(0x13e8, 7); // ld (hl),a
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x13e9, 6); // inc hl
    regs.djnz();
    m.step(regs.b !== 0 ? 0x13da : 0x13eb, regs.b !== 0 ? 13 : 8); // djnz 0x13da
  } while (regs.b !== 0);

  // -- fill loop (x14): 0x10, then a 0x3F terminator --
  regs.b = 0x0e;
  m.step(0x13ed, 7); // ld b,0x0e
  do {
    mem.write8(regs.hl, 0x10);
    m.step(0x13ef, 10); // ld (hl),0x10
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x13f0, 6); // inc hl
    regs.djnz();
    m.step(regs.b !== 0 ? 0x13ed : 0x13f2, regs.b !== 0 ? 13 : 8); // djnz 0x13ed
  } while (regs.b !== 0);
  mem.write8(regs.hl, 0x3f);
  m.step(0x13f4, 10); // ld (hl),0x3f

  // -- compare-and-swap: up to 5 passes --
  regs.b = 0x05;
  m.step(0x13f6, 7); // ld b,0x05
  regs.hl = 0x61a5;
  m.step(0x13f9, 10); // ld hl,0x61a5
  regs.de = 0x61c7;
  m.step(0x13fc, 10); // ld de,0x61c7
  for (;;) {
    // -- loc_13fc: 3-byte multi-precision subtract (de[] - hl[]) --
    regs.a = mem.read8(regs.de); m.step(0x13fd, 7); // ld a,(de)
    regs.sub(mem.read8(regs.hl)); m.step(0x13fe, 7); // sub (hl) -- sets borrow
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x13ff, 6); // inc hl
    regs.de = (regs.de + 1) & 0xffff; m.step(0x1400, 6); // inc de
    regs.a = mem.read8(regs.de); m.step(0x1401, 7); // ld a,(de)
    regs.sbc(mem.read8(regs.hl)); m.step(0x1402, 7); // sbc a,(hl) -- carry chain (FIRST-USE mem form)
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x1403, 6); // inc hl
    regs.de = (regs.de + 1) & 0xffff; m.step(0x1404, 6); // inc de
    regs.a = mem.read8(regs.de); m.step(0x1405, 7); // ld a,(de)
    regs.sbc(mem.read8(regs.hl)); m.step(0x1406, 7); // sbc a,(hl)
    if (regs.fC) { m.ret(11); return; } // ret c -- borrow, 4th exit
    m.step(0x1407, 5);

    // -- swap 25 bytes (backward), preserving the outer count --
    m.push16(regs.bc); // push bc -- save outer B=5
    m.step(0x1408, 11);
    regs.b = 0x19;
    m.step(0x140a, 7); // ld b,0x19
    do {
      regs.c = mem.read8(regs.hl); m.step(0x140b, 7); // ld c,(hl)
      regs.a = mem.read8(regs.de); m.step(0x140c, 7); // ld a,(de)
      mem.write8(regs.hl, regs.a); m.step(0x140d, 7); // ld (hl),a
      regs.a = regs.c; m.step(0x140e, 4); // ld a,c
      mem.write8(regs.de, regs.a); m.step(0x140f, 7); // ld (de),a
      regs.hl = (regs.hl - 1) & 0xffff; m.step(0x1410, 6); // dec hl
      regs.de = (regs.de - 1) & 0xffff; m.step(0x1411, 6); // dec de
      regs.djnz();
      m.step(regs.b !== 0 ? 0x140a : 0x1413, regs.b !== 0 ? 13 : 8); // djnz 0x140a
    } while (regs.b !== 0);

    regs.bc = 0xfff5; // -11
    m.step(0x1416, 10); // ld bc,0xfff5
    regs.addHl(regs.bc); // add hl,bc -- HL -= 11
    m.step(0x1417, 11);
    regs.exDeHl(); m.step(0x1418, 4); // ex de,hl
    regs.addHl(regs.bc); // add hl,bc -- (the other pointer) -= 11
    m.step(0x1419, 11);
    regs.exDeHl(); m.step(0x141a, 4); // ex de,hl
    regs.bc = m.pop16(); // pop bc -- restore outer B
    m.step(0x141b, 10);
    regs.djnz();
    if (regs.b !== 0) { m.step(0x13fc, 13); continue; } // djnz 0x13fc
    m.step(0x141d, 8);
    m.ret();
    return;
  }
}

/**
 * loc_141e -- ROM 0x141E-0x1485  (search 0x611C[5] for record 1 or 3, dispatch)
 */
export function loc_141e(m) {
  const { regs, mem } = m;

  m.push16(0x1421);
  m.step(0x0616, 17); // call 0x0616
  sub_0616(m);
  m.push16(0x1422);
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // counter not expired -- aborted
  m.push16(0x1425);
  m.step(0x0874, 17); // call 0x0874
  sub_0874(m);

  regs.a = 0x00;
  m.step(0x1427, 7); // ld a,0x00
  mem.write8(0x600e, regs.a); // clear player index
  m.step(0x142a, 13);
  mem.write8(0x600d, regs.a);
  m.step(0x142d, 13);

  // ---- search 0x611C[5] (stride 0x22) for a record == 1 ----
  regs.hl = 0x611c;
  m.step(0x1430, 10); // ld hl,0x611c
  regs.de = 0x0022;
  m.step(0x1433, 10); // ld de,0x0022
  regs.b = 0x05;
  m.step(0x1435, 7); // ld b,0x05
  regs.a = 0x01;
  m.step(0x1437, 7); // ld a,0x01 -- the search key (runs once)
  do {
    regs.cp(mem.read8(regs.hl));
    m.step(0x1438, 7); // cp (hl)
    if (regs.fZ) {
      m.step(0x1459, 10); // jp z,0x1459
      return loc_1459(m); // A = 0x01 here
    }
    m.step(0x143b, 10); // jp z NOT taken
    regs.addHl(regs.de);
    m.step(0x143c, 11); // add hl,de
    regs.b = (regs.b - 1) & 0xff;
    m.step(regs.b !== 0 ? 0x1437 : 0x143e, regs.b !== 0 ? 13 : 8); // djnz 0x1437
  } while (regs.b !== 0);

  // ---- search 0x611C[5] for a record == 3 ----
  regs.hl = 0x611c;
  m.step(0x1441, 10); // ld hl,0x611c
  regs.b = 0x05;
  m.step(0x1443, 7); // ld b,0x05
  regs.a = 0x03;
  m.step(0x1445, 7); // ld a,0x03 -- the search key (runs once)
  do {
    regs.cp(mem.read8(regs.hl));
    m.step(0x1446, 7); // cp (hl)
    if (regs.fZ) {
      m.step(0x144f, 10); // jp z,0x144f
      return loc_144f(m);
    }
    m.step(0x1449, 10); // jp z NOT taken
    regs.addHl(regs.de);
    m.step(0x144a, 11); // add hl,de
    regs.b = (regs.b - 1) & 0xff;
    m.step(regs.b !== 0 ? 0x1445 : 0x144c, regs.b !== 0 ? 13 : 8); // djnz 0x1445
  } while (regs.b !== 0);

  m.step(0x1475, 10); // jp 0x1475 -- neither found
  return loc_1475(m);
}

/** loc_144f -- 141E interior: record 3 found -> player index 1, then loc_1459. */
function loc_144f(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  m.step(0x1451, 7); // ld a,0x01
  mem.write8(0x600e, regs.a); // player index = 1
  m.step(0x1454, 13);
  mem.write8(0x600d, regs.a);
  m.step(0x1457, 13);
  regs.a = 0x00; // A = 0 for loc_1459 (differs from the state-1 path)
  m.step(0x1459, 7); // ld a,0x00
  return loc_1459(m);
}

/** loc_1459 -- 141E interior: 0x7D82 hardware write, then 12 sub_309f enqueues. */
function loc_1459(m) {
  const { regs, mem } = m;
  regs.hl = 0x6026;
  m.step(0x145c, 10); // ld hl,0x6026
  regs.or(mem.read8(regs.hl)); // A |= (0x6026)
  m.step(0x145d, 7); // or (hl)
  mem.write8(0x7d82, regs.a); // HARDWARE WRITE (flipscreen latch)
  m.step(0x1460, 13); // ld (0x7d82),a
  regs.a = 0x00;
  m.step(0x1462, 7); // ld a,0x00
  mem.write8(0x6009, regs.a); // clear the rst 0x18 counter
  m.step(0x1465, 13);
  regs.hl = 0x600a;
  m.step(0x1468, 10); // ld hl,0x600a
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (0x600a)
  m.step(0x1469, 11);
  regs.de = 0x030d;
  m.step(0x146c, 10); // ld de,0x030d
  regs.b = 0x0c;
  do {
    m.push16(0x1471);
    m.step(0x309f, 17); // call 0x309f
    sub_309f(m); // DE sweeps 0x030D..0x0318
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x1472, 6); // inc de
    regs.b = (regs.b - 1) & 0xff;
    m.step(regs.b !== 0 ? 0x146e : 0x1474, regs.b !== 0 ? 13 : 8); // djnz 0x146e
  } while (regs.b !== 0);
  m.ret(10); // ret (0x1474)
}

/** loc_1475 -- 141E interior: neither found -> flip 0x7D82, clear 0x600A. */
function loc_1475(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  m.step(0x1477, 7); // ld a,0x01
  mem.write8(0x7d82, regs.a); // HARDWARE WRITE = 1
  m.step(0x147a, 13);
  mem.write8(0x6005, regs.a);
  m.step(0x147d, 13);
  mem.write8(0x6007, regs.a);
  m.step(0x1480, 13);
  regs.a = 0x00;
  m.step(0x1482, 7); // ld a,0x00
  mem.write8(0x600a, regs.a);
  m.step(0x1485, 13);
  m.ret(10); // ret (0x1485)
}

/**
 * sub_2407 -- FIXED-POINT SUBTRACT.  ROM 0x2407-0x241E (24 bytes)
 * Spreads packed byte (ix+0x14)=0xHL into HL=(H<<8)|(L<<4), then HL -= BC where
 * BC=(ix+0x12:0x13). Returns HL; writes no memory. Callers: 0x1BDF,0x20C3,0x2146.
 *
 *   2407  dd 7e 14  ld   a,(ix+0x14)
 *   240a  07        rlca                  ) four rotates = nibble swap 0xHL->0xLH
 *   240b  07        rlca                  ) EMIT FOUR EXPLICITLY, do not loop
 *   240c  07        rlca
 *   240d  07        rlca
 *   240e  4f        ld   c,a
 *   240f  e6 0f     and  0x0f
 *   2411  67        ld   h,a              H = original HIGH nibble
 *   2412  79        ld   a,c
 *   2413  e6 f0     and  0xf0             clears carry -> sbc carry-in = 0
 *   2415  6f        ld   l,a              L = original LOW nibble << 4
 *   2416  dd 4e 13  ld   c,(ix+0x13)
 *   2419  dd 46 12  ld   b,(ix+0x12)
 *   241c  ed 42     sbc  hl,bc            HL = HL - BC - 0
 *   241e  c9        ret
 *
 * IX is live-in. sbcHl ASSIGNS this.hl and returns nothing (precedented in sub_236e) --
 * call it BARE.
 */
export function sub_2407(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = mem.read8(R(0x14)); // packed 0xHL
  m.step(0x240a, 19);
  regs.rlca(); m.step(0x240b, 4);
  regs.rlca(); m.step(0x240c, 4);
  regs.rlca(); m.step(0x240d, 4);
  regs.rlca(); m.step(0x240e, 4); // A = swapped 0xLH; carry dead (masked next)
  regs.c = regs.a;
  m.step(0x240f, 4);
  regs.and(0x0f); // A = 0x0H
  m.step(0x2411, 7);
  regs.h = regs.a; // H = original high nibble
  m.step(0x2412, 4);
  regs.a = regs.c; // A = swapped 0xLH again
  m.step(0x2413, 4);
  regs.and(0xf0); // A = 0xL0 ; AND clears carry -> sbc carry-in is 0
  m.step(0x2415, 7);
  regs.l = regs.a; // L = original low nibble << 4
  m.step(0x2416, 4);
  regs.c = mem.read8(R(0x13));
  m.step(0x2419, 19);
  regs.b = mem.read8(R(0x12));
  m.step(0x241c, 19);
  regs.sbcHl(regs.bc); // HL = HL - BC - carry(=0). BARE call; sbcHl assigns HL.
  m.step(0x241e, 15);
  m.ret(10);
}
/**
 * sub_241f -- POSITION GATE.  ROM 0x241F-0x2440 (34 bytes). Returns a (D,E) pair;
 * writes NO memory. Callers: 0x1AE6, 0x1BC5, 0x2B09.
 *
 * FIVE conditional rets, ALL fall through when not taken; the (D,E) pair is mutated
 * between them, so the exit reached IS the answer:
 *   X < 0x16                 -> (1,0) default
 *   X >= 0xEA                -> (0,1) far-right edge
 *   bit0(0x6227)==0          -> (0,0) blocked
 *   Y >= 0x58                -> (0,0)
 *   X >= 0x6C                -> (0,0)
 *   else                     -> (1,0)
 * `rrca` is a bit-0 test on (0x6227); A reloaded after, only its carry matters. All cp UNSIGNED.
 */
export function sub_241f(m) {
  const { regs, mem } = m;

  regs.de = 0x0100; // D=1, E=0
  m.step(0x2422, 10);
  regs.a = mem.read8(0x6203); // player X
  m.step(0x2425, 13);
  regs.cp(0x16);
  m.step(0x2427, 5);
  if (regs.fC) {
    m.ret(11); // ret c -- X < 0x16 -> (1,0)
    return;
  }
  m.step(0x2428, 5); // NOT taken

  regs.d = regs.dec8(regs.d); // D=0
  m.step(0x2429, 4);
  regs.e = regs.inc8(regs.e); // E=1 -> (0,1)
  m.step(0x242a, 4);
  regs.cp(0xea);
  m.step(0x242c, 5);
  if (!regs.fC) {
    m.ret(11); // ret nc -- X >= 0xEA -> (0,1)
    return;
  }
  m.step(0x242d, 5);

  regs.e = regs.dec8(regs.e); // E=0 -> (0,0)
  m.step(0x242e, 4);
  regs.a = mem.read8(0x6227); // parity flag
  m.step(0x2431, 13);
  regs.rrca(); // bit 0 -> carry; A now dead (reloaded at 0x2433)
  m.step(0x2432, 4);
  if (!regs.fC) {
    m.ret(11); // ret nc -- bit0 clear -> (0,0)
    return;
  }
  m.step(0x2433, 5);

  regs.a = mem.read8(0x6205); // player Y
  m.step(0x2436, 13);
  regs.cp(0x58);
  m.step(0x2438, 5);
  if (!regs.fC) {
    m.ret(11); // ret nc -- Y >= 0x58 -> (0,0)
    return;
  }
  m.step(0x2439, 5);

  regs.a = mem.read8(0x6203); // player X again
  m.step(0x243c, 13);
  regs.cp(0x6c);
  m.step(0x243e, 5);
  if (!regs.fC) {
    m.ret(11); // ret nc -- X >= 0x6C -> (0,0)
    return;
  }
  m.step(0x243f, 5);

  regs.d = regs.inc8(regs.d); // D=1 -> (1,0)
  m.step(0x2440, 4);
  m.ret(10);
}
/**
 * sub_2441 -- ROM 0x2441-0x24B3
 *
 *   -- head A: modular sum over ROM 0x3F0C picks the IY base
 *   2441  21 0c 3f     ld   hl,0x3f0c
 *   2444  3e 5e        ld   a,0x5e
 *   2446  06 06        ld   b,0x06
 *   2448  86           add  a,(hl)          ; loc_2448
 *   2449  23           inc  hl
 *   244a  10 fc        djnz 0x2448
 *   244c  fd 21 10 63  ld   iy,0x6310
 *   2450  a7           and  a
 *   2451  ca 56 24     jp   z,0x2456
 *   2454  fd 23        inc  iy
 *
 *   -- head B: 0x6227 picks one of four record tables
 *   2456  3a 27 62     ld   a,(0x6227)      ; entry_2456
 *   2459  3d           dec  a
 *   245a  21 e4 3a     ld   hl,0x3ae4
 *   245d  ca 71 24     jp   z,0x2471
 *   2460  3d           dec  a
 *   2461  21 5d 3b     ld   hl,0x3b5d
 *   2464  ca 71 24     jp   z,0x2471
 *   2467  3d           dec  a
 *   2468  21 e5 3b     ld   hl,0x3be5
 *   246b  ca 71 24     jp   z,0x2471
 *   246e  21 8b 3c     ld   hl,0x3c8b
 *   2471  dd 21 00 63  ld   ix,0x6300       ; entry_2471
 *   2475  11 05 00     ld   de,0x0005
 *
 *  -- the walk: SCC 0x2478 / 0x2488 / 0x249E
 *   2478  7e           ld   a,(hl)          ; loc_2478
 *   ...                                       (full listing in section 1)
 *   24b1  c3 78 24     jp   0x2478
 *
 * The walk is a JUMP cycle, not a call cycle -- no call/push/pop/rst in the whole
 * 115 bytes, so the ROM's stack depth is flat across it. Written as one loop for
 * that reason; three mutually-calling functions would be shape-faithful and grow a
 * JS frame per record.
 *
 * CALLED FROM 0x0D62 (`cd 41 24`), the only reference to 0x2441 in the ROM. That
 * is a real `call`, so it pushes 0x0D65. That alone, however, does NOT
 * establish that it "returns to 0x0D65".
 */
export function sub_2441(m) {
  const { regs, mem } = m;

  // -- head A ------------------------------------------------------------
  regs.hl = 0x3f0c;
  m.step(0x2444, 10); // ld hl,0x3f0c
  regs.a = 0x5e;
  m.step(0x2446, 7); // ld a,0x5e
  regs.b = 0x06;
  m.step(0x2448, 7); // ld b,0x06

  // loc_2448 -- regs.add() masks to 8 bits, which is the point: the carry out
  // of each step is DISCARDED and the sum is mod 256. An open-coded `+=` that
  // forgets the mask diverges on the first sum over 0xFF.
  do {
    regs.add(mem.read8(regs.hl));
    m.step(0x2449, 7); // add a,(hl)
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x244a, 6); // inc hl
    regs.djnz();
    m.step(regs.b !== 0 ? 0x2448 : 0x244c, regs.b !== 0 ? 13 : 8); // djnz
  } while (regs.b !== 0);

  // `ld rr,nn` affects no flags, and `and a` regenerates them from A anyway,
  // so this sits harmlessly between the loop and its test. By contrast, an
  // identically flag-neutral `ld hl,nn` elsewhere is NOT harmless.
  regs.iy = 0x6310;
  m.step(0x2450, 14); // ld iy,0x6310
  regs.and(regs.a);
  m.step(0x2451, 4); // and a

  if (regs.fZ) {
    m.step(0x2456, 10); // jp z,0x2456 TAKEN -- sum was 0, IY stays 0x6310
  } else {
    m.step(0x2454, 10); // NOT taken -- falls through
    regs.iy = (regs.iy + 1) & 0xffff; // 16-bit INC: no flags
    m.step(0x2456, 10); // inc iy -- IY becomes 0x6311
  }

  // -- head B ------------------------------------------------------------
  // Every `ld hl,nn` below is FLAG-NEUTRAL, so each `jp z` tests the `dec a`
  // TWO instructions earlier, across an intervening load -- the same
  // flag-neutral-load trap shape seen elsewhere in this file.
  regs.a = mem.read8(0x6227);
  m.step(0x2459, 13); // ld a,(0x6227) -- discards the head-A sum

  selectTable: {
    regs.a = regs.dec8(regs.a);
    m.step(0x245a, 4); // dec a
    regs.hl = 0x3ae4;
    m.step(0x245d, 10); // ld hl,0x3ae4  (flag-neutral)
    if (regs.fZ) {
      m.step(0x2471, 10); // jp z,0x2471 TAKEN -- 0x6227 was 1
      break selectTable;
    }
    m.step(0x2460, 10); // falls through

    regs.a = regs.dec8(regs.a);
    m.step(0x2461, 4); // dec a
    regs.hl = 0x3b5d;
    m.step(0x2464, 10); // ld hl,0x3b5d  (flag-neutral)
    if (regs.fZ) {
      m.step(0x2471, 10); // 0x6227 was 2
      break selectTable;
    }
    m.step(0x2467, 10); // falls through

    regs.a = regs.dec8(regs.a);
    m.step(0x2468, 4); // dec a
    regs.hl = 0x3be5;
    m.step(0x246b, 10); // ld hl,0x3be5  (flag-neutral)
    if (regs.fZ) {
      m.step(0x2471, 10); // 0x6227 was 3
      break selectTable;
    }
    m.step(0x246e, 10); // falls through

    // Default: EVERYTHING else reaches here, including 0x6227 == 0, which
    // wraps to 0xFF on the first `dec a` and never hits Z.
    regs.hl = 0x3c8b;
    m.step(0x2471, 10); // ld hl,0x3c8b
  }

  regs.ix = 0x6300;
  m.step(0x2475, 14); // ld ix,0x6300
  regs.de = 0x0005;
  m.step(0x2478, 10); // ld de,0x0005

  // -- the walk: falls through into loc_2478 ------------------------------
  // A still holds (0x6227 - 1..3) here and HL past the checksum block is long
  // gone; both are dead -- `ld a,(hl)` below overwrites A immediately and HL
  // was reloaded in head B. Checked, not assumed.
  for (;;) {
    // -- loc_2478 --
    regs.a = mem.read8(regs.hl);
    m.step(0x2479, 7); // ld a,(hl)
    regs.and(regs.a);
    m.step(0x247a, 4); // and a

    if (regs.fZ) {
      // -- loc_2488: type 0 -> IX block --
      m.step(0x2488, 10); // jp z,0x2488 TAKEN

      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x2489, 6); // inc hl
      regs.a = mem.read8(regs.hl);
      m.step(0x248a, 7); // ld a,(hl)
      mem.write8((regs.ix + 0x00) & 0xffff, regs.a);
      m.step(0x248d, 19); // ld (ix+0x00),a

      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x248e, 6); // inc hl
      regs.a = mem.read8(regs.hl);
      m.step(0x248f, 7); // ld a,(hl)
      mem.write8((regs.ix + 0x15) & 0xffff, regs.a);
      m.step(0x2492, 19); // ld (ix+0x15),a

      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x2493, 6); // inc hl -- record byte +3 stepped over, never read
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x2494, 6); // inc hl
      regs.a = mem.read8(regs.hl);
      m.step(0x2495, 7); // ld a,(hl)
      mem.write8((regs.ix + 0x2a) & 0xffff, regs.a);
      m.step(0x2498, 19); // ld (ix+0x2a),a

      // `inc ix` is 16-bit INC and affects NO flags. Deliberately NOT
      // regs.addIx(1) -- that is `add ix,rr`, which writes H, N, C and F3/F5.
      // Mirror image of the sub_0593 correction at mainloop.js:878: there,
      // open-coding an `add` DROPPED flags that should have been set; here,
      // reaching for the helper would SET flags that must stay untouched.
      regs.ix = (regs.ix + 1) & 0xffff;
      m.step(0x249a, 10); // inc ix
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x249b, 6); // inc hl
      m.step(0x2478, 10); // jp 0x2478
      continue;
    }
    m.step(0x247d, 10); // jp z,0x2488 NOT taken -- falls through

    regs.a = regs.dec8(regs.a);
    m.step(0x247e, 4); // dec a -- A is original-1 from here down

    if (regs.fZ) {
      // -- loc_249e: type 1 -> IY block --
      m.step(0x249e, 10); // jp z,0x249e TAKEN

      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x249f, 6); // inc hl
      regs.a = mem.read8(regs.hl);
      m.step(0x24a0, 7); // ld a,(hl)
      mem.write8((regs.iy + 0x00) & 0xffff, regs.a);
      m.step(0x24a3, 19); // ld (iy+0x00),a

      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x24a4, 6); // inc hl
      regs.a = mem.read8(regs.hl);
      m.step(0x24a5, 7); // ld a,(hl)
      mem.write8((regs.iy + 0x15) & 0xffff, regs.a);
      m.step(0x24a8, 19); // ld (iy+0x15),a

      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x24a9, 6); // inc hl -- record byte +3 stepped over here too
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x24aa, 6); // inc hl
      regs.a = mem.read8(regs.hl);
      m.step(0x24ab, 7); // ld a,(hl)
      mem.write8((regs.iy + 0x2a) & 0xffff, regs.a);
      m.step(0x24ae, 19); // ld (iy+0x2a),a

      regs.iy = (regs.iy + 1) & 0xffff; // 16-bit INC: no flags. See note above.
      m.step(0x24b0, 10); // inc iy
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x24b1, 6); // inc hl
      m.step(0x2478, 10); // jp 0x2478
      continue;
    }
    m.step(0x2481, 10); // jp z,0x249e NOT taken -- falls through

    regs.cp(0xa9);
    m.step(0x2483, 7); // cp 0xa9 -- against the DECREMENTED A.

    if (regs.fZ) {
      m.ret(11); // ret z TAKEN -- 11 T-states, not 10. THE ONLY EXIT.
      return;
    }
    m.step(0x2484, 5); // ret z NOT taken -- 5 T-states, falls through

    regs.addHl(regs.de);
    m.step(0x2485, 11); // add hl,de
    m.step(0x2478, 10); // jp 0x2478
  }
}

export function sub_2523(m) {
  const { regs, mem } = m;
  const IX = (d) => (regs.ix + d) & 0xffff;

  regs.hl = 0x639b; // LIVE to 0x258F
  m.step(0x2526, 10); // ld hl,0x639b
  regs.a = mem.read8(regs.hl);
  m.step(0x2527, 7); // ld a,(hl)
  regs.and(regs.a);
  m.step(0x2528, 4); // and a -- timer == 0?
  if (regs.fNZ) {
    m.step(0x258f, 10); // jp nz,0x258f -- timer running
    return decAndRet();
  }
  m.step(0x252b, 10); // jp nz not taken

  regs.a = mem.read8(0x639a);
  m.step(0x252e, 13); // ld a,(0x639a)
  regs.and(regs.a);
  m.step(0x252f, 4); // and a -- request == 0?
  if (regs.fZ) {
    m.ret(11); // ret z -- no request (skips the dec)
    return;
  }
  m.step(0x2530, 5); // ret z NOT taken

  // -- free-slot scan --
  regs.b = 0x06;
  m.step(0x2532, 7); // ld b,0x06
  regs.de = 0x0010;
  m.step(0x2535, 10); // ld de,0x0010
  regs.ix = 0x65a0;
  m.step(0x2539, 14); // ld ix,0x65a0
  for (;;) {
    regs.bit(0, mem.read8(IX(0x00)));
    m.step(0x253d, 20); // bit 0,(ix+0x00)
    if (regs.fZ) {
      m.step(0x2545, 10); // jp z,0x2545 -- free slot
      break;
    }
    m.step(0x2540, 10); // jp z not taken
    regs.addIx(regs.de);
    m.step(0x2542, 15); // add ix,de
    regs.djnz();
    if (regs.b !== 0) {
      m.step(0x2539, 13); // djnz taken
      continue;
    }
    m.step(0x2544, 8); // djnz not taken
    m.ret(); // no free slot -- nothing spawned (skips the dec)
    return;
  }

  // -- loc_2545: spawn -- roll for the type --
  let toType = false;
  m.push16(0x2548);
  m.step(0x0057, 17);
  sub_0057(m); // pseudo-random -> A
  regs.cp(0x60);
  m.step(0x254a, 7); // cp 0x60
  mem.write8(IX(0x05), 0x7c); // ld (ix+0x05),0x7c -- default field5
  m.step(0x254e, 19);
  if (regs.fC) {
    toType = true;
    m.step(0x2558, 10); // jp c,0x2558 -- random < 0x60
  } else {
    m.step(0x2551, 10); // jp c not taken
    regs.a = mem.read8(0x62a3);
    m.step(0x2554, 13); // ld a,(0x62a3)
    regs.a = regs.dec8(regs.a);
    m.step(0x2555, 4); // dec a
    if (regs.fNZ) {
      // -- loc_256e: re-roll --
      m.step(0x256e, 10); // jp nz,0x256e
      m.push16(0x2571);
      m.step(0x0057, 17);
      sub_0057(m); // SECOND RNG draw
      regs.cp(0x68);
      m.step(0x2573, 7); // cp 0x68
      m.step(0x2560, 10); // jp 0x2560 -- into the field3 block (carry = cp 0x68's)
    } else {
      m.step(0x2558, 5); // jp nz not taken -> fall into 0x2558
      toType = true;
    }
  }

  if (toType) {
    // -- loc_2558 --
    mem.write8(IX(0x05), 0xcc); // ld (ix+0x05),0xcc -- override field5
    m.step(0x255c, 19);
    regs.a = mem.read8(0x62a6);
    m.step(0x255f, 13); // ld a,(0x62a6)
    regs.rlca(); // carry = bit 7 of 0x62A6
    m.step(0x2560, 4);
  }
  // -- loc_2560: field3 default, carry preserved from rlca OR cp 0x68 --
  mem.write8(IX(0x03), 0x07); // ld (ix+0x03),0x07 -- FLAG-NEUTRAL
  m.step(0x2564, 19);
  if (regs.fC) {
    m.step(0x2567, 10); // jp nc not taken
    mem.write8(IX(0x03), 0xf8); // ld (ix+0x03),0xf8 -- override
    m.step(0x256b, 19);
    m.step(0x2576, 10); // jp 0x2576
  } else {
    m.step(0x2576, 10); // jp nc,0x2576 -- keep 0x07
  }

  // -- loc_2576: activate the object --
  mem.write8(IX(0x00), 0x01);
  m.step(0x257a, 19); // ld (ix+0x00),0x01
  mem.write8(IX(0x07), 0x4b);
  m.step(0x257e, 19); // ld (ix+0x07),0x4b
  mem.write8(IX(0x09), 0x08);
  m.step(0x2582, 19); // ld (ix+0x09),0x08
  mem.write8(IX(0x0a), 0x03);
  m.step(0x2586, 19); // ld (ix+0x0a),0x03
  regs.a = 0x7c;
  m.step(0x2588, 7); // ld a,0x7c
  mem.write8(0x639b, regs.a); // reload timer
  m.step(0x258b, 13); // ld (0x639b),a
  regs.xor(regs.a); // A = 0
  m.step(0x258c, 4);
  mem.write8(0x639a, regs.a); // clear request
  m.step(0x258f, 13); // ld (0x639a),a
  return decAndRet();

  function decAndRet() {
    // -- loc_258f: dec (hl) ; ret -- SHARED tail, HL is PATH-DEPENDENT:
    //   timer path -> HL = 0x639B (untouched);
    //   spawn path -> HL = sub_0057's leftover (0x639B stays 0x7C from the reload).
    regs.decMem8(mem, regs.hl); // dec (hl) -- the LIVE register, target differs by path
    m.step(0x2590, 11);
    m.ret();
  }
}

/**
 * sub_1826 -- ROM 0x1826-0x1838  (shared helper: nested descending fill, HL live-in)
 *
 *   1826  11 db ff     ld   de,0xffdb    ; = -0x25
 *   1829  0e 0e        ld   c,0x0e       ; 14 rows
 *   182b  3e 10        ld   a,0x10       ; fill value, set ONCE
 *   182d  06 05        ld   b,0x05       ; loc_182d (outer re-entry) -- 5 per row
 *   182f  77           ld   (hl),a       ; loc_182f (inner)
 *   1830  23           inc  hl
 *   1831  10 fc        djnz 0x182f
 *   1833  19           add  hl,de        ; HL -= 0x25 (next row, backward)
 *   1834  0d           dec  c
 *   1835  c2 2d 18     jp   nz,0x182d
 *   1838  c9           ret
 *
 * HL is the caller's start address (live-in). 5x14 = 70 bytes of 0x10.
 * Translated for completeness; not yet wired into the live dispatcher.
 */
export function sub_1826(m) {
  const { regs, mem } = m;

  regs.de = 0xffdb; // -0x25
  m.step(0x1829, 10); // ld de,0xffdb
  regs.c = 0x0e;
  m.step(0x182b, 7); // ld c,0x0e
  regs.a = 0x10;
  m.step(0x182d, 7); // ld a,0x10 (once)

  do {
    // -- loc_182d (outer) --
    regs.b = 0x05;
    m.step(0x182f, 7); // ld b,0x05
    do {
      // -- loc_182f (inner) --
      mem.write8(regs.hl, regs.a);
      m.step(0x1830, 7); // ld (hl),a
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x1831, 6); // inc hl
      regs.djnz();
      m.step(regs.b !== 0 ? 0x182f : 0x1833, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
    regs.addHl(regs.de); // add hl,de -- HL -= 0x25
    m.step(0x1834, 11);
    regs.c = regs.dec8(regs.c);
    m.step(0x1835, 4); // dec c
    m.step(regs.fNZ ? 0x182d : 0x1838, 10); // jp nz,0x182d
  } while (regs.fNZ);

  m.ret();
}
/**
 * sub_1a1e -- NO-OP dispatch handler.  ROM 0x1A1E (1 byte)
 * A `dw 0x1a1e` slot in the 0x1A0A rst 0x28 table: this state does nothing.
 * rst 0x28 dispatches by jp, so this `ret` returns to the 0x1A0A routine's
 * CALLER (no frame of its own was pushed).
 *   1a1e  c9  ret
 */
export function sub_1a1e(m) {
  m.ret(10);
}
/**
 * sub_19da -- 3-entry table search (stride 4) over 0x6A0C.  ROM 0x19DA-0x19EC.
 * ONE caller: 0x19AD.
 * Compares X (0x6203) against table[i]; a match jp-jumps to entry_19ed (0x19ED-0x1A06,
 * EXTERNAL undrafted routine -- NOT the spine finale at 0x1977) -> NotImplemented frontier.
 * No match -> ret.
 */
export function sub_19da(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6203); // X
  m.step(0x19dd, 13); // ld a,(0x6203)
  regs.b = 0x03;
  m.step(0x19df, 7); // ld b,0x03
  regs.hl = 0x6a0c;
  m.step(0x19e2, 10); // ld hl,0x6a0c
  do {
    // -- loc_19e2 --
    regs.cp(mem.read8(regs.hl));
    m.step(0x19e3, 7); // cp (hl)
    if (regs.fZ) {
      m.step(0x19ed, 10); // jp z,0x19ed -- X-match; TAIL-jump (entry_19ed's ret returns to our caller)
      return entry_19ed(m);
    }
    m.step(0x19e6, 10); // jp z not taken
    regs.l = regs.inc8(regs.l);
    m.step(0x19e7, 4); // inc l
    regs.l = regs.inc8(regs.l);
    m.step(0x19e8, 4); // inc l
    regs.l = regs.inc8(regs.l);
    m.step(0x19e9, 4); // inc l
    regs.l = regs.inc8(regs.l);
    m.step(0x19ea, 4); // inc l -- stride 4
    regs.djnz();
    m.step(regs.b !== 0 ? 0x19e2 : 0x19ec, regs.b !== 0 ? 13 : 8); // djnz 0x19e2
  } while (regs.b !== 0);
  m.ret(); // 0x19EC -- no match
}
/**
 * entry_19ed -- the confirm half of sub_19da's object-slot scan. ROM 0x19ED-0x1A06.
 * Reached ONLY via sub_19da's `jp z,0x19ed` @0x19E3 (X-match), with HL LIVE-IN =
 * the matched 0x6A0C-array slot ptr (do NOT default it). Confirms player-Y == (slot+3)
 * and bit 3 of (slot+1) CLEAR (eligible); if both pass, registers the hit -- (0x6343)=slot
 * ptr, (0x6342)=0, (0x6340)=1 -- the same shared "player hit an object" flags sub_1a33
 * (edge pickup) writes. Leaf. Reached by jp+ret, so its ret returns to sub_19da's caller.
 * NOTE: the two `ret nz` guards are 11T taken / 5T not-taken (draft skeleton had these
 * swapped; corrected to the Z80 timing / sub_2fcb convention).
 */
export function entry_19ed(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6205);
  m.step(0x19f0, 13); // ld a,(0x6205) -- player Y
  regs.l = regs.inc8(regs.l);
  m.step(0x19f1, 4); // inc l -- slot+1
  regs.l = regs.inc8(regs.l);
  m.step(0x19f2, 4); // inc l -- slot+2
  regs.l = regs.inc8(regs.l);
  m.step(0x19f3, 4); // inc l -- slot+3
  regs.cp(mem.read8(regs.hl));
  m.step(0x19f4, 7); // cp (hl) -- player Y == (slot+3)?
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- no Y match
  m.step(0x19f5, 5); // ret nz NOT taken
  regs.l = regs.dec8(regs.l);
  m.step(0x19f6, 4); // dec l -- slot+2
  regs.l = regs.dec8(regs.l);
  m.step(0x19f7, 4); // dec l -- slot+1
  const flagged = regs.bit(3, mem.read8(regs.hl));
  m.step(0x19f9, 12); // bit 3,(hl) -- enable/consumed flag
  if (flagged) { m.ret(11); return; } // ret nz -- bit 3 SET, object not eligible
  m.step(0x19fa, 5); // ret nz NOT taken
  regs.l = regs.dec8(regs.l);
  m.step(0x19fb, 4); // dec l -- slot+0 (base)
  mem.write16(0x6343, regs.hl);
  m.step(0x19fe, 16); // ld (0x6343),hl -- hit-slot ptr
  regs.xor(regs.a);
  m.step(0x19ff, 4); // xor a
  mem.write8(0x6342, regs.a);
  m.step(0x1a02, 13); // ld (0x6342),a -- := 0
  regs.a = regs.inc8(regs.a);
  m.step(0x1a03, 4); // inc a
  mem.write8(0x6340, regs.a);
  m.step(0x1a06, 13); // ld (0x6340),a -- := 1 (hit registered)
  m.ret(10);
}
/**
 * entry_1a07 -- rst 0x28 STATE-MACHINE dispatcher.  ROM 0x1A07-0x1A32.
 * ONE caller: loc_197a @ 0x19BC.
 * Reads (0x6386) and dispatches to one of 4 states via the inline table @0x1A0B =
 * dw [0x1A1E, 0x1A15, 0x1A1F, 0x1A2A] (idx4+ = dw 0x0000, a wild jp). rst 0x28
 * dispatches by JUMP (the pushed table base is consumed by the body's pop hl), so
 * each handler's `ret` returns to loc_197a, NOT to this dispatcher.
 *
 * The rst 0x28 body (ROM 0x0028-0x0037) is modelled FAITHFULLY (push/pop balanced,
 * table read from ROM).
 */
export function entry_1a07(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6386); // state 0..4
  m.step(0x1a0a, 13); // ld a,(0x6386)
  m.push16(0x1a0b); // rst 0x28 pushes the address AFTER it -- the TABLE BASE
  m.step(0x0028, 11); // rst 0x28

  // -- inline rst 0x28 body (ROM 0x0028-0x0037), modelled faithfully --
  regs.add(regs.a);
  m.step(0x0029, 4); // add a,a -- A = 2*state
  regs.hl = m.pop16(); // pop hl -- table base 0x1A0B (balances the push)
  m.step(0x002a, 10);
  regs.e = regs.a;
  m.step(0x002b, 4); // ld e,a
  regs.d = 0x00;
  m.step(0x002d, 7); // ld d,0x00
  m.step(0x0032, 10); // jp 0x0032
  regs.addHl(regs.de); // add hl,de -- HL = table base + 2*state (flags dead into handlers)
  m.step(0x0033, 11);
  regs.e = mem.read8(regs.hl);
  m.step(0x0034, 7); // ld e,(hl)
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0035, 6); // inc hl
  regs.d = mem.read8(regs.hl);
  m.step(0x0036, 7); // ld d,(hl)
  const target = regs.de; // ex de,hl -- HL becomes the target
  regs.de = regs.hl;
  regs.hl = target;
  m.step(0x0037, 4); // ex de,hl
  m.step(target, 4); // jp (hl)

  if (target === 0x1a1e) { sub_1a1e(m); return true; } // idx0 -- no-op ret
  if (target === 0x1a15) { loc_1a15(m); return true; } // idx1 -- INIT
  if (target === 0x1a1f) { loc_1a1f(m); return true; } // idx2 -- DELAY
  if (target === 0x1a2a) return loc_1a2a(m); // idx3 -- true (ret-nz) / false (caller-skip)
  // idx4+ ((0x6386) >= 4): table[4] = dw 0x0000 -> jp 0x0000, a wild jump (never on tape).
  throw new NotImplemented(
    `entry_1a07 rst 0x28 dispatches to ROM 0x${target.toString(16).padStart(4, "0")} ` +
      "((0x6386) out of the 0..3 state range -> wild jp 0x0000); non-executing frontier.",
  );
}

/** loc_1a15 -- idx1 INIT: clear (0x6387), advance state (0x6386) to 2; falls into 0x1A1E ret. */
function loc_1a15(m) {
  const { regs, mem } = m;
  regs.xor(regs.a);
  m.step(0x1a16, 4); // xor a
  mem.write8(0x6387, regs.a);
  m.step(0x1a19, 13); // ld (0x6387),a -- counter := 0 (BEFORE state)
  regs.a = 0x02;
  m.step(0x1a1b, 7); // ld a,0x02
  mem.write8(0x6386, regs.a);
  m.step(0x1a1e, 13); // ld (0x6386),a -- state := 2 -> falls into 0x1A1E
  m.ret(10); // 0x1A1E ret -> loc_197a
}

/** loc_1a1f -- idx2 DELAY: countdown (0x6387); at 0 advance state to 3. */
function loc_1a1f(m) {
  const { regs, mem } = m;
  regs.hl = 0x6387;
  m.step(0x1a22, 10); // ld hl,0x6387
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x1a23, 11); // dec (hl) -- (0x6387)--
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- stay in state 2
  m.step(0x1a24, 5); // ret nz NOT taken
  regs.a = 0x03;
  m.step(0x1a26, 7); // ld a,0x03
  mem.write8(0x6386, regs.a);
  m.step(0x1a29, 13); // ld (0x6386),a -- state := 3
  m.ret(10); // ret -> loc_197a
}

/** loc_1a2a -- idx3 WAIT+EXIT: when (0x6216)==0, caller-skip loc_197a to its 0x19D2 tail. */
function loc_1a2a(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6216);
  m.step(0x1a2d, 13); // ld a,(0x6216)
  regs.and(regs.a);
  m.step(0x1a2e, 4); // and a
  if (regs.fNZ) { m.ret(11); return true; } // ret nz -- stay in state 3 while (0x6216) != 0
  m.step(0x1a2f, 5); // ret nz NOT taken
  m.pop16(); // pop hl -- HIDDEN EXIT: discards loc_197a's 0x19BF continuation
  m.step(0x1a30, 10);
  m.step(0x19d2, 10); // jp 0x19d2 -> loc_197a's shared tail
  tail_19d2(m); // runs the tail; its ret returns to loc_197a's caller (dispatch)
  return false; // CALLER-SKIP: loc_197a must NOT continue past 0x19BF
}
/**
 * sub_1a33 -- edge item pickup: grid clear + sprite erase (task-gated).  ROM 0x1A33-0x1AC2.
 * rst 0x30 gate (A=0x08). At a screen-edge X (0x4B/0xB3) -> arm (0x6291=1); when armed
 * (0x6291==1), process the pickup: build a slot index B from player X/Y bits, clear the
 * 0x6292+B slot, dec count 0x6290, compute the video address (stride 5 from 0x02CB/0x012B),
 * erase a 3-cell sprite, set collection flags (0x6340/0x6342/0x6225), and call z sub_1d95.
 */
export function sub_1a33(m) {
  const { regs, mem } = m;
  regs.a = 0x08;
  m.step(0x1a35, 7);
  m.push16(0x1a36); m.step(0x0030, 11);
  if (!sub_0030(m)) return; // rst 0x30 gate closed -> caller-skip
  regs.a = mem.read8(0x6203);
  m.step(0x1a39, 13); // player X
  regs.cp(0x4b);
  m.step(0x1a3b, 7);
  if (regs.fZ) { m.step(0x1a4b, 10); return arm_1a4b(m); } // X == 0x4B -> arm
  m.step(0x1a3e, 10);
  regs.cp(0xb3);
  m.step(0x1a40, 7);
  if (regs.fZ) { m.step(0x1a4b, 10); return arm_1a4b(m); } // X == 0xB3 -> arm
  m.step(0x1a43, 10);
  regs.a = mem.read8(0x6291);
  m.step(0x1a46, 13);
  regs.a = regs.dec8(regs.a);
  m.step(0x1a47, 4);
  if (!regs.fZ) { m.ret(10); return; } // (0x6291) != 1 -> not armed
  m.step(0x1a51, 10);
  // -- armed pickup (A == 0 here) --
  mem.write8(0x6291, regs.a);
  m.step(0x1a54, 13); // disarm
  regs.b = regs.a;
  m.step(0x1a55, 4); // B = 0
  regs.a = mem.read8(0x6205);
  m.step(0x1a58, 13); // player Y
  regs.a = regs.dec8(regs.a);
  m.step(0x1a59, 4);
  regs.cp(0xd0);
  m.step(0x1a5b, 7);
  if (regs.fNC) { m.ret(11); return; } // off-field
  regs.rlca();
  m.step(0x1a5d, 4);
  if (regs.fC) { m.step(0x1a60, 10); regs.b = regs.set(2, regs.b); m.step(0x1a62, 8); } else m.step(0x1a62, 10);
  regs.rlca();
  m.step(0x1a63, 4);
  regs.rlca();
  m.step(0x1a64, 4);
  if (regs.fC) { m.step(0x1a67, 10); regs.b = regs.set(1, regs.b); m.step(0x1a69, 8); } else m.step(0x1a69, 10);
  regs.and(0x07);
  m.step(0x1a6b, 7);
  regs.cp(0x06);
  m.step(0x1a6d, 7);
  if (regs.fZ) { m.step(0x1a70, 10); regs.b = regs.set(1, regs.b); m.step(0x1a72, 8); } else m.step(0x1a72, 10);
  regs.a = mem.read8(0x6203);
  m.step(0x1a75, 13); // player X
  regs.rlca();
  m.step(0x1a76, 4);
  if (regs.fC) { m.step(0x1a79, 10); regs.b = regs.set(0, regs.b); m.step(0x1a7b, 8); } else m.step(0x1a7b, 10);
  regs.hl = 0x6292;
  m.step(0x1a7e, 10);
  regs.a = regs.b;
  m.step(0x1a7f, 4);
  regs.add(regs.l);
  m.step(0x1a80, 4); // add a,l
  regs.l = regs.a;
  m.step(0x1a81, 4); // HL = 0x6292 + B
  regs.a = mem.read8(regs.hl);
  m.step(0x1a82, 7);
  regs.and(regs.a);
  m.step(0x1a83, 4);
  if (regs.fZ) { m.ret(11); return; } // slot empty
  mem.write8(regs.hl, 0x00);
  m.step(0x1a86, 10); // clear slot
  regs.hl = 0x6290;
  m.step(0x1a89, 10);
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x1a8a, 11); // dec count
  regs.a = regs.b;
  m.step(0x1a8b, 4);
  regs.bc = 0x0005;
  m.step(0x1a8e, 10);
  regs.rra();
  m.step(0x1a8f, 4); // A = B>>1, carry = B.0
  if (regs.fC) {
    m.step(0x1abd, 10);
    regs.hl = 0x012b;
    m.step(0x1ac0, 10);
    m.step(0x1a95, 10); // jp 0x1a95
  } else {
    m.step(0x1a92, 10);
    regs.hl = 0x02cb;
    m.step(0x1a95, 10);
  }
  // -- loc_1a95: stride multiply --
  regs.and(regs.a);
  m.step(0x1a96, 4);
  if (regs.fZ) {
    m.step(0x1a9e, 10); // jp z,0x1a9e
  } else {
    m.step(0x1a99, 10);
    do {
      regs.addHl(regs.bc);
      m.step(0x1a9a, 11); // add hl,bc
      regs.a = regs.dec8(regs.a);
      m.step(0x1a9b, 4); // dec a
      m.step(regs.a !== 0 ? 0x1a99 : 0x1a9e, 10); // jp nz,0x1a99
    } while (regs.a !== 0);
  }
  // -- loc_1a9e --
  regs.bc = 0x7400;
  m.step(0x1aa1, 10);
  regs.addHl(regs.bc);
  m.step(0x1aa2, 11); // HL = video addr
  regs.a = 0x10;
  m.step(0x1aa4, 7);
  mem.write8(regs.hl, regs.a);
  m.step(0x1aa5, 7);
  regs.l = regs.dec8(regs.l);
  m.step(0x1aa6, 4);
  mem.write8(regs.hl, regs.a);
  m.step(0x1aa7, 7);
  regs.l = regs.inc8(regs.l);
  m.step(0x1aa8, 4);
  regs.l = regs.inc8(regs.l);
  m.step(0x1aa9, 4);
  mem.write8(regs.hl, regs.a);
  m.step(0x1aaa, 7); // 3-cell erase
  regs.a = 0x01;
  m.step(0x1aac, 7);
  mem.write8(0x6340, regs.a);
  m.step(0x1aaf, 13);
  mem.write8(0x6342, regs.a);
  m.step(0x1ab2, 13);
  mem.write8(0x6225, regs.a);
  m.step(0x1ab5, 13); // collection flags
  regs.a = mem.read8(0x6216);
  m.step(0x1ab8, 13);
  regs.and(regs.a);
  m.step(0x1ab9, 4);
  if (regs.fZ) { m.push16(0x1abc); m.step(0x1d95, 17); sub_1d95(m); } // call z,0x1d95
  else m.step(0x1abc, 10);
  m.ret(10);
}
/** arm_1a4b -- sub_1a33 edge-hit: set (0x6291)=1 (arm the pickup). */
function arm_1a4b(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  m.step(0x1a4d, 7);
  mem.write8(0x6291, regs.a);
  m.step(0x1a50, 13);
  m.ret(10);
}

/**
 * entry_1ac3 -- PLAYER movement / climb / jump state machine.
 * ROM 0x1AC3-0x1D02 (576 bytes, ~130 insns). Called ONCE from loc_197a @ 0x1980
 *  (handler_1977's cascade).
 *
 * ONE UNIT: every interior label (loc_1ae6 .. loc_1cf2) is reached
 * only from within this span -- extent PROVEN by forward reachability trace, so
 * the interior labels are module-local helpers, not separate entries.
 *
 * Not yet wired into the live dispatcher: its only caller loc_197a is untranslated (the
 * handler_1977 spine); nothing in translated src invokes entry_1ac3. Goes
 * live only at the finale (step 4).
 *
 * THREE LOAD-BEARING FACTS:
 *  (1) call 0x236e @ 0x1B13 (loc_1afe) is a HIDDEN EXIT -- on a miss it unwinds
 *      past entry_1ac3 to loc_197a and aborts this routine. Boolean-guarded:
 *      `if (!sub_236e(m)) return;`. Its found-path A is carried across a
 *      flag-clobbering region by a push af / pop af bracket (0x1B16-0x1B2D) --
 *      modelled as regs.af save/restore; dropping it corrupts the 0x1B2D branch.
 *  (2) 0x1C23-0x1C32 is LIVE CODE the listing hides as `defb UNREACHED` (the
 *      tracer stopped after call 0x2853, which returns normally). Transcribed live.
 *  (3) loc_1bb2 sets IX=0x6200 itself and uses a LOCAL X-helper; the loc_1afe
 *      spine uses the caller's IX via R. Two distinct IX regimes -- kept separate.
 *
 * Dispatches on 0x6216/0x621e/0x6217/0x6215 (state) + 0x6010 (input), then moves
 * the player or hands to the 0x1Dxx cluster (mostly jp 0x1da6). External tail
 * targets return <ext>(m). call z 0x1d95 (0x1C70) is a non-executing frontier
 * (0x1D95 not integrated). Object/state fields not interpreted.
 */
export function entry_1ac3(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  // ---- HEAD DISPATCH (0x1AC3-0x1AE5): five state/input tests, all fall-through ----
  regs.a = mem.read8(0x6216); // PRIMARY movement state
  m.step(0x1ac6, 13); // ld a,(0x6216)
  regs.a = regs.dec8(regs.a);
  m.step(0x1ac7, 4); // dec a
  if (regs.fZ) { m.step(0x1bb2, 10); return loc_1bb2(m); } // jp z -- state 1 (airborne)
  m.step(0x1aca, 10);

  regs.a = mem.read8(0x621e); // lock/freeze countdown
  m.step(0x1acd, 13); // ld a,(0x621e)
  regs.and(regs.a);
  m.step(0x1ace, 4); // and a
  if (regs.fNZ) { m.step(0x1b55, 10); return loc_1b55(m); } // jp nz -- lock ticking
  m.step(0x1ad1, 10);

  regs.a = mem.read8(0x6217); // climb sub-state
  m.step(0x1ad4, 13); // ld a,(0x6217)
  regs.a = regs.dec8(regs.a);
  m.step(0x1ad5, 4); // dec a
  if (regs.fZ) { m.step(0x1ae6, 10); return loc_1ae6(m, R); } // jp z -- climb path
  m.step(0x1ad8, 10);

  regs.a = mem.read8(0x6215);
  m.step(0x1adb, 13); // ld a,(0x6215)
  regs.a = regs.dec8(regs.a);
  m.step(0x1adc, 4); // dec a
  if (regs.fZ) { m.step(0x1b38, 10); return loc_1b38(m); } // jp z
  m.step(0x1adf, 10);

  regs.a = mem.read8(0x6010); // PLAYER INPUT
  m.step(0x1ae2, 13); // ld a,(0x6010)
  regs.rla(); // bit 7 (button) -> carry
  m.step(0x1ae3, 4); // rla
  if (regs.fC) { m.step(0x1b6e, 10); return loc_1b6e(m); } // jp c -- start jump
  m.step(0x1ae6, 5); // falls through to loc_1ae6
  return loc_1ae6(m, R);
}

/** loc_1ae6 -- WALK/CLIMB direction pick, gated by 241f's (D,E). */
function loc_1ae6(m, R) {
  const { regs, mem } = m;
  m.push16(0x1ae9);
  m.step(0x241f, 17); // call 0x241f
  sub_241f(m); // returns (D,E); plain call
  regs.a = mem.read8(0x6010);
  m.step(0x1aec, 13); // ld a,(0x6010)
  regs.e = regs.dec8(regs.e); // E was 241f's E
  m.step(0x1aed, 4); // dec e
  if (regs.fNZ) {
    m.step(0x1af0, 10); // jr nz NOT to loc_1af5
    regs.bit(0, regs.a); // input dir bit 0 (register form)
    m.step(0x1af2, 12); // bit 0,a
    if (regs.fNZ) { m.step(0x1c8f, 10); return loc_1c8f(m); } // jp nz
  } else {
    m.step(0x1af5, 10);
  }
  return loc_1af5(m, R);
}

/** loc_1af5 -- second direction (D), then fall to loc_1afe (climb collision). */
function loc_1af5(m, R) {
  const { regs } = m;
  regs.d = regs.dec8(regs.d);
  m.step(0x1af6, 4); // dec d
  if (regs.fNZ) {
    m.step(0x1af9, 10);
    regs.bit(1, regs.a);
    m.step(0x1afb, 12); // bit 1,a
    if (regs.fNZ) { m.step(0x1cab, 10); return loc_1cab(m); } // jp nz
  } else {
    m.step(0x1afe, 10);
  }
  return loc_1afe(m, R);
}

/**
 * loc_1afe -- climb collision. ** CONTAINS THE 236e HIDDEN EXIT + push/pop af. **
 */
function loc_1afe(m, R) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6217);
  m.step(0x1b01, 13); // ld a,(0x6217)
  regs.a = regs.dec8(regs.a);
  m.step(0x1b02, 4); // dec a
  if (regs.fZ) { m.ret(11); return; } // ret z
  m.step(0x1b03, 5);

  regs.a = mem.read8(0x6205); // Y
  m.step(0x1b06, 13); // ld a,(0x6205)
  regs.add(0x08);
  m.step(0x1b08, 7); // add a,0x08
  regs.d = regs.a;
  m.step(0x1b09, 4); // ld d,a
  regs.a = mem.read8(0x6203); // X
  m.step(0x1b0c, 13); // ld a,(0x6203)
  regs.or(0x03);
  m.step(0x1b0e, 7); // or 0x03
  regs.a = regs.res(2, regs.a);
  m.step(0x1b10, 8); // res 2,a
  regs.bc = 0x0015;
  m.step(0x1b13, 10); // ld bc,0x0015

  // ** THE HIDDEN EXIT ** -- 236e miss unwinds to 197a; body below is found-only
  m.push16(0x1b16);
  m.step(0x236e, 17); // call 0x236e
  if (!sub_236e(m)) return; // miss: already unwound to loc_197a

  m.push16(regs.af); // push af -- carry 236e's A across the flag-clobbering region
  m.step(0x1b17, 11);
  regs.hl = 0x6207;
  m.step(0x1b1a, 10); // ld hl,0x6207
  regs.a = mem.read8(regs.hl);
  m.step(0x1b1b, 7); // ld a,(hl)
  regs.and(0x80);
  m.step(0x1b1d, 7); // and 0x80
  regs.or(0x06);
  m.step(0x1b1f, 7); // or 0x06
  mem.write8(regs.hl, regs.a);
  m.step(0x1b20, 7); // ld (hl),a
  regs.hl = 0x621a;
  m.step(0x1b23, 10); // ld hl,0x621a
  regs.a = 0x04;
  m.step(0x1b25, 7); // ld a,0x04
  regs.cp(regs.c); // C = 236e's cpir residual count
  m.step(0x1b26, 4); // cp c
  mem.write8(regs.hl, 0x01);
  m.step(0x1b28, 10); // ld (hl),0x01
  if (regs.fNC) {
    m.step(0x1b2c, 10); // jr nc,0x1b2c
  } else {
    m.step(0x1b2b, 5); // jr nc NOT taken
    mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
    m.step(0x1b2c, 11); // dec (hl)
  }

  // loc_1b2c: pop af, test the RESTORED A
  regs.af = m.pop16(); // pop af
  m.step(0x1b2d, 10);
  regs.and(regs.a);
  m.step(0x1b2e, 4); // and a
  if (regs.fZ) { m.step(0x1b4e, 10); return entry_1b4e(m); } // jp z
  m.step(0x1b31, 10);
  regs.a = mem.read8(regs.hl);
  m.step(0x1b32, 7); // ld a,(hl)
  regs.and(regs.a);
  m.step(0x1b33, 4); // and a
  if (regs.fNZ) { m.ret(11); return; } // ret nz
  m.step(0x1b34, 5); // ret nz NOT taken
  regs.l = regs.inc8(regs.l);
  m.step(0x1b35, 4); // inc l
  mem.write8(regs.hl, regs.d);
  m.step(0x1b36, 7); // ld (hl),d
  regs.l = regs.inc8(regs.l);
  m.step(0x1b37, 4); // inc l
  mem.write8(regs.hl, regs.b);
  m.step(0x1b38, 7); // ld (hl),b
  return loc_1b38(m);
}

/** loc_1b38 (0x1B38-0x1B4D): input bit3 -> jump-phase; bit2 -> 0x1d03; else ret. */
function loc_1b38(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6010);
  m.step(0x1b3b, 13); // ld a,(0x6010)
  regs.bit(3, regs.a);
  m.step(0x1b3d, 8); // bit 3,a
  if (regs.fNZ) { m.step(0x1cf2, 10); return loc_1cf2(m); } // jp nz,0x1cf2
  m.step(0x1b40, 10);
  regs.a = mem.read8(0x6215);
  m.step(0x1b43, 13); // ld a,(0x6215)
  regs.and(regs.a);
  m.step(0x1b44, 4); // and a
  if (regs.fZ) { m.ret(11); return; } // ret z
  m.step(0x1b45, 5);
  return loc_1b45(m);
}

/** loc_1b45 (0x1B45-0x1B4D): input bit2 -> 0x1d03 (external); else ret. */
function loc_1b45(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6010);
  m.step(0x1b48, 13); // ld a,(0x6010)
  regs.bit(2, regs.a);
  m.step(0x1b4a, 8); // bit 2,a
  if (regs.fNZ) { m.step(0x1d03, 10); return entry_1d03(m); } // jp nz -- external
  m.step(0x1b4d, 10);
  m.ret(10);
}

/** entry_1b4e (0x1B4E-0x1B54): store B,D at (HL+1),(HL+3) then jp into loc_1b45.
 *  Reached from loc_1afe's 0x1B2E jp z; HL is 0x621A there. */
function entry_1b4e(m) {
  const { regs, mem } = m;
  regs.l = regs.inc8(regs.l);
  m.step(0x1b4f, 4); // inc l
  mem.write8(regs.hl, regs.b);
  m.step(0x1b50, 7); // ld (hl),b
  regs.l = regs.inc8(regs.l);
  m.step(0x1b51, 4); // inc l
  mem.write8(regs.hl, regs.d);
  m.step(0x1b52, 7); // ld (hl),d
  m.step(0x1b45, 10); // jp 0x1b45
  return loc_1b45(m);
}

/** loc_1b55 (0x1B55-0x1B6D): the 0x621E lock countdown. */
function loc_1b55(m) {
  const { regs, mem } = m;
  regs.hl = 0x621e;
  m.step(0x1b58, 10); // ld hl,0x621e
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x1b59, 11); // dec (hl)
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- still locked
  m.step(0x1b5a, 5);
  regs.a = mem.read8(0x6218);
  m.step(0x1b5d, 13); // ld a,(0x6218)
  mem.write8(0x6217, regs.a);
  m.step(0x1b60, 13); // ld (0x6217),a
  regs.hl = 0x6207;
  m.step(0x1b63, 10); // ld hl,0x6207
  regs.a = mem.read8(regs.hl);
  m.step(0x1b64, 7); // ld a,(hl)
  regs.and(0x80);
  m.step(0x1b66, 7); // and 0x80
  mem.write8(regs.hl, regs.a);
  m.step(0x1b67, 7); // ld (hl),a
  regs.xor(regs.a);
  m.step(0x1b68, 4); // xor a
  mem.write8(0x6202, regs.a);
  m.step(0x1b6b, 13); // ld (0x6202),a
  m.step(0x1da6, 10); // jp 0x1da6
  return entry_1da6(m);
}

/** loc_1b6e (0x1B6E-0x1BB1): JUMP INIT. */
function loc_1b6e(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  m.step(0x1b70, 7); // ld a,0x01
  mem.write8(0x6216, regs.a);
  m.step(0x1b73, 13); // ld (0x6216),a
  regs.hl = 0x6210;
  m.step(0x1b76, 10); // ld hl,0x6210
  regs.a = mem.read8(0x6010);
  m.step(0x1b79, 13); // ld a,(0x6010)
  regs.bc = 0x0080; // +X velocity
  m.step(0x1b7c, 10); // ld bc,0x0080
  regs.rra(); // input bit 0 -> carry
  m.step(0x1b7d, 4); // rra
  if (regs.fC) { m.step(0x1b8a, 10); return loc_1b8a(m); } // jp c
  m.step(0x1b80, 10);
  regs.bc = 0xff80; // -X velocity
  m.step(0x1b83, 10); // ld bc,0xff80
  regs.rra(); // input bit 1 -> carry
  m.step(0x1b84, 4); // rra
  if (regs.fC) { m.step(0x1b8a, 10); return loc_1b8a(m); } // jp c
  m.step(0x1b87, 10);
  regs.bc = 0x0000;
  m.step(0x1b8a, 10); // ld bc,0x0000
  return loc_1b8a(m);
}

/** loc_1b8a (0x1B8A-0x1BB1): write the jump record, set sprite, snapshot Y, sound. */
function loc_1b8a(m) {
  const { regs, mem } = m;
  regs.xor(regs.a); // A = 0
  m.step(0x1b8b, 4); // xor a
  mem.write8(regs.hl, regs.b);
  m.step(0x1b8c, 7); // ld (hl),b -- (0x6210)=B
  regs.l = regs.inc8(regs.l);
  m.step(0x1b8d, 4); // inc l
  mem.write8(regs.hl, regs.c);
  m.step(0x1b8e, 7); // ld (hl),c -- (0x6211)=C
  regs.l = regs.inc8(regs.l);
  m.step(0x1b8f, 4); // inc l
  mem.write8(regs.hl, 0x01);
  m.step(0x1b91, 10); // ld (hl),0x01 -- (0x6212)=1
  regs.l = regs.inc8(regs.l);
  m.step(0x1b92, 4); // inc l
  mem.write8(regs.hl, 0x48);
  m.step(0x1b94, 10); // ld (hl),0x48 -- (0x6213)=0x48
  regs.l = regs.inc8(regs.l);
  m.step(0x1b95, 4); // inc l
  mem.write8(regs.hl, regs.a);
  m.step(0x1b96, 7); // ld (hl),a -- (0x6214)=0
  mem.write8(0x6204, regs.a);
  m.step(0x1b99, 13); // ld (0x6204),a
  mem.write8(0x6206, regs.a);
  m.step(0x1b9c, 13); // ld (0x6206),a
  regs.a = mem.read8(0x6207);
  m.step(0x1b9f, 13); // ld a,(0x6207)
  regs.and(0x80);
  m.step(0x1ba1, 7); // and 0x80
  regs.or(0x0e);
  m.step(0x1ba3, 7); // or 0x0e
  mem.write8(0x6207, regs.a);
  m.step(0x1ba6, 13); // ld (0x6207),a
  regs.a = mem.read8(0x6205);
  m.step(0x1ba9, 13); // ld a,(0x6205)
  mem.write8(0x620e, regs.a);
  m.step(0x1bac, 13); // ld (0x620e),a
  regs.hl = 0x6081;
  m.step(0x1baf, 10); // ld hl,0x6081
  mem.write8(regs.hl, 0x03); // sound trigger
  m.step(0x1bb1, 10); // ld (hl),0x03
  m.ret(10);
}

/** loc_1bb2 (0x1BB2-0x1BF1): AIRBORNE (0x6216==1). Sets IX=0x6200 (its OWN regime). */
function loc_1bb2(m) {
  const { regs, mem } = m;
  regs.ix = 0x6200; // this path's IX (do NOT share R with the spine)
  m.step(0x1bb6, 14); // ld ix,0x6200
  const X = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(0x6203);
  m.step(0x1bb9, 13); // ld a,(0x6203)
  mem.write8(X(0x0b), regs.a);
  m.step(0x1bbc, 19); // ld (ix+0x0b),a
  regs.a = mem.read8(0x6205);
  m.step(0x1bbf, 13); // ld a,(0x6205)
  mem.write8(X(0x0c), regs.a);
  m.step(0x1bc2, 19); // ld (ix+0x0c),a
  m.push16(0x1bc5);
  m.step(0x239c, 17); // call 0x239c
  sub_239c(m);
  m.push16(0x1bc8);
  m.step(0x241f, 17); // call 0x241f
  sub_241f(m); // returns (D,E)
  regs.d = regs.dec8(regs.d);
  m.step(0x1bc9, 4); // dec d
  if (regs.fNZ) { m.step(0x1bf2, 10); return entry_1bf2(m, X); } // jp nz
  m.step(0x1bcc, 5);
  mem.write8(X(0x10), 0x00);
  m.step(0x1bd0, 19); // ld (ix+0x10),0x00
  mem.write8(X(0x11), 0x80);
  m.step(0x1bd4, 19); // ld (ix+0x11),0x80
  mem.write8(X(0x07), regs.set(7, mem.read8(X(0x07))));
  m.step(0x1bd8, 23); // set 7,(ix+0x07)
  return loc_1bd8(m, X);
}

/** entry_1bf2 (0x1BF2-0x1C04): D-nonzero branch of loc_1bb2. */
function entry_1bf2(m, X) {
  const { regs, mem } = m;
  regs.e = regs.dec8(regs.e);
  m.step(0x1bf3, 4); // dec e
  if (regs.fNZ) { m.step(0x1c05, 10); return entry_1c05(m, X); } // jp nz
  m.step(0x1bf6, 5);
  mem.write8(X(0x10), 0xff);
  m.step(0x1bfa, 19); // ld (ix+0x10),0xff
  mem.write8(X(0x11), 0x80);
  m.step(0x1bfe, 19); // ld (ix+0x11),0x80
  mem.write8(X(0x07), regs.res(7, mem.read8(X(0x07))));
  m.step(0x1c02, 23); // res 7,(ix+0x07)
  m.step(0x1bd8, 10); // jp 0x1bd8
  return loc_1bd8(m, X);
}

/** loc_1bd8 (0x1BD8-0x1BF1): landing target via 2407, gravity via 239c. */
function loc_1bd8(m, X) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6220);
  m.step(0x1bdb, 13); // ld a,(0x6220)
  regs.a = regs.dec8(regs.a);
  m.step(0x1bdc, 4); // dec a
  if (regs.fZ) { m.step(0x1bec, 10); return loc_1bec(m, X); } // jp z
  m.step(0x1bdf, 5);
  m.push16(0x1be2);
  m.step(0x2407, 17); // call 0x2407
  sub_2407(m); // returns HL (fixed-point)
  mem.write8(X(0x12), regs.h);
  m.step(0x1be5, 19); // ld (ix+0x12),h
  mem.write8(X(0x13), regs.l);
  m.step(0x1be8, 19); // ld (ix+0x13),l
  mem.write8(X(0x14), 0x00);
  m.step(0x1bec, 19); // ld (ix+0x14),0x00
  return loc_1bec(m, X);
}

/** loc_1bec (0x1BEC-0x1BF1): gravity via 239c, then jp into the 1c05 dispatch. */
function loc_1bec(m, X) {
  m.push16(0x1bef);
  m.step(0x239c, 17); // call 0x239c
  sub_239c(m);
  m.step(0x1c05, 10); // jp 0x1c05
  return entry_1c05(m, X);
}

/** entry_1c05 (0x1C05-0x1C32): 2b1c dispatch + the LIVE 0x1C23 block. */
function entry_1c05(m, X) {
  const { regs, mem } = m;
  m.push16(0x1c08);
  m.step(0x2b1c, 17); // call 0x2b1c
  entry_2b1c(m); // returns A (0x1C08 always resumes here)
  regs.a = regs.dec8(regs.a);
  m.step(0x1c09, 4); // dec a
  if (regs.fZ) { m.step(0x1c3a, 10); return loc_1c3a(m); } // jp z
  m.step(0x1c0c, 10);
  regs.a = mem.read8(0x621f);
  m.step(0x1c0f, 13); // ld a,(0x621f)
  regs.a = regs.dec8(regs.a);
  m.step(0x1c10, 4); // dec a
  if (regs.fZ) { m.step(0x1c76, 10); return entry_1c76(m); } // jp z
  m.step(0x1c13, 10);
  regs.a = mem.read8(0x6214);
  m.step(0x1c16, 13); // ld a,(0x6214)
  regs.sub(0x14);
  m.step(0x1c18, 7); // sub 0x14
  if (regs.fNZ) { m.step(0x1c33, 10); return loc_1c33(m); } // jp nz
  m.step(0x1c1b, 5);
  regs.a = 0x01;
  m.step(0x1c1d, 7); // ld a,0x01
  mem.write8(0x621f, regs.a);
  m.step(0x1c20, 13); // ld (0x621f),a
  m.push16(0x1c23);
  m.step(0x2853, 17); // call 0x2853 (returns normally)
  entry_2853(m);
  // ---- 0x1C23-0x1C32: LIVE CODE hidden as `defb UNREACHED` in the listing ----
  regs.and(regs.a); // A = sub_2853's return (from the 3e88 dispatch target)
  m.step(0x1c24, 4); // and a
  if (regs.fZ) { m.step(0x1da6, 10); return entry_1da6(m); } // jp z,0x1da6
  m.step(0x1c27, 10);
  mem.write8(0x6342, regs.a);
  m.step(0x1c2a, 13); // ld (0x6342),a
  regs.a = 0x01;
  m.step(0x1c2c, 7); // ld a,0x01
  mem.write8(0x6340, regs.a);
  m.step(0x1c2f, 13); // ld (0x6340),a
  mem.write8(0x6225, regs.a);
  m.step(0x1c32, 13); // ld (0x6225),a
  m.step(0x1c33, 4); // nop @ 0x1C32, fall into loc_1c33
  return loc_1c33(m);
}

/** loc_1c33 (0x1C33-0x1C39): inc a; if wrapped to 0 call 2954; tail-jump 0x1da6. */
function loc_1c33(m) {
  const { regs } = m;
  regs.a = regs.inc8(regs.a);
  m.step(0x1c34, 4); // inc a
  if (regs.fZ) {
    m.push16(0x1c37);
    m.step(0x2954, 17); // call z,0x2954
    entry_2954(m);
  } else {
    m.step(0x1c37, 10); // call z NOT taken
  }
  m.step(0x1da6, 10); // jp 0x1da6
  return entry_1da6(m);
}

/** loc_1c3a (0x1C3A-0x1C4E): B==1 -> entry_1c4f; else advance 0x621f, clear the
 *  5-byte jump record (djnz), tail-jump 0x1da6. */
function loc_1c3a(m) {
  const { regs, mem } = m;
  regs.b = regs.dec8(regs.b);
  m.step(0x1c3b, 4); // dec b
  if (regs.fZ) { m.step(0x1c4f, 10); return entry_1c4f(m); } // jp z
  m.step(0x1c3e, 10);
  regs.a = regs.inc8(regs.a);
  m.step(0x1c3f, 4); // inc a
  mem.write8(0x621f, regs.a);
  m.step(0x1c42, 13); // ld (0x621f),a
  regs.xor(regs.a);
  m.step(0x1c43, 4); // xor a
  regs.hl = 0x6210;
  m.step(0x1c46, 10); // ld hl,0x6210
  regs.b = 0x05;
  m.step(0x1c48, 7); // ld b,0x05
  do {
    // loc_1c48 clear loop, B=5
    mem.write8(regs.hl, regs.a);
    m.step(0x1c49, 7); // ld (hl),a
    regs.l = regs.inc8(regs.l);
    m.step(0x1c4a, 4); // inc l
    regs.b = (regs.b - 1) & 0xff; // djnz -- no flags
    m.step(regs.b !== 0 ? 0x1c48 : 0x1c4c, regs.b !== 0 ? 13 : 8); // djnz 0x1c48
  } while (regs.b !== 0);
  m.step(0x1da6, 10); // jp 0x1da6
  return entry_1da6(m);
}

/** entry_1c4f (0x1C4F-0x1C75): reset to state 0, arm the 0x621E lock, sound frontier. */
function entry_1c4f(m) {
  const { regs, mem } = m;
  mem.write8(0x6216, regs.a); // A = 0 (from the dec b path)
  m.step(0x1c52, 13); // ld (0x6216),a
  regs.a = mem.read8(0x6220);
  m.step(0x1c55, 13); // ld a,(0x6220)
  regs.xor(0x01);
  m.step(0x1c57, 7); // xor 0x01
  mem.write8(0x6200, regs.a);
  m.step(0x1c5a, 13); // ld (0x6200),a
  regs.hl = 0x6207;
  m.step(0x1c5d, 10); // ld hl,0x6207
  regs.a = mem.read8(regs.hl);
  m.step(0x1c5e, 7); // ld a,(hl)
  regs.and(0x80);
  m.step(0x1c60, 7); // and 0x80
  regs.or(0x0f);
  m.step(0x1c62, 7); // or 0x0f
  mem.write8(regs.hl, regs.a);
  m.step(0x1c63, 7); // ld (hl),a
  regs.a = 0x04;
  m.step(0x1c65, 7); // ld a,0x04
  mem.write8(0x621e, regs.a); // arm the lock (loc_1b55 counts it down)
  m.step(0x1c68, 13); // ld (0x621e),a
  regs.xor(regs.a);
  m.step(0x1c69, 4); // xor a
  mem.write8(0x621f, regs.a);
  m.step(0x1c6c, 13); // ld (0x621f),a
  regs.a = mem.read8(0x6225);
  m.step(0x1c6f, 13); // ld a,(0x6225)
  regs.a = regs.dec8(regs.a);
  m.step(0x1c70, 4); // dec a
  if (regs.fZ) {
    m.push16(0x1c73); // call z,0x1d95 taken -- pushes return address
    m.step(0x1d95, 17);
    sub_1d95(m);
  } else {
    m.step(0x1c73, 10); // call z NOT taken
  }
  m.step(0x1da6, 10); // jp 0x1da6
  return entry_1da6(m);
}

/** sub_1d95 -- ROM 0x1D95-0x1DA5. entry_1c4f call-z target (0x6225==1). A live-in.
 *  Stores A->0x6225; unless 0x6227==1, sets 0x608A=0x0D / 0x608B=0x03. */
export function sub_1d95(m) {
  const { regs, mem } = m;
  mem.write8(0x6225, regs.a);
  m.step(0x1d98, 13); // ld (0x6225),a
  regs.a = mem.read8(0x6227);
  m.step(0x1d9b, 13); // ld a,(0x6227)
  regs.a = regs.dec8(regs.a);
  m.step(0x1d9c, 4); // dec a
  if (regs.fZ) { m.ret(11); return; } // ret z -- 0x6227 == 1
  m.step(0x1d9d, 5);
  regs.hl = 0x608a;
  m.step(0x1da0, 10); // ld hl,0x608a
  mem.write8(regs.hl, 0x0d);
  m.step(0x1da2, 10); // ld (hl),0x0d
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x1da3, 4); // inc l
  mem.write8(regs.hl, 0x03);
  m.step(0x1da5, 10); // ld (hl),0x03
  m.ret(10); // 0x1DA5
}

/** entry_1c76 (0x1C76-0x1C8E): landed-check; set 0x6220, sound; tail-jump 0x1da6. */
function entry_1c76(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6205);
  m.step(0x1c79, 13); // ld a,(0x6205)
  regs.hl = 0x620e;
  m.step(0x1c7c, 10); // ld hl,0x620e
  regs.sub(0x0f);
  m.step(0x1c7e, 7); // sub 0x0f
  regs.cp(mem.read8(regs.hl));
  m.step(0x1c7f, 7); // cp (hl)
  if (regs.fC) { m.step(0x1da6, 10); return entry_1da6(m); } // jp c
  m.step(0x1c82, 10);
  regs.a = 0x01;
  m.step(0x1c84, 7); // ld a,0x01
  mem.write8(0x6220, regs.a);
  m.step(0x1c87, 13); // ld (0x6220),a
  regs.hl = 0x6084;
  m.step(0x1c8a, 10); // ld hl,0x6084
  mem.write8(regs.hl, 0x03);
  m.step(0x1c8c, 10); // ld (hl),0x03
  m.step(0x1da6, 10); // jp 0x1da6
  return entry_1da6(m);
}

/** loc_1c8f (0x1C8F-0x1CAA): MOVE +dir. Twin of loc_1cab: B=+1, 3009 arg=0x05,
 *  extra `or 0x80`. Shares loc_1cc2. */
function loc_1c8f(m) {
  const { regs, mem } = m;
  regs.b = 0x01; // +1 delta
  m.step(0x1c91, 7); // ld b,0x01
  regs.a = mem.read8(0x620f); // jump phase
  m.step(0x1c94, 13); // ld a,(0x620f)
  regs.and(regs.a);
  m.step(0x1c95, 4); // and a
  if (regs.fNZ) { m.step(0x1cd2, 10); return loc_1cd2(m); } // jp nz -- already moving
  m.step(0x1c98, 10);
  regs.a = mem.read8(0x6202); // facing
  m.step(0x1c9b, 13); // ld a,(0x6202)
  regs.b = regs.a;
  m.step(0x1c9c, 4); // ld b,a
  regs.a = 0x05; // 3009 arg (differs from loc_1cab's 0x01)
  m.step(0x1c9e, 7); // ld a,0x05
  m.push16(0x1ca1);
  m.step(0x3009, 17); // call 0x3009
  entry_3009(m); // returns A (new facing)
  mem.write8(0x6202, regs.a);
  m.step(0x1ca4, 13); // ld (0x6202),a
  regs.and(0x03);
  m.step(0x1ca6, 7); // and 0x03
  regs.or(0x80); // <-- the extra step loc_1cab does NOT have
  m.step(0x1ca8, 7); // or 0x80
  m.step(0x1cc2, 10); // jp 0x1cc2
  return loc_1cc2(m);
}

/** loc_1cab (0x1CAB-0x1CC1): MOVE -dir. Twin of loc_1c8f: B=0xFF, 3009 arg=0x01,
 *  NO `or 0x80`. Shares loc_1cc2. */
function loc_1cab(m) {
  const { regs, mem } = m;
  regs.b = 0xff; // -1 delta
  m.step(0x1cad, 7); // ld b,0xff
  regs.a = mem.read8(0x620f);
  m.step(0x1cb0, 13); // ld a,(0x620f)
  regs.and(regs.a);
  m.step(0x1cb1, 4); // and a
  if (regs.fNZ) { m.step(0x1cd2, 10); return loc_1cd2(m); } // jp nz
  m.step(0x1cb4, 10);
  regs.a = mem.read8(0x6202);
  m.step(0x1cb7, 13); // ld a,(0x6202)
  regs.b = regs.a;
  m.step(0x1cb8, 4); // ld b,a
  regs.a = 0x01; // 3009 arg (differs from loc_1c8f's 0x05)
  m.step(0x1cba, 7); // ld a,0x01
  m.push16(0x1cbd);
  m.step(0x3009, 17); // call 0x3009
  entry_3009(m);
  mem.write8(0x6202, regs.a);
  m.step(0x1cc0, 13); // ld (0x6202),a
  regs.and(0x03); // NO or 0x80 -- falls into loc_1cc2
  m.step(0x1cc2, 7); // and 0x03
  return loc_1cc2(m);
}

/** loc_1cc2 (0x1CC2-0x1CD1): shared move tail. Store facing, bit0 -> sound 1d8f. */
function loc_1cc2(m) {
  const { regs, mem } = m;
  regs.hl = 0x6207;
  m.step(0x1cc5, 10); // ld hl,0x6207
  mem.write8(regs.hl, regs.a);
  m.step(0x1cc6, 7); // ld (hl),a
  regs.rra(); // facing bit 0 -> carry
  m.step(0x1cc7, 4); // rra
  if (regs.fC) {
    m.push16(0x1cca);
    m.step(0x1d8f, 17); // call c,0x1d8f
    sub_1d8f(m);
  } else {
    m.step(0x1cca, 10); // call c NOT taken
  }
  regs.a = 0x02;
  m.step(0x1ccc, 7); // ld a,0x02
  mem.write8(0x620f, regs.a);
  m.step(0x1ccf, 13); // ld (0x620f),a
  m.step(0x1da6, 10); // jp 0x1da6
  return entry_1da6(m);
}

/** loc_1cd2 (0x1CD2-0x1CF1): apply movement (0x6203 += B, signed); 0x6227 clamp. */
function loc_1cd2(m) {
  const { regs, mem } = m;
  regs.hl = 0x6203; // player X
  m.step(0x1cd5, 10); // ld hl,0x6203
  regs.a = mem.read8(regs.hl);
  m.step(0x1cd6, 7); // ld a,(hl)
  regs.add(regs.b); // signed: B = +1 / -1 / 0xFF
  m.step(0x1cd7, 4); // add a,b
  mem.write8(regs.hl, regs.a);
  m.step(0x1cd8, 7); // ld (hl),a
  regs.a = mem.read8(0x6227);
  m.step(0x1cdb, 13); // ld a,(0x6227)
  regs.a = regs.dec8(regs.a);
  m.step(0x1cdc, 4); // dec a
  if (regs.fNZ) { m.step(0x1ceb, 10); return loc_1ceb(m); } // jp nz
  m.step(0x1cdf, 5);
  regs.h = mem.read8(regs.hl); // ld h,(hl) -- HL=0x6203, H = (0x6203)
  m.step(0x1ce0, 7); // ld h,(hl)
  regs.a = mem.read8(0x6205);
  m.step(0x1ce3, 13); // ld a,(0x6205)
  regs.l = regs.a; // HL = ((0x6203)<<8)|(0x6205)
  m.step(0x1ce4, 4); // ld l,a
  m.push16(0x1ce7);
  m.step(0x2333, 17); // call 0x2333
  entry_2333(m); // clamp; returns L
  regs.a = regs.l;
  m.step(0x1ce8, 4); // ld a,l
  mem.write8(0x6205, regs.a);
  m.step(0x1ceb, 13); // ld (0x6205),a
  return loc_1ceb(m);
}

/** loc_1ceb (0x1CEB-0x1CF1): dec (0x620f) jump-phase, tail-jump 0x1da6. */
function loc_1ceb(m) {
  const { regs, mem } = m;
  regs.hl = 0x620f;
  m.step(0x1cee, 10); // ld hl,0x620f
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x1cef, 11); // dec (hl)
  m.step(0x1da6, 10); // jp 0x1da6
  return entry_1da6(m);
}

/** loc_1cf2 (0x1CF2-0x1D02): jump-phase handler. nonzero -> 0x1d8a; else jp 0x1d11. */
function loc_1cf2(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x620f);
  m.step(0x1cf5, 13); // ld a,(0x620f)
  regs.and(regs.a);
  m.step(0x1cf6, 4); // and a
  if (regs.fNZ) { m.step(0x1d8a, 10); return entry_1d8a(m); } // jp nz -- external
  m.step(0x1cf9, 5);
  regs.a = 0x03;
  m.step(0x1cfb, 7); // ld a,0x03
  mem.write8(0x620f, regs.a);
  m.step(0x1cfe, 13); // ld (0x620f),a
  regs.a = 0x02;
  m.step(0x1d00, 7); // ld a,0x02
  m.step(0x1d11, 10); // jp 0x1d11 -- external (extent boundary)
  return loc_1d11(m);
}

/**
 * sub_1f72 <-> loc_21ba SCC -- OBJECT DISPATCH + the shared object-sprite tail.
 * ROM 0x1F72-0x2117 (1f72) + 0x2118-0x216A + 0x21BA-0x21D0 (the 0x21xx cluster).
 * Integrated TOGETHER (mutual recursion: loc_21ba's `jp 0x1f8d` re-enters 1f72's
 * loop; 1f72's branches `jp 0x21ba` reach the shared tail).
 *
 * Not yet wired into the live dispatcher: called from loc_197a @0x1983 (handler_1977
 * cascade, untranslated); nothing in translated src invokes sub_1f72 / the 21xx
 * cluster. Goes live at the finale (step 4).
 *
 * sub_1f72 scans 10 object slots @0x6700 (stride 0x20), and for each state-1 slot
 * dispatches on (ix+1)/(ix+2) bits to one of FIVE `exx` handlers. Runs only on
 * (0x6227)==1. The loop is modelled as FUNCTIONS (loc_1f83 slot-check / loc_1f8d
 * advance) -- NOT a do-while -- precisely so loc_21ba can re-enter at 0x1f8d.
 *
 * ** exx IS A PROJECT-FIRST ** (first executable use of the shadow register file).
 * regs.exx() swaps EXACTLY BC/DE/HL, leaves AF/IX/IY/SP untouched -- so after exx
 * `(ix+d)` still uses the MAIN ix. The five branches exx into the shadow to do
 * their work and `jp 0x21ba` WITHOUT unswapping; loc_21ba's LEADING exx
 * is the downstream unswap that restores the loop's main set (HL/IX/DE/B) for
 * 0x1f8d -- a register-state contract on all 13 entries, modelled
 * LITERALLY, never special-cased per caller. loc_1f8d / loc_1fce are shared entry
 * points tail-reached from 0x21CE / 0x210B -- their layout is load-bearing.
 * Object fields not interpreted.
 */
export function sub_1f72(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6227);
  m.step(0x1f75, 13); // ld a,(0x6227)
  regs.a = regs.dec8(regs.a);
  m.step(0x1f76, 4); // dec a
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- not phase 1
  m.step(0x1f77, 5);
  regs.ix = 0x6700;
  m.step(0x1f7b, 14); // ld ix,0x6700
  regs.hl = 0x6980;
  m.step(0x1f7e, 10); // ld hl,0x6980
  regs.de = 0x0020; // slot stride (LOCAL, not live-in)
  m.step(0x1f81, 10); // ld de,0x0020
  regs.b = 0x0a; // 10 slots
  m.step(0x1f83, 7); // ld b,0x0a
  return loc_1f83(m);
}

/** loc_1f83 (0x1F83): per-slot state check. active (==1) -> loc_1f93; else skip
 *  the slot's 4 buffer bytes and advance. */
function loc_1f83(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(R(0x00));
  m.step(0x1f86, 19); // ld a,(ix+0x00)
  regs.a = regs.dec8(regs.a);
  m.step(0x1f87, 4); // dec a
  if (regs.fZ) { m.step(0x1f93, 10); return loc_1f93(m); } // jp z -- active slot
  m.step(0x1f8a, 10); // jp z NOT taken
  regs.l = regs.inc8(regs.l);
  m.step(0x1f8b, 4); // inc l
  regs.l = regs.inc8(regs.l);
  m.step(0x1f8c, 4); // inc l
  regs.l = regs.inc8(regs.l);
  m.step(0x1f8d, 4); // inc l (3rd; loc_1f8d is the 4th, below)
  return loc_1f8d(m);
}

/** loc_1f8d (0x1F8D-0x1F92): 4th inc l + loop advance. SHARED ENTRY from loc_21ba
 *  (0x21CE jp 0x1f8d) -- the SCC continuation. */
function loc_1f8d(m) {
  const { regs } = m;
  regs.l = regs.inc8(regs.l);
  m.step(0x1f8e, 4); // inc l (4th; 0x1F8D external entry lands here)
  regs.addIx(regs.de);
  m.step(0x1f90, 15); // add ix,de
  regs.b = (regs.b - 1) & 0xff; // djnz -- no flags
  if (regs.b !== 0) { m.step(0x1f83, 13); return loc_1f83(m); } // djnz 0x1f83 taken
  m.step(0x1f92, 8); // djnz NOT taken
  m.ret(10); // 0x1F92
}

/** loc_1f93: active-slot dispatch on (ix+1)/(ix+2). All targets are exx branches. */
function loc_1f93(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(R(0x01));
  m.step(0x1f96, 19); // ld a,(ix+0x01)
  regs.a = regs.dec8(regs.a);
  m.step(0x1f97, 4); // dec a
  if (regs.fZ) { m.step(0x20ec, 10); return branch_20ec(m); } // jp z -- exx @0x20EC
  m.step(0x1f9a, 10);
  regs.a = mem.read8(R(0x02));
  m.step(0x1f9d, 19); // ld a,(ix+0x02)
  regs.rra(); // bit 0 -> carry
  m.step(0x1f9e, 4); // rra
  if (regs.fC) { m.step(0x1fac, 10); return branch_1fac(m); } // jp c -- exx @0x1FAC
  m.step(0x1fa1, 10);
  regs.rra(); // bit 1
  m.step(0x1fa2, 4); // rra
  if (regs.fC) { m.step(0x1fe5, 10); return branch_1fe5(m); } // jp c -- exx @0x1FE5
  m.step(0x1fa5, 10);
  regs.rra(); // bit 2
  m.step(0x1fa6, 4); // rra
  if (regs.fC) { m.step(0x1fef, 10); return branch_1fef(m); } // jp c -- exx @0x1FEF
  m.step(0x1fa9, 10);
  m.step(0x2053, 10); // jp 0x2053 -- exx @0x2053
  return branch_2053(m);
}

/** branch_1fac (0x1FAC-0x1FE4): exx; animate -- advance (ix+5); on (ix+17)==(ix+5)
 *  recompute sprite; else step (ix+0f). Both jp 0x21ba. */
function branch_1fac(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.exx(); // swap to shadow BC/DE/HL (IX untouched)
  m.step(0x1fad, 4); // exx
  mem.write8(R(0x05), regs.inc8(mem.read8(R(0x05))));
  m.step(0x1fb0, 23); // inc (ix+0x05)
  regs.a = mem.read8(R(0x17));
  m.step(0x1fb3, 19); // ld a,(ix+0x17)
  regs.cp(mem.read8(R(0x05)));
  m.step(0x1fb6, 19); // cp (ix+0x05)
  if (regs.fNZ) { m.step(0x1fce, 10); return loc_1fce(m); } // jp nz -- shared tail
  m.step(0x1fb9, 10);
  regs.a = mem.read8(R(0x15));
  m.step(0x1fbc, 19); // ld a,(ix+0x15)
  regs.rlca();
  m.step(0x1fbd, 4); // rlca
  regs.rlca();
  m.step(0x1fbe, 4); // rlca
  regs.add(0x15);
  m.step(0x1fc0, 7); // add a,0x15
  mem.write8(R(0x07), regs.a);
  m.step(0x1fc3, 19); // ld (ix+0x07),a
  regs.a = mem.read8(R(0x02));
  m.step(0x1fc6, 19); // ld a,(ix+0x02)
  regs.xor(0x07);
  m.step(0x1fc8, 7); // xor 0x07
  mem.write8(R(0x02), regs.a);
  m.step(0x1fcb, 19); // ld (ix+0x02),a
  m.step(0x21ba, 10); // jp 0x21ba
  return loc_21ba(m);
}

/** loc_1fce (0x1FCE-0x1FE4): the (ix+17)!=(ix+5) tail. ALSO the SHARED ENTRY tail-
 *  reached from 0x210B. Steps (ix+0f); on expiry toggles (ix+7), reloads =4. */
function loc_1fce(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(R(0x0f));
  m.step(0x1fd1, 19); // ld a,(ix+0x0f)
  regs.a = regs.dec8(regs.a);
  m.step(0x1fd2, 4); // dec a
  if (regs.fNZ) {
    m.step(0x1fdf, 10); // jp nz,0x1fdf -- skip the reload
  } else {
    m.step(0x1fd5, 10);
    regs.a = mem.read8(R(0x07));
    m.step(0x1fd8, 19); // ld a,(ix+0x07)
    regs.xor(0x01);
    m.step(0x1fda, 7); // xor 0x01
    mem.write8(R(0x07), regs.a);
    m.step(0x1fdd, 19); // ld (ix+0x07),a
    regs.a = 0x04;
    m.step(0x1fdf, 7); // ld a,0x04
  }
  mem.write8(R(0x0f), regs.a);
  m.step(0x1fe2, 19); // ld (ix+0x0f),a
  m.step(0x21ba, 10); // jp 0x21ba
  return loc_21ba(m);
}

/** branch_1fe5 (0x1FE5-0x1FEC): exx; +X velocity BC=0x0100, inc (ix+3); jp shared_1ff6. */
function branch_1fe5(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.exx();
  m.step(0x1fe6, 4); // exx
  regs.bc = 0x0100; // shadow BC scratch
  m.step(0x1fe9, 10); // ld bc,0x0100
  mem.write8(R(0x03), regs.inc8(mem.read8(R(0x03))));
  m.step(0x1fec, 23); // inc (ix+0x03)
  m.step(0x1ff6, 10); // jp 0x1ff6
  return shared_1ff6(m);
}

/** branch_1fef (0x1FEF-0x1FF5): exx; -X velocity BC=0xff04, dec (ix+3); FALLS INTO
 *  shared_1ff6. Twin of branch_1fe5 (BC sign, inc vs dec). */
function branch_1fef(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.exx();
  m.step(0x1ff0, 4); // exx
  regs.bc = 0xff04; // -X
  m.step(0x1ff3, 10); // ld bc,0xff04
  mem.write8(R(0x03), regs.dec8(mem.read8(R(0x03))));
  m.step(0x1ff6, 23); // dec (ix+0x03)
  return shared_1ff6(m);
}

/** shared_1ff6 (0x1FF6-0x2052): tail of branch_1fe5/1fef. On (H&7)==3 -> loc_215f;
 *  else clamp via 0x2333, write (ix+5), run 23de/24b4, and set the velocity record. */
function shared_1ff6(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.h = mem.read8(R(0x03));
  m.step(0x1ff9, 19); // ld h,(ix+0x03)
  regs.l = mem.read8(R(0x05));
  m.step(0x1ffc, 19); // ld l,(ix+0x05)
  regs.a = regs.h;
  m.step(0x1ffd, 4); // ld a,h
  regs.and(0x07);
  m.step(0x1fff, 7); // and 0x07
  regs.cp(0x03);
  m.step(0x2001, 7); // cp 0x03
  if (regs.fZ) { m.step(0x215f, 10); return loc_215f(m); } // jp z -- 21xx cluster
  m.step(0x2004, 10);
  regs.l = regs.dec8(regs.l);
  m.step(0x2005, 4); // dec l
  regs.l = regs.dec8(regs.l);
  m.step(0x2006, 4); // dec l
  regs.l = regs.dec8(regs.l);
  m.step(0x2007, 4); // dec l
  m.push16(0x200a);
  m.step(0x2333, 17); // call 0x2333
  entry_2333(m); // clamp; returns L
  regs.l = regs.inc8(regs.l);
  m.step(0x200b, 4); // inc l
  regs.l = regs.inc8(regs.l);
  m.step(0x200c, 4); // inc l
  regs.l = regs.inc8(regs.l);
  m.step(0x200d, 4); // inc l
  regs.a = regs.l;
  m.step(0x200e, 4); // ld a,l
  mem.write8(R(0x05), regs.a);
  m.step(0x2011, 19); // ld (ix+0x05),a
  m.push16(0x2014);
  m.step(0x23de, 17); // call 0x23de
  sub_23de(m);
  m.push16(0x2017);
  m.step(0x24b4, 17); // call 0x24b4
  if (!entry_24b4(m)) return; // skip-capable: spliced to 21ba/loop -> do NOT continue inline
  regs.a = mem.read8(R(0x03));
  m.step(0x201a, 19); // ld a,(ix+0x03)
  regs.cp(0x1c);
  m.step(0x201c, 7); // cp 0x1c
  if (regs.fC) { m.step(0x202f, 10); return shared_202f(m); } // jp c -- low X
  m.step(0x201f, 10);
  regs.cp(0xe4);
  m.step(0x2021, 7); // cp 0xe4
  if (regs.fC) { m.step(0x21ba, 10); return loc_21ba(m); } // jp c -- mid X, done
  m.step(0x2024, 10);
  regs.xor(regs.a); // A = 0
  m.step(0x2025, 4); // xor a
  mem.write8(R(0x10), regs.a);
  m.step(0x2028, 19); // ld (ix+0x10),a
  mem.write8(R(0x11), 0x60);
  m.step(0x202c, 19); // ld (ix+0x11),0x60
  m.step(0x2038, 10); // jp 0x2038
  return shared_2038(m);
}

/** shared_202f (0x202F-0x2037): the low-X (jp c) velocity variant. */
function shared_202f(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.xor(regs.a); // A = 0
  m.step(0x2030, 4); // xor a
  mem.write8(R(0x10), 0xff);
  m.step(0x2034, 19); // ld (ix+0x10),0xff
  mem.write8(R(0x11), 0xa0);
  m.step(0x2038, 19); // ld (ix+0x11),0xa0
  return shared_2038(m);
}

/** shared_2038 (0x2038-0x2052): the common velocity/sprite record write. A=0. */
function shared_2038(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  mem.write8(R(0x12), 0xff);
  m.step(0x203c, 19); // ld (ix+0x12),0xff
  mem.write8(R(0x13), 0xf0);
  m.step(0x2040, 19); // ld (ix+0x13),0xf0
  mem.write8(R(0x14), regs.a);
  m.step(0x2043, 19); // ld (ix+0x14),a  (A=0)
  mem.write8(R(0x0e), regs.a);
  m.step(0x2046, 19); // ld (ix+0x0e),a
  mem.write8(R(0x04), regs.a);
  m.step(0x2049, 19); // ld (ix+0x04),a
  mem.write8(R(0x06), regs.a);
  m.step(0x204c, 19); // ld (ix+0x06),a
  mem.write8(R(0x02), 0x08);
  m.step(0x2050, 19); // ld (ix+0x02),0x08
  m.step(0x21ba, 10); // jp 0x21ba
  return loc_21ba(m);
}

/** branch_2053 (0x2053-0x20E9): exx; ACTIVE-MOVEMENT. 239c gravity, 2a2f collision,
 *  then an (ix+3) bounds ladder and an (ix+0e) sub-state dispatch. */
function branch_2053(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.exx();
  m.step(0x2054, 4); // exx
  m.push16(0x2057);
  m.step(0x239c, 17); // call 0x239c
  sub_239c(m);
  m.push16(0x205a);
  m.step(0x2a2f, 17); // call 0x2a2f
  sub_2a2f(m); // returns A
  regs.and(regs.a);
  m.step(0x205b, 4); // and a
  if (regs.fNZ) { m.step(0x2083, 10); return sub_2083(m); } // jp nz -- sub-state
  m.step(0x205e, 10);
  regs.a = mem.read8(R(0x03));
  m.step(0x2061, 19); // ld a,(ix+0x03)
  regs.add(0x08);
  m.step(0x2063, 7); // add a,0x08
  regs.cp(0x10);
  m.step(0x2065, 7); // cp 0x10
  if (regs.fC) { m.step(0x2079, 10); return sub_2079(m); } // jp c
  m.step(0x2068, 10);
  m.push16(0x206b);
  m.step(0x24b4, 17); // call 0x24b4
  if (!entry_24b4(m)) return; // skip-capable: spliced to 21ba/loop -> do NOT continue inline
  regs.a = mem.read8(R(0x10));
  m.step(0x206e, 19); // ld a,(ix+0x10)
  regs.and(0x01);
  m.step(0x2070, 7); // and 0x01
  regs.rlca();
  m.step(0x2071, 4); // rlca
  regs.rlca();
  m.step(0x2072, 4); // rlca
  regs.c = regs.a;
  m.step(0x2073, 4); // ld c,a
  m.push16(0x2076);
  m.step(0x23de, 17); // call 0x23de
  sub_23de(m);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2076, 6); // inc hl
  m.step(0x21ba, 10); // jp 0x21ba
  return loc_21ba(m);
}

/** sub_2079 (0x2079-0x2082): (ix+3)+8 < 0x10 -- deactivate the slot. */
function sub_2079(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.xor(regs.a);
  m.step(0x207a, 4); // xor a
  mem.write8(R(0x00), regs.a);
  m.step(0x207d, 19); // ld (ix+0x00),a
  mem.write8(R(0x03), regs.a);
  m.step(0x2080, 19); // ld (ix+0x03),a
  m.step(0x21ba, 10); // jp 0x21ba
  return loc_21ba(m);
}

/** sub_2083 (0x2083-0x20E9): the 2a2f-nonzero sub-state machine on (ix+0e). */
function sub_2083(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  mem.write8(R(0x0e), regs.inc8(mem.read8(R(0x0e))));
  m.step(0x2086, 23); // inc (ix+0x0e)
  regs.a = mem.read8(R(0x0e));
  m.step(0x2089, 19); // ld a,(ix+0x0e)
  regs.a = regs.dec8(regs.a);
  m.step(0x208a, 4); // dec a
  if (regs.fZ) { m.step(0x20a2, 10); return sub_20a2(m); } // jp z -- state 1
  m.step(0x208d, 10);
  regs.a = regs.dec8(regs.a);
  m.step(0x208e, 4); // dec a
  if (regs.fZ) { m.step(0x20c3, 10); return sub_20c3(m); } // jp z -- state 2
  m.step(0x2091, 10);
  regs.a = mem.read8(R(0x10));
  m.step(0x2094, 19); // ld a,(ix+0x10)
  regs.a = regs.dec8(regs.a);
  m.step(0x2095, 4); // dec a
  regs.a = 0x04;
  m.step(0x2097, 7); // ld a,0x04
  if (regs.fNZ) {
    m.step(0x209c, 10); // jp nz -- keep A=0x04
  } else {
    m.step(0x209a, 10);
    regs.a = 0x02;
    m.step(0x209c, 7); // ld a,0x02
  }
  mem.write8(R(0x02), regs.a);
  m.step(0x209f, 19); // ld (ix+0x02),a
  m.step(0x21ba, 10); // jp 0x21ba
  return loc_21ba(m);
}

/** sub_20a2 (0x20A2-0x20C2): state-1 -- proximity check (ix+15)/(0x6205). */
function sub_20a2(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(R(0x15));
  m.step(0x20a5, 19); // ld a,(ix+0x15)
  regs.and(regs.a);
  m.step(0x20a6, 4); // and a
  if (regs.fNZ) { m.step(0x20b5, 10); return sub_20b5(m); } // jp nz
  m.step(0x20a9, 10);
  regs.hl = 0x6205;
  m.step(0x20ac, 10); // ld hl,0x6205
  regs.a = mem.read8(R(0x05));
  m.step(0x20af, 19); // ld a,(ix+0x05)
  regs.sub(0x16);
  m.step(0x20b1, 7); // sub 0x16
  regs.cp(mem.read8(regs.hl));
  m.step(0x20b2, 7); // cp (hl)
  if (regs.fNC) { m.step(0x20c3, 10); return sub_20c3(m); } // jp nc
  m.step(0x20b5, 5);
  return sub_20b5(m);
}

/** sub_20b5 (0x20B5-0x20C2): sets the horizontal velocity sign into (ix+10/11). */
function sub_20b5(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(R(0x10));
  m.step(0x20b8, 19); // ld a,(ix+0x10)
  regs.and(regs.a);
  m.step(0x20b9, 4); // and a
  if (regs.fNZ) { m.step(0x20e1, 10); return sub_20e1(m); } // jp nz
  m.step(0x20bc, 10);
  mem.write8(R(0x11), regs.a); // A = 0
  m.step(0x20bf, 19); // ld (ix+0x11),a
  mem.write8(R(0x10), 0xff);
  m.step(0x20c3, 19); // ld (ix+0x10),0xff
  return sub_20c3(m);
}

/** sub_20c3 (0x20C3-0x20E0): 2407 (fixed-point), HL >>= 2 (srl h/rr l x2), store
 *  landing (ix+12/13), clear (ix+14/04/06). jp 0x21ba. */
function sub_20c3(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  m.push16(0x20c6);
  m.step(0x2407, 17); // call 0x2407
  sub_2407(m); // returns HL
  regs.h = regs.srl(regs.h);
  m.step(0x20c8, 8); // srl h
  regs.l = regs.rr(regs.l);
  m.step(0x20ca, 8); // rr l
  regs.h = regs.srl(regs.h);
  m.step(0x20cc, 8); // srl h
  regs.l = regs.rr(regs.l);
  m.step(0x20ce, 8); // rr l -- HL >>= 2
  mem.write8(R(0x12), regs.h);
  m.step(0x20d1, 19); // ld (ix+0x12),h
  mem.write8(R(0x13), regs.l);
  m.step(0x20d4, 19); // ld (ix+0x13),l
  regs.xor(regs.a);
  m.step(0x20d5, 4); // xor a
  mem.write8(R(0x14), regs.a);
  m.step(0x20d8, 19); // ld (ix+0x14),a
  mem.write8(R(0x04), regs.a);
  m.step(0x20db, 19); // ld (ix+0x04),a
  mem.write8(R(0x06), regs.a);
  m.step(0x20de, 19); // ld (ix+0x06),a
  m.step(0x21ba, 10); // jp 0x21ba
  return loc_21ba(m);
}

/** sub_20e1 (0x20E1-0x20EB): the (ix+10)!=0 velocity variant, then jp 0x20c3. */
function sub_20e1(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  mem.write8(R(0x10), 0x01);
  m.step(0x20e5, 19); // ld (ix+0x10),0x01
  mem.write8(R(0x11), 0x00);
  m.step(0x20e9, 19); // ld (ix+0x11),0x00
  m.step(0x20c3, 10); // jp 0x20c3
  return sub_20c3(m);
}

/** branch_20ec (0x20EC-0x2100): exx; 239c gravity; a proximity gate -> loc_2104;
 *  a 2a2f collision -> entry_2118; else fall into loc_2101. */
function branch_20ec(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.exx();
  m.step(0x20ed, 4); // exx
  m.push16(0x20f0);
  m.step(0x239c, 17); // call 0x239c
  sub_239c(m);
  regs.a = regs.h; // shadow H (post-exx)
  m.step(0x20f1, 4); // ld a,h
  regs.sub(0x1a);
  m.step(0x20f3, 7); // sub 0x1a
  regs.b = mem.read8(R(0x19));
  m.step(0x20f6, 19); // ld b,(ix+0x19)
  regs.cp(regs.b);
  m.step(0x20f7, 4); // cp b
  if (regs.fC) { m.step(0x2104, 10); return loc_2104(m); } // jp c -- INTERNAL
  m.step(0x20fa, 10);
  m.push16(0x20fd);
  m.step(0x2a2f, 17); // call 0x2a2f
  sub_2a2f(m); // returns A
  regs.and(regs.a);
  m.step(0x20fe, 4); // and a
  if (regs.fNZ) { m.step(0x2118, 10); return entry_2118(m); } // jp nz -- 21xx cluster
  m.step(0x2101, 5); // NOT taken -- falls into loc_2101 (was defb-hidden)
  return loc_2101(m);
}

/** loc_2101 (0x2101-0x2103): the 20ec branch tail (was `defb`-hidden). call 24b4,
 *  fall into loc_2104. */
function loc_2101(m) {
  m.push16(0x2104);
  m.step(0x24b4, 17); // call 0x24b4
  if (!entry_24b4(m)) return; // skip-capable: spliced to 21ba/loop -> do NOT continue inline
  return loc_2104(m);
}

/** loc_2104 (0x2104-0x2117): reached from loc_2101 AND from 0x20F7 (jp c). BOTH
 *  INTERNAL. bounds-check (ix+3)+8: >= 0x10 -> loc_1fce (0x210B); else deactivate. */
function loc_2104(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(R(0x03));
  m.step(0x2107, 19); // ld a,(ix+0x03)
  regs.add(0x08);
  m.step(0x2109, 7); // add a,0x08
  regs.cp(0x10);
  m.step(0x210b, 7); // cp 0x10
  if (regs.fNC) { m.step(0x1fce, 10); return loc_1fce(m); } // jp nc,0x1fce -- INTERNAL
  m.step(0x210e, 10);
  regs.xor(regs.a); // A = 0
  m.step(0x210f, 4); // xor a
  mem.write8(R(0x00), regs.a);
  m.step(0x2112, 19); // ld (ix+0x00),a -- deactivate slot
  mem.write8(R(0x03), regs.a);
  m.step(0x2115, 19); // ld (ix+0x03),a
  m.step(0x21ba, 10); // jp 0x21ba
  return loc_21ba(m);
}

/**
 * loc_21ba -- SHARED OBJECT-SPRITE TAIL.  ROM 0x21BA-0x21D0 (23 bytes).
 * 13 entries reach `jp 0x21ba` (9 exx'd from 1f72's branches, 4 non-exx'd from
 * loc_215f/entry_2118/0x24xx). Copies the 4 sprite fields (ix+3,7,8,5) -- OUT OF
 * ORDER, do not sort -- to the buffer HL, then jp 0x1f8d (1f72's loop advance).
 *
 * ** THE LEADING exx IS A CONTRACT: modelled LITERALLY. ** After
 * regs.exx() the loop's main set (HL buffer / IX obj / DE stride / B count) is
 * active for 0x1f8d, whatever the caller's entry state. NOT special-cased.
 */
export function loc_21ba(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.exx(); // Restores the loop main set for the 9 exx'd callers
  m.step(0x21bb, 4); // exx
  regs.a = mem.read8(R(0x03));
  m.step(0x21be, 19); // ld a,(ix+0x03)
  mem.write8(regs.hl, regs.a);
  m.step(0x21bf, 7); // ld (hl),a
  regs.l = regs.inc8(regs.l);
  m.step(0x21c0, 4); // inc l
  regs.a = mem.read8(R(0x07));
  m.step(0x21c3, 19); // ld a,(ix+0x07)
  mem.write8(regs.hl, regs.a);
  m.step(0x21c4, 7); // ld (hl),a
  regs.l = regs.inc8(regs.l);
  m.step(0x21c5, 4); // inc l
  regs.a = mem.read8(R(0x08));
  m.step(0x21c8, 19); // ld a,(ix+0x08)
  mem.write8(regs.hl, regs.a);
  m.step(0x21c9, 7); // ld (hl),a
  regs.l = regs.inc8(regs.l);
  m.step(0x21ca, 4); // inc l
  regs.a = mem.read8(R(0x05));
  m.step(0x21cd, 19); // ld a,(ix+0x05)
  mem.write8(regs.hl, regs.a);
  m.step(0x21ce, 7); // ld (hl),a -- (no inc l after the 4th)
  m.step(0x1f8d, 10); // jp 0x1f8d -- 1f72's loop continuation (SCC)
  return loc_1f8d(m);
}

/** loc_215f (0x215F-0x216A): set up (D=L+5, A=H, BC=0x15), call sub_216d, tail. */
export function loc_215f(m) {
  const { regs } = m;
  regs.a = regs.l;
  m.step(0x2160, 4); // ld a,l
  regs.add(0x05);
  m.step(0x2162, 7); // add a,0x05
  regs.d = regs.a; // D = L + 5
  m.step(0x2163, 4); // ld d,a
  regs.a = regs.h; // A = H
  m.step(0x2164, 4); // ld a,h
  regs.bc = 0x0015;
  m.step(0x2167, 10); // ld bc,0x0015
  m.push16(0x216a);
  m.step(0x216d, 17); // call 0x216d
  sub_216d(m); // may abort (216d hidden-exit); jp below runs on normal return
  m.step(0x21ba, 10); // jp 0x21ba -- NON-exx'd entry
  return loc_21ba(m);
}

/** entry_2118 (0x2118-0x215C): object velocity/sprite state setup -> shared tail. */
export function entry_2118(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(R(0x05));
  m.step(0x211b, 19); // ld a,(ix+0x05)
  regs.cp(0xe0);
  m.step(0x211d, 7); // cp 0xe0
  if (regs.fC) { m.step(0x2146, 10); return loc_2146(m); } // jp c
  m.step(0x2120, 10);
  regs.a = mem.read8(R(0x07));
  m.step(0x2123, 19); // ld a,(ix+0x07)
  regs.and(0xfc);
  m.step(0x2125, 7); // and 0xfc
  regs.or(0x01);
  m.step(0x2127, 7); // or 0x01
  mem.write8(R(0x07), regs.a);
  m.step(0x212a, 19); // ld (ix+0x07),a
  regs.xor(regs.a); // A = 0
  m.step(0x212b, 4); // xor a
  mem.write8(R(0x01), regs.a);
  m.step(0x212e, 19); // ld (ix+0x01),a
  mem.write8(R(0x02), regs.a);
  m.step(0x2131, 19); // ld (ix+0x02),a
  mem.write8(R(0x10), 0xff);
  m.step(0x2135, 19); // ld (ix+0x10),0xff
  mem.write8(R(0x11), regs.a);
  m.step(0x2138, 19); // ld (ix+0x11),a
  mem.write8(R(0x12), regs.a);
  m.step(0x213b, 19); // ld (ix+0x12),a
  mem.write8(R(0x13), 0xb0);
  m.step(0x213f, 19); // ld (ix+0x13),0xb0
  mem.write8(R(0x0e), 0x01);
  m.step(0x2143, 19); // ld (ix+0x0e),0x01
  m.step(0x2153, 10); // jp 0x2153
  return loc_2153(m);
}

/** loc_2146 (0x2146-0x2152): the (ix+5) < 0xE0 path -- 2407 + 22cb, snapshot (ix+5). */
function loc_2146(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  m.push16(0x2149);
  m.step(0x2407, 17); // call 0x2407
  sub_2407(m);
  m.push16(0x214c);
  m.step(0x22cb, 17); // call 0x22cb
  sub_22cb(m);
  regs.a = mem.read8(R(0x05));
  m.step(0x214f, 19); // ld a,(ix+0x05)
  mem.write8(R(0x19), regs.a);
  m.step(0x2152, 19); // ld (ix+0x19),a
  regs.xor(regs.a); // A = 0
  m.step(0x2153, 4); // xor a
  return loc_2153(m);
}

/** loc_2153 (0x2153-0x215C): clear (ix+14/04/06), tail. A = 0 on entry. */
function loc_2153(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  mem.write8(R(0x14), regs.a);
  m.step(0x2156, 19); // ld (ix+0x14),a
  mem.write8(R(0x04), regs.a);
  m.step(0x2159, 19); // ld (ix+0x04),a
  mem.write8(R(0x06), regs.a);
  m.step(0x215c, 19); // ld (ix+0x06),a
  m.step(0x21ba, 10); // jp 0x21ba
  return loc_21ba(m);
}

/**
 * entry_2853 -- SETUP + DISPATCH trampoline.  ROM 0x2853-0x286E (28 bytes).
 * Called from entry_1ac3 @ 0x1C20 (resolves spine-1's forward-ref).
 *
 *   2853  fd 21 00 62  ld   iy,0x6200
 *   2857  3a 05 62     ld   a,(0x6205)     ; player Y
 *   285a  c6 0c        add  a,0x0c
 *   285c  4f           ld   c,a            ; C = Y + 0x0C
 *   285d  3a 10 60     ld   a,(0x6010)     ; input
 *   2860  e6 03        and  0x03
 *   2862  21 08 05     ld   hl,0x0508      ; default parameter pair
 *   2865  ca 6b 28     jp   z,0x286b       ; (input&3)==0 -> keep 0x0508
 *   2868  21 08 13     ld   hl,0x1308      ; else pair 0x1308
 *   286b  cd 88 3e     call 0x3e88         ; the rst-28 dispatcher
 *  286e c9 ret ; the `defb`-hidden ret
 *
 * (named entry_2853 to match entry_1ac3's forward-ref; the draft used sub_2853).
 * Not yet wired into the live dispatcher: called only from entry_1ac3 @0x1C20.
 *
 * ** RETURNS NORMALLY ** via entry_3e88's BALANCED dispatch (and my
 * wave-1 entry_3e88 + 0x28xx targets all pop the pushed HL): the target's
 * `pop hl` matches 3e88's `push hl`, the rst consumes its own table pointer, and
 * the target's `ret` lands on 0x286E. NOT a caller-skip -- which is exactly why
 * entry_1ac3's 0x1C23 "UNREACHED" block is reached. IY/C/HL are dispatch
 * parameters for entry_3e88 (HL = 0x0508 for input dir 0, else 0x1308 -- the
 * collision-bound pair). Params/targets not interpreted.
 */
export function entry_2853(m) {
  const { regs, mem } = m;
  regs.iy = 0x6200;
  m.step(0x2857, 14); // ld iy,0x6200
  regs.a = mem.read8(0x6205); // player Y
  m.step(0x285a, 13); // ld a,(0x6205)
  regs.add(0x0c);
  m.step(0x285c, 7); // add a,0x0c
  regs.c = regs.a; // C = Y + 0x0C
  m.step(0x285d, 4); // ld c,a
  regs.a = mem.read8(0x6010); // input
  m.step(0x2860, 13); // ld a,(0x6010)
  regs.and(0x03); // direction bits
  m.step(0x2862, 7); // and 0x03
  regs.hl = 0x0508; // default pair
  m.step(0x2865, 10); // ld hl,0x0508
  if (regs.fZ) {
    m.step(0x286b, 10); // jp z -- (input&3)==0, keep 0x0508
  } else {
    m.step(0x2868, 10);
    regs.hl = 0x1308; // else pair
    m.step(0x286b, 10); // ld hl,0x1308
  }

  m.push16(0x286e); // `call` pushes; 3e88's dispatch returns here
  m.step(0x3e88, 17); // call 0x3e88
  entry_3e88(m); // BALANCED dispatch -- returns normally (NOT a caller-skip)
  m.ret(10); // 0x286E -- the ret the listing hid as `defb 0xc9`
}

/**
 * handler_1977 -- THE FINALE.  ROM 0x1977-0x19D9.  Task-table entry dw 0x1977 @0x074E
 * (game state 1 sub-state, reached via the 0x0748 rst-28 dispatch).
 *
 *  1977 cd ee 21 call 0x21ee ; sub_21ee -- PLAIN call (NOT skip-capable)
 *                                  ; then FALLS THROUGH into loc_197a
 *
 * = `call sub_21ee` (the animation-counter tick) then the shared loc_197a per-frame
 * update cascade. loc_197a is the SAME cascade WITHOUT the 0x21ee call (its own task
 * entry dw 0x197a @0x071A) -- TWO task entries sharing a tail, integrated as two
 * functions. This is THE reach-mover: wiring it live runs the whole engine cascade
 * (including the spine: entry_1ac3, sub_1f72, entry_30ed, ...).
 */
export function handler_1977(m) {
  m.push16(0x197a);
  m.step(0x21ee, 17); // call 0x21ee
  sub_21ee(m); // PLAIN call -- returns to 0x197A, NO guard
  return loc_197a(m); // fall through into the shared cascade
}

/**
 * loc_197a -- the shared per-frame update cascade (task dw 0x197a @0x071A, and
 * handler_1977's tail). ~25 calls; the ONE hidden exit is sub_1e57 @0x19B9 (pop-hl
 * unwind -> aborts to our caller), boolean-guarded. All other calls return normally
 * (an rst caller-skip inside a callee aborts THAT callee's caller = us, so from our
 * frame it returned). The 0x198F-0x19D1 run is `defb`-hidden in dk.asm but is LIVE
 * code. Callee names mapped to their integrated forms.
 */
export function loc_197a(m) {
  const { regs, mem } = m;

  // ---- head cascade (0x197A-0x198E) ----
  m.push16(0x197d); m.step(0x1dbd, 17); sub_1dbd(m);
  m.push16(0x1980); m.step(0x1e8c, 17);
  if (!entry_1e8c(m)) return; // 0x1E96 non-zero path fell into entry_1e94 skip-tail & RETed
  m.push16(0x1983); m.step(0x1ac3, 17); entry_1ac3(m);
  m.push16(0x1986); m.step(0x1f72, 17); sub_1f72(m);
  m.push16(0x1989); m.step(0x2c8f, 17); entry_2c8f(m);
  m.push16(0x198c); m.step(0x2c03, 17); entry_2c03(m);
  m.push16(0x198f); m.step(0x30ed, 17); entry_30ed(m);

  // ---- the cascade the listing hides as `defb` -- LIVE code ----
  m.push16(0x1992); m.step(0x2e04, 17); entry_2e04(m);
  m.push16(0x1995); m.step(0x24ea, 17); sub_24ea(m);
  m.push16(0x1998); m.step(0x2ddb, 17); entry_2ddb(m);
  m.push16(0x199b); m.step(0x2ed4, 17); entry_2ed4(m);
  m.push16(0x199e); m.step(0x2207, 17); sub_2207(m);
  m.push16(0x19a1); m.step(0x1a33, 17); sub_1a33(m);
  m.push16(0x19a4); m.step(0x2a85, 17); sub_2a85(m);
  m.push16(0x19a7); m.step(0x1f46, 17); sub_1f46(m);
  m.push16(0x19aa); m.step(0x26fa, 17); sub_26fa(m);
  m.push16(0x19ad); m.step(0x25f2, 17); sub_25f2(m);
  m.push16(0x19b0); m.step(0x19da, 17); sub_19da(m);
  m.push16(0x19b3); m.step(0x03fb, 17); entry_03fb(m);
  m.push16(0x19b6); m.step(0x2808, 17); sub_2808(m);
  m.push16(0x19b9); m.step(0x281d, 17); loc_281d(m);

  // @0x19B9 HIDDEN EXIT -- sub_1e57's pop-hl unwind aborts us
  m.push16(0x19bc);
  m.step(0x1e57, 17); // call 0x1e57
  if (!sub_1e57(m)) return; // NOT a plain call -- returned to OUR caller

  m.push16(0x19bf); m.step(0x1a07, 17);
  if (!entry_1a07(m)) return; // idx3 caller-skip jumped to the tail & RETed
  m.push16(0x19c2); m.step(0x2fcb, 17); sub_2fcb(m);

  // ---- 0x19C2: three nops -- a REMOVED call, keep the 12 T ----
  m.step(0x19c3, 4); // nop
  m.step(0x19c4, 4); // nop
  m.step(0x19c5, 4); // nop

  regs.a = mem.read8(0x6200); // coin/mode byte
  m.step(0x19c8, 13); // ld a,(0x6200)
  regs.and(regs.a);
  m.step(0x19c9, 4); // and a
  if (regs.fNZ) {
    m.ret(11); // ret nz -- (0x6200) != 0, skip the tail
    return;
  }
  m.step(0x19ca, 5); // ret nz NOT taken -- (0x6200) == 0

  m.push16(0x19cd); m.step(0x011c, 17); sub_011c(m);
  regs.hl = 0x6082;
  m.step(0x19d0, 10); // ld hl,0x6082
  mem.write8(regs.hl, 0x03);
  m.step(0x19d2, 10); // ld (hl),0x03
  return tail_19d2(m);
}

/** tail_19d2 -- shared tail (also `jp 0x19d2` from 0x1A30). Re-arms the rst-18 counter. */
function tail_19d2(m) {
  const { regs, mem } = m;
  regs.hl = 0x600a;
  m.step(0x19d5, 10); // ld hl,0x600a
  regs.incMem8(mem, regs.hl); // inc (hl) -- 0x600A++
  m.step(0x19d6, 11); // inc (hl)
  regs.hl = (regs.hl - 1) & 0xffff; // dec hl -> 0x6009
  m.step(0x19d7, 6); // dec hl
  mem.write8(regs.hl, 0x40); // 0x6009 = 0x40 -- re-arm the rst 0x18 counter
  m.step(0x19d9, 10); // ld (hl),0x40
  m.ret(10); // 0x19D9
}

/**
 * loc_07cb -- ROUND-2 BATCH: per-frame countdown animation task.  ROM 0x07CB-0x084A
 * (128 bytes). Dispatch-table handler (dw 0x07cb @0x0754, the 0x0748 task table --
 * same dispatch as handler_1977).
 * Reached only via the 0x0754 task-table dispatch.
 * Frame timer 0x638A / pattern 0x638B; on expiry finishes (0x6009=2, 0x600A++,
 * clears 0x638A/B); else decodes 2 pattern bits (rlc, CB-form) and table-driven
 * fills from 0x3D08, then queues tasks (sub_309f x2), repaints (sub_004e/sub_3f24),
 * and two rst-0x38 sound triggers. Fields not interpreted.
 */
export function loc_07cb(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x638a);
  m.step(0x07ce, 13); // ld a,(0x638a) -- frame timer
  regs.cp(0x00);
  m.step(0x07d0, 7); // cp 0x00
  if (regs.fNZ) {
    // loc_082d -- countdown frame
    m.step(0x082d, 10); // jp nz,0x082d
    regs.a = mem.read8(0x638b);
    m.step(0x0830, 13); // ld a,(0x638b)
    regs.c = regs.a;
    m.step(0x0831, 4); // ld c,a -- restore pattern
    regs.a = mem.read8(0x638a);
    m.step(0x0834, 13); // ld a,(0x638a)
    regs.a = regs.dec8(regs.a);
    m.step(0x0835, 4); // dec a
    mem.write8(0x638a, regs.a);
    m.step(0x0838, 13); // ld (0x638a),a
    m.step(0x07da, 10); // jp 0x07da -> body
  } else {
    m.step(0x07d3, 10); // jp nz NOT taken
    regs.a = 0x60;
    m.step(0x07d5, 7); // ld a,0x60
    mem.write8(0x638a, regs.a);
    m.step(0x07d8, 13); // ld (0x638a),a -- arm timer
    regs.c = 0x5f;
    m.step(0x07da, 7); // ld c,0x5f -- initial pattern
  }

  // loc_07da -- shared body (JOIN). A = timer, C = pattern.
  regs.cp(0x00);
  m.step(0x07dc, 7); // cp 0x00
  if (regs.fZ) {
    // loc_083b -- finish
    m.step(0x083b, 10); // jp z,0x083b
    regs.hl = 0x6009;
    m.step(0x083e, 10); // ld hl,0x6009
    mem.write8(regs.hl, 0x02);
    m.step(0x0840, 10); // ld (hl),0x02 -- 0x6009=2
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0841, 6); // inc hl -> 0x600a
    regs.incMem8(mem, regs.hl);
    m.step(0x0842, 11); // inc (hl) -- 0x600a++
    regs.hl = 0x638a;
    m.step(0x0845, 10); // ld hl,0x638a
    mem.write8(regs.hl, 0x00);
    m.step(0x0847, 10); // ld (hl),0x00 -- 0x638a=0
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0848, 6); // inc hl -> 0x638b
    mem.write8(regs.hl, 0x00);
    m.step(0x084a, 10); // ld (hl),0x00 -- 0x638b=0
    m.ret(); // 0x084a
    return;
  }
  m.step(0x07df, 10); // jp z NOT taken

  // decode 2 pattern bits into 0x7d86 / 0x7d87
  regs.hl = 0x7d86;
  m.step(0x07e2, 10); // ld hl,0x7d86
  mem.write8(regs.hl, 0x00);
  m.step(0x07e4, 10); // ld (hl),0x00
  regs.a = regs.c;
  m.step(0x07e5, 4); // ld a,c
  regs.a = regs.rlc(regs.a);
  m.step(0x07e7, 8); // rlc a -- CB-form
  if (regs.fC) {
    m.step(0x07e9, 7); // jr nc NOT taken
    mem.write8(regs.hl, 0x01);
    m.step(0x07eb, 10); // ld (hl),0x01
  } else {
    m.step(0x07eb, 12); // jr nc taken
  }
  // loc_07eb
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x07ec, 6); // inc hl -> 0x7d87
  mem.write8(regs.hl, 0x00);
  m.step(0x07ee, 10); // ld (hl),0x00
  regs.a = regs.rlc(regs.a);
  m.step(0x07f0, 8); // rlc a -- second bit
  if (regs.fC) {
    m.step(0x07f2, 7); // jr nc NOT taken
    mem.write8(regs.hl, 0x01);
    m.step(0x07f4, 10); // ld (hl),0x01
  } else {
    m.step(0x07f4, 12); // jr nc taken
  }
  // loc_07f4
  mem.write8(0x638b, regs.a);
  m.step(0x07f7, 13); // ld (0x638b),a -- save rotated pattern
  regs.hl = 0x3d08;
  m.step(0x07fa, 10); // ld hl,0x3d08 -- fill table

  // table-driven fill: outer over records, inner djnz block-fill
  do {
    regs.a = 0xb0;
    m.step(0x07fc, 7); // ld a,0xb0
    regs.b = mem.read8(regs.hl);
    m.step(0x07fd, 7); // ld b,(hl) -- count
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x07fe, 6); // inc hl
    regs.e = mem.read8(regs.hl);
    m.step(0x07ff, 7); // ld e,(hl) -- dest lo
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0800, 6); // inc hl
    regs.d = mem.read8(regs.hl);
    m.step(0x0801, 7); // ld d,(hl) -- dest hi
    // loc_0801 inner block-fill
    do {
      mem.write8(regs.de, regs.a);
      m.step(0x0802, 7); // ld (de),a
      regs.de = (regs.de + 1) & 0xffff;
      m.step(0x0803, 6); // inc de
      regs.b = (regs.b - 1) & 0xff; // djnz
      m.step(regs.b !== 0 ? 0x0801 : 0x0805, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0806, 6); // inc hl
    regs.a = mem.read8(regs.hl);
    m.step(0x0807, 7); // ld a,(hl) -- next count
    regs.cp(0x00);
    m.step(0x0809, 7); // cp 0x00
    m.step(regs.fNZ ? 0x07fa : 0x080c, 10); // jp nz,0x07fa
  } while (regs.fNZ);

  // 0x080c -- queue tasks, repaint, sprite-field nudges
  regs.de = 0x031e;
  m.step(0x080f, 10); // ld de,0x031e
  m.push16(0x0812);
  m.step(0x309f, 17); // call 0x309f -- queue task 0x031E
  sub_309f(m);
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0813, 6); // inc de
  m.push16(0x0816);
  m.step(0x309f, 17); // call 0x309f -- queue task 0x031F
  sub_309f(m);
  regs.hl = 0x39cf;
  m.step(0x0819, 10); // ld hl,0x39cf
  m.push16(0x081c);
  m.step(0x004e, 17); // call 0x004e -- repaint
  sub_004e(m);
  m.push16(0x081f);
  m.step(0x3f24, 17); // call 0x3f24
  sub_3f24(m);
  m.step(0x0820, 4); // nop
  regs.hl = 0x6908;
  m.step(0x0823, 10); // ld hl,0x6908
  regs.c = 0x44;
  m.step(0x0825, 7); // ld c,0x44
  m.push16(0x0826);
  m.step(0x0038, 11); // rst 0x38
  loc_0038(m);
  regs.hl = 0x690b;
  m.step(0x0829, 10); // ld hl,0x690b
  regs.c = 0x78;
  m.step(0x082b, 7); // ld c,0x78
  m.push16(0x082c);
  m.step(0x0038, 11); // rst 0x38
  loc_0038(m);
  m.ret(); // 0x082c
}

/**
 * loc_0ee8 -- ROUND-2 BATCH: kind-3 record strip (girder-cap column draw). ROM
 * 0x0EE8-0x0F1A. Reached from loc_0e4f's
 * kind!=2 branch (wired below); kind>=4 dispatches to entry_0f1b. The `jp 0x0da7`
 * exits are the walk-loop back-edge -> `return` (unwinds to sub_0da7's for(;;)).
 */
export function loc_0ee8(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x63b3);
  m.step(0x0eeb, 13); // ld a,(0x63b3) -- kind
  regs.cp(0x03);
  m.step(0x0eed, 7); // cp 0x03
  if (regs.fNZ) {
    m.step(0x0f1b, 10); // jp nz,0x0f1b -- kind 4+
    return entry_0f1b(m);
  }
  m.step(0x0ef0, 10); // jp nz NOT taken -- kind 3

  regs.hl = mem.read16(0x63ab);
  m.step(0x0ef3, 16); // ld hl,(0x63ab)
  regs.a = 0xb3;
  m.step(0x0ef5, 7); // ld a,0xb3 -- top cap
  mem.write8(regs.hl, regs.a);
  m.step(0x0ef6, 7); // ld (hl),a
  regs.bc = 0x0020;
  m.step(0x0ef9, 10); // ld bc,0x0020
  regs.addHl(regs.bc);
  m.step(0x0efa, 11); // add hl,bc
  regs.a = mem.read8(0x63b1);
  m.step(0x0efd, 13); // ld a,(0x63b1)
  regs.sub(0x10);
  m.step(0x0eff, 7); // sub 0x10 -- FIRST step

  for (;;) {
    // loc_0eff -- borrow test
    if (regs.fC) {
      m.step(0x0f14, 10); // jp c,0x0f14 taken
      regs.a = 0xb2;
      m.step(0x0f16, 7); // ld a,0xb2 -- bottom cap
      mem.write8(regs.hl, regs.a);
      m.step(0x0f17, 7); // ld (hl),a
      regs.de = (regs.de + 1) & 0xffff;
      m.step(0x0f18, 6); // inc de
      m.step(0x0da7, 10); // jp 0x0da7 -- walk back-edge
      return;
    }
    m.step(0x0f02, 10); // jp c NOT taken
    mem.write8(0x63b1, regs.a);
    m.step(0x0f05, 13); // ld (0x63b1),a
    regs.a = 0xb1;
    m.step(0x0f07, 7); // ld a,0xb1 -- body
    mem.write8(regs.hl, regs.a);
    m.step(0x0f08, 7); // ld (hl),a
    regs.bc = 0x0020;
    m.step(0x0f0b, 10); // ld bc,0x0020
    regs.addHl(regs.bc);
    m.step(0x0f0c, 11); // add hl,bc
    regs.a = mem.read8(0x63b1);
    m.step(0x0f0f, 13); // ld a,(0x63b1)
    regs.sub(0x08);
    m.step(0x0f11, 7); // sub 0x08 -- SUBSEQUENT step
    m.step(0x0eff, 10); // jp 0x0eff -- loop
  }
}

/**
 * entry_0f1b -- ROUND-2 BATCH: kind-4/5/6 record strip filler.  ROM 0x0F1B-0x0F55.
 * Reached from loc_0ee8 (kind>=4). kind>=7
 * -> 0x0ECF (inc de / jp 0x0da7). Kind picks the fill tile-code (4->0xE0, 5->0xB0,
 * 6->0xFE), then a do-while column fill. `jp p` @0x0F20 is a SIGN test (not jp nc);
 * `jp 0x0da7` exits are the walk back-edge -> `return`.
 */
export function entry_0f1b(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x63b3);
  m.step(0x0f1e, 13); // ld a,(0x63b3) -- record kind
  regs.cp(0x07);
  m.step(0x0f20, 7); // cp 0x07
  if (regs.fP) {
    // jp p,0x0ecf -- kind >= 7 (SIGN test)
    m.step(0x0ecf, 10); // jp p taken
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0ed0, 6); // inc de
    m.step(0x0da7, 10); // jp 0x0da7 -- walk back-edge
    return;
  }
  m.step(0x0f23, 10); // jp p NOT taken

  regs.cp(0x04);
  m.step(0x0f25, 7); // cp 0x04
  if (regs.fZ) {
    m.step(0x0f4c, 10); // jp z,0x0f4c -- kind 4
    regs.a = 0xe0;
    m.step(0x0f4e, 7); // ld a,0xe0
    m.step(0x0f2f, 10); // jp 0x0f2f
  } else {
    m.step(0x0f28, 10); // jp z NOT taken
    regs.cp(0x05);
    m.step(0x0f2a, 7); // cp 0x05
    if (regs.fZ) {
      m.step(0x0f51, 10); // jp z,0x0f51 -- kind 5
      regs.a = 0xb0;
      m.step(0x0f53, 7); // ld a,0xb0
      m.step(0x0f2f, 10); // jp 0x0f2f
    } else {
      m.step(0x0f2d, 10); // jp z NOT taken -- kind 6 (default)
      regs.a = 0xfe;
      m.step(0x0f2f, 7); // ld a,0xfe
    }
  }

  // loc_0f2f -- common fill body; A = fill tile-code
  mem.write8(0x63b5, regs.a);
  m.step(0x0f32, 13); // ld (0x63b5),a
  regs.hl = mem.read16(0x63ab);
  m.step(0x0f35, 16); // ld hl,(0x63ab)

  do {
    regs.a = mem.read8(0x63b5);
    m.step(0x0f38, 13); // ld a,(0x63b5)
    mem.write8(regs.hl, regs.a);
    m.step(0x0f39, 7); // ld (hl),a
    regs.bc = 0x0020;
    m.step(0x0f3c, 10); // ld bc,0x0020
    regs.addHl(regs.bc);
    m.step(0x0f3d, 11); // add hl,bc
    regs.a = mem.read8(0x63b1);
    m.step(0x0f40, 13); // ld a,(0x63b1)
    regs.sub(0x08);
    m.step(0x0f42, 7); // sub 0x08
    mem.write8(0x63b1, regs.a);
    m.step(0x0f45, 13); // ld (0x63b1),a
    m.step(regs.fNC ? 0x0f35 : 0x0f48, 10); // jp nc,0x0f35
  } while (regs.fNC);

  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0f49, 6); // inc de
  m.step(0x0da7, 10); // jp 0x0da7 -- walk back-edge
  return;
}

/**
 * entry_1d8a -- SHARED animation-timer decrement tail.  ROM 0x1D8A-0x1D8E.
 * Reached by jp/fall-through from entry_1d03 (0x1D7A jp z, 0x1D89 fall) and the
 * twin loc_1cf2 (0x1CF6 jp nz). NEVER called -- its `ret` returns to the
 * animation routine's caller. Decrements the 4-frame timer (0x620F).
 *   1d8a  ld hl,0x620f
 *   1d8d  dec (hl)
 *   1d8e  ret
 */
export function entry_1d8a(m) {
  const { regs, mem } = m;
  regs.hl = 0x620f;
  m.step(0x1d8d, 10); // ld hl,0x620f
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl))); // dec (hl) -- the BYTE, not the pointer
  m.step(0x1d8e, 11); // dec (hl) = 11 T
  m.ret(10); // 0x1D8E
}
/**
 * sub_1d8f -- SOUND TRIGGER: 0x6080 = 3.  ROM 0x1D8F-0x1D94 (6 bytes)
 * Callers: 0x1CC7 (`call c`, entry_1ac3 loc_1cc2 -- footstep/turn sound),
 *          0x1D61 (`call z`). Both conditional; this routine is unconditional.
 * Translated for completeness; not yet wired into the live dispatcher.
 *   1d8f  3e 03     ld   a,0x03
 *   1d91  32 80 60  ld   (0x6080),a
 *   1d94  c9        ret
 */
export function sub_1d8f(m) {
  const { regs, mem } = m;
  regs.a = 0x03;
  m.step(0x1d91, 7);
  mem.write8(0x6080, regs.a); // sound latch (work RAM -- no busOffset)
  m.step(0x1d94, 13);
  m.ret(10);
}
/**
 * entry_1da6 -- PLAYER sprite -> display buffer copy.  ROM 0x1DA6-0x1DBC.
 * The convergence tail of entry_1ac3 (11 jp/call sites). Copies player fields
 * (0x6203,0x6207,0x6208,0x6205) = player(+3,+7,+8,+5) -- OUT OF ORDER, do not
 * sort -- to the buffer 0x694C..0x694F. The player-hardcoded twin of loc_21ba.
 * Translated for completeness; not yet wired into the live dispatcher.
 *   1da6  ld hl,0x694c
 *   1da9  ld a,(0x6203) / ld (hl),a
 *   1dad  ld a,(0x6207) / inc l / ld (hl),a
 *   1db2  ld a,(0x6208) / inc l / ld (hl),a
 *   1db7  ld a,(0x6205) / inc l / ld (hl),a
 *   1dbc  ret
 */
export function entry_1da6(m) {
  const { regs, mem } = m;
  regs.hl = 0x694c;
  m.step(0x1da9, 10);
  regs.a = mem.read8(0x6203); mem.write8(regs.hl, regs.a);
  m.step(0x1dad, 13 + 7);
  regs.a = mem.read8(0x6207); regs.l = regs.inc8(regs.l); mem.write8(regs.hl, regs.a);
  m.step(0x1db2, 13 + 4 + 7);
  regs.a = mem.read8(0x6208); regs.l = regs.inc8(regs.l); mem.write8(regs.hl, regs.a);
  m.step(0x1db7, 13 + 4 + 7);
  regs.a = mem.read8(0x6205); regs.l = regs.inc8(regs.l); mem.write8(regs.hl, regs.a);
  m.step(0x1dbc, 13 + 4 + 7);
  m.ret(10);
}
/**
 * entry_1d03 -- PLAYER walk/climb animation stepper.  ROM 0x1D03-0x1D89.
 * ONE caller: 0x1B4A jp nz. 4-frame timer (0x620F); steps player Y (0x6205) by
 * -2, cycles walk frames into the sprite-control byte (0x6207), hands off to
 * entry_1da6. TWIN loc_1cf2 shares the body loc_1d11 with delta +2 / timer 3
 * (A is LIVE-IN to loc_1d11 -- the delta). Shares the tail entry_1d8a via loc_1d76.
 * Translated for completeness; not yet wired into the live dispatcher.
 */
export function entry_1d03(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x620f);
  m.step(0x1d06, 13); // ld a,(0x620f)
  regs.and(regs.a);
  m.step(0x1d07, 4); // and a
  if (regs.fNZ) { m.step(0x1d76, 10); return loc_1d76(m); } // jp nz,0x1d76 (timer running)
  m.step(0x1d0a, 10); // timer expired (jp nz not taken)
  regs.a = 0x04;
  m.step(0x1d0c, 7); // ld a,0x04
  mem.write8(0x620f, regs.a);
  m.step(0x1d0f, 13); // ld (0x620f),a -- reset timer := 4
  regs.a = 0xfe; // delta = -2  (** twin loc_1cf2 sets 0x02 here **)
  m.step(0x1d11, 7); // ld a,0xfe -- falls into the shared body loc_1d11
  return loc_1d11(m);
}

/**
 * loc_1d11 -- shared animation body (ROM 0x1D11).  A = delta (LIVE-IN): -2 from
 * entry_1d03, +2 from the twin loc_1cf2. (0x6205) += delta; toggle phase 0x6222.
 */
function loc_1d11(m) {
  const { regs, mem } = m;
  regs.hl = 0x6205;
  m.step(0x1d14, 10); // ld hl,0x6205
  regs.add(mem.read8(regs.hl)); // add a,(hl) -- (0x6205) += delta, sets flags
  m.step(0x1d15, 7);
  mem.write8(regs.hl, regs.a);
  m.step(0x1d16, 7); // ld (hl),a
  regs.b = regs.a;
  m.step(0x1d17, 4); // ld b,a
  regs.a = mem.read8(0x6222);
  m.step(0x1d1a, 13); // ld a,(0x6222)
  regs.xor(0x01);
  m.step(0x1d1c, 7); // xor 0x01 -- toggle phase
  mem.write8(0x6222, regs.a);
  m.step(0x1d1f, 13); // ld (0x6222),a
  if (regs.fNZ) { m.step(0x1d51, 10); return loc_1d51(m); } // jp nz,0x1d51
  m.step(0x1d22, 10); // phase -> 0
  regs.a = regs.b;
  m.step(0x1d23, 4); // ld a,b
  regs.add(0x08);
  m.step(0x1d25, 7); // add a,0x08
  regs.hl = 0x621c;
  m.step(0x1d28, 10); // ld hl,0x621c
  regs.cp(mem.read8(regs.hl));
  m.step(0x1d29, 7); // cp (hl)
  if (regs.fZ) { m.step(0x1d67, 10); return loc_1d67(m); } // jp z,0x1d67
  m.step(0x1d2c, 10);
  regs.l = (regs.l - 1) & 0xff;
  m.step(0x1d2d, 4); // dec l -> 0x621b
  regs.sub(mem.read8(regs.hl));
  m.step(0x1d2e, 7); // sub (hl)
  if (regs.fZ) { m.step(0x1d67, 10); return loc_1d67(m); } // jp z,0x1d67
  m.step(0x1d31, 10);
  regs.b = 0x05;
  m.step(0x1d33, 7); // ld b,0x05
  regs.sub(0x08);
  m.step(0x1d35, 7); // sub 0x08
  if (regs.fZ) { m.step(0x1d3f, 10); return loc_1d3f(m); } // jp z,0x1d3f (frame 5)
  m.step(0x1d38, 10);
  regs.b = regs.dec8(regs.b);
  m.step(0x1d39, 4); // dec b (=4)
  regs.sub(0x04);
  m.step(0x1d3b, 7); // sub 0x04
  if (regs.fZ) { m.step(0x1d3f, 10); return loc_1d3f(m); } // jp z,0x1d3f (frame 4)
  m.step(0x1d3e, 10);
  regs.b = regs.dec8(regs.b);
  m.step(0x1d3f, 4); // dec b (=3) -- falls into loc_1d3f
  return loc_1d3f(m);
}

/** loc_1d3f -- write sprite-control (0x6207): flip direction bit (xor 0x80), OR in frame B. */
function loc_1d3f(m) {
  const { regs, mem } = m;
  regs.a = 0x80;
  m.step(0x1d41, 7); // ld a,0x80
  regs.hl = 0x6207;
  m.step(0x1d44, 10); // ld hl,0x6207
  regs.and(mem.read8(regs.hl));
  m.step(0x1d45, 7); // and (hl) -- A = bit7 of (0x6207)
  regs.xor(0x80);
  m.step(0x1d47, 7); // xor 0x80 -- flip direction bit
  regs.or(regs.b);
  m.step(0x1d48, 4); // or b -- | frame
  mem.write8(regs.hl, regs.a);
  m.step(0x1d49, 7); // ld (hl),a -- falls into loc_1d49
  return loc_1d49(m);
}

/** loc_1d49 -- mark the sprite dirty (0x6215:=1), tail-jump entry_1da6. */
function loc_1d49(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  m.step(0x1d4b, 7); // ld a,0x01
  mem.write8(0x6215, regs.a);
  m.step(0x1d4e, 13); // ld (0x6215),a := 1
  m.step(0x1da6, 10); // jp 0x1da6 (TAIL JUMP)
  return entry_1da6(m); // 1da6's ret returns to entry_1d03's caller
}

/** loc_1d51 -- phase-1 arm: adjust (0x6203), toggle 0x6224, conditionally trigger sound. */
function loc_1d51(m) {
  const { regs, mem } = m;
  regs.l = (regs.l - 1) & 0xff;
  m.step(0x1d52, 4); // dec l (hl 0x6205 -> 0x6204)
  regs.l = (regs.l - 1) & 0xff;
  m.step(0x1d53, 4); // dec l -> 0x6203
  regs.a = mem.read8(regs.hl);
  m.step(0x1d54, 7); // ld a,(hl)  (0x6203)
  regs.or(0x03);
  m.step(0x1d56, 7); // or 0x03
  regs.a = regs.res(2, regs.a); // res 2,a -- RETURNS the value (cpu.js res())
  m.step(0x1d58, 8); // res 2,a
  mem.write8(regs.hl, regs.a);
  m.step(0x1d59, 7); // ld (hl),a
  regs.a = mem.read8(0x6224);
  m.step(0x1d5c, 13); // ld a,(0x6224)
  regs.xor(0x01);
  m.step(0x1d5e, 7); // xor 0x01
  mem.write8(0x6224, regs.a);
  m.step(0x1d61, 13); // ld (0x6224),a
  if (regs.fZ) {
    m.push16(0x1d64); // call z,0x1d8f taken -- pushes return
    m.step(0x1d8f, 17);
    sub_1d8f(m); // sound trigger (rets to 0x1d64)
  } else {
    m.step(0x1d64, 10); // call z NOT taken
  }
  m.step(0x1d49, 10); // jp 0x1d49
  return loc_1d49(m);
}

/** loc_1d67 -- limit-reached: sprite-control := 6, clear 0x6219/0x6215, tail-jump entry_1da6. */
function loc_1d67(m) {
  const { regs, mem } = m;
  regs.a = 0x06;
  m.step(0x1d69, 7); // ld a,0x06
  mem.write8(0x6207, regs.a);
  m.step(0x1d6c, 13); // ld (0x6207),a := 6
  regs.xor(regs.a);
  m.step(0x1d6d, 4); // xor a
  mem.write8(0x6219, regs.a);
  m.step(0x1d70, 13); // ld (0x6219),a := 0
  mem.write8(0x6215, regs.a);
  m.step(0x1d73, 13); // ld (0x6215),a := 0  (NOTE: 0, vs 1 at loc_1d49)
  m.step(0x1da6, 10); // jp 0x1da6 (TAIL JUMP)
  return entry_1da6(m);
}

/** loc_1d76 -- timer-running branch: 0x621A gates; falls into the shared tail entry_1d8a. */
function loc_1d76(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x621a);
  m.step(0x1d79, 13); // ld a,(0x621a)
  regs.and(regs.a);
  m.step(0x1d7a, 4); // and a
  if (regs.fZ) { m.step(0x1d8a, 10); return entry_1d8a(m); } // jp z,0x1d8a -> shared tail
  m.step(0x1d7d, 10); // (0x621A) != 0  [COLD arm on tape]
  mem.write8(0x6219, regs.a);
  m.step(0x1d80, 13); // ld (0x6219),a := (0x621A)
  regs.a = mem.read8(0x621c);
  m.step(0x1d83, 13); // ld a,(0x621c)
  regs.sub(0x13);
  m.step(0x1d85, 7); // sub 0x13
  regs.hl = 0x6205;
  m.step(0x1d88, 10); // ld hl,0x6205
  regs.cp(mem.read8(regs.hl));
  m.step(0x1d89, 7); // cp (hl)
  if (regs.fNC) { m.ret(11); return; } // ret nc
  m.step(0x1d8a, 5); // ret nc NOT taken -> FALL INTO entry_1d8a
  return entry_1d8a(m);
}

/**
 * loc_1dc9 -- ROM 0x1DC9-0x1DF4  (rst 0x28 dispatch target, sub_1dbd entry 1)
 *
 *   1dc9  3e 40        ld   a,0x40
 *   1dcb  32 41 63     ld   (0x6341),a
 *   1dce  3e 02        ld   a,0x02
 *   1dd0  32 40 63     ld   (0x6340),a     ; STATE ADVANCE 1 -> 2, unconditional
 *   1dd3  3a 42 63     ld   a,(0x6342)
 *   1dd6  1f           rra                 ; carry = bit 0 of 0x6342
 *   1dd7  da 70 3e     jp   c,0x3e70
 *   1dda  1f           rra                 ; carry = bit 1
 *   1ddb  da 00 1e     jp   c,0x1e00
 *   1dde  1f           rra                 ; carry = bit 2
 *   1ddf  da f5 1d     jp   c,0x1df5
 *   1de2  21 85 60     ld   hl,0x6085
 *   1de5  36 03        ld   (hl),0x03
 *   1de7  3a 29 62     ld   a,(0x6229)
 *   1dea  3d           dec  a
 *   1deb  ca 00 1e     jp   z,0x1e00
 *   1dee  3d           dec  a
 *   1def  ca 08 1e     jp   z,0x1e08
 *   1df2  c3 10 1e     jp   0x1e10
 *
 * Stack-clean: no push/pop/rst/call and no ret. Every exit is a TAIL JUMP.
 */
export function loc_1dc9(m) {
  const { regs, mem } = m;

  regs.a = 0x40;
  m.step(0x1dcb, 7); // ld a,0x40
  mem.write8(0x6341, regs.a);
  m.step(0x1dce, 13); // ld (0x6341),a
  regs.a = 0x02;
  m.step(0x1dd0, 7); // ld a,0x02
  mem.write8(0x6340, regs.a); // *** STATE ADVANCE 1 -> 2, unconditional ***
  m.step(0x1dd3, 13); // ld (0x6340),a

  regs.a = mem.read8(0x6342);
  m.step(0x1dd6, 13); // ld a,(0x6342)

  regs.rra(); // carry = bit 0; A's rotated-in bit is dead. FIRST use of rra.
  m.step(0x1dd7, 4); // rra
  if (regs.fC) {
    m.step(0x3e70, 10); // jp c,0x3e70 taken (tail)
    return loc_3e70(m);
  }
  m.step(0x1dda, 10); // jp c,0x3e70 not taken

  regs.rra(); // carry = bit 1
  m.step(0x1ddb, 4); // rra
  if (regs.fC) {
    m.step(0x1e00, 10); // jp c,0x1e00 taken (tail)
    return loc_1e00(m);
  }
  m.step(0x1dde, 10); // jp c,0x1e00 not taken

  regs.rra(); // carry = bit 2
  m.step(0x1ddf, 4); // rra
  if (regs.fC) {
    m.step(0x1df5, 10); // jp c,0x1df5 taken (tail)
    return loc_1df5(m);
  }
  m.step(0x1de2, 10); // jp c,0x1df5 not taken

  regs.hl = 0x6085;
  m.step(0x1de5, 10); // ld hl,0x6085
  mem.write8(regs.hl, 0x03);
  m.step(0x1de7, 10); // ld (hl),0x03  -- 0x6085:=3, fall-through path only

  regs.a = mem.read8(0x6229);
  m.step(0x1dea, 13); // ld a,(0x6229)
  regs.a = regs.dec8(regs.a);
  m.step(0x1deb, 4); // dec a
  if (regs.fZ) {
    m.step(0x1e00, 10); // jp z,0x1e00 taken (tail) -- 0x6229 == 1
    return loc_1e00(m);
  }
  m.step(0x1dee, 10); // jp z,0x1e00 not taken

  regs.a = regs.dec8(regs.a); // NOT reloaded -- continues the dec chain
  m.step(0x1def, 4); // dec a
  if (regs.fZ) {
    m.step(0x1e08, 10); // jp z,0x1e08 taken (tail)  -- 0x6229 == 2 (level 2) -- wired
    return loc_1e08(m);
  }
  m.step(0x1df2, 10); // jp z,0x1e08 not taken

  m.step(0x1e10, 10); // jp 0x1e10 (unconditional tail) -- 0x6229 not in {1,2} (level >=3)
  return loc_1e10(m); // loc_1e10 already translated (0x1E10-0x1E14 -> loc_1e15); wire the level>=3 tail
}

/**
 * sub_1dbd -- ROM 0x1DBD-0x1DC8  (rst 0x28 inline-jump-table dispatcher on 0x6340)
 *
 *   1dbd  3a 40 63     ld   a,(0x6340)
 *   1dc0  ef           rst  0x28
 *   ; ---- inline jump table 0x1DC1-0x1DC8 (DATA: 49 1e c9 1d 4a 1e 00 00) ----
 *   1dc1  dw 0x1E49    ; 0x6340 == 0
 *   1dc3  dw 0x1DC9    ; 0x6340 == 1  -> loc_1dc9 (advances 0x6340 := 2)
 *   1dc5  dw 0x1E4A    ; 0x6340 == 2
 *   1dc7  dw 0x0000    ; 0x6340 == 3  -> RESET VECTOR
 *
 * The ROUTER on state var 0x6340 (writes nothing itself). Leaves via the
 * dispatch, never a ret of its own.
 */
export function sub_1dbd(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6340); // ld a,(0x6340) -- flag-neutral; A is the index
  m.step(0x1dc0, 13);
  const idx = regs.a; // raw state value, for the diagnostic below

  // rst 0x28: dispatch through the inline table at 0x1DC1, indexed by A. Body
  // (ROM 0x0028-0x0037) modelled exactly as sub_0f56's dispatcher above.
  m.push16(0x1dc1); // rst 0x28 pushes the address AFTER it -- the table base
  m.step(0x0028, 11);

  regs.add(regs.a);
  m.step(0x0029, 4); // add a,a -- A = 2*index
  regs.hl = m.pop16(); // pop hl -- table base 0x1DC1, balancing the push
  m.step(0x002a, 10);
  regs.e = regs.a;
  m.step(0x002b, 4); // ld e,a
  regs.d = 0x00;
  m.step(0x002d, 7); // ld d,0x00 -- DE = 2*index
  m.step(0x0032, 10); // jp 0x0032
  regs.addHl(regs.de); // add hl,de -- &table[index]
  m.step(0x0033, 11);
  regs.e = mem.read8(regs.hl);
  m.step(0x0034, 7); // ld e,(hl)
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0035, 6); // inc hl
  regs.d = mem.read8(regs.hl);
  m.step(0x0036, 7); // ld d,(hl)
  const target = regs.de; // ex de,hl: HL becomes the target, DE the pointer
  regs.de = regs.hl;
  regs.hl = target;
  m.step(0x0037, 4); // ex de,hl
  m.step(target, 4); // jp (hl)

  if (target === 0x1dc9) return loc_1dc9(m); // entry 1: 0x6340 == 1
  if (target === 0x1e49) return loc_1e49(m); // entry 0: 0x6340 == 0 (idle ret; tape-hot)
  if (target === 0x1e4a) return loc_1e4a(m); // entry 2: 0x6340 == 2 (state-2 countdown; finale-latent)
  throw new NotImplemented(
    `sub_1dbd dispatches via rst 0x28 to ROM 0x${target.toString(16).padStart(4, "0")} ` +
      `(table at 0x1DC1, index A=mem[0x6340]=${idx}), which is not translated.`,
  );
}

/**
 * loc_1e49 -- sub_1dbd rst-28 table[0] (0x6340==0): the state-0 IDLE arm.  ROM 0x1E49.
 * A 1-byte `ret` no-op. Reached by rst-28 jump-dispatch, so this ret returns to
 * sub_1dbd's caller (loc_197a @0x197D).
 * TAPE-HOT -- the FIRE-1 blocker (A=mem[0x6340]=0 on the coin/start tape).
 */
export function loc_1e49(m) {
  m.ret(10); // 0x1E49  c9  ret
}

/**
 * loc_1e4a -- sub_1dbd rst-28 table[2] (0x6340==2): the state-2 countdown.  ROM 0x1E4A-0x1E56.
 *  Reached by rst-28 jump-
 * dispatch (A==2), so `ret` returns to sub_1dbd's caller (loc_197a). Decrements
 * (0x6341) each frame; on expiry clears (0x6a30) and resets the dispatcher
 * (0x6340):=0 (a 0x40-frame timed hold, armed by state 1 loc_1dc9). FINALE-LATENT
 * (A=2 reached only after state 1 advances). `ret nz` @0x1E4E falls through ONLY on
 * expiry. `dec (hl)` is the BYTE RMW at 0x6341, not the pointer. Fields not interpreted.
 *   1e4a  ld hl,0x6341 / dec (hl) / ret nz / xor a / ld (0x6a30),a / ld (0x6340),a / ret
 */
export function loc_1e4a(m) {
  const { regs, mem } = m;
  regs.hl = 0x6341;
  m.step(0x1e4d, 10); // ld hl,0x6341
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl))); // dec (hl) -- the BYTE at 0x6341
  m.step(0x1e4e, 11); // dec (hl)
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- stay in state 2
  m.step(0x1e4f, 5); // ret nz NOT taken -- counter expired
  regs.xor(regs.a);
  m.step(0x1e50, 4); // xor a
  mem.write8(0x6a30, regs.a);
  m.step(0x1e53, 13); // ld (0x6a30),a := 0
  mem.write8(0x6340, regs.a);
  m.step(0x1e56, 13); // ld (0x6340),a := 0 -- reset dispatcher to state 0
  m.ret(10); // 0x1E56
}

/**
 * loc_3e70 -- ROM 0x3E70-0x3E87 (>=0x3000, my region). ROUND-3: loc_1dc9 tail-jumps
 * here (0x6342 bit 0 set). A live-in. rra-driven 3-way param encoder: on the first
 * clear low bit picks (DE,B) = bit0=0->(1,0x7B), bit1=0->(3,0x7D), else (5,0x7F);
 * tail-jumps to loc_1e28.
 */
function loc_3e70(m) {
  const { regs } = m;
  regs.de = 0x0001;
  m.step(0x3e73, 10); // ld de,0x0001
  regs.b = 0x7b;
  m.step(0x3e75, 7); // ld b,0x7b
  regs.rra();
  m.step(0x3e76, 4); // rra -- bit0 -> carry
  if (regs.fNC) { m.step(0x1e28, 10); return loc_1e28(m); } // jp nc -- DE=1,B=0x7B
  m.step(0x3e79, 10);
  regs.e = 0x03;
  m.step(0x3e7b, 7); // ld e,0x03 (DE=0x0003)
  regs.b = 0x7d;
  m.step(0x3e7d, 7); // ld b,0x7d
  regs.rra();
  m.step(0x3e7e, 4); // rra -- bit1 -> carry
  if (regs.fNC) { m.step(0x1e28, 10); return loc_1e28(m); } // jp nc -- DE=3,B=0x7D
  m.step(0x3e81, 10);
  regs.e = 0x05;
  m.step(0x3e83, 7); // ld e,0x05 (DE=0x0005)
  regs.b = 0x7f;
  m.step(0x3e85, 7); // ld b,0x7f
  m.step(0x1e28, 10); // jp 0x1e28
  return loc_1e28(m); // DE=5,B=0x7F
}

/**
 * loc_1e28 -- ROM 0x1E28-0x1E49. ROUND-3: writes the 0x6A30 param block, rst-0x30
 * caller-skip gate, then 0x6085=3, ret. Its ret @0x1E49 IS the loc_1e49 byte
 * (shared; modelled as a plain ret here, NOT a call to loc_1e49). DE,B live-in from
 * loc_3e70.
 */
function loc_1e28(m) {
  const { regs, mem } = m;
  m.push16(0x1e2b);
  m.step(0x309f, 17); // call 0x309f -- queue task
  sub_309f(m);
  regs.a = mem.read8(0x6205);
  m.step(0x1e2e, 13); // ld a,(0x6205)
  regs.add(0x14);
  m.step(0x1e30, 7); // add a,0x14
  regs.c = regs.a;
  m.step(0x1e31, 4); // ld c,a
  regs.a = mem.read8(0x6203);
  m.step(0x1e34, 13); // ld a,(0x6203)
  m.step(0x1e35, 4); // nop
  m.step(0x1e36, 4); // nop
  regs.hl = 0x6a30;
  m.step(0x1e39, 10); // ld hl,0x6a30
  mem.write8(regs.hl, regs.a);
  m.step(0x1e3a, 7); // ld (hl),a -- 0x6A30 = (0x6203)
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x1e3b, 4); // inc l
  mem.write8(regs.hl, regs.b);
  m.step(0x1e3c, 7); // ld (hl),b -- 0x6A31 = B
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x1e3d, 4); // inc l
  mem.write8(regs.hl, 0x07);
  m.step(0x1e3f, 10); // ld (hl),0x07 -- 0x6A32 = 7
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x1e40, 4); // inc l
  mem.write8(regs.hl, regs.c);
  m.step(0x1e41, 7); // ld (hl),c -- 0x6A33 = C
  regs.a = 0x05;
  m.step(0x1e43, 7); // ld a,0x05
  m.push16(0x1e44);
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // rst-0x30 CALLER-SKIP -- gate fired, back to our caller
  regs.hl = 0x6085;
  m.step(0x1e47, 10); // ld hl,0x6085
  mem.write8(regs.hl, 0x03);
  m.step(0x1e49, 10); // ld (hl),0x03 -- 0x6085 = 3
  m.ret(10); // 0x1E49 (== loc_1e49; one ret, not double-integrated)
}

/**
 * loc_1e15 -- ROM 0x1E15-0x1E24  (convergence of loc_1e00 / loc_1e08 / loc_1e10)
 *
 *   1e15  cd 9f 30     call 0x309f        ; consumes B, DE (the setters' params)
 *   1e18  2a 43 63     ld   hl,(0x6343)   ; INDIRECT: HL = word at 0x6343
 *   1e1b  7e           ld   a,(hl)        ; read byte 0
 *   1e1c  36 00        ld   (hl),0x00     ; CLEAR byte 0 (after reading into A)
 *   1e1e  2c           inc  l             ; L-only, wraps within page; sets flags
 *   1e1f  2c           inc  l
 *   1e20  2c           inc  l
 *   1e21  4e           ld   c,(hl)        ; read byte 3 into C
 *   1e22  c3 36 1e     jp   0x1e36
 *
 * Live-in B, DE (from the setters) consumed by the first call; HL reloaded here.
 * Ends in a TAIL JUMP to untranslated 0x1E36 -> NotImplemented.
 */
export function loc_1e15(m) {
  const { regs, mem } = m;

  m.push16(0x1e18); // call 0x309f pushes the return address 0x1E18
  m.step(0x309f, 17);
  sub_309f(m); // consumes B, DE; preserves HL (push/pop)

  // INDIRECT load: HL from the WORD at 0x6343, not the literal 0x6343 (2A vs 21).
  regs.hl = mem.read16(0x6343);
  m.step(0x1e1b, 16); // ld hl,(0x6343)

  regs.a = mem.read8(regs.hl);
  m.step(0x1e1c, 7); // ld a,(hl) -- READ byte 0 first...
  mem.write8(regs.hl, 0x00);
  m.step(0x1e1e, 10); // ld (hl),0x00 -- ...THEN clear. Order-critical (S8).

  // inc l x3 -- L-only (no carry into H), and SETS flags via inc8; the last
  // one's flags escape to loc_1e36. NOT (regs.l+1)&0xff, which would drop them.
  regs.l = regs.inc8(regs.l);
  m.step(0x1e1f, 4); // inc l
  regs.l = regs.inc8(regs.l);
  m.step(0x1e20, 4); // inc l
  regs.l = regs.inc8(regs.l);
  m.step(0x1e21, 4); // inc l

  regs.c = mem.read8(regs.hl);
  m.step(0x1e22, 7); // ld c,(hl) -- byte 3

  m.step(0x1e36, 10); // jp 0x1e36 (tail jump, no push)
  return loc_1e36(m);
}

/**
 * loc_1e00 -- ROM 0x1E00-0x1E07  (setter; loc_1dc9 tail-jumps here)
 *
 *   1e00  06 7d        ld   b,0x7d
 *   1e02  11 03 00     ld   de,0x0003
 *   1e05  c3 15 1e     jp   0x1e15
 *
 * Sets the (B, DE) parameters and tail-jumps to the shared continuation loc_1e15
 * (a TAIL JUMP: 0x1E05 is 0xC3/jp, no return address pushed).
 */
export function loc_1e00(m) {
  const { regs } = m;

  regs.b = 0x7d;
  m.step(0x1e02, 7); // ld b,0x7d
  regs.de = 0x0003;
  m.step(0x1e05, 10); // ld de,0x0003
  m.step(0x1e15, 10); // jp 0x1e15 (tail jump, no push16)
  return loc_1e15(m);
}

export function sub_1e57(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6227);
  m.step(0x1e5a, 13); // ld a,(0x6227)
  regs.bit(2, regs.a);
  m.step(0x1e5c, 8); // bit 2,a
  if (regs.fNZ) {
    m.step(0x1e80, 10); // jp nz,0x1e80
    return loc_1e80(m);
  }
  m.step(0x1e5f, 10); // jp nz not taken
  regs.rra(); // bit 1 -> carry
  m.step(0x1e60, 4);
  regs.a = mem.read8(0x6205); // Y
  m.step(0x1e63, 13);
  if (regs.fC) {
    m.step(0x1e7a, 10); // jp c,0x1e7a
    return loc_1e7a(m);
  }
  m.step(0x1e66, 10); // jp c not taken
  regs.cp(0x51);
  m.step(0x1e68, 7); // cp 0x51
  if (!regs.fC) {
    m.ret(11); // ret nc -- NORMAL return
    return true;
  }
  m.step(0x1e69, 5); // ret nc not taken
  regs.a = mem.read8(0x6203); // X
  m.step(0x1e6c, 13);
  regs.rla(); // X bit 7 -> carry
  m.step(0x1e6d, 4);
  return loc_1e6d(m);
}

/** loc_1e6d -- 1E57 interior: set 0x694D mirror flag by carry, then unwind. */
function loc_1e6d(m) {
  const { regs, mem } = m;
  regs.a = 0x00;
  m.step(0x1e6f, 7); // ld a,0x00
  if (regs.fC) {
    m.step(0x1e74, 10); // jp c -- keep A=0
  } else {
    m.step(0x1e72, 10); // jp c not taken
    regs.a = 0x80;
    m.step(0x1e74, 7); // ld a,0x80
  }
  mem.write8(0x694d, regs.a); // sprite mirror flag
  m.step(0x1e77, 13);
  m.step(0x1e85, 10); // jp 0x1e85 -- the unwind
  return loc_1e85(m);
}

/** loc_1e7a -- 1E57 interior: cp 0x31 -> normal ret, or into loc_1e6d. */
function loc_1e7a(m) {
  const { regs } = m;
  regs.cp(0x31);
  m.step(0x1e7c, 7); // cp 0x31
  if (!regs.fC) {
    m.ret(11); // ret nc -- NORMAL
    return true;
  }
  m.step(0x1e7d, 5); // ret nc not taken
  m.step(0x1e6d, 10); // jp 0x1e6d
  return loc_1e6d(m);
}

/** loc_1e80 -- 1E57 interior: 0x6290 test -> normal ret, or unwind. */
function loc_1e80(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6290);
  m.step(0x1e83, 13); // ld a,(0x6290)
  regs.and(regs.a);
  m.step(0x1e84, 4); // and a
  if (regs.fNZ) {
    m.ret(11); // ret nz -- NORMAL
    return true;
  }
  m.step(0x1e85, 5); // ret nz not taken
  return loc_1e85(m);
}

/** loc_1e85 -- 1E57 interior: 0x600A=0x16, then UNWIND (pop own return, ret to caller's caller). */
function loc_1e85(m) {
  const { regs, mem } = m;
  regs.a = 0x16;
  m.step(0x1e87, 7); // ld a,0x16
  mem.write8(0x600a, regs.a); // 0x600A = 0x16
  m.step(0x1e8a, 13);
  regs.hl = m.pop16(); // pop hl -- discards sub_1e57's OWN return address
  m.step(0x1e8b, 10);
  m.ret(); // returns to the CALLER'S CALLER -- unwinds
  return false; // BOOLEAN: unwound (the caller must not continue)
}

/**
 * entry_1e8c -- ROM 0x1E8C-0x1E93  (caller-skip head; 0x197D calls it)
 *
 *   1e8c  3a 50 63     ld   a,(0x6350)
 *   1e8f  a7           and  a
 *   1e90  c8           ret  z            ; (0x6350)==0 -> normal return
 *   1e91  cd 96 1e     call 0x1e96       ; UNTRANSLATED -> NotImplemented
 *
 * On the non-zero path, control would fall into entry_1e94 after 0x1e96 returns.
 */
export function entry_1e8c(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6350);
  m.step(0x1e8f, 13); // ld a,(0x6350)
  regs.and(regs.a);
  m.step(0x1e90, 4); // and a
  if (regs.fZ) {
    m.ret(11); // ret z TAKEN -- normal return to the caller (11 T)
    return true;
  }
  m.step(0x1e91, 5); // ret z NOT taken (5 T), falls through

  m.push16(0x1e94); // call 0x1e96 pushes the return address 0x1E94
  m.step(0x1e96, 17);
  sub_1e96(m);
  entry_1e94(m); // skip tail: pop hl (discard loc_197a's 0x1980) + ret to loc_197a's caller
  return false; // CALLER-SKIP: loc_197a must NOT continue past 0x1980
}

/**
 * entry_1e94 -- ROM 0x1E94-0x1E95  (entry_1e8c's private skip tail)
 *
 *   1e94  e1           pop  hl           ; discard the caller's return address
 *   1e95  c9           ret               ; return to the caller's CALLER
 *
 * SINGLE CALLER-SKIP (sub_0020-tail / sub_0044 idiom): `pop hl` drops one stack
 * frame (the 0x197D caller's 0x1980), then `ret` returns to the caller's caller.
 * NOT a plain return. Reached only by fall-through from entry_1e8c's non-zero
 * path (blocked above until 0x1E96 lands); standalone here for direct testing.
 */
export function entry_1e94(m) {
  const { regs } = m;

  regs.hl = m.pop16(); // pop hl -- discards the caller's return address
  m.step(0x1e95, 10);
  m.ret(); // ret -- returns to the caller's CALLER (single-frame skip)
}

/**
 * sub_1e96 -- ROM 0x1E96-0x1E99 (+ inline table 0x1E9A-0x1E9F)
 *
 *   1e96  3a 45 63     ld   a,(0x6345)
 *   1e99  ef           rst  0x28
 *   ; ---- inline jump table 0x1E9A-0x1E9F (DATA: a0 1e 09 1f 23 1f) ----
 *   1e9a  dw 0x1EA0    ; (0x6345) == 0
 *   1e9c  dw 0x1F09    ; (0x6345) == 1
 *   1e9e  dw 0x1F23    ; (0x6345) == 2
 */
export function sub_1e96(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6345); // ld a,(0x6345) -- the dispatch index
  m.step(0x1e99, 13);
  const idx = regs.a; // for the diagnostic below

  // rst 0x28: dispatch through the inline table at 0x1E9A. Body (ROM
  // 0x0028-0x0037) modelled exactly as sub_1dbd / sub_0f56.
  m.push16(0x1e9a); // rst 0x28 pushes the address AFTER it -- the table base
  m.step(0x0028, 11);

  regs.add(regs.a);
  m.step(0x0029, 4); // add a,a -- A = 2*index
  regs.hl = m.pop16(); // pop hl -- table base 0x1E9A, balancing the push
  m.step(0x002a, 10);
  regs.e = regs.a;
  m.step(0x002b, 4); // ld e,a
  regs.d = 0x00;
  m.step(0x002d, 7); // ld d,0x00 -- DE = 2*index
  m.step(0x0032, 10); // jp 0x0032
  regs.addHl(regs.de); // add hl,de -- &table[index] (RAW: no bounds check)
  m.step(0x0033, 11);
  regs.e = mem.read8(regs.hl);
  m.step(0x0034, 7); // ld e,(hl)
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0035, 6); // inc hl
  regs.d = mem.read8(regs.hl);
  m.step(0x0036, 7); // ld d,(hl)
  const target = regs.de; // ex de,hl: HL becomes the target, DE the pointer
  regs.de = regs.hl;
  regs.hl = target;
  m.step(0x0037, 4); // ex de,hl
  m.step(target, 4); // jp (hl)

  if (target === 0x1ea0) return entry_1ea0(m); // idx 0
  if (target === 0x1f09) return loc_1f09(m); // idx 1
  if (target === 0x1f23) return loc_1f23(m); // idx 2
  throw new NotImplemented(
    `sub_1e96 dispatches via rst 0x28 to ROM 0x${target.toString(16).padStart(4, "0")} ` +
      `(3-entry table at 0x1E9A, index A=mem[0x6345]=${idx}), which is not translated.`,
  );
}

/**
 * entry_1ea0 -- ROM 0x1EA0-0x1F08  (sub_1e96 dispatch target, index 0)
 *
 *   1ea0  3a 52 63     ld   a,(0x6352)
 *   1ea3  fe 65        cp   0x65
 *   1ea5  21 b8 69     ld   hl,0x69b8
 *   1ea8  ca b4 1e     jp   z,0x1eb4        ; == -> HL 0x69b8
 *   1eab  21 d0 69     ld   hl,0x69d0
 *   1eae  da b4 1e     jp   c,0x1eb4        ; <  -> HL 0x69d0
 *   1eb1  21 80 69     ld   hl,0x6980       ; >  -> HL 0x6980
 *   1eb4  dd 2a 51 63  ld   ix,(0x6351)     ; FIRST USE, 20 T
 *   1eb8  16 00        ld   d,0x00
 *   1eba  3a 53 63     ld   a,(0x6353)
 *   1ebd  5f           ld   e,a             ; DE = 0x00:(0x6353)
 *   1ebe  01 04 00     ld   bc,0x0004
 *   1ec1  3a 54 63     ld   a,(0x6354)
 *   1ec4  a7           and  a
 *   1ec5  ca cf 1e     jp   z,0x1ecf        ; (0x6354)==0 -> skip loop
 *   1ec8  09           add  hl,bc           ; loop: HL += 4
 *   1ec9  dd 19        add  ix,de           ;       IX += DE
 *   1ecb  3d           dec  a
 *   1ecc  c2 c8 1e     jp   nz,0x1ec8
 *   1ecf  dd 36 00 00  ld   (ix+0x00),0x00
 *   1ed3  dd 7e 15     ld   a,(ix+0x15)
 *   1ed6  a7           and  a
 *   1ed7  3e 02        ld   a,0x02
 *   1ed9  ca de 1e     jp   z,0x1ede        ; (ix+0x15)==0 -> keep 0x02
 *   1edc  3e 04        ld   a,0x04          ; else 0x04
 *   1ede  32 42 63     ld   (0x6342),a
 *   1ee1  01 2c 6a     ld   bc,0x6a2c
 *   1ee4  7e           ld   a,(hl)
 *   1ee5  36 00        ld   (hl),0x00
 *   1ee7  02           ld   (bc),a          ; FIRST USE, 7 T
 *   1ee8  0c           inc  c
 *   1ee9  2c           inc  l
 *   1eea  3e 60        ld   a,0x60
 *   1eec  02           ld   (bc),a
 *   1eed  0c           inc  c
 *   1eee  2c           inc  l
 *   1eef  3e 0c        ld   a,0x0c
 *   1ef1  02           ld   (bc),a
 *   1ef2  0c           inc  c
 *   1ef3  2c           inc  l
 *   1ef4  7e           ld   a,(hl)
 *   1ef5  02           ld   (bc),a
 *   1ef6  21 45 63     ld   hl,0x6345
 *   1ef9  34           inc  (hl)            ; STATE ADVANCE 0x6345 (incMem8)
 *   1efa  2c           inc  l
 *   1efb  36 06        ld   (hl),0x06       ; 0x6346 = 6
 *   1efd  2c           inc  l
 *   1efe  36 05        ld   (hl),0x05       ; 0x6347 = 5
 *   1f00  21 8a 60     ld   hl,0x608a
 *   1f03  36 06        ld   (hl),0x06       ; 0x608a = 6
 *   1f05  2c           inc  l
 *   1f06  36 03        ld   (hl),0x03       ; 0x608b = 3
 *   1f08  c9           ret
 */
export function entry_1ea0(m) {
  const { regs, mem } = m;

  // ---- HL select by (0x6352) vs 0x65; cp's flags survive the flag-neutral ld hl ----
  regs.a = mem.read8(0x6352);
  m.step(0x1ea3, 13); // ld a,(0x6352)
  regs.cp(0x65);
  m.step(0x1ea5, 7); // cp 0x65
  regs.hl = 0x69b8;
  m.step(0x1ea8, 10); // ld hl,0x69b8
  if (regs.fZ) {
    m.step(0x1eb4, 10); // jp z,0x1eb4 taken (==)
  } else {
    m.step(0x1eab, 10); // jp z not taken
    regs.hl = 0x69d0;
    m.step(0x1eae, 10); // ld hl,0x69d0
    if (regs.fC) {
      m.step(0x1eb4, 10); // jp c,0x1eb4 taken (<)
    } else {
      m.step(0x1eb1, 10); // jp c not taken
      regs.hl = 0x6980;
      m.step(0x1eb4, 10); // ld hl,0x6980 (falls into loc_1eb4)
    }
  }

  // ---- loc_1eb4: set up IX, DE, BC, and the loop count ----
  regs.ix = mem.read16(0x6351); // ld ix,(0x6351) -- FIRST USE, 20 T (vs MAME z80.lst)
  m.step(0x1eb8, 20);
  regs.d = 0x00;
  m.step(0x1eba, 7); // ld d,0x00
  regs.a = mem.read8(0x6353);
  m.step(0x1ebd, 13); // ld a,(0x6353)
  regs.e = regs.a;
  m.step(0x1ebe, 4); // ld e,a
  regs.bc = 0x0004;
  m.step(0x1ec1, 10); // ld bc,0x0004
  regs.a = mem.read8(0x6354);
  m.step(0x1ec4, 13); // ld a,(0x6354)
  regs.and(regs.a);
  m.step(0x1ec5, 4); // and a
  if (regs.fZ) {
    m.step(0x1ecf, 10); // jp z,0x1ecf -- (0x6354)==0, skip the loop
  } else {
    m.step(0x1ec8, 10); // jp z not taken -> enter loop
    for (;;) {
      regs.addHl(regs.bc); // add hl,bc -- HL += 4, INSIDE the loop (draft TEST 3)
      m.step(0x1ec9, 11);
      regs.addIx(regs.de); // add ix,de -- IX += DE, INSIDE the loop
      m.step(0x1ecb, 15);
      regs.a = regs.dec8(regs.a);
      m.step(0x1ecc, 4); // dec a
      if (regs.fNZ) {
        m.step(0x1ec8, 10); // jp nz,0x1ec8 taken -- next iteration
        continue;
      }
      m.step(0x1ecf, 10); // jp nz not taken -> fall to loc_1ecf
      break;
    }
  }

  // ---- loc_1ecf: (ix+0)=0; select 0x02 vs 0x04 by (ix+0x15) ----
  mem.write8((regs.ix + 0x00) & 0xffff, 0x00);
  m.step(0x1ed3, 19); // ld (ix+0x00),0x00
  regs.a = mem.read8((regs.ix + 0x15) & 0xffff);
  m.step(0x1ed6, 19); // ld a,(ix+0x15)
  regs.and(regs.a);
  m.step(0x1ed7, 4); // and a
  regs.a = 0x02;
  m.step(0x1ed9, 7); // ld a,0x02
  if (regs.fZ) {
    m.step(0x1ede, 10); // jp z,0x1ede taken -- (ix+0x15)==0, keep 0x02
  } else {
    m.step(0x1edc, 10); // jp z not taken
    regs.a = 0x04;
    m.step(0x1ede, 7); // ld a,0x04
  }

  // ---- loc_1ede: store the selected value, then the ordered 4-byte copy (S8) ----
  mem.write8(0x6342, regs.a);
  m.step(0x1ee1, 13); // ld (0x6342),a
  regs.bc = 0x6a2c;
  m.step(0x1ee4, 10); // ld bc,0x6a2c
  regs.a = mem.read8(regs.hl);
  m.step(0x1ee5, 7); // ld a,(hl)
  mem.write8(regs.hl, 0x00);
  m.step(0x1ee7, 10); // ld (hl),0x00
  mem.write8(regs.bc, regs.a);
  m.step(0x1ee8, 7); // ld (bc),a -- FIRST USE, 7 T (vs MAME z80.lst)
  regs.c = regs.inc8(regs.c);
  m.step(0x1ee9, 4); // inc c
  regs.l = regs.inc8(regs.l);
  m.step(0x1eea, 4); // inc l
  regs.a = 0x60;
  m.step(0x1eec, 7); // ld a,0x60
  mem.write8(regs.bc, regs.a);
  m.step(0x1eed, 7); // ld (bc),a
  regs.c = regs.inc8(regs.c);
  m.step(0x1eee, 4); // inc c
  regs.l = regs.inc8(regs.l);
  m.step(0x1eef, 4); // inc l
  regs.a = 0x0c;
  m.step(0x1ef1, 7); // ld a,0x0c
  mem.write8(regs.bc, regs.a);
  m.step(0x1ef2, 7); // ld (bc),a
  regs.c = regs.inc8(regs.c);
  m.step(0x1ef3, 4); // inc c
  regs.l = regs.inc8(regs.l);
  m.step(0x1ef4, 4); // inc l
  regs.a = mem.read8(regs.hl);
  m.step(0x1ef5, 7); // ld a,(hl)
  mem.write8(regs.bc, regs.a);
  m.step(0x1ef6, 7); // ld (bc),a

  // ---- state advance: inc (0x6345) [0->1], then the four sibling stores ----
  regs.hl = 0x6345;
  m.step(0x1ef9, 10); // ld hl,0x6345
  regs.incMem8(mem, regs.hl); // inc (hl) -- 0x6345 state advance (shared RMW); flags dead here
  m.step(0x1efa, 11); // inc (hl)
  regs.l = regs.inc8(regs.l);
  m.step(0x1efb, 4); // inc l
  mem.write8(regs.hl, 0x06);
  m.step(0x1efd, 10); // ld (hl),0x06 -- 0x6346 = 6
  regs.l = regs.inc8(regs.l);
  m.step(0x1efe, 4); // inc l
  mem.write8(regs.hl, 0x05);
  m.step(0x1f00, 10); // ld (hl),0x05 -- 0x6347 = 5
  regs.hl = 0x608a;
  m.step(0x1f03, 10); // ld hl,0x608a
  mem.write8(regs.hl, 0x06);
  m.step(0x1f05, 10); // ld (hl),0x06 -- 0x608a = 6
  regs.l = regs.inc8(regs.l);
  m.step(0x1f06, 4); // inc l
  mem.write8(regs.hl, 0x03);
  m.step(0x1f08, 10); // ld (hl),0x03 -- 0x608b = 3
  m.ret(); // ret (0x1F08)
}

/**
 * loc_1f09 / loc_1f1d -- ROM 0x1F09-0x1F22  (sub_1e96 dispatch target, index 1)
 *
 *   1f09  21 46 63     ld   hl,0x6346
 *   1f0c  35           dec  (hl)          ; every-6th-call delay
 *   1f0d  c0           ret  nz
 *   1f0e  36 06        ld   (hl),0x06     ; reload 0x6346
 *   1f10  2c           inc  l             ; HL -> 0x6347
 *   1f11  35           dec  (hl)
 *   1f12  ca 1d 1f     jp   z,0x1f1d
 *   1f15  21 2d 6a     ld   hl,0x6a2d
 *   1f18  7e           ld   a,(hl)
 *   1f19  ee 01        xor  0x01          ; toggle bit 0 of 0x6a2d
 *   1f1b  77           ld   (hl),a
 *   1f1c  c9           ret
 *   1f1d  36 04        ld   (hl),0x04     ; loc_1f1d: reload 0x6347 (HL=0x6347)
 *   1f1f  2d           dec  l             ; HL -> 0x6346
 *   1f20  2d           dec  l             ; HL -> 0x6345
 *   1f21  34           inc  (hl)          ; 0x6345: 1 -> 2 (advance the dispatch)
 *   1f22  c9           ret
 */
export function loc_1f09(m) {
  const { regs, mem } = m;

  regs.hl = 0x6346;
  m.step(0x1f0c, 10); // ld hl,0x6346
  regs.decMem8(mem, regs.hl); // dec (0x6346) -- flag-correct; ret nz reads its Z
  m.step(0x1f0d, 11); // dec (hl)
  if (regs.fNZ) {
    m.ret(11); // ret nz TAKEN -- the delay, 11 T (draft TEST 1)
    return;
  }
  m.step(0x1f0e, 5); // ret nz NOT taken, 5 T

  mem.write8(regs.hl, 0x06); // reload 0x6346 = 6
  m.step(0x1f10, 10); // ld (hl),0x06
  regs.l = regs.inc8(regs.l); // inc l -- HL -> 0x6347
  m.step(0x1f11, 4);
  regs.decMem8(mem, regs.hl); // dec (0x6347) -- flag-correct; jp z reads its Z
  m.step(0x1f12, 11); // dec (hl)
  if (regs.fZ) {
    m.step(0x1f1d, 10); // jp z,0x1f1d taken -> loc_1f1d
    // loc_1f1d: reload 0x6347, walk HL to 0x6345, advance it 1 -> 2
    mem.write8(regs.hl, 0x04); // ld (hl),0x04 -- reload 0x6347 (HL=0x6347)
    m.step(0x1f1f, 10);
    regs.l = regs.dec8(regs.l); // dec l -- HL -> 0x6346
    m.step(0x1f20, 4);
    regs.l = regs.dec8(regs.l); // dec l -- HL -> 0x6345
    m.step(0x1f21, 4);
    regs.incMem8(mem, regs.hl); // inc (0x6345) -- 1 -> 2 (draft TEST 2)
    m.step(0x1f22, 11); // inc (hl)
    m.ret(); // ret (0x1F22)
    return;
  }
  m.step(0x1f15, 10); // jp z NOT taken

  regs.hl = 0x6a2d;
  m.step(0x1f18, 10); // ld hl,0x6a2d
  regs.a = mem.read8(regs.hl);
  m.step(0x1f19, 7); // ld a,(hl)
  regs.xor(0x01); // xor 0x01 -- toggle bit 0 (draft TEST 3: xor, NOT inc)
  m.step(0x1f1b, 7);
  mem.write8(regs.hl, regs.a);
  m.step(0x1f1c, 7); // ld (hl),a
  m.ret(); // ret (0x1F1C)
}

/**
 * loc_1f23 / loc_1f34 -- ROM 0x1F23-0x1F45  (sub_1e96 dispatch target, index 2)
 *
 *   1f23  21 46 63     ld   hl,0x6346
 *   1f26  35           dec  (hl)          ; every-Nth-call delay
 *   1f27  c0           ret  nz
 *   1f28  36 0c        ld   (hl),0x0c     ; reload 0x6346 (TWIN: 0x0c vs 0x06)
 *   1f2a  2c           inc  l             ; HL -> 0x6347
 *   1f2b  35           dec  (hl)
 *   1f2c  ca 34 1f     jp   z,0x1f34
 *   1f2f  21 2d 6a     ld   hl,0x6a2d
 *   1f32  34           inc  (hl)          ; TWIN: inc vs xor 0x01
 *   1f33  c9           ret
 *   1f34  2d           dec  l             ; loc_1f34: HL 0x6347 -> 0x6346
 *   1f35  2d           dec  l             ; HL -> 0x6345
 *   1f36  af           xor  a             ; A = 0
 *   1f37  77           ld   (hl),a        ; 0x6345 = 0 -- RESET the index (bounds)
 *   1f38  32 50 63     ld   (0x6350),a    ; 0x6350 = 0
 *   1f3b  3c           inc  a             ; A = 1
 *   1f3c  32 40 63     ld   (0x6340),a    ; game state 0x6340 = 1
 *   1f3f  21 2c 6a     ld   hl,0x6a2c
 *   1f42  22 43 63     ld   (0x6343),hl   ; 0x6343 = 0x6a2c (loc_1e15's pointer)
 *   1f45  c9           ret
 */
export function loc_1f23(m) {
  const { regs, mem } = m;

  regs.hl = 0x6346;
  m.step(0x1f26, 10); // ld hl,0x6346
  regs.decMem8(mem, regs.hl); // dec (0x6346) -- flag-correct; ret nz reads its Z
  m.step(0x1f27, 11); // dec (hl)
  if (regs.fNZ) {
    m.ret(11); // ret nz TAKEN -- the delay, 11 T
    return;
  }
  m.step(0x1f28, 5); // ret nz NOT taken, 5 T

  mem.write8(regs.hl, 0x0c); // reload 0x6346 = 0x0c (TWIN differs from loc_1f09's 0x06)
  m.step(0x1f2a, 10); // ld (hl),0x0c
  regs.l = regs.inc8(regs.l); // inc l -- HL -> 0x6347
  m.step(0x1f2b, 4);
  regs.decMem8(mem, regs.hl); // dec (0x6347) -- flag-correct; jp z reads its Z
  m.step(0x1f2c, 11); // dec (hl)
  if (regs.fZ) {
    m.step(0x1f34, 10); // jp z,0x1f34 taken -> loc_1f34
    // loc_1f34: reset the dispatch index and seed the next stage.
    regs.l = regs.dec8(regs.l); // dec l -- HL -> 0x6346
    m.step(0x1f35, 4);
    regs.l = regs.dec8(regs.l); // dec l -- HL -> 0x6345
    m.step(0x1f36, 4);
    regs.xor(regs.a); // xor a -- A = 0
    m.step(0x1f37, 4);
    mem.write8(regs.hl, regs.a); // ld (hl),a -- 0x6345 = 0 (RESET the 1e96 index)
    m.step(0x1f38, 7);
    mem.write8(0x6350, regs.a); // ld (0x6350),a -- 0x6350 = 0
    m.step(0x1f3b, 13);
    regs.a = regs.inc8(regs.a); // inc a -- A = 1
    m.step(0x1f3c, 4);
    mem.write8(0x6340, regs.a); // ld (0x6340),a -- game state 0x6340 = 1
    m.step(0x1f3f, 13);
    regs.hl = 0x6a2c;
    m.step(0x1f42, 10); // ld hl,0x6a2c
    mem.write16(0x6343, regs.hl); // ld (0x6343),hl -- 0x6343 = 0x6a2c
    m.step(0x1f45, 16);
    m.ret(); // ret (0x1F45)
    return;
  }
  m.step(0x1f2f, 10); // jp z NOT taken

  regs.hl = 0x6a2d;
  m.step(0x1f32, 10); // ld hl,0x6a2d
  regs.incMem8(mem, regs.hl); // inc (0x6a2d) (TWIN: inc, vs loc_1f09's xor 0x01)
  m.step(0x1f33, 11); // inc (hl)
  m.ret(); // ret (0x1F33)
}
/**
 * sub_1f46 -- PLAYER-STATE RESET (gated on 0x6221).  ROM 0x1F46-0x1F71.
 * (0x6221)==0 -> ret. Else clear 0x6204/06/21/10-14 (=0), set 0x6216/1f (=1),
 * snapshot Y (0x6205) -> 0x620e. Hands entry_1ac3 a state-1 player next frame.
 * The inc a @ 0x1F64 is the store-value boundary: 8 zeros before, 2 ones after --
 * do not reorder across it.
 */
export function sub_1f46(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6221);
  m.step(0x1f49, 13);
  regs.and(regs.a);
  m.step(0x1f4a, 4);
  if (regs.fZ) { m.ret(11); return; } // ret z -- nothing to reset
  m.step(0x1f4b, 5);

  regs.xor(regs.a); // A = 0 -- the clear value
  m.step(0x1f4c, 4);
  mem.write8(0x6204, regs.a); m.step(0x1f4f, 13);
  mem.write8(0x6206, regs.a); m.step(0x1f52, 13);
  mem.write8(0x6221, regs.a); m.step(0x1f55, 13); // clear the trigger
  mem.write8(0x6210, regs.a); m.step(0x1f58, 13);
  mem.write8(0x6211, regs.a); m.step(0x1f5b, 13);
  mem.write8(0x6212, regs.a); m.step(0x1f5e, 13);
  mem.write8(0x6213, regs.a); m.step(0x1f61, 13);
  mem.write8(0x6214, regs.a); m.step(0x1f64, 13);
  regs.a = regs.inc8(regs.a); // A = 1 -- the store-value boundary
  m.step(0x1f65, 4);
  mem.write8(0x6216, regs.a); m.step(0x1f68, 13); // state = 1
  mem.write8(0x621f, regs.a); m.step(0x1f6b, 13);
  regs.a = mem.read8(0x6205); // player Y
  m.step(0x1f6e, 13);
  mem.write8(0x620e, regs.a); // snapshot Y
  m.step(0x1f71, 13);
  m.ret(10);
}

/**
 * entry_2913 -- ROM 0x2913-0x2953  (object-list search; A=1+skip on hit, A=0 normal)
 *
 *   2913  dd e5        push ix                ; OUTSIDE the loop
 *   2915  dd cb 00 46  bit  0,(ix+0x00)       ; loop head (djnz target)
 *   2919  ca 4c 29     jp   z,0x294c          ; slot inactive -> next
 *   291c  79           ld   a,c
 *   291d  dd 96 05     sub  (ix+0x05)
 *   2920  d2 25 29     jp   nc,0x2925
 *   2923  ed 44        neg                    ; |C - (ix+5)|
 *   2925  3c           inc  a
 *   2926  95           sub  l
 *   2927  da 30 29     jp   c,0x2930
 *   292a  dd 96 0a     sub  (ix+0x0a)
 *   292d  d2 4c 29     jp   nc,0x294c         ; out of range -> next
 *   2930  fd 7e 03     ld   a,(iy+0x03)
 *   2933  dd 96 03     sub  (ix+0x03)
 *   2936  d2 3b 29     jp   nc,0x293b
 *   2939  ed 44        neg                    ; |(iy+3) - (ix+3)|
 *   293b  94           sub  h
 *   293c  da 45 29     jp   c,0x2945          ; HIT
 *   293f  dd 96 09     sub  (ix+0x09)
 *   2942  d2 4c 29     jp   nc,0x294c         ; out of range -> next
 *   2945  3e 01        ld   a,0x01            ; HIT: A=1 and SKIP a frame
 *   2947  dd e1        pop  ix
 *   2949  33           inc  sp
 *   294a  33           inc  sp
 *   294b  c9           ret                    ; -> caller's CALLER
 *   294c  dd 19        add  ix,de             ; next record
 *   294e  10 c5        djnz 0x2915
 *   2950  af           xor  a                 ; exhausted: A=0
 *   2951  dd e1        pop  ix
 *   2953  c9           ret                    ; -> caller (normal)
 *
 * LIVE-IN: IX (record base), C, L, H, DE (record stride), B (count), IY (0x2930).
 * @returns {boolean} true when control returned NORMALLY (A=0, list exhausted);
 *   false when it SKIPPED a frame (A=1, hit) -- the sub_0008 convention.
 */
export function entry_2913(m) {
  const { regs, mem } = m;

  m.push16(regs.ix); // push ix -- OUTSIDE the loop (djnz targets 0x2915)
  m.step(0x2915, 15);

  for (;;) {
    // `advance` = the ROM's 0x294C target: every "not a match" jump lands there.
    advance: {
      // bit 0,(ix+0x00). F3/F5 come from the EFFECTIVE-ADDRESS HIGH BYTE for the
      // indexed form, not the operand -- that is what cpu.js's `yxFrom` third
      // parameter exists for (it names this call site).
      const ea2915 = (regs.ix + 0x00) & 0xffff;
      regs.bit(0, mem.read8(ea2915), (ea2915 >> 8) & 0xff);
      m.step(0x2919, 20);
      if (regs.fZ) {
        m.step(0x294c, 10); // jp z,0x294c -- slot inactive
        break advance;
      }
      m.step(0x291c, 10);

      regs.a = regs.c;
      m.step(0x291d, 4); // ld a,c
      regs.sub(mem.read8((regs.ix + 0x05) & 0xffff));
      m.step(0x2920, 19); // sub (ix+0x05)
      if (regs.fNC) {
        m.step(0x2925, 10); // jp nc,0x2925
      } else {
        m.step(0x2923, 10);
        regs.neg();
        m.step(0x2925, 8); // neg -- absolute difference
      }

      regs.a = regs.inc8(regs.a);
      m.step(0x2926, 4); // inc a
      regs.sub(regs.l);
      m.step(0x2927, 4); // sub l
      if (regs.fC) {
        m.step(0x2930, 10); // jp c,0x2930 -- within the first span
      } else {
        m.step(0x292a, 10);
        regs.sub(mem.read8((regs.ix + 0x0a) & 0xffff));
        m.step(0x292d, 19); // sub (ix+0x0a)
        if (regs.fNC) {
          m.step(0x294c, 10); // jp nc,0x294c -- out of range
          break advance;
        }
        m.step(0x2930, 10);
      }

      regs.a = mem.read8((regs.iy + 0x03) & 0xffff);
      m.step(0x2933, 19); // ld a,(iy+0x03)
      regs.sub(mem.read8((regs.ix + 0x03) & 0xffff));
      m.step(0x2936, 19); // sub (ix+0x03)
      if (regs.fNC) {
        m.step(0x293b, 10); // jp nc,0x293b
      } else {
        m.step(0x2939, 10);
        regs.neg();
        m.step(0x293b, 8); // neg -- absolute difference
      }

      regs.sub(regs.h);
      m.step(0x293c, 4); // sub h
      if (regs.fC) {
        m.step(0x2945, 10); // jp c,0x2945 -- HIT
      } else {
        m.step(0x293f, 10);
        regs.sub(mem.read8((regs.ix + 0x09) & 0xffff));
        m.step(0x2942, 19); // sub (ix+0x09)
        if (regs.fNC) {
          m.step(0x294c, 10); // jp nc,0x294c -- out of range
          break advance;
        }
        m.step(0x2945, 10); // falls into the HIT exit
      }

      // ---- 0x2945 HIT: A=1, restore IX, DISCARD our return address, ret ----
      regs.a = 0x01;
      m.step(0x2947, 7); // ld a,0x01
      regs.ix = m.pop16();
      m.step(0x2949, 14); // pop ix
      regs.sp = (regs.sp + 1) & 0xffff;
      m.step(0x294a, 6); // inc sp
      regs.sp = (regs.sp + 1) & 0xffff;
      m.step(0x294b, 6); // inc sp -- our return address is now discarded
      m.ret(); // ret -> the CALLER'S CALLER
      return false; // SKIPPED (sub_0008 convention)
    }

    // ---- 0x294C: advance to the next record and loop ----
    regs.addIx(regs.de);
    m.step(0x294e, 15); // add ix,de
    regs.djnz();
    m.step(regs.b !== 0 ? 0x2915 : 0x2950, regs.b !== 0 ? 13 : 8);
    if (regs.b === 0) break; // B==0 on entry would give 256 passes; the ROM does not guard it
  }

  // ---- 0x2950: list exhausted -- A=0, restore IX, NORMAL return ----
  regs.xor(regs.a);
  m.step(0x2951, 4); // xor a
  regs.ix = m.pop16();
  m.step(0x2953, 14); // pop ix
  m.ret(); // ret -> the caller
  return true; // returned NORMALLY (sub_0008 convention)
}

/**
 * sub_2a22 -- ROM 0x2A22-0x2A2E  (entry_2913 wrapper: B=6, DE=0x0010, IX=0x6600)
 *
 *   2a22  06 06        ld   b,0x06
 *   2a24  11 10 00     ld   de,0x0010
 *   2a27  dd 21 00 66  ld   ix,0x6600
 *   2a2b  cd 13 29     call 0x2913
 *   2a2e  c9           ret                ; runs ONLY on entry_2913's A=0 exit
 */
export function sub_2a22(m) {
  const { regs } = m;

  regs.b = 0x06;
  m.step(0x2a24, 7); // ld b,0x06
  regs.de = 0x0010;
  m.step(0x2a27, 10); // ld de,0x0010
  regs.ix = 0x6600;
  m.step(0x2a2b, 14); // ld ix,0x6600

  m.push16(0x2a2e); // call 0x2913 pushes the return address 0x2A2E
  m.step(0x2913, 17);
  if (!entry_2913(m)) {
    // A=1: entry_2913 discarded 0x2A2E and already returned to OUR caller
    // (0x29C0). Executing the ret below would double-return.
    return;
  }
  m.ret(); // ret (0x2A2E) -- only on entry_2913's A=0 (normal) exit
}

export function sub_2a2f(m) {
  const { regs, mem } = m;
  const IX = (d) => (regs.ix + d) & 0xffff;

  regs.a = mem.read8(IX(0x03));
  m.step(0x2a32, 19); // ld a,(ix+0x03)
  regs.h = regs.a; // H = Y
  m.step(0x2a33, 4); // ld h,a
  regs.a = mem.read8(IX(0x05));
  m.step(0x2a36, 19); // ld a,(ix+0x05)
  regs.add(0x04); // +4
  m.step(0x2a38, 7); // add a,0x04
  regs.l = regs.a; // L = X + 4
  m.step(0x2a39, 4); // ld l,a

  m.push16(regs.hl); // push hl -- the position
  m.step(0x2a3a, 11);
  m.push16(0x2a3d);
  m.step(0x2ff0, 17);
  sub_2ff0(m); // HL = pos -> HL = tilemap cell ptr
  regs.de = m.pop16(); // pop de -- DE = the saved position (E = X+4)
  m.step(0x2a3e, 10);

  regs.a = mem.read8(regs.hl); // the tile
  m.step(0x2a3f, 7); // ld a,(hl)
  regs.cp(0xb0);
  m.step(0x2a41, 7); // cp 0xb0
  if (regs.fC) return noCollision(); // jp c,0x2a7b -- passable
  m.step(0x2a44, 10);
  regs.and(0x0f);
  m.step(0x2a46, 7); // and 0x0f
  regs.cp(0x08);
  m.step(0x2a48, 7); // cp 0x08
  if (regs.fNC) return noCollision(); // jp nc,0x2a7b
  m.step(0x2a4b, 10);

  regs.a = mem.read8(regs.hl); // re-read the tile
  m.step(0x2a4c, 7); // ld a,(hl)
  regs.cp(0xc0);
  m.step(0x2a4e, 7); // cp 0xc0
  if (regs.fZ) return noCollision(); // jp z,0x2a7b -- exactly 0xC0
  const below_c0 = regs.fC;
  m.step(below_c0 ? 0x2a69 : 0x2a54, 10); // jp c,0x2a69

  let C;
  if (below_c0) {
    // -- loc_2a69: 0xB0-0xBF --
    regs.a = 0xff;
    m.step(0x2a6b, 7); // ld a,0xff
    m.step(0x2a72, 10); // jp 0x2a72
    C = regs.a;
  } else {
    regs.cp(0xd0);
    m.step(0x2a56, 7); // cp 0xd0
    if (regs.fC) {
      C = classSub9(0x2a6e); // jp c,0x2a6e -- 0xC1-0xCF
    } else {
      m.step(0x2a59, 10);
      regs.cp(0xe0);
      m.step(0x2a5b, 7); // cp 0xe0
      if (regs.fC) {
        C = classDec(0x2a63); // jp c,0x2a63 -- 0xD0-0xDF
      } else {
        m.step(0x2a5e, 10);
        regs.cp(0xf0);
        m.step(0x2a60, 7); // cp 0xf0
        if (regs.fC) C = classSub9(0x2a6e); // jp c,0x2a6e -- 0xE0-0xEF
        else C = classDec(0x2a63); // else (>= 0xF0)
      }
    }
  }

  // -- loc_2a72: X-adjust --
  regs.c = C;
  m.step(0x2a73, 4); // ld c,a
  regs.a = regs.e; // A = E (object X + 4)
  m.step(0x2a74, 4); // ld a,e
  regs.and(0xf8); // snap to tile boundary
  m.step(0x2a76, 7); // and 0xf8
  regs.add(regs.c); // + slope offset
  m.step(0x2a77, 4); // add a,c
  regs.cp(regs.e); // compare to original X
  m.step(0x2a78, 7); // cp e
  if (regs.fC) {
    // -- loc_2a7d: adjust --
    m.step(0x2a7d, 10); // jp c,0x2a7d
    regs.sub(0x04); // undo the +4
    m.step(0x2a7f, 7); // sub 0x04
    mem.write8(IX(0x05), regs.a); // (ix+0x05) = adjusted X
    m.step(0x2a82, 19);
    regs.a = 0x01;
    m.step(0x2a84, 7); // ld a,0x01
    m.ret();
    return;
  }
  return noCollision(); // jp c not taken -> fall to 0x2a7b

  function classDec(addr) {
    // loc_2a63: (tile & 0x0f) - 1
    m.step(addr, 10);
    regs.and(0x0f);
    m.step(0x2a65, 7); // and 0x0f
    regs.a = regs.dec8(regs.a);
    m.step(0x2a66, 4); // dec a
    m.step(0x2a72, 10); // jp 0x2a72
    return regs.a;
  }
  function classSub9(addr) {
    // loc_2a6e: (tile & 0x0f) - 9
    m.step(addr, 10);
    regs.and(0x0f);
    m.step(0x2a70, 7); // and 0x0f
    regs.sub(0x09);
    m.step(0x2a72, 4); // sub 0x09
    return regs.a;
  }
  function noCollision() {
    m.step(0x2a7b, 10); // jp to 0x2a7b
    regs.xor(regs.a); // A = 0
    m.step(0x2a7c, 4);
    m.ret();
  }
}
/**
 * sub_2a85 -- ROM 0x2A85-0x2AB3  (0x198F cascade: gated tile probe; sub_2a2f sibling)
 *
 * Three gates (0x6215, 0x6216, 0x6398), then probes the tilemap at position
 * (H=0x6203-3, L=0x6205+0x0C) via sub_2ff0. On the tape the executing exit is the
 * ret at 0x2AB3 (tile >= 0xB0 AND low-nibble < 8). The jp c / jp nc -> 0x2AB4 slope
 * cascade is NON-EXECUTING (frontier; see sub_2a2f).
 */
export function sub_2a85(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6215);
  m.step(0x2a88, 13); // ld a,(0x6215)
  regs.and(regs.a);
  m.step(0x2a89, 4); // and a
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- gate 1
  m.step(0x2a8a, 5);
  regs.a = mem.read8(0x6216);
  m.step(0x2a8d, 13); // ld a,(0x6216)
  regs.and(regs.a);
  m.step(0x2a8e, 4); // and a
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- gate 2
  m.step(0x2a8f, 5);
  regs.a = mem.read8(0x6398);
  m.step(0x2a92, 13); // ld a,(0x6398)
  regs.cp(0x01);
  m.step(0x2a94, 7); // cp 0x01
  if (regs.fZ) { m.ret(11); return; } // ret z -- gate 3
  m.step(0x2a95, 5);

  regs.a = mem.read8(0x6203);
  m.step(0x2a98, 13); // ld a,(0x6203)
  regs.sub(0x03);
  m.step(0x2a9a, 7); // sub 0x03
  regs.h = regs.a; // H = 0x6203 - 3
  m.step(0x2a9b, 4); // ld h,a
  regs.a = mem.read8(0x6205);
  m.step(0x2a9e, 13); // ld a,(0x6205)
  regs.add(0x0c);
  m.step(0x2aa0, 7); // add a,0x0c
  regs.l = regs.a; // L = 0x6205 + 0x0C
  m.step(0x2aa1, 4); // ld l,a

  m.push16(regs.hl); // push hl -- the probe position
  m.step(0x2aa2, 11);
  m.push16(0x2aa5);
  m.step(0x2ff0, 17);
  sub_2ff0(m); // HL = pos -> HL = tilemap cell ptr
  regs.de = m.pop16(); // pop de -- saved position
  m.step(0x2aa6, 10);

  regs.a = mem.read8(regs.hl); // the tile
  m.step(0x2aa7, 7); // ld a,(hl)
  regs.cp(0xb0);
  m.step(0x2aa9, 7); // cp 0xb0
  if (regs.fC) {
    // -- jp c,0x2ab4 -- tile < 0xB0: slope cascade (Mario on angled girder) --
    m.step(0x2ab4, 10);
    return loc_2ab4(m);
  }
  m.step(0x2aac, 10); // jp c not taken
  regs.and(0x0f);
  m.step(0x2aae, 7); // and 0x0f
  regs.cp(0x08);
  m.step(0x2ab0, 7); // cp 0x08
  if (regs.fNC) {
    // -- jp nc,0x2ab4 -- low nibble >= 8: slope cascade (Mario on angled girder) --
    m.step(0x2ab4, 10);
    return loc_2ab4(m);
  }
  m.step(0x2ab3, 10); // jp nc not taken -> the executing path
  m.ret(); // 0x2AB3
}

/**
 * loc_2ab4 -- ROM 0x2AB4-0x2ACC  (the slope cascade off sub_2a85)
 * Reached when Mario's foot-probe tile is a SLOPE (tile < 0xB0, or low-nibble >= 8).
 * Probe the tile ONE ROW UP (HL -= 0x20): if that upper tile is solid (>= 0xB0 and
 * low-nibble < 8) fall through to a bare ret; otherwise (X&7==0, or upper tile is
 * also slope/empty) set the slope-contact flag 0x6221 via entry_2acd. Transcribed
 * from out/dk.asm so Mario can stand on the angled girders (was a NotImplemented
 * frontier -- found by poke-sweeping Mario's Y up the board).
 *   2ab4 7a ld a,d   2ab5 e6 07 and 0x07   2ab7 ca cd 2a jp z,0x2acd
 *   2aba 01 20 00 ld bc,0x0020   2abd ed 42 sbc hl,bc   2abf 7e ld a,(hl)
 *   2ac0 fe b0 cp 0xb0   2ac2 da cd 2a jp c,0x2acd   2ac5 e6 0f and 0x0f
 *   2ac7 fe 08 cp 0x08   2ac9 d2 cd 2a jp nc,0x2acd   2acc c9 ret
 */
function loc_2ab4(m) {
  const { regs, mem } = m;
  regs.a = regs.d;
  m.step(0x2ab5, 4); // ld a,d
  regs.and(0x07);
  m.step(0x2ab7, 7); // and 0x07 (also clears carry for the sbc below)
  if (regs.fZ) { m.step(0x2acd, 10); return entry_2acd(m); } // jp z,0x2acd
  m.step(0x2aba, 10); // jp z not taken
  regs.bc = 0x0020;
  m.step(0x2abd, 10); // ld bc,0x0020
  regs.sbcHl(regs.bc); // sbc hl,bc -- carry 0 from `and`, HL -= 0x20 (one tile row up)
  m.step(0x2abf, 15); // sbc hl,bc
  regs.a = mem.read8(regs.hl);
  m.step(0x2ac0, 7); // ld a,(hl)
  regs.cp(0xb0);
  m.step(0x2ac2, 7); // cp 0xb0
  if (regs.fC) { m.step(0x2acd, 10); return entry_2acd(m); } // jp c,0x2acd
  m.step(0x2ac5, 10); // jp c not taken
  regs.and(0x0f);
  m.step(0x2ac7, 7); // and 0x0f
  regs.cp(0x08);
  m.step(0x2ac9, 7); // cp 0x08
  if (regs.fNC) { m.step(0x2acd, 10); return entry_2acd(m); } // jp nc,0x2acd
  m.step(0x2acc, 10); // jp nc not taken
  m.ret(); // 0x2ACC c9 ret
}

/** entry_2acd -- ROM 0x2ACD-0x2AD2  set slope-contact flag 0x6221 = 1, ret. */
function entry_2acd(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  m.step(0x2acf, 7); // ld a,0x01
  mem.write8(0x6221, regs.a);
  m.step(0x2ad2, 13); // ld (0x6221),a
  m.ret(); // 0x2AD2 c9 ret
}

/**
 * sub_29af -- ROM 0x29AF-0x2A21  (object-collision resolver over the 2913 search)
 *
 *   29af  3e 04        ld   a,0x04
 *   29b1  f7           rst  0x30            ; skips our body unless the bit is set
 *   29b2  fd 21 00 62  ld   iy,0x6200
 *   29b6  3a 05 62     ld   a,(0x6205)
 *   29b9  4f           ld   c,a
 *   29ba  21 08 04     ld   hl,0x0408
 *   29bd  cd 22 2a     call 0x2a22          ; -> entry_2913 search; A = hit/miss
 *   29c0  a7           and  a
 *   29c1  ca 20 2a     jp   z,0x2a20        ; miss -> plain ret
 *   29c4  3e 06        ld   a,0x06
 *   29c6  90           sub  b
 *   29c7  ca d0 29     jp   z,0x29d0        ; loc_29c7 loop head
 *   29ca  dd 19        add  ix,de
 *   29cc  3d           dec  a
 *   29cd  c3 c7 29     jp   0x29c7
 *   29d0  dd 7e 05     ld   a,(ix+0x05)
 *   29d3  d6 04        sub  0x04
 *   29d5  57           ld   d,a
 *   29d6  3a 0c 62     ld   a,(0x620c)
 *   29d9  c6 05        add  a,0x05
 *   29db  ba           cp   d
 *   29dc  d2 ee 29     jp   nc,0x29ee
 *   29df  7a           ld   a,d
 *   29e0  d6 08        sub  0x08
 *   29e2  32 05 62     ld   (0x6205),a
 *   29e5  3e 01        ld   a,0x01
 *   29e7  47           ld   b,a
 *   29e8  32 98 63     ld   (0x6398),a
 *   29eb  33           inc  sp
 *   29ec  33           inc  sp
 *   29ed  c9           ret                  ; SKIP -> caller's CALLER
 *   29ee  3a 0c 62     ld   a,(0x620c)
 *   29f1  d6 0e        sub  0x0e
 *   29f3  ba           cp   d
 *   29f4  d2 1b 2a     jp   nc,0x2a1b
 *   29f7  3a 10 62     ld   a,(0x6210)
 *   29fa  a7           and  a
 *   29fb  3a 03 62     ld   a,(0x6203)      ; FLAG-NEUTRAL -- Z below is `and a`'s
 *   29fe  ca 08 2a     jp   z,0x2a08
 *   2a01  f6 07        or   0x07
 *   2a03  d6 04        sub  0x04
 *   2a05  c3 0e 2a     jp   0x2a0e
 *   2a08  d6 08        sub  0x08            ; loc_2a08
 *   2a0a  f6 07        or   0x07
 *   2a0c  c6 04        add  a,0x04
 *   2a0e  32 03 62     ld   (0x6203),a      ; loc_2a0e
 *   2a11  32 4c 69     ld   (0x694c),a
 *   2a14  3e 01        ld   a,0x01
 *   2a16  06 00        ld   b,0x00
 *   2a18  33           inc  sp
 *   2a19  33           inc  sp
 *   2a1a  c9           ret                  ; SKIP -> caller's CALLER
 *   2a1b  af           xor  a               ; loc_2a1b
 *   2a1c  32 00 62     ld   (0x6200),a
 *   2a1f  c9           ret                  ; plain ret
 *   2a20  47           ld   b,a             ; loc_2a20
 *   2a21  c9           ret                  ; plain ret
 *
 * @returns {boolean} true when control reached OUR CALLER (rst-0x30 skip, or
 *   either plain ret); false for the two inc-sp exits, which skip the caller.
 */
export function sub_29af(m) {
  const { regs, mem } = m;

  // rst 0x30 -- and the boolean guard below is SILENT ABOUT REGISTERS, which are
  // part of the contract. sub_0030 CLOBBERS A (rrca'd B times), HL (:= 0x6227) and
  // B (djnz'd to 0). NOTHING is preserved across it here, deliberately: A is
  // reloaded from (0x6205), HL from the literal 0x0408, and B is set by sub_2a22.
  // DO NOT "helpfully" save/restore HL around this rst -- the ROM does not, the
  // pre-rst value is dead (sub_0030's first act is ld hl,0x6227), and preserving
  // it would corrupt a later (hl) user while every gate stayed green.
  regs.a = 0x04;
  m.step(0x29b1, 7); // ld a,0x04 -- the value sub_0030 rotates; NOT preserved
  m.push16(0x29b2); // rst 0x30 pushes its continuation
  m.step(0x0030, 11);
  if (!sub_0030(m)) return true; // skipped OUR body; our caller still resumes

  regs.iy = 0x6200;
  m.step(0x29b6, 14); // ld iy,0x6200
  regs.a = mem.read8(0x6205);
  m.step(0x29b9, 13); // ld a,(0x6205)
  regs.c = regs.a;
  m.step(0x29ba, 4); // ld c,a
  regs.hl = 0x0408;
  m.step(0x29bd, 10); // ld hl,0x0408

  m.push16(0x29c0); // call 0x2a22
  m.step(0x2a22, 17);
  sub_2a22(m); // both of its arms land us at 0x29C0; A carries hit/miss

  regs.and(regs.a);
  m.step(0x29c1, 4); // and a
  if (regs.fZ) {
    m.step(0x2a20, 10); // jp z,0x2a20 -- miss
    regs.b = regs.a;
    m.step(0x2a21, 4); // ld b,a
    m.ret(); // plain ret
    return true;
  }
  m.step(0x29c4, 10);

  regs.a = 0x06;
  m.step(0x29c6, 7); // ld a,0x06
  regs.sub(regs.b);
  m.step(0x29c7, 4); // sub b -- A = 6 - B

  // loc_29c7: hand-rolled countdown; add ix,de is INSIDE (draft TEST 2).
  for (;;) {
    if (regs.fZ) {
      m.step(0x29d0, 10); // jp z,0x29d0
      break;
    }
    m.step(0x29ca, 10);
    regs.addIx(regs.de);
    m.step(0x29cc, 15); // add ix,de
    regs.a = regs.dec8(regs.a);
    m.step(0x29cd, 4); // dec a
    m.step(0x29c7, 10); // jp 0x29c7
  }

  regs.a = mem.read8((regs.ix + 0x05) & 0xffff);
  m.step(0x29d3, 19); // ld a,(ix+0x05)
  regs.sub(0x04);
  m.step(0x29d5, 7); // sub 0x04
  regs.d = regs.a;
  m.step(0x29d6, 4); // ld d,a
  regs.a = mem.read8(0x620c);
  m.step(0x29d9, 13); // ld a,(0x620c)
  regs.add(0x05);
  m.step(0x29db, 7); // add a,0x05
  regs.cp(regs.d);
  m.step(0x29dc, 4); // cp d
  if (!regs.fNC) {
    m.step(0x29df, 10); // jp nc NOT taken
    // ---- 0x29DF: SKIP EXIT 1 -- discards our return, lands in caller's caller
    regs.a = regs.d;
    m.step(0x29e0, 4); // ld a,d
    regs.sub(0x08);
    m.step(0x29e2, 7); // sub 0x08
    mem.write8(0x6205, regs.a);
    m.step(0x29e5, 13); // ld (0x6205),a
    regs.a = 0x01;
    m.step(0x29e7, 7); // ld a,0x01
    regs.b = regs.a;
    m.step(0x29e8, 4); // ld b,a
    mem.write8(0x6398, regs.a);
    m.step(0x29eb, 13); // ld (0x6398),a
    regs.sp = (regs.sp + 1) & 0xffff;
    m.step(0x29ec, 6); // inc sp
    regs.sp = (regs.sp + 1) & 0xffff;
    m.step(0x29ed, 6); // inc sp -- our return address discarded
    m.ret(); // -> the CALLER'S CALLER
    return false; // SKIPPED the caller
  }
  m.step(0x29ee, 10); // jp nc,0x29ee taken

  regs.a = mem.read8(0x620c);
  m.step(0x29f1, 13); // ld a,(0x620c)
  regs.sub(0x0e);
  m.step(0x29f3, 7); // sub 0x0e
  regs.cp(regs.d);
  m.step(0x29f4, 4); // cp d
  if (regs.fNC) {
    m.step(0x2a1b, 10); // jp nc,0x2a1b
    regs.xor(regs.a);
    m.step(0x2a1c, 4); // xor a
    mem.write8(0x6200, regs.a);
    m.step(0x2a1f, 13); // ld (0x6200),a
    m.ret(); // plain ret
    return true;
  }
  m.step(0x29f7, 10);

  regs.a = mem.read8(0x6210);
  m.step(0x29fa, 13); // ld a,(0x6210)
  regs.and(regs.a);
  m.step(0x29fb, 4); // and a -- sets the Z the jp z below reads
  regs.a = mem.read8(0x6203); // ld a,(0x6203) -- FLAG-NEUTRAL, `and a`'s Z survives
  m.step(0x29fe, 13);
  if (regs.fZ) {
    m.step(0x2a08, 10); // jp z,0x2a08
    regs.sub(0x08);
    m.step(0x2a0a, 7); // sub 0x08
    regs.or(0x07);
    m.step(0x2a0c, 7); // or 0x07
    regs.add(0x04);
    m.step(0x2a0e, 7); // add a,0x04
  } else {
    m.step(0x2a01, 10);
    regs.or(0x07);
    m.step(0x2a03, 7); // or 0x07
    regs.sub(0x04);
    m.step(0x2a05, 7); // sub 0x04
    m.step(0x2a0e, 10); // jp 0x2a0e
  }

  // ---- 0x2A0E: SKIP EXIT 2 -- discards our return, lands in caller's caller
  mem.write8(0x6203, regs.a);
  m.step(0x2a11, 13); // ld (0x6203),a
  mem.write8(0x694c, regs.a);
  m.step(0x2a14, 13); // ld (0x694c),a
  regs.a = 0x01;
  m.step(0x2a16, 7); // ld a,0x01
  regs.b = 0x00;
  m.step(0x2a18, 7); // ld b,0x00
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x2a19, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x2a1a, 6); // inc sp -- our return address discarded
  m.ret(); // -> the CALLER'S CALLER
  return false; // SKIPPED the caller
}

/**
 * entry_2b1c -- ROM 0x2B1C-0x2B28  (calls entry_2b29 then sub_29af; IX = 0x6200).
 * entry_2b29 is a CALLER-SKIP: on every exit but 0x2B70 (ret z) it does pop hl / ret,
 * unwinding PAST entry_2b1c. So `if (!entry_2b29(m)) return;` -- the skip already
 * unwound to entry_2b1c's caller. Only the normal (true) return reaches sub_29af.
 * Translated for completeness; not yet wired into the live dispatcher.
 */
export function entry_2b1c(m) {
  const { regs } = m;
  regs.ix = 0x6200;
  m.step(0x2b20, 14); // ld ix,0x6200
  m.push16(0x2b23); m.step(0x2b29, 17); // call 0x2b29
  if (!entry_2b29(m)) return; // caller-skip: 2b29 (or its 2b9b double-skip) unwound past 2b1c
  m.push16(0x2b26); m.step(0x29af, 17); sub_29af(m); // call 0x29af
  regs.xor(regs.a);
  m.step(0x2b27, 4); // xor a
  regs.b = regs.a;
  m.step(0x2b28, 4); // ld b,a -- B = 0
  m.ret(); // ret (0x2B28) -- only if entry_2b29 returned NORMALLY
}

/**
 * entry_2b29 -- ROM 0x2B29-0x2B9A  (player-vs-tilemap collision probe; CALLER-SKIP).
 * (0x6227)==1 -> probe (X,Y+7); else -> loc_2b53 probe (X-3,Y+7) + (D+7,E). Calls
 * entry_2b9b (tile classifier) up to 3x. Returns a BOOLEAN under the caller-skip
 * convention: true = normal return (0x2B70 ret z) so entry_2b1c continues; false =
 * a pop-hl/ret skip (0x2B51/0x2B74/0x2B99) OR an entry_2b9b DOUBLE-skip (entry_2be1
 * A<=C: pop x2 + ret two frames up), both of which unwind past entry_2b1c.
 *
 * ** entry_2b9b's double-skip (=== false) does its own pop x2 + ret; we
 *    just propagate `return false` here (no extra stack op) so the JS control flow
 *    mirrors the ROM's 2-frame unwind. entry_2b1c's `if (!x) return` completes it. **
 * Translated for completeness; not yet wired into the live dispatcher.
 */
export function entry_2b29(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6227);
  m.step(0x2b2c, 13); // ld a,(0x6227)
  regs.a = regs.dec8(regs.a);
  m.step(0x2b2d, 4); // dec a
  if (regs.fNZ) { m.step(0x2b53, 10); return loc_2b53(m); } // jp nz,0x2b53
  m.step(0x2b30, 10);

  // -- (0x6227)==1 arm: probe (X, Y+7) --
  regs.a = mem.read8(0x6203);
  m.step(0x2b33, 13); // ld a,(0x6203)
  regs.h = regs.a;
  m.step(0x2b34, 4); // ld h,a
  regs.a = mem.read8(0x6205);
  m.step(0x2b37, 13); // ld a,(0x6205)
  regs.add(0x07);
  m.step(0x2b39, 7); // add a,0x07
  regs.l = regs.a;
  m.step(0x2b3a, 4); // ld l,a
  m.push16(0x2b3d); m.step(0x2b9b, 17); // call 0x2b9b
  if (entry_2b9b(m) === false) return false; // entry_2be1 DOUBLE-skip -> unwound past 2b29+2b1c
  regs.and(regs.a);
  m.step(0x2b3e, 4); // and a
  if (regs.fZ) { m.step(0x2b51, 10); return skip_2b51(m); } // jp z,0x2b51 (reject A==0)
  m.step(0x2b41, 10);
  regs.a = regs.e; // E = original L (Y+7)
  m.step(0x2b42, 4); // ld a,e
  regs.sub(regs.c); // C = entry_2be1's column
  m.step(0x2b43, 7); // sub c
  regs.cp(0x04);
  m.step(0x2b45, 7); // cp 0x04
  if (regs.fNC) { m.step(0x2b74, 10); return skip_2b74(m); } // jp nc,0x2b74
  m.step(0x2b48, 10);
  regs.a = regs.c;
  m.step(0x2b49, 4); // ld a,c
  regs.sub(0x07);
  m.step(0x2b4b, 7); // sub 0x07
  mem.write8(0x6205, regs.a); // (0x6205) = C - 7
  m.step(0x2b4e, 13);
  regs.a = 0x01;
  m.step(0x2b50, 7); // ld a,0x01
  regs.b = regs.a; // B = 1
  m.step(0x2b51, 4); // ld b,a -- falls into loc_2b51
  return skip_2b51(m);
}

/** loc_2b51 -- pop hl / ret: SKIP past entry_2b1c (discard 2b29's return, ret to 2b1c's caller). */
function skip_2b51(m) {
  const { regs } = m;
  regs.hl = m.pop16();
  m.step(0x2b52, 10); // pop hl -- discard 2b29's return
  m.ret(); // ret -- to 2b1c's caller
  return false;
}

/** loc_2b74 -- A=0, B=0, then pop hl / ret: SKIP. */
function skip_2b74(m) {
  const { regs } = m;
  regs.a = 0x00;
  m.step(0x2b76, 7); // ld a,0x00
  regs.b = 0x00;
  m.step(0x2b78, 7); // ld b,0x00
  regs.hl = m.pop16();
  m.step(0x2b79, 10); // pop hl
  m.ret();
  return false;
}

/** loc_2b53 -- (0x6227)!=1 arm: probe (X-3, Y+7), classify, maybe a second probe (D+7, E). */
function loc_2b53(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6203);
  m.step(0x2b56, 13); // ld a,(0x6203)
  regs.sub(0x03);
  m.step(0x2b58, 7); // sub 0x03
  regs.h = regs.a;
  m.step(0x2b59, 4); // ld h,a
  regs.a = mem.read8(0x6205);
  m.step(0x2b5c, 13); // ld a,(0x6205)
  regs.add(0x07);
  m.step(0x2b5e, 7); // add a,0x07
  regs.l = regs.a;
  m.step(0x2b5f, 4); // ld l,a
  m.push16(0x2b62); m.step(0x2b9b, 17); // call 0x2b9b
  if (entry_2b9b(m) === false) return false; // double-skip
  regs.cp(0x02);
  m.step(0x2b64, 7); // cp 0x02
  if (regs.fZ) { m.step(0x2b7a, 10); return loc_2b7a(m); } // jp z,0x2b7a (success-2, A==2)
  m.step(0x2b67, 10);
  regs.a = regs.d; // D = original H (X-3)
  m.step(0x2b68, 4); // ld a,d
  regs.add(0x07);
  m.step(0x2b6a, 7); // add a,0x07
  regs.h = regs.a;
  m.step(0x2b6b, 4); // ld h,a
  regs.l = regs.e; // L = E
  m.step(0x2b6c, 4); // ld l,e
  m.push16(0x2b6f); m.step(0x2b9b, 17); // call 0x2b9b
  if (entry_2b9b(m) === false) return false; // double-skip
  regs.and(regs.a);
  m.step(0x2b70, 4); // and a
  if (regs.fZ) { m.ret(11); return true; } // ret z -- NORMAL return (entry_2b1c continues)
  m.step(0x2b71, 5); // ret z not taken
  m.step(0x2b7a, 10); // jp 0x2b7a
  return loc_2b7a(m);
}

/** loc_2b7a -- shared tail: adjust X by (0x6210) parity, store to (0x6203)/(0x694c); pop hl/ret SKIP. */
function loc_2b7a(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6210);
  m.step(0x2b7d, 13); // ld a,(0x6210)
  regs.and(regs.a); // sets Z from (0x6210) -- read by the jp z below
  m.step(0x2b7e, 4); // and a
  regs.a = mem.read8(0x6203); // ld a,(0x6203) -- does NOT touch flags
  m.step(0x2b81, 13);
  if (regs.fZ) { m.step(0x2b8b, 10); return loc_2b8b(m); } // jp z,0x2b8b ((0x6210)==0)
  m.step(0x2b84, 10);
  regs.or(0x07);
  m.step(0x2b86, 7); // or 0x07
  regs.sub(0x04);
  m.step(0x2b88, 7); // sub 0x04
  m.step(0x2b91, 10); // jp 0x2b91
  return loc_2b91(m);
}

/** loc_2b8b -- (0x6210)==0 variant of the X adjust. */
function loc_2b8b(m) {
  const { regs } = m;
  regs.sub(0x08);
  m.step(0x2b8d, 7); // sub 0x08
  regs.or(0x07);
  m.step(0x2b8f, 7); // or 0x07
  regs.add(0x04);
  m.step(0x2b91, 7); // add a,0x04 -- falls into loc_2b91
  return loc_2b91(m);
}

/** loc_2b91 -- store the adjusted X to (0x6203) and (0x694c), A=1, then pop hl/ret SKIP. */
function loc_2b91(m) {
  const { regs, mem } = m;
  mem.write8(0x6203, regs.a);
  m.step(0x2b94, 13); // ld (0x6203),a
  mem.write8(0x694c, regs.a);
  m.step(0x2b97, 13); // ld (0x694c),a
  regs.a = 0x01;
  m.step(0x2b99, 7); // ld a,0x01
  regs.hl = m.pop16();
  m.step(0x2b9a, 10); // pop hl -- discard 2b29's return
  m.ret(); // ret -- SKIP past 2b1c
  return false;
}
/**
 * entry_2b9b -- ROM 0x2B9B-0x2BE0  (tile gate; rejects or falls into entry_2be1)
 *
 *   2b9b  e5           push hl              ; save the ORIGINAL (y,x)
 *   2b9c  cd f0 2f     call 0x2ff0
 *  2b9f d1 pop de ; DE = the ORIGINAL HL
 *   2ba0  7e           ld   a,(hl)
 *   2ba1  fe b0        cp   0xb0
 *   2ba3  da d9 2b     jp   c,0x2bd9        ; REJECT: tile < 0xB0
 *   2ba6  e6 0f        and  0x0f
 *   2ba8  fe 08        cp   0x08
 *   2baa  d2 d9 2b     jp   nc,0x2bd9       ; REJECT: low nibble >= 8
 *   2bad  7e           ld   a,(hl)
 *   2bae  fe c0        cp   0xc0
 *   2bb0  ca d9 2b     jp   z,0x2bd9        ; REJECT: tile == 0xC0
 *   2bb3  da dc 2b     jp   c,0x2bdc        ; tile < 0xC0 -> loc_2bdc
 *   2bb6  fe d0        cp   0xd0
 *   2bb8  da cb 2b     jp   c,0x2bcb
 *   2bbb  fe e0        cp   0xe0
 *   2bbd  da c5 2b     jp   c,0x2bc5
 *   2bc0  fe f0        cp   0xf0
 *   2bc2  da cb 2b     jp   c,0x2bcb
 *   2bc5  e6 0f        and  0x0f            ; loc_2bc5
 *   2bc7  3d           dec  a
 *   2bc8  c3 cf 2b     jp   0x2bcf
 *   2bcb  e6 0f        and  0x0f            ; loc_2bcb
 *   2bcd  d6 09        sub  0x09
 *   2bcf  4f           ld   c,a             ; loc_2bcf
 *   2bd0  7b           ld   a,e
 *   2bd1  e6 f8        and  0xf8
 *   2bd3  81           add  a,c
 *   2bd4  4f           ld   c,a
 *   2bd5  bb           cp   e               ; first `cp r` in games/dkong/translated/ (S6)
 *   2bd6  da e1 2b     jp   c,0x2be1        ; SUCCESS 1 -> entry_2be1
 *   2bd9  af           xor  a               ; loc_2bd9 -- REJECT
 *   2bda  47           ld   b,a
 *   2bdb  c9           ret                  ; A=0, B=0
 *   2bdc  7b           ld   a,e             ; loc_2bdc
 *   2bdd  e6 f8        and  0xf8
 *   2bdf  3d           dec  a
 *   2be0  4f           ld   c,a
 *                      (falls into 0x2BE1)  ; SUCCESS 2 -- silent fall-through
 */
export function entry_2b9b(m) {
  const { regs, mem } = m;

  m.push16(regs.hl); // push hl -- saves the ORIGINAL (y,x) across the call
  m.step(0x2b9c, 11);
  m.push16(0x2b9f); // call 0x2ff0
  m.step(0x2ff0, 17);
  sub_2ff0(m);
  regs.de = m.pop16(); // pop de -- recovers the ORIGINAL HL, not a return value
  m.step(0x2ba0, 10);

  regs.a = mem.read8(regs.hl);
  m.step(0x2ba1, 7); // ld a,(hl)
  regs.cp(0xb0);
  m.step(0x2ba3, 7); // cp 0xb0
  if (regs.fC) {
    m.step(0x2bd9, 10); // jp c,0x2bd9 -- REJECT (tile < 0xB0)
    return reject2b9b(m);
  }
  m.step(0x2ba6, 10);

  regs.and(0x0f);
  m.step(0x2ba8, 7); // and 0x0f
  regs.cp(0x08);
  m.step(0x2baa, 7); // cp 0x08
  if (regs.fNC) {
    m.step(0x2bd9, 10); // jp nc,0x2bd9 -- REJECT (low nibble >= 8)
    return reject2b9b(m);
  }
  m.step(0x2bad, 10);

  regs.a = mem.read8(regs.hl);
  m.step(0x2bae, 7); // ld a,(hl) -- reload the raw tile
  regs.cp(0xc0);
  m.step(0x2bb0, 7); // cp 0xc0
  if (regs.fZ) {
    m.step(0x2bd9, 10); // jp z,0x2bd9 -- REJECT (tile == 0xC0)
    return reject2b9b(m);
  }
  m.step(0x2bb3, 10);
  if (regs.fC) {
    m.step(0x2bdc, 10); // jp c,0x2bdc -- tile < 0xC0
    // ---- loc_2bdc: SUCCESS 2, the SILENT FALL-THROUGH into 0x2BE1 ----
    regs.a = regs.e;
    m.step(0x2bdd, 4); // ld a,e
    regs.and(0xf8);
    m.step(0x2bdf, 7); // and 0xf8
    regs.a = regs.dec8(regs.a);
    m.step(0x2be0, 4); // dec a
    regs.c = regs.a;
    m.step(0x2be1, 4); // ld c,a -- and then FALLS THROUGH into 0x2BE1
    return entry_2be1(m); // now translated: 2b9b's success exit -> entry_2be1
  }
  m.step(0x2bb6, 10);

  // Classify the tile band; both arms converge on loc_2bcf.
  let at;
  regs.cp(0xd0);
  m.step(0x2bb8, 7); // cp 0xd0
  if (regs.fC) {
    m.step(0x2bcb, 10);
    at = 0x2bcb;
  } else {
    m.step(0x2bbb, 10);
    regs.cp(0xe0);
    m.step(0x2bbd, 7); // cp 0xe0
    if (regs.fC) {
      m.step(0x2bc5, 10);
      at = 0x2bc5;
    } else {
      m.step(0x2bc0, 10);
      regs.cp(0xf0);
      m.step(0x2bc2, 7); // cp 0xf0
      if (regs.fC) {
        m.step(0x2bcb, 10);
        at = 0x2bcb;
      } else {
        m.step(0x2bc5, 10); // jp c not taken -- falls into loc_2bc5
        at = 0x2bc5;
      }
    }
  }

  if (at === 0x2bc5) {
    regs.and(0x0f);
    m.step(0x2bc7, 7); // loc_2bc5: and 0x0f
    regs.a = regs.dec8(regs.a);
    m.step(0x2bc8, 4); // dec a
    m.step(0x2bcf, 10); // jp 0x2bcf
  } else {
    regs.and(0x0f);
    m.step(0x2bcd, 7); // loc_2bcb: and 0x0f
    regs.sub(0x09);
    m.step(0x2bcf, 7); // sub 0x09 -- falls into loc_2bcf
  }

  // ---- loc_2bcf: build the column in C and compare against E ----
  regs.c = regs.a;
  m.step(0x2bd0, 4); // ld c,a
  regs.a = regs.e;
  m.step(0x2bd1, 4); // ld a,e
  regs.and(0xf8);
  m.step(0x2bd3, 7); // and 0xf8
  regs.add(regs.c);
  m.step(0x2bd4, 4); // add a,c
  regs.c = regs.a;
  m.step(0x2bd5, 4); // ld c,a
  regs.cp(regs.e); // cp e -- first use of THIS operand; the cp r form is
  // precedented by cp b @ state0.js:1016 (see the S6 correction above)
  m.step(0x2bd6, 4);
  if (regs.fC) {
    m.step(0x2be1, 10); // jp c,0x2be1 -- SUCCESS 1
    return entry_2be1(m); // now translated
  }
  m.step(0x2bd9, 10); // jp c not taken -- falls into the reject

  return reject2b9b(m);
}

export function entry_2be1(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x620c);
  m.step(0x2be4, 13); // ld a,(0x620c)
  regs.sub(mem.read8((regs.ix + 0x05) & 0xffff)); // sub (ix+0x05)
  m.step(0x2be7, 19);
  regs.add(regs.e); // add a,e
  m.step(0x2be8, 4);
  regs.cp(regs.c); // cp c
  m.step(0x2be9, 4);

  if (regs.fZ) {
    m.step(0x2bef, 10); // jp z,0x2bef -- A == C
  } else {
    m.step(0x2bec, 10); // jp z not taken
    if (regs.fNC) {
      // -- loc_2bf8: A > C, PLAIN return --
      m.step(0x2bf8, 10); // jp nc,0x2bf8
      regs.a = 0x02;
      m.step(0x2bfa, 7); // ld a,0x02
      regs.b = 0x00;
      m.step(0x2bfc, 7); // ld b,0x00
      m.ret(); // 0x2BFC -- normal return
      return true;
    }
    m.step(0x2bef, 10); // jp nc not taken (A < C) -- falls into loc_2bef
  }

  // -- loc_2bef: A <= C, store then the double-skip --
  regs.a = regs.c;
  m.step(0x2bf0, 4); // ld a,c
  regs.sub(0x07);
  m.step(0x2bf2, 7); // sub 0x07
  mem.write8(0x6205, regs.a); // (0x6205) = C - 7
  m.step(0x2bf5, 13);
  m.step(0x2bfd, 10); // jp 0x2bfd

  // -- loc_2bfd: A=1, B=1, POP TWICE, ret -> TWO FRAMES UP --
  regs.a = 0x01;
  m.step(0x2bff, 7); // ld a,0x01
  regs.b = regs.a;
  m.step(0x2c00, 4); // ld b,a
  regs.hl = m.pop16(); // pop hl -- discard R1 (2b9b's own return)
  m.step(0x2c01, 10);
  regs.hl = m.pop16(); // pop hl -- discard R2 (2b9b's caller's return) -- DOUBLED
  m.step(0x2c02, 10);
  m.ret(); // 0x2C02 -- rets to R3, two frames above 2b9b's caller
  return false; // double-unwound (see the header)
}

/** loc_2bd9 -- entry_2b9b's REJECT tail: A=0, B=0, plain ret. */
function reject2b9b(m) {
  const { regs } = m;
  regs.xor(regs.a);
  m.step(0x2bda, 4); // xor a
  regs.b = regs.a;
  m.step(0x2bdb, 4); // ld b,a
  m.ret(); // ret (0x2BDB)
}

/**
 * entry_2333 -- ROM 0x2333-0x236D  (coordinate clamp/step; H,L,B -> L)
 *
 *   2333  3e 0f        ld   a,0x0f
 *   2335  a4           and  h              ; A = H & 0x0F
 *   2336  05           dec  b
 *   2337  ca 42 23     jp   z,0x2342
 *   233a  fe 0f        cp   0x0f
 *   233c  d8           ret  c              ; (H&F) < 0x0F -> unchanged
 *   233d  06 ff        ld   b,0xff         ; step -1
 *   233f  c3 47 23     jp   0x2347
 *   2342  fe 01        cp   0x01           ; loc_2342
 *   2344  d0           ret  nc             ; (H&F) >= 1 -> unchanged
 *   2345  06 01        ld   b,0x01         ; step +1
 *   2347  3e f0        ld   a,0xf0         ; loc_2347
 *   2349  bd           cp   l
 *   234a  ca 60 23     jp   z,0x2360       ; L == 0xF0
 *   234d  3e 4c        ld   a,0x4c
 *   234f  bd           cp   l
 *   2350  ca 66 23     jp   z,0x2366       ; L == 0x4C
 *   2353  7d           ld   a,l
 *   2354  cb 6f        bit  5,a
 *   2356  ca 5c 23     jp   z,0x235c       ; bit5 clear -> add
 *   2359  90           sub  b              ; loc_2359: A = L - B   (bit5 set)
 *   235a  6f           ld   l,a            ; loc_235a
 *   235b  c9           ret
 *   235c  80           add  a,b            ; loc_235c: A = L + B   (bit5 clear)
 *   235d  c3 5a 23     jp   0x235a
 *   2360  cb 7c        bit  7,h            ; loc_2360 (L was 0xF0)
 *   2362  c2 59 23     jp   nz,0x2359      ; H bit7 set -> step
 *   2365  c9           ret                 ; H bit7 clear -> unchanged
 *   2366  7c           ld   a,h            ; loc_2366 (L was 0x4C)
 *   2367  fe 98        cp   0x98
 *   2369  d8           ret  c              ; H < 0x98 -> unchanged
 *   236a  7d           ld   a,l
 *   236b  c3 5c 23     jp   0x235c         ; H >= 0x98 -> add path
 */
export function entry_2333(m) {
  const { regs } = m;

  regs.a = 0x0f;
  m.step(0x2335, 7); // ld a,0x0f
  regs.and(regs.h);
  m.step(0x2336, 4); // and h -- A = H & 0x0F
  regs.b = regs.dec8(regs.b);
  m.step(0x2337, 4); // dec b
  if (regs.fZ) {
    m.step(0x2342, 10); // jp z,0x2342 -- loc_2342
    regs.cp(0x01);
    m.step(0x2344, 7); // cp 0x01
    if (regs.fNC) {
      m.ret(11); // ret nc -- (H&F) >= 1 -> L unchanged
      return;
    }
    m.step(0x2345, 5); // ret nc not taken
    regs.b = 0x01;
    m.step(0x2347, 7); // ld b,0x01 -- step +1, falls into loc_2347
  } else {
    m.step(0x233a, 10); // jp z not taken
    regs.cp(0x0f);
    m.step(0x233c, 7); // cp 0x0f
    if (regs.fC) {
      m.ret(11); // ret c -- (H&F) < 0x0F -> L unchanged
      return;
    }
    m.step(0x233d, 5); // ret c not taken
    regs.b = 0xff;
    m.step(0x233f, 7); // ld b,0xff -- step -1
    m.step(0x2347, 10); // jp 0x2347
  }

  // loc_2347: the L step, a small DAG converging on loc_235a (ld l,a / ret).
  let at = 0x2347;
  for (;;) {
    if (at === 0x2347) {
      regs.a = 0xf0;
      m.step(0x2349, 7); // ld a,0xf0
      regs.cp(regs.l);
      m.step(0x234a, 4); // cp l
      if (regs.fZ) { m.step(0x2360, 10); at = 0x2360; continue; } // L == 0xF0
      m.step(0x234d, 10); // jp z not taken
      regs.a = 0x4c;
      m.step(0x234f, 7); // ld a,0x4c
      regs.cp(regs.l);
      m.step(0x2350, 4); // cp l
      if (regs.fZ) { m.step(0x2366, 10); at = 0x2366; continue; } // L == 0x4C
      m.step(0x2353, 10); // jp z not taken
      regs.a = regs.l;
      m.step(0x2354, 4); // ld a,l
      regs.bit(5, regs.a);
      m.step(0x2356, 8); // bit 5,a -- register form, F3/F5 from operand (correct)
      if (regs.fZ) { m.step(0x235c, 10); at = 0x235c; continue; } // bit5 clear -> add
      m.step(0x2359, 10); // jp z not taken -> loc_2359 (bit5 set)
      at = 0x2359;
      continue;
    }
    if (at === 0x2360) {
      regs.bit(7, regs.h);
      m.step(0x2362, 8); // bit 7,h
      if (regs.fZ) { m.step(0x2365, 10); m.ret(10); return; } // jp nz not taken -> ret (unchanged)
      m.step(0x2359, 10); // jp nz taken -> loc_2359
      at = 0x2359;
      continue;
    }
    if (at === 0x2366) {
      regs.a = regs.h;
      m.step(0x2367, 4); // ld a,h
      regs.cp(0x98);
      m.step(0x2369, 7); // cp 0x98
      if (regs.fC) { m.ret(11); return; } // ret c -- H < 0x98 -> unchanged
      m.step(0x236a, 5); // ret c not taken
      regs.a = regs.l;
      m.step(0x236b, 4); // ld a,l
      m.step(0x235c, 10); // jp 0x235c
      at = 0x235c;
      continue;
    }
    if (at === 0x2359) {
      regs.sub(regs.b); // sub b -- A = L - B
      m.step(0x235a, 4);
      at = 0x235a;
      continue;
    }
    if (at === 0x235c) {
      regs.add(regs.b); // add a,b -- A = L + B
      m.step(0x235d, 4);
      m.step(0x235a, 10); // jp 0x235a
      at = 0x235a;
      continue;
    }
    // at === 0x235a
    regs.l = regs.a;
    m.step(0x235b, 4); // ld l,a
    m.ret(10); // ret (0x235B)
    return;
  }
}

/**
 * sub_236e -- ROM 0x236E-0x239B  (cross-partition object-table search; -> A,B)
 *
 * Searches 0x6300.. for the byte in A (BC entries). cpir leaves HL = M+1 (it
 * POST-increments), and the found/not-found signal is the Z FLAG, not cpir's
 * return value (which is the iteration count n). On a hit, a secondary compare
 * of D against two slots selects which of them is returned in B:
 *
 *   M = the matched address.
 *   D == (M+0x15)   ->  A = 1, B = (M+0x2A)     [loc_238f]   ** the OTHER slot **
 *   D == (M+0x2A)   ->  A = 0, B = (M+0x15)     [loc_2395]   ** the OTHER slot **
 *   neither         ->  restore D:=A, A:=key and re-search from M+1  [jp 0x2371]
 *   cpir found none ->  UNWIND (see the header) -- returns false, no A/B contract
 *
 * cpir cost is 21 T per iteration except the last (16 T) => 21*(n-1) + 16, NOT a
 * constant; cpir(mem) returns n precisely so this can be charged.
 *
 * `xor a` at 0x2395 does DOUBLE DUTY: A=0 (the return value) AND it CLEARS THE
 * CARRY that `sbc hl,bc` at 0x2396 subtracts. Writing `regs.a = 0` gets the
 * return value right and the address wrong whenever carry is set.
 *
 * @returns {boolean} true when control returned NORMALLY; false when the miss
 *   path unwound to the caller's caller.
 */
export function sub_236e(m) {
  const { regs, mem } = m;

  regs.hl = 0x6300;
  m.step(0x2371, 10); // ld hl,0x6300

  for (;;) {
    const n = regs.cpir(mem); // leaves HL = M+1; Z set iff a byte matched
    m.step(0x2373, 21 * (n - 1) + 16); // cpir -- NOT a constant (first-use cost)
    if (regs.fNZ) {
      // loc_239a, THE MISS PATH: `pop hl` at 0x239A with NOTHING pushed.
      m.step(0x239a, 10); // jp nz,0x239a (taken)
      regs.hl = m.pop16(); // pop hl -- discards this routine's return address
      m.step(0x239b, 10); // (the pop hl cost)
      m.ret(); // ret -- pops the CALLER's return address, unwinds a second frame
      return false;
    }
    m.step(0x2376, 10); // jp nz,0x239a (not taken)

    m.push16(regs.hl);
    m.step(0x2377, 11); // push hl
    m.push16(regs.bc);
    m.step(0x2378, 11); // push bc
    regs.bc = 0x0014;
    m.step(0x237b, 10); // ld bc,0x0014
    regs.addHl(regs.bc); // HL = M+0x15
    m.step(0x237c, 11); // add hl,bc
    regs.c = regs.inc8(regs.c); // BC -> 0x0015. `inc c`, NOT `inc bc`
    m.step(0x237d, 4); // inc c
    regs.e = regs.a; // E = the search key, saved for the retry
    m.step(0x237e, 4); // ld e,a
    regs.a = regs.d; // A = D. D itself is never modified by this routine
    m.step(0x237f, 4); // ld a,d
    regs.cp(mem.read8(regs.hl)); // D vs (M+0x15)
    m.step(0x2380, 7); // cp (hl)

    if (regs.fZ) {
      // loc_238f -- first candidate matched
      m.step(0x238f, 10); // jp z,0x238f (taken)
      regs.addHl(regs.bc); // HL = M+0x2A
      m.step(0x2390, 11); // add hl,bc
      regs.a = 0x01;
      m.step(0x2392, 7); // ld a,0x01
      m.step(0x2398, 10); // jp 0x2398
      return tail2398(m);
    }
    m.step(0x2383, 10); // jp z,0x238f (not taken)

    regs.addHl(regs.bc); // HL = M+0x2A
    m.step(0x2384, 11); // add hl,bc
    regs.cp(mem.read8(regs.hl)); // D vs (M+0x2A)
    m.step(0x2385, 7); // cp (hl)

    if (regs.fZ) {
      // loc_2395 -- second candidate matched
      m.step(0x2395, 10); // jp z,0x2395 (taken)
      regs.xor(regs.a); // A = 0 AND CARRY CLEARED -- the sbc below needs it
      m.step(0x2396, 4); // xor a
      regs.sbcHl(regs.bc); // HL = M+0x2A - 0x15 = M+0x15. sbcHl ASSIGNS this.hl
      m.step(0x2398, 15); //   and returns nothing -- do NOT write `regs.hl = ...`
      return tail2398(m); // sbc hl,bc
    }
    m.step(0x2388, 10); // jp z,0x2395 (not taken)

    regs.d = regs.a; // writes D back UNCHANGED (A was loaded from D at 0x237E)
    m.step(0x2389, 4); // ld d,a
    regs.a = regs.e; // restore the search key
    m.step(0x238a, 4); // ld a,e
    regs.bc = m.pop16();
    m.step(0x238b, 10); // pop bc
    regs.hl = m.pop16(); // back to M+1 -- the retry resumes AFTER the match
    m.step(0x238c, 10); // pop hl
    m.step(0x2371, 10); // jp 0x2371 -- re-search
  }
}

/*
 * loc_2398-0x239B -- the FOUND tail, reached from both hit paths. NOT the same
 * tail as the miss path: it does `pop bc` and `ld b,(hl)` FIRST, and only then
 * falls into 0x239A's `pop hl`. The miss path enters at 0x239A and does neither
 * (see sub_236e's header). Module-local because both hit paths converge on it,
 * mirroring the ROM's shared 0x2398 tail.
 */
function tail2398(m) {
  const { regs, mem } = m;
  regs.bc = m.pop16(); // restores the caller's BC...
  m.step(0x2399, 10); // pop bc
  regs.b = mem.read8(regs.hl); // ...then immediately overwrites B. C survives.
  m.step(0x239a, 7); // ld b,(hl)
  regs.hl = m.pop16(); // balances the push at 0x2376 -- HL = M+1
  m.step(0x239b, 10); // pop hl
  m.ret(10); // ret
  return true;
}

export function sub_239c(m) {
  const { regs, mem } = m;
  const ixb = (d) => (regs.ix + d) & 0xffff;

  // ---- 16-bit add: (ix+3:4) += (ix+0x10:0x11) ----
  regs.a = mem.read8(ixb(0x04));
  m.step(0x239f, 19); // ld a,(ix+0x04)
  regs.add(mem.read8(ixb(0x11))); // add a,(ix+0x11) -- sets carry
  m.step(0x23a2, 19);
  mem.write8(ixb(0x04), regs.a); // ld (ix+0x04),a
  m.step(0x23a5, 19);
  regs.a = mem.read8(ixb(0x03));
  m.step(0x23a8, 19); // ld a,(ix+0x03)
  regs.adc(mem.read8(ixb(0x10))); // adc a,(ix+0x10) -- consumes the carry
  m.step(0x23ab, 19);
  mem.write8(ixb(0x03), regs.a);
  m.step(0x23ae, 19); // ld (ix+0x03),a

  // ---- 16-bit subtract into HL: (ix+5:6) - (ix+0x12:0x13) ----
  regs.a = mem.read8(ixb(0x06));
  m.step(0x23b1, 19); // ld a,(ix+0x06)
  regs.sub(mem.read8(ixb(0x13))); // sub (ix+0x13) -- sets borrow
  m.step(0x23b4, 19);
  regs.l = regs.a;
  m.step(0x23b5, 4); // ld l,a
  regs.a = mem.read8(ixb(0x05));
  m.step(0x23b8, 19); // ld a,(ix+0x05)
  regs.sbc(mem.read8(ixb(0x12))); // sbc (ix+0x12) -- consumes the borrow
  m.step(0x23bb, 19);
  regs.h = regs.a;
  m.step(0x23bc, 4); // ld h,a

  // ---- B:A = (2*(ix+0x14) + 1) * 8 ----
  regs.a = mem.read8(ixb(0x14));
  m.step(0x23bf, 19); // ld a,(ix+0x14)
  regs.and(regs.a); // and a -- clears carry for the rla
  m.step(0x23c0, 4);
  regs.rla();
  m.step(0x23c1, 4); // rla
  regs.a = regs.inc8(regs.a); // inc a -- leaves carry alone
  m.step(0x23c2, 4);
  regs.b = 0x00;
  m.step(0x23c4, 7); // ld b,0x00
  regs.b = regs.rl(regs.b); // rl b -- captures the rla carry into B
  m.step(0x23c6, 8);
  for (const [slaNext, rlNext] of [[0x23c8, 0x23ca], [0x23cc, 0x23ce], [0x23d0, 0x23d2]]) {
    regs.a = regs.sla(regs.a); // sla a -- FIRST executable use (cpu.js:531)
    m.step(slaNext, 8);
    regs.b = regs.rl(regs.b); // rl b
    m.step(rlNext, 8);
  }

  regs.c = regs.a; // ld c,a -- BC only becomes the operand here
  m.step(0x23d3, 4);
  regs.addHl(regs.bc);
  m.step(0x23d4, 11); // add hl,bc

  // ---- store back (read-modify-write, order forced) ----
  mem.write8(ixb(0x05), regs.h);
  m.step(0x23d7, 19); // ld (ix+0x05),h
  mem.write8(ixb(0x06), regs.l);
  m.step(0x23da, 19); // ld (ix+0x06),l
  mem.write8(ixb(0x14), regs.inc8(mem.read8(ixb(0x14)))); // inc (ix+0x14) -- preserves carry
  m.step(0x23dd, 23);

  m.ret(); // ret (0x23DD) -- carry from add hl,bc and Z from the inc both escape
}

export function sub_23de(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = mem.read8(R(0x0f));
  m.step(0x23e1, 19); // ld a,(ix+0x0f)
  regs.a = regs.dec8(regs.a);
  m.step(0x23e2, 4); // dec a
  if (regs.fNZ) {
    m.step(0x2403, 10); // jp nz,0x2403 -- (ix+0x0F) != 1
    return tail_23de(m, R);
  }
  m.step(0x23e5, 10); // jp nz NOT taken

  regs.xor(regs.a);
  m.step(0x23e6, 4); // xor a
  mem.write8(R(0x07), regs.sla(mem.read8(R(0x07)))); // sla (ix+7); carry=old bit7
  m.step(0x23ea, 23);
  regs.rla();
  m.step(0x23eb, 4); // rla -- carry -> A bit 0
  mem.write8(R(0x08), regs.sla(mem.read8(R(0x08)))); // sla (ix+8)
  m.step(0x23ef, 23);
  regs.rla();
  m.step(0x23f0, 4);
  regs.b = regs.a; // B = the two sign bits
  m.step(0x23f1, 4); // ld b,a
  regs.a = 0x03;
  m.step(0x23f3, 7); // ld a,0x03
  regs.or(regs.c); // A = 0x03 | C (C live-in)
  m.step(0x23f4, 4); // or c
  m.push16(0x23f7);
  m.step(0x3009, 17); // call 0x3009
  entry_3009(m); // returns A
  regs.rra(); // A bit 0 -> carry
  m.step(0x23f8, 4);
  mem.write8(R(0x08), regs.rr(mem.read8(R(0x08)))); // rr (ix+8); carry in
  m.step(0x23fc, 23);
  regs.rra();
  m.step(0x23fd, 4);
  mem.write8(R(0x07), regs.rr(mem.read8(R(0x07)))); // rr (ix+7)
  m.step(0x2401, 23);
  regs.a = 0x04;
  m.step(0x2403, 7); // ld a,0x04
  return tail_23de(m, R);
}

/** tail_23de -- 0x2403-0x2406: write A to (ix+0x0F), ret. */
function tail_23de(m, R) {
  const { regs, mem } = m;
  mem.write8(R(0x0f), regs.a);
  m.step(0x2406, 19); // ld (ix+0x0f),a
  m.ret(10);
}

/**
 * sub_298c / loc_29ac -- ROM 0x298C-0x29AE  (tile-in-range predicate; -> A)
 *
 *   298c  2a c8 63     ld   hl,(0x63c8)
 *   298f  7d           ld   a,l
 *   2990  c6 0e        add  a,0x0e
 *   2992  6f           ld   l,a
 *   2993  56           ld   d,(hl)         ; D = table[+0x0E]
 *   2994  2c           inc  l
 *   2995  7e           ld   a,(hl)
 *   2996  c6 0c        add  a,0x0c
 *   2998  5f           ld   e,a            ; E = table[+0x0F] + 0x0C
 *   2999  eb           ex   de,hl          ; HL = the (y,x) pair
 *   299a  cd f0 2f     call 0x2ff0         ; -> HL = VRAM address
 *   299d  7e           ld   a,(hl)         ; A = tile
 *   299e  fe b0        cp   0xb0
 *   29a0  da ac 29     jp   c,0x29ac       ; tile < 0xB0 -> A=1
 *   29a3  e6 0f        and  0x0f
 *   29a5  fe 08        cp   0x08
 *   29a7  d2 ac 29     jp   nc,0x29ac      ; low nibble >= 8 -> A=1
 *   29aa  af           xor  a              ; IN RANGE -> A=0
 *   29ab  c9           ret
 *   29ac  3e 01        ld   a,0x01         ; loc_29ac
 *   29ae  c9           ret
 */
export function sub_298c(m) {
  const { regs, mem } = m;

  regs.hl = mem.read16(0x63c8);
  m.step(0x298f, 16); // ld hl,(0x63c8)
  regs.a = regs.l;
  m.step(0x2990, 4); // ld a,l
  regs.add(0x0e);
  m.step(0x2992, 7); // add a,0x0e
  regs.l = regs.a;
  m.step(0x2993, 4); // ld l,a -- L += 0x0E (L-only)
  regs.d = mem.read8(regs.hl);
  m.step(0x2994, 7); // ld d,(hl)
  regs.l = regs.inc8(regs.l);
  m.step(0x2995, 4); // inc l
  regs.a = mem.read8(regs.hl);
  m.step(0x2996, 7); // ld a,(hl)
  regs.add(0x0c);
  m.step(0x2998, 7); // add a,0x0c -- E = table[+0x0F] + 0x0C
  regs.e = regs.a;
  m.step(0x2999, 4); // ld e,a
  regs.exDeHl();
  m.step(0x299a, 4); // ex de,hl -- HL = the assembled (y,x)

  m.push16(0x299d); // call 0x2ff0
  m.step(0x2ff0, 17);
  sub_2ff0(m); // translated, stack-balanced -> HL = VRAM address

  regs.a = mem.read8(regs.hl);
  m.step(0x299e, 7); // ld a,(hl) -- tile
  regs.cp(0xb0);
  m.step(0x29a0, 7); // cp 0xb0
  if (regs.fC) {
    m.step(0x29ac, 10); // jp c,0x29ac -- tile < 0xB0
    regs.a = 0x01;
    m.step(0x29ae, 7); // ld a,0x01
    m.ret(); // ret -- A=1
    return;
  }
  m.step(0x29a3, 10); // jp c not taken

  regs.and(0x0f);
  m.step(0x29a5, 7); // and 0x0f
  regs.cp(0x08);
  m.step(0x29a7, 7); // cp 0x08
  if (regs.fNC) {
    m.step(0x29ac, 10); // jp nc,0x29ac -- low nibble >= 8
    regs.a = 0x01;
    m.step(0x29ae, 7); // ld a,0x01
    m.ret(); // ret -- A=1
    return;
  }
  m.step(0x29aa, 10); // jp nc not taken

  regs.xor(regs.a); // xor a -- IN RANGE, A=0
  m.step(0x29ab, 4);
  m.ret(); // ret (0x29AB) -- A=0
}

export function entry_2974(m) {
  const { regs, mem } = m;

  regs.iy = 0x6200;
  m.step(0x2978, 14); // ld iy,0x6200
  regs.a = mem.read8(0x6205);
  m.step(0x297b, 13); // ld a,(0x6205)
  regs.c = regs.a;
  m.step(0x297c, 4); // ld c,a
  regs.hl = 0x0408;
  m.step(0x297f, 10); // ld hl,0x0408
  regs.b = 0x02;
  m.step(0x2981, 7); // ld b,0x02
  regs.de = 0x0010;
  m.step(0x2984, 10); // ld de,0x0010
  regs.ix = 0x6680;
  m.step(0x2988, 14); // ld ix,0x6680

  m.push16(0x298b); // call 0x2913 -- entry_2913's skip path consumes this
  m.step(0x2913, 17);
  if (!entry_2913(m)) return; // HIT (A=1): 2913 already returned past us
  m.ret(10); // ret (0x298B)
}

export function entry_2954(m) {
  const { regs, mem } = m;

  regs.a = 0x0b;
  m.step(0x2956, 7); // ld a,0x0b -- the bit sub_0030 tests
  m.push16(0x2957);
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // gate: selected bit clear -> skipped

  m.push16(0x295a);
  m.step(0x2974, 17); // call 0x2974
  entry_2974(m); // both arms land at 0x295A; A/B = the 2913 result

  mem.write8(0x6218, regs.a);
  m.step(0x295d, 13); // ld (0x6218),a
  regs.rrca();
  m.step(0x295e, 4); // rrca
  regs.rrca();
  m.step(0x295f, 4); // rrca -- A: 1 -> 0x40, 0 -> 0
  mem.write8(0x6085, regs.a);
  m.step(0x2962, 13); // ld (0x6085),a

  regs.a = regs.b;
  m.step(0x2963, 4); // ld a,b -- B names which object entry hit
  regs.and(regs.a);
  m.step(0x2964, 4); // and a
  if (regs.fZ) {
    m.ret(11); // ret z -- B=0 (miss)
    return;
  }
  m.step(0x2965, 5); // ret z NOT taken

  regs.cp(0x01);
  m.step(0x2967, 7); // cp 0x01
  if (regs.fZ) {
    m.step(0x296f, 10); // jp z,0x296f -- B=1
    mem.write8((regs.ix + 0x11) & 0xffff, 0x01);
    m.step(0x2973, 19); // ld (ix+0x11),0x01 -> 0x6691
    m.ret();
    return;
  }
  m.step(0x296a, 10); // jp z NOT taken -- B=2

  mem.write8((regs.ix + 0x01) & 0xffff, 0x01);
  m.step(0x296e, 19); // ld (ix+0x01),0x01 -> 0x6681
  m.ret(); // ret (0x2973)
}

/**
 * sub_28b0 -- ROM 0x28B0-0x28DF  (three entry_2913 sweeps; rst 0x28 tail target)
 *
 *   28b0  e1           pop  hl                 ; recover the dispatcher's HL
 *   28b1  06 05        ld   b,0x05
 *   28b3  78           ld   a,b
 *   28b4  32 b9 63     ld   (0x63b9),a
 *   28b7  11 20 00     ld   de,0x0020
 *   28ba  dd 21 00 64  ld   ix,0x6400
 *   28be  cd 13 29     call 0x2913            ; GUARDED
 *   28c1  06 06        ld   b,0x06 ...         ; group 2: ld e,0x10 (D survives), ix=0x65a0
 *   28cd  cd 13 29     call 0x2913            ; GUARDED
 *   28d0  06 01        ld   b,0x01 ...         ; group 3: ld e,0x00 (stride 0), ix=0x66a0
 *   28dc  cd 13 29     call 0x2913            ; GUARDED
 *   28df  c9           ret
 */
export function sub_28b0(m) {
  const { regs, mem } = m;

  regs.hl = m.pop16(); // pop hl -- the dispatcher's pushed HL (2913's axis-2 bounds)
  m.step(0x28b1, 10);

  // group 1: B=5, DE=0x0020, IX=0x6400
  regs.b = 0x05;
  m.step(0x28b3, 7); // ld b,0x05
  regs.a = regs.b;
  m.step(0x28b4, 4); // ld a,b
  mem.write8(0x63b9, regs.a);
  m.step(0x28b7, 13); // ld (0x63b9),a
  regs.de = 0x0020;
  m.step(0x28ba, 10); // ld de,0x0020
  regs.ix = 0x6400;
  m.step(0x28be, 14); // ld ix,0x6400
  m.push16(0x28c1); // call 0x2913
  m.step(0x2913, 17);
  if (!entry_2913(m)) return true; // 2913 HIT skipped us -> our caller resumes

  // group 2: B=6, E=0x10 (D preserved = 0x00), IX=0x65a0
  regs.b = 0x06;
  m.step(0x28c3, 7); // ld b,0x06
  regs.a = regs.b;
  m.step(0x28c4, 4); // ld a,b
  mem.write8(0x63b9, regs.a);
  m.step(0x28c7, 13); // ld (0x63b9),a
  regs.e = 0x10;
  m.step(0x28c9, 7); // ld e,0x10 -- E only; D stays 0x00 across the calls
  regs.ix = 0x65a0;
  m.step(0x28cd, 14); // ld ix,0x65a0
  m.push16(0x28d0); // call 0x2913
  m.step(0x2913, 17);
  if (!entry_2913(m)) return true;

  // group 3: B=1, E=0x00 (stride 0x0000), IX=0x66a0
  regs.b = 0x01;
  m.step(0x28d2, 7); // ld b,0x01
  regs.a = regs.b;
  m.step(0x28d3, 4); // ld a,b
  mem.write8(0x63b9, regs.a);
  m.step(0x28d6, 13); // ld (0x63b9),a
  regs.e = 0x00;
  m.step(0x28d8, 7); // ld e,0x00 -- stride 0
  regs.ix = 0x66a0;
  m.step(0x28dc, 14); // ld ix,0x66a0
  m.push16(0x28df); // call 0x2913
  m.step(0x2913, 17);
  if (!entry_2913(m)) return true;

  m.ret(); // ret (0x28DF)
  return true; // all sweeps completed normally -> caller continues
}

export function sub_286f(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6227);
  m.step(0x2872, 13); // ld a,(0x6227)
  m.push16(regs.hl); // push hl -- survives to the target's pop hl
  m.step(0x2873, 11);

  m.push16(0x2874); // rst 0x28 pushes its return address = the TABLE BASE (0x2874)
  m.step(0x0028, 11);
  sub_0028(m, "0x2874 (0x6227 collision dispatch)"); // reads the table from ROM; ends in jp (hl)
}

export function sub_2880(m) {
  const { regs, mem } = m;

  regs.hl = m.pop16(); // pop hl -- recover sub_286f's pushed HL (balances the stack)
  m.step(0x2881, 10);

  // -- sweep 1: 0x6700, count 0x0A, stride 0x0020 --
  regs.b = 0x0a;
  m.step(0x2883, 7); // ld b,0x0a
  regs.a = regs.b;
  m.step(0x2884, 4); // ld a,b
  mem.write8(0x63b9, regs.a); // 0x63B9 = count
  m.step(0x2887, 13);
  regs.de = 0x0020; // D=0x00 LIVE across the next two calls
  m.step(0x288a, 10); // ld de,0x0020
  regs.ix = 0x6700;
  m.step(0x288e, 14); // ld ix,0x6700
  m.push16(0x2891);
  m.step(0x2913, 17);
  if (!entry_2913(m)) return false; // HIT: 2913 unwound to sub_2808 w/ A=1 -- STOP (preserves D)

  // -- sweep 2: 0x6400, count 0x05 (only E reloaded; D stays 0x00) --
  regs.b = 0x05;
  m.step(0x2893, 7); // ld b,0x05
  regs.a = regs.b;
  m.step(0x2894, 4); // ld a,b
  mem.write8(0x63b9, regs.a);
  m.step(0x2897, 13);
  regs.e = 0x20; // E only -- DE = 0x0020
  m.step(0x2899, 7); // ld e,0x20
  regs.ix = 0x6400;
  m.step(0x289d, 14); // ld ix,0x6400
  m.push16(0x28a0);
  m.step(0x2913, 17);
  if (!entry_2913(m)) return false; // HIT: caller-skip already unwound to sub_2808 -- STOP

  // -- sweep 3: 0x66A0, count 0x01, stride 0x0000 (E=0, D stays 0x00) --
  regs.b = 0x01;
  m.step(0x28a2, 7); // ld b,0x01
  regs.a = regs.b;
  m.step(0x28a3, 4); // ld a,b
  mem.write8(0x63b9, regs.a);
  m.step(0x28a6, 13);
  regs.e = 0x00; // E only -- DE = 0x0000
  m.step(0x28a8, 7); // ld e,0x00
  regs.ix = 0x66a0;
  m.step(0x28ac, 14); // ld ix,0x66a0
  m.push16(0x28af);
  m.step(0x2913, 17);
  if (!entry_2913(m)) return false; // HIT: caller-skip already unwound to sub_2808 -- STOP

  m.ret(); // ret (0x28AF) -- all sweeps missed
}

export function sub_2808(m) {
  const { regs, mem } = m;

  regs.iy = 0x6200;
  m.step(0x280c, 14); // ld iy,0x6200
  regs.a = mem.read8(0x6205);
  m.step(0x280f, 13); // ld a,(0x6205)
  regs.c = regs.a;
  m.step(0x2810, 4); // ld c,a
  regs.hl = 0x0407;
  m.step(0x2813, 10); // ld hl,0x0407
  m.push16(0x2816);
  m.step(0x286f, 17); // call 0x286f -- returns A
  sub_286f(m);

  regs.and(regs.a);
  m.step(0x2817, 4); // and a
  if (regs.fZ) {
    m.ret(11); // ret z
    return;
  }
  m.step(0x2818, 5); // ret z NOT taken
  regs.a = regs.dec8(regs.a);
  m.step(0x2819, 4); // dec a
  mem.write8(0x6200, regs.a); // 0x6200 = A - 1
  m.step(0x281c, 13); // ld (0x6200),a
  m.ret(); // ret (0x281C)
}

export function loc_281d(m) {
  const { regs, mem } = m;

  regs.b = 0x02;
  m.step(0x281f, 7); // ld b,0x02
  regs.de = 0x0010;
  m.step(0x2822, 10); // ld de,0x0010
  regs.iy = 0x6680;
  m.step(0x2826, 14); // ld iy,0x6680

  for (;;) {
    regs.bit(0, mem.read8((regs.iy + 0x01) & 0xffff)); // bit 0,(iy+0x01)
    m.step(0x282a, 20);
    if (regs.fNZ) {
      m.step(0x2832, 10); // jp nz,0x2832 -- found
      break;
    }
    m.step(0x282d, 10); // jp nz not taken
    regs.addIy(regs.de); // add iy,de -- FIRST executable use of addIy
    m.step(0x282f, 15);
    regs.djnz();
    if (regs.b !== 0) {
      m.step(0x2826, 13); // djnz 0x2826
      continue;
    }
    m.step(0x2831, 8); // djnz not taken
    m.ret(); // none found
    return;
  }

  // -- loc_2832: found --
  regs.c = mem.read8((regs.iy + 0x05) & 0xffff);
  m.step(0x2835, 19); // ld c,(iy+0x05)
  regs.h = mem.read8((regs.iy + 0x09) & 0xffff);
  m.step(0x2838, 19); // ld h,(iy+0x09)
  regs.l = mem.read8((regs.iy + 0x0a) & 0xffff);
  m.step(0x283b, 19); // ld l,(iy+0x0a)

  m.push16(0x283e);
  m.step(0x286f, 17); // call 0x286f -- in HL/C; out A, IX
  sub_286f(m);

  regs.and(regs.a);
  m.step(0x283f, 4); // and a
  if (regs.fZ) {
    m.ret(11); // ret z -- A == 0, not stored
    return;
  }
  m.step(0x2840, 5); // ret z NOT taken

  mem.write8(0x6350, regs.a);
  m.step(0x2843, 13); // ld (0x6350),a
  regs.a = mem.read8(0x63b9); // set by 0x286f
  m.step(0x2846, 13); // ld a,(0x63b9)
  regs.sub(regs.b); // sub b -- 0x63B9 - B
  m.step(0x2847, 4);
  mem.write8(0x6354, regs.a);
  m.step(0x284a, 13); // ld (0x6354),a
  regs.a = regs.e;
  m.step(0x284b, 4); // ld a,e
  mem.write8(0x6353, regs.a);
  m.step(0x284e, 13); // ld (0x6353),a
  mem.write16(0x6351, regs.ix); // ld (0x6351),ix -- IX from 0x286f
  m.step(0x2852, 20);
  m.ret(); // ret (0x2852)
}

/**
 * sub_28e0 -- ROM 0x28E0-0x2900  (two entry_2913 sweeps; twin of sub_28b0)
 *   twin diffs: two groups (not three); group 2 B=0x0A, IX=0x6500.
 */
export function sub_28e0(m) {
  const { regs, mem } = m;

  regs.hl = m.pop16(); // pop hl
  m.step(0x28e1, 10);

  regs.b = 0x05;
  m.step(0x28e3, 7); // ld b,0x05
  regs.a = regs.b;
  m.step(0x28e4, 4); // ld a,b
  mem.write8(0x63b9, regs.a);
  m.step(0x28e7, 13); // ld (0x63b9),a
  regs.de = 0x0020;
  m.step(0x28ea, 10); // ld de,0x0020
  regs.ix = 0x6400;
  m.step(0x28ee, 14); // ld ix,0x6400
  m.push16(0x28f1); // call 0x2913
  m.step(0x2913, 17);
  if (!entry_2913(m)) return true;

  regs.b = 0x0a;
  m.step(0x28f3, 7); // ld b,0x0a
  regs.a = regs.b;
  m.step(0x28f4, 4); // ld a,b
  mem.write8(0x63b9, regs.a);
  m.step(0x28f7, 13); // ld (0x63b9),a
  regs.e = 0x10;
  m.step(0x28f9, 7); // ld e,0x10 -- D preserved
  regs.ix = 0x6500;
  m.step(0x28fd, 14); // ld ix,0x6500
  m.push16(0x2900); // call 0x2913
  m.step(0x2913, 17);
  if (!entry_2913(m)) return true;

  m.ret(); // ret (0x2900)
  return true;
}

/**
 * sub_2901 -- ROM 0x2901-0x2912  (one entry_2913 sweep; twin of sub_28b0)
 *   twin diffs: one group; B=0x07, DE=0x0020, IX=0x6400.
 */
export function sub_2901(m) {
  const { regs, mem } = m;

  regs.hl = m.pop16(); // pop hl
  m.step(0x2902, 10);

  regs.b = 0x07;
  m.step(0x2904, 7); // ld b,0x07
  regs.a = regs.b;
  m.step(0x2905, 4); // ld a,b
  mem.write8(0x63b9, regs.a);
  m.step(0x2908, 13); // ld (0x63b9),a
  regs.de = 0x0020;
  m.step(0x290b, 10); // ld de,0x0020
  regs.ix = 0x6400;
  m.step(0x290f, 14); // ld ix,0x6400
  m.push16(0x2912); // call 0x2913
  m.step(0x2913, 17);
  if (!entry_2913(m)) return true;

  m.ret(); // ret (0x2912)
  return true;
}

/**
 * sub_2207 -- ROM 0x2207-0x2239  (0x197a cascade: rst 0x30 gate-head)
 *
 *   2207  3e 02        ld   a,0x02
 *   2209  f7           rst  0x30        ; gate: rotate A right mem[0x6227] times; carry -> body,
 *                                       ; else skip -> return to caller. SKIPS on coin_start.
 *   220a  ...          (body -- NON-EXECUTING frontier; object update over 0x6280 -> ret 0x2239)
 *
 * A rst-0x30-gated head reached via `call 0x2207` @0x199B (197a cascade). On the
 * measured coin_start tape the gate SKIPS -- only the 3-byte head executes; the body
 * 0x220A-0x2239 is a non-executing frontier (NotImplemented marks it, like the loc_0c92
 * untranslated arms).
 */
export function sub_2207(m) {
  const { regs } = m;

  regs.a = 0x02;
  m.step(0x2209, 7); // ld a,0x02
  m.push16(0x220a); // rst 0x30 pushes the body address
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // gate SKIPPED (coin_start) -> returned to caller

  return sub_2207_body(m); // 0x220A: the object-update body (now translated)
}
/**
 * sub_22bd -- ROM 0x22BD-0x22CA  (bit-3-of-L selected copy of (HL) -> (DE))
 *
 *   22bd  7e           ld   a,(hl)
 *   22be  cb 5d        bit  3,l           ; Z = !bit3(L)
 *   22c0  11 4b 69     ld   de,0x694b
 *   22c3  c2 c9 22     jp   nz,0x22c9     ; bit3 set -> keep 0x694B
 *   22c6  11 47 69     ld   de,0x6947     ; bit3 clear -> 0x6947
 *   22c9  12           ld   (de),a        ; loc_22c9
 *   22ca  c9           ret
 */
export function sub_22bd(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.hl);
  m.step(0x22be, 7); // ld a,(hl)
  regs.bit(3, regs.l); // bit 3,l -- register form, F3/F5 from operand (correct)
  m.step(0x22c0, 8);
  regs.de = 0x694b;
  m.step(0x22c3, 10); // ld de,0x694b
  if (regs.fNZ) {
    m.step(0x22c9, 10); // jp nz,0x22c9 -- bit3 set, keep DE=0x694B
  } else {
    m.step(0x22c6, 10); // jp nz not taken
    regs.de = 0x6947;
    m.step(0x22c9, 10); // ld de,0x6947
  }
  mem.write8(regs.de, regs.a);
  m.step(0x22ca, 7); // ld (de),a
  m.ret(); // ret (0x22CA)
}
/**
 * sub_22cb -- OBJECT VELOCITY INIT (difficulty/mode/RNG scaled).  ROM 0x22CB-0x2302
 * Called from 0x2149. IX live-in
 * (object record). Sets (ix+0x11)=magnitude, (ix+0x10)=(A&1)-1 (0x00 odd / 0xFF even).
 *
 *   22cb  ld a,(0x6348) / and a / jp z,0x22e1   ; mode 0 -> loc_22e1 (0x6229 pick)
 *   22d2  ld a,(0x6380) / dec a / rst 0x28      ; difficulty 0..5, index = diff-1
 *   22d7  dw 22f6,22f6,2303,2303,231a           ; INLINE table: diff 1/2->22f6 (RNG,
 *                                               ;   internal); diff 3/4->2303, 5->231a
 *                                               ;   (EXTERNAL, non-executing frontier)
 *
 * The rst 0x28 body (ROM 0x0028-0x0037) is modelled FAITHFULLY (push/pop balanced,
 * table read from ROM), per the sub_0f56 rst-0x28 discipline -- NOT summarised as a
 * JS array (that hides the pop hl and the register/flag clobber). On the coin_start
 * tape difficulty is 1 -> 0x22F6, so 0x2303/0x231a are a non-executing frontier.
 */
export function sub_22cb(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6348); // mode flag
  m.step(0x22ce, 13); // ld a,(0x6348)
  regs.and(regs.a);
  m.step(0x22cf, 4); // and a
  if (regs.fZ) {
    m.step(0x22e1, 10); // jp z,0x22e1 -- mode 0
    return loc_22e1(m);
  }
  m.step(0x22d2, 10); // jp z NOT taken

  regs.a = mem.read8(0x6380); // difficulty 0..5
  m.step(0x22d5, 13); // ld a,(0x6380)
  regs.a = regs.dec8(regs.a); // dec a -- index = difficulty - 1
  m.step(0x22d6, 4);
  m.push16(0x22d7); // rst 0x28 pushes the address AFTER it -- the TABLE BASE
  m.step(0x0028, 11); // rst 0x28

  // -- inline rst 0x28 body (ROM 0x0028-0x0037), modelled faithfully (sub_0f56 discipline) --
  regs.add(regs.a);
  m.step(0x0029, 4); // add a,a -- A = 2*index
  regs.hl = m.pop16(); // pop hl -- table base 0x22D7 (balances the push)
  m.step(0x002a, 10);
  regs.e = regs.a;
  m.step(0x002b, 4); // ld e,a
  regs.d = 0x00;
  m.step(0x002d, 7); // ld d,0x00
  m.step(0x0032, 10); // jp 0x0032
  regs.addHl(regs.de); // add hl,de -- HL = table base + 2*index (flags dead into targets)
  m.step(0x0033, 11);
  regs.e = mem.read8(regs.hl);
  m.step(0x0034, 7); // ld e,(hl)
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0035, 6); // inc hl
  regs.d = mem.read8(regs.hl);
  m.step(0x0036, 7); // ld d,(hl)
  const target = regs.de; // ex de,hl -- HL becomes the target
  regs.de = regs.hl;
  regs.hl = target;
  m.step(0x0037, 4); // ex de,hl
  m.step(target, 4); // jp (hl)

  if (target === 0x22f6) return loc_22f6(m); // diff 1/2 -> RNG (internal)
  if (target === 0x2303) return loc_2303(m); // diff 3/4
  if (target === 0x231a) return loc_231a(m); // diff 5
  throw new NotImplemented(
    `sub_22cb rst 0x28 dispatches to unexpected ROM 0x${target.toString(16).padStart(4, "0")}`,
  );
}

/** loc_22e1 -- mode 0: pick A from (0x6229): 1 -> 0x01, 2 -> 0xB1, else 0xE9; jp loc_22f9. */
function loc_22e1(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6229);
  m.step(0x22e4, 13); // ld a,(0x6229)
  regs.b = regs.a;
  m.step(0x22e5, 4); // ld b,a
  regs.b = regs.dec8(regs.b); // dec b -- sets Z read by the jp z below
  m.step(0x22e6, 4);
  regs.a = 0x01;
  m.step(0x22e8, 7); // ld a,0x01
  if (regs.fZ) { m.step(0x22f9, 10); return loc_22f9(m); } // (0x6229)==1
  m.step(0x22eb, 10);
  regs.b = regs.dec8(regs.b);
  m.step(0x22ec, 4); // dec b
  regs.a = 0xb1;
  m.step(0x22ee, 7); // ld a,0xb1
  if (regs.fZ) { m.step(0x22f9, 10); return loc_22f9(m); } // (0x6229)==2
  m.step(0x22f1, 10);
  regs.a = 0xe9;
  m.step(0x22f3, 7); // ld a,0xe9
  m.step(0x22f9, 10); // jp 0x22f9
  return loc_22f9(m);
}

/** loc_22f6 -- the RNG velocity (difficulty 1/2): A = (0x6018); falls into loc_22f9. */
function loc_22f6(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6018); // RNG
  m.step(0x22f9, 13); // ld a,(0x6018)
  return loc_22f9(m);
}

/** loc_22f9 -- store the velocity pair: (ix+0x11)=A; (ix+0x10)=(A&1)-1 (0x00 odd/0xFF even). */
function loc_22f9(m) {
  const { regs, mem } = m;
  mem.write8((regs.ix + 0x11) & 0xffff, regs.a); // ld (ix+0x11),a -- magnitude/value
  m.step(0x22fc, 19);
  regs.and(0x01); // isolate bit 0
  m.step(0x22fe, 7);
  regs.a = regs.dec8(regs.a); // dec a -- 0x00 (bit0 set) or 0xFF (clear) = direction sign
  m.step(0x22ff, 4);
  mem.write8((regs.ix + 0x10) & 0xffff, regs.a); // ld (ix+0x10),a
  m.step(0x2302, 19);
  m.ret(10); // ret (0x2302)
}

export function sub_21ee(m) {
  const { regs, mem } = m;

  regs.de = 0x21d1;
  m.step(0x21f1, 10); // ld de,0x21d1
  regs.hl = 0x63cc;
  m.step(0x21f4, 10); // ld hl,0x63cc

  regs.a = mem.read8(regs.hl); // A = script index
  m.step(0x21f5, 7); // ld a,(hl)
  regs.rlca(); // rotate (bit 7 wraps into bit 0)
  m.step(0x21f6, 4);
  regs.add(regs.e); // 8-bit add -- no carry into D
  m.step(0x21f7, 4);
  regs.e = regs.a;
  m.step(0x21f8, 4); // ld e,a

  regs.a = mem.read8(regs.de); // the input byte for this script step
  m.step(0x21f9, 7); // ld a,(de)
  mem.write8(0x6010, regs.a); // overwrite the decoded player input
  m.step(0x21fc, 13);

  regs.l = regs.inc8(regs.l); // inc l -- HL 0x63CC -> 0x63CD
  m.step(0x21fd, 4);
  regs.a = mem.read8(regs.hl); // READ BEFORE the RMW: PRE-decrement value
  m.step(0x21fe, 7);
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl))); // dec (hl) -- 0xFF when it was 0
  m.step(0x21ff, 11);
  regs.and(regs.a); // tests the PRE-decrement value
  m.step(0x2200, 4);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- still counting down this step
    return;
  }
  m.step(0x2201, 5); // ret nz NOT taken -- falls through

  regs.e = regs.inc8(regs.e); // inc e -- no carry into D
  m.step(0x2202, 4);
  regs.a = mem.read8(regs.de); // the duration byte of this pair
  m.step(0x2203, 7);
  mem.write8(regs.hl, regs.a); // reload 0x63CD (overwriting the 0xFF)
  m.step(0x2204, 7);
  regs.l = regs.dec8(regs.l); // dec l -- HL 0x63CD -> 0x63CC
  m.step(0x2205, 4);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // advance the script index
  m.step(0x2206, 11);
  m.ret(10); // ret (0x2206)
}

export function sub_216d(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  m.push16(0x2170); // `call` PUSHES -- 236e's pop/ret consume it on the miss
  m.step(0x216d, 17); // call 0x236e
  if (!sub_236e(m)) return; // cpir miss: 236e already ret'd to 0x216A

  regs.a = regs.dec8(regs.a);
  m.step(0x2171, 4); // dec a
  if (regs.fNZ) {
    m.ret(11); // ret nz -- 236e returned A=0 variant
    return;
  }
  m.step(0x2172, 5); // ret nz NOT taken

  regs.a = regs.b;
  m.step(0x2173, 4); // ld a,b
  regs.sub(0x05); // wraps if B < 5
  m.step(0x2175, 7);
  mem.write8(R(0x17), regs.a);
  m.step(0x2178, 19); // ld (ix+0x17),a

  regs.a = mem.read8(0x6348);
  m.step(0x217b, 13); // ld a,(0x6348)
  regs.and(regs.a);
  m.step(0x217c, 4); // and a
  if (regs.fZ) {
    m.step(0x21b2, 10); // jp z,0x21b2 -- straight to the success tail
    return tail21b2(m, R);
  }
  m.step(0x217f, 10); // jp z not taken

  regs.a = mem.read8(0x6205);
  m.step(0x2182, 13); // ld a,(0x6205)
  regs.sub(0x04);
  m.step(0x2184, 7); // sub 0x04
  regs.cp(regs.d); // D = caller's L+5, laundered through 236e
  m.step(0x2185, 4); // cp d
  if (regs.fC) {
    m.ret(11); // ret c
    return;
  }
  m.step(0x2186, 5); // ret c NOT taken -- CARRY IS PROVEN 0 HERE

  regs.a = mem.read8(0x6380); // difficulty 0-5
  m.step(0x2189, 13);
  regs.rra(); // carry proven 0, so == A>>1
  m.step(0x218a, 4);
  regs.a = regs.inc8(regs.a);
  m.step(0x218b, 4); // inc a
  regs.b = regs.a; // B = (difficulty >> 1) + 1
  m.step(0x218c, 4); // ld b,a

  regs.a = mem.read8(0x6018); // the RNG
  m.step(0x218f, 13);
  regs.c = regs.a; // C keeps the FULL rng byte (reread at 0x21AE)
  m.step(0x2190, 4); // ld c,a
  regs.and(0x03);
  m.step(0x2192, 7); // and 0x03
  regs.cp(regs.b);
  m.step(0x2193, 4); // cp b
  if (!regs.fC) {
    m.ret(11); // ret nc -- the difficulty gate rejected this call
    return;
  }
  m.step(0x2194, 5); // ret nc NOT taken

  regs.hl = 0x6010; // the player-input byte
  m.step(0x2197, 10); // ld hl,0x6010
  regs.a = mem.read8(0x6203);
  m.step(0x219a, 13); // ld a,(0x6203)
  regs.cp(regs.e); // E = caller's H, set inside 236e
  m.step(0x219b, 4); // cp e
  if (regs.fZ) {
    m.step(0x21b2, 10); // jp z,0x21b2
    return tail21b2(m, R);
  }
  m.step(0x219e, 10); // jp z not taken

  if (!regs.fC) {
    // jp nc,0x21a9 -- Z excluded above, so strictly >
    m.step(0x21a9, 10);
    regs.bit(1, mem.read8(regs.hl));
    m.step(0x21ab, 12); // bit 1,(hl)
    if (regs.fNZ) {
      m.step(0x21b2, 10);
      return tail21b2(m, R);
    }
    m.step(0x21ae, 10); // bit 1 == 0
    return tail21ae(m, R);
  }
  m.step(0x21a1, 10); // jp nc not taken (A < E)

  regs.bit(0, mem.read8(regs.hl));
  m.step(0x21a3, 12); // bit 0,(hl)
  if (regs.fZ) {
    m.step(0x21ae, 10);
    return tail21ae(m, R);
  }
  m.step(0x21a6, 10); // bit 0 != 0
  m.step(0x21b2, 10); // jp 0x21b2 -- unconditional
  return tail21b2(m, R);
}

/** tail21ae -- 216D interior: RNG & 0x18 gate -> ret nz, else tail21b2. */
function tail21ae(m, R) {
  const { regs } = m;
  regs.a = regs.c; // the full RNG byte saved at 0x218F
  m.step(0x21af, 4); // ld a,c
  regs.and(0x18);
  m.step(0x21b1, 7); // and 0x18
  if (regs.fNZ) {
    m.ret(11); // ret nz
    return;
  }
  m.step(0x21b2, 5); // ret nz NOT taken
  return tail21b2(m, R);
}

/** tail21b2 -- 216D success tail: inc (ix+0x07), set 0,(ix+0x02). */
function tail21b2(m, R) {
  const { regs, mem } = m;
  regs.incMem8(mem, R(0x07)); // inc (ix+0x07)
  m.step(0x21b5, 23);
  mem.write8(R(0x02), regs.set(0, mem.read8(R(0x02)))); // set 0,(ix+0x02) -- FIRST use of set
  m.step(0x21b9, 23);
  m.ret(10); // ret (0x21B9)
}

/**
 * entry_24b4 -- ROM 0x24B4-0x24E9  (bounds gate; early ret or return-splice to 0x21ba)
 *
 *   24b4  dd 7e 05     ld   a,(ix+0x05)
 *   24b7  fe e8        cp   0xe8
 *   24b9  d8           ret  c            ; (ix+5) < 0xE8 -> RETURN
 *   24ba  dd 7e 03     ld   a,(ix+0x03)
 *   24bd  fe 2a        cp   0x2a
 *   24bf  d0           ret  nc           ; (ix+3) >= 0x2A -> RETURN
 *   24c0  fe 20        cp   0x20         ; SAME A -- range test on (ix+3)
 *   24c2  d8           ret  c            ; (ix+3) < 0x20 -> RETURN
 *   24c3  dd 7e 15     ld   a,(ix+0x15)
 *   24c6  a7           and  a
 *   24c7  ca d0 24     jp   z,0x24d0
 *   24ca  3e 03        ld   a,0x03
 *   24cc  32 b9 62     ld   (0x62b9),a
 *   24cf  af           xor  a
 *   24d0  dd 77 00     ld   (ix+0x00),a  ; loc_24d0 -- A=0 on both paths
 *   24d3  dd 77 03     ld   (ix+0x03),a
 *   24d6  21 82 60     ld   hl,0x6082
 *   24d9  36 03        ld   (hl),0x03
 *   24db  e1           pop  hl           ; pops the caller's return, forwarded to 0x21ba
 *   24dc  3a 48 63     ld   a,(0x6348)
 *   24df  a7           and  a
 *   24e0  c2 ba 21     jp   nz,0x21ba
 *   24e3  3c           inc  a
 *   24e4  32 48 63     ld   (0x6348),a   ; one-shot latch := 1
 *   24e7  c3 ba 21     jp   0x21ba       ; does NOT return to caller
 *
 * @returns {boolean} true when control returned to the caller (the three early
 *   rets). The main path does not return -- it throws (0x21ba untranslated).
 */
export function entry_24b4(m) {
  const { regs, mem } = m;

  regs.a = mem.read8((regs.ix + 0x05) & 0xffff);
  m.step(0x24b7, 19); // ld a,(ix+0x05)
  regs.cp(0xe8);
  m.step(0x24b9, 7); // cp 0xe8
  if (regs.fC) {
    m.ret(11); // ret c -- (ix+5) < 0xE8, normal return
    return true;
  }
  m.step(0x24ba, 5); // ret c not taken

  regs.a = mem.read8((regs.ix + 0x03) & 0xffff);
  m.step(0x24bd, 19); // ld a,(ix+0x03)
  regs.cp(0x2a);
  m.step(0x24bf, 7); // cp 0x2a
  if (regs.fNC) {
    m.ret(11); // ret nc -- (ix+3) >= 0x2A
    return true;
  }
  m.step(0x24c0, 5); // ret nc not taken
  regs.cp(0x20); // cp 0x20 -- SAME A (ix+3), no reload; completes 0x20..0x29
  m.step(0x24c2, 7);
  if (regs.fC) {
    m.ret(11); // ret c -- (ix+3) < 0x20
    return true;
  }
  m.step(0x24c3, 5); // ret c not taken

  regs.a = mem.read8((regs.ix + 0x15) & 0xffff);
  m.step(0x24c6, 19); // ld a,(ix+0x15)
  regs.and(regs.a);
  m.step(0x24c7, 4); // and a
  if (regs.fZ) {
    m.step(0x24d0, 10); // jp z,0x24d0 -- A already 0
  } else {
    m.step(0x24ca, 10); // jp z not taken
    regs.a = 0x03;
    m.step(0x24cc, 7); // ld a,0x03
    mem.write8(0x62b9, regs.a);
    m.step(0x24cf, 13); // ld (0x62b9),a -- shared cell := 3
    regs.xor(regs.a); // xor a -- A := 0
    m.step(0x24d0, 4);
  }

  // loc_24d0 -- A = 0 on both paths; reset (ix+0), (ix+3), then the splice.
  mem.write8((regs.ix + 0x00) & 0xffff, regs.a);
  m.step(0x24d3, 19); // ld (ix+0x00),a
  mem.write8((regs.ix + 0x03) & 0xffff, regs.a);
  m.step(0x24d6, 19); // ld (ix+0x03),a
  regs.hl = 0x6082;
  m.step(0x24d9, 10); // ld hl,0x6082
  mem.write8(regs.hl, 0x03);
  m.step(0x24db, 10); // ld (hl),0x03

  // *** RETURN SPLICE: pop the caller's return address into HL. NOT a discard --
  // it is forwarded live to 0x21ba (whose first op is exx). Control does NOT
  // return to this routine's caller from here.
  regs.hl = m.pop16();
  m.step(0x24dc, 10); // pop hl
  regs.a = mem.read8(0x6348);
  m.step(0x24df, 13); // ld a,(0x6348)
  regs.and(regs.a);
  m.step(0x24e0, 4); // and a
  if (regs.fNZ) {
    m.step(0x21ba, 10); // jp nz,0x21ba taken -- 0x6348 already non-zero
    loc_21ba(m); // SPLICE -> 21ba's exx + the loop (forwards the popped caller-return in HL)
    return false; // skip-capable: signal caller NOT to continue inline (exx-parity fix)
  }
  m.step(0x24e3, 10); // jp nz not taken
  regs.a = regs.inc8(regs.a);
  m.step(0x24e4, 4); // inc a
  mem.write8(0x6348, regs.a);
  m.step(0x24e7, 13); // ld (0x6348),a -- one-shot latch := 1
  m.step(0x21ba, 10); // jp 0x21ba
  loc_21ba(m); // SPLICE -> 21ba's exx + the loop (forwards the popped caller-return in HL)
  return false; // skip-capable: signal caller NOT to continue inline (exx-parity fix)
}

export function sub_2591(m) {
  const { regs, mem } = m;
  const IX = (d) => (regs.ix + d) & 0xffff;

  regs.ix = 0x65a0;
  m.step(0x2595, 14); // ld ix,0x65a0
  regs.de = 0x0010; // LIVE-OUT -- do not clobber
  m.step(0x2598, 10); // ld de,0x0010
  regs.b = 0x06;
  m.step(0x259a, 7); // ld b,0x06

  for (;;) {
    // -- loc_259a: per-slot; all paths converge at 0x25BB --
    let doCull = false;
    regs.bit(0, mem.read8(IX(0x00)));
    m.step(0x259e, 20); // bit 0,(ix+0x00)

    if (regs.fZ) {
      m.step(0x25bb, 10); // jp z,0x25bb -- inactive slot
    } else {
      m.step(0x25a1, 10); // jp z not taken
      regs.a = mem.read8(IX(0x03));
      m.step(0x25a4, 19); // ld a,(ix+0x03)
      regs.h = regs.a; // H = ORIGINAL field3
      m.step(0x25a5, 4); // ld h,a
      regs.add(0x07); // scratch copy
      m.step(0x25a7, 7); // add a,0x07
      regs.cp(0x0e);
      m.step(0x25a9, 7); // cp 0x0e
      if (regs.fC) {
        doCull = true;
        m.step(0x25d6, 10); // jp c,0x25d6 -- (field3+7) < 0x0E
      } else {
        m.step(0x25ac, 10); // jp c not taken
        regs.a = mem.read8(IX(0x05));
        m.step(0x25af, 19); // ld a,(ix+0x05)
        regs.cp(0x7c);
        m.step(0x25b1, 7); // cp 0x7c
        if (regs.fZ) {
          // -- loc_25c0: field5 == 0x7C --
          m.step(0x25c0, 10); // jp z,0x25c0
          regs.a = regs.h;
          m.step(0x25c1, 4); // ld a,h
          regs.cp(0x80);
          m.step(0x25c3, 7); // cp 0x80
          if (regs.fZ) {
            doCull = true;
            m.step(0x25d6, 10); // jp z,0x25d6 -- field3 == 0x80
          } else {
            if (regs.fNC) {
              m.step(0x25c9, 13); // jp z not taken -- field3 > 0x80
              regs.a = mem.read8(0x63a5);
              m.step(0x25cf, 10); // jp nc,0x25cf
            } else {
              m.step(0x25cc, 10); // jp nc not taken -- field3 < 0x80
              regs.a = mem.read8(0x63a4);
              m.step(0x25cf, 13); // ld a,(0x63a4)
            }
            regs.add(regs.h);
            m.step(0x25d0, 4); // add a,h
            mem.write8(IX(0x03), regs.a);
            m.step(0x25d3, 19); // ld (ix+0x03),a
            m.step(0x25bb, 10); // jp 0x25bb
          }
        } else {
          m.step(0x25b4, 10); // jp z not taken -- field5 != 0x7C
          regs.a = mem.read8(0x63a6);
          m.step(0x25b7, 13); // ld a,(0x63a6)
          regs.add(regs.h);
          m.step(0x25b8, 4); // add a,h
          mem.write8(IX(0x03), regs.a);
          m.step(0x25bb, 19); // ld (ix+0x03),a
        }
      }

      if (doCull) {
        // -- loc_25d6: cull --
        regs.hl = 0x69b8;
        m.step(0x25d9, 10); // ld hl,0x69b8
        regs.a = 0x06;
        m.step(0x25db, 7); // ld a,0x06
        regs.sub(regs.b); // A = 6 - B = slot index
        m.step(0x25dc, 4); // sub b
        for (;;) {
          // -- loc_25dc: advance HL by 4 per remaining slot index --
          if (regs.fZ) {
            m.step(0x25e7, 10); // jp z,0x25e7
            break;
          }
          m.step(0x25df, 10); // jp z not taken
          regs.l = regs.inc8(regs.l);
          m.step(0x25e0, 4);
          regs.l = regs.inc8(regs.l);
          m.step(0x25e1, 4);
          regs.l = regs.inc8(regs.l);
          m.step(0x25e2, 4);
          regs.l = regs.inc8(regs.l);
          m.step(0x25e3, 4);
          regs.a = regs.dec8(regs.a);
          m.step(0x25e4, 4);
          m.step(0x25dc, 10); // jp 0x25dc
        }
        regs.xor(regs.a); // A = 0
        m.step(0x25e8, 4);
        mem.write8(IX(0x00), regs.a); // clear field0
        m.step(0x25eb, 19);
        mem.write8(IX(0x03), regs.a); // clear field3
        m.step(0x25ee, 19);
        mem.write8(regs.hl, regs.a); // clear the 0x69B8 record byte
        m.step(0x25ef, 7);
        m.step(0x25bb, 10); // jp 0x25bb
      }
    }

    // -- loc_25bb: advance to the next slot (shared by all paths) --
    regs.addIx(regs.de); // add ix,de -- DE stays 0x10
    m.step(0x25bd, 15);
    regs.djnz();
    if (regs.b !== 0) {
      m.step(0x259a, 13); // djnz 0x259a
      continue;
    }
    m.step(0x25bf, 8); // djnz not taken
    m.ret();
    return;
  }
}

export function sub_24ea(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = 0x02; // the rst 0x30 rotate input
  m.step(0x24ec, 7); // ld a,0x02
  m.push16(0x24ed);
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // caller-skip: (0x6227)-bit test -> abort

  m.push16(0x24f0);
  m.step(0x2523, 17); // call 0x2523
  sub_2523(m);
  m.push16(0x24f3);
  m.step(0x2591, 17); // call 0x2591 -- leaves DE=0x10
  sub_2591(m);

  regs.ix = 0x65a0;
  m.step(0x24f7, 14); // ld ix,0x65a0
  regs.b = 0x06;
  m.step(0x24f9, 7); // ld b,0x06
  regs.hl = 0x69b8;
  m.step(0x24fc, 10); // ld hl,0x69b8

  do {
    regs.a = mem.read8(R(0x00));
    m.step(0x24ff, 19); // ld a,(ix+0x00)
    regs.and(regs.a);
    m.step(0x2500, 4); // and a
    if (regs.fZ) {
      // -- loc_251c: inactive slot -- skip its 4 buffer bytes --
      m.step(0x251c, 10); // jp z,0x251c
      regs.a = regs.l;
      m.step(0x251d, 4); // ld a,l
      regs.add(0x04);
      m.step(0x251f, 7); // add a,0x04
      regs.l = regs.a;
      m.step(0x2520, 4); // ld l,a
      m.step(0x2517, 10); // jp 0x2517 -- to the shared advance
    } else {
      m.step(0x2503, 10); // jp z not taken
      regs.a = mem.read8(R(0x03));
      m.step(0x2506, 19); // ld a,(ix+0x03)
      mem.write8(regs.hl, regs.a);
      m.step(0x2507, 7); // ld (hl),a
      regs.l = regs.inc8(regs.l);
      m.step(0x2508, 4); // inc l
      regs.a = mem.read8(R(0x07));
      m.step(0x250b, 19); // ld a,(ix+0x07)
      mem.write8(regs.hl, regs.a);
      m.step(0x250c, 7); // ld (hl),a
      regs.l = regs.inc8(regs.l);
      m.step(0x250d, 4); // inc l
      regs.a = mem.read8(R(0x08));
      m.step(0x2510, 19); // ld a,(ix+0x08)
      mem.write8(regs.hl, regs.a);
      m.step(0x2511, 7); // ld (hl),a
      regs.l = regs.inc8(regs.l);
      m.step(0x2512, 4); // inc l
      regs.a = mem.read8(R(0x05));
      m.step(0x2515, 19); // ld a,(ix+0x05)
      mem.write8(regs.hl, regs.a);
      m.step(0x2516, 7); // ld (hl),a
      regs.l = regs.inc8(regs.l);
      m.step(0x2517, 4); // inc l
    }
    regs.addIx(regs.de); // add ix,de -- DE = 0x10 (from sub_2591)
    m.step(0x2519, 15);
    regs.b = (regs.b - 1) & 0xff; // djnz
    m.step(regs.b !== 0 ? 0x24fc : 0x251b, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(10); // ret (0x251B)
}

/**
 * entry_2c72 -- ROM 0x2C72-0x2C7A  (set bit 7 of 0x6382)
 *
 *   2c72  3a 82 63     ld   a,(0x6382)
 *   2c75  f6 80        or   0x80
 *   2c77  32 82 63     ld   (0x6382),a
 *   2c7a  c9           ret
 */
export function entry_2c72(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6382);
  m.step(0x2c75, 13); // ld a,(0x6382)
  regs.or(0x80); // or 0x80 -- set bit 7, low bits preserved
  m.step(0x2c77, 7);
  mem.write8(0x6382, regs.a);
  m.step(0x2c7a, 13); // ld (0x6382),a
  m.ret(); // ret (0x2C7A)
}
/**
 * entry_2cb8 -- free-slot claim; flows into entry_2ce6.  ROM 0x2CB8-0x2CE5.
 * IX/B live-in (from entry_2c8f's jp nc,0x2CB8 -- still a NotImplemented stub
 * there). Not yet wired into the live dispatcher.
 * (0x62AC) = 0x6980 + (10-B)*4; (0x6386)=1 only if (0x62B1) dec -> 0. `ld (nn),ix`
 * @0x2CB8 is 20T (precedented at state0.js:11248, not a first-use).
 */
export function entry_2cb8(m) {
  const { regs, mem } = m;
  mem.write16(0x62aa, regs.ix); // ld (0x62aa),ix -- 20T
  m.step(0x2cbc, 20);
  mem.write8((regs.ix + 0x00) & 0xffff, 0x02);
  m.step(0x2cc0, 19); // ld (ix+0x00),0x02
  regs.d = 0x00;
  m.step(0x2cc2, 7); // ld d,0x00
  regs.a = 0x0a;
  m.step(0x2cc4, 7); // ld a,0x0a
  regs.sub(regs.b);
  m.step(0x2cc5, 4); // sub b -- 10 - B
  regs.add(regs.a);
  m.step(0x2cc6, 4); // add a,a (*2)
  regs.add(regs.a);
  m.step(0x2cc7, 4); // add a,a (*4)
  regs.e = regs.a;
  m.step(0x2cc8, 4); // ld e,a (DE = (10-B)*4)
  regs.hl = 0x6980;
  m.step(0x2ccb, 10); // ld hl,0x6980
  regs.addHl(regs.de);
  m.step(0x2ccc, 11); // add hl,de
  mem.write16(0x62ac, regs.hl);
  m.step(0x2ccf, 16); // ld (0x62ac),hl
  regs.a = 0x01;
  m.step(0x2cd1, 7); // ld a,0x01
  mem.write8(0x6393, regs.a);
  m.step(0x2cd4, 13); // ld (0x6393),a
  regs.de = 0x0501;
  m.step(0x2cd7, 10); // ld de,0x0501
  m.push16(0x2cda); m.step(0x309f, 17); sub_309f(m); // call 0x309f
  regs.hl = 0x62b1;
  m.step(0x2cdd, 10); // ld hl,0x62b1
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x2cde, 11); // dec (0x62b1)
  if (regs.fNZ) { m.step(0x2ce6, 10); return entry_2ce6(m); } // jp nz,0x2ce6
  m.step(0x2ce1, 10);
  regs.a = 0x01;
  m.step(0x2ce3, 7); // ld a,0x01
  mem.write8(0x6386, regs.a);
  m.step(0x2ce6, 13); // ld (0x6386),a -- falls into entry_2ce6
  return entry_2ce6(m);
}

/**
 * entry_2ce6 / entry_2cf6 -- slot-field init.  ROM 0x2CE6-0x2D14; flows into loc_2d15.
 * HL/IX live-in. entry_2ce6: (hl) >= 4 -> entry_2cf6; else clear 0x69A8 + (hl)*4.
 * entry_2cf6: (ix+7/8/15) default (0x15,0x0B,0x00), then (0x19,0x0C,0x01) if (0x6382)
 * bit7 set (rlca -> carry); flows into loc_2d15.
 */
export function entry_2ce6(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(regs.hl);
  m.step(0x2ce7, 7); // ld a,(hl)
  regs.cp(0x04);
  m.step(0x2ce9, 7); // cp 0x04
  if (regs.fNC) { m.step(0x2cf6, 10); return entry_2cf6(m); } // jp nc,0x2cf6
  m.step(0x2cec, 10);
  regs.hl = 0x69a8;
  m.step(0x2cef, 10); // ld hl,0x69a8
  regs.add(regs.a);
  m.step(0x2cf0, 4); // add a,a (*2)
  regs.add(regs.a);
  m.step(0x2cf1, 4); // add a,a (*4)
  regs.e = regs.a;
  m.step(0x2cf2, 4); // ld e,a
  regs.d = 0x00;
  m.step(0x2cf4, 7); // ld d,0x00
  regs.addHl(regs.de);
  m.step(0x2cf5, 11); // add hl,de -- HL = 0x69A8 + (hl)*4
  mem.write8(regs.hl, regs.d);
  m.step(0x2cf6, 7); // ld (hl),d -- (hl) = 0 (D == 0)
  return entry_2cf6(m);
}

export function entry_2cf6(m) {
  const { regs, mem } = m;
  const ixb = (d) => (regs.ix + d) & 0xffff;
  mem.write8(ixb(0x07), 0x15);
  m.step(0x2cfa, 19); // ld (ix+0x07),0x15 -- default (written even on the set path)
  mem.write8(ixb(0x08), 0x0b);
  m.step(0x2cfe, 19); // ld (ix+0x08),0x0b
  mem.write8(ixb(0x15), 0x00);
  m.step(0x2d02, 19); // ld (ix+0x15),0x00
  regs.a = mem.read8(0x6382);
  m.step(0x2d05, 13); // ld a,(0x6382)
  regs.rlca();
  m.step(0x2d06, 4); // rlca -- bit 7 -> carry
  if (regs.fNC) { m.step(0x2d15, 10); return loc_2d15(m); } // jp nc,0x2d15 (bit7 clear -> keep defaults)
  m.step(0x2d09, 10);
  mem.write8(ixb(0x07), 0x19);
  m.step(0x2d0d, 19); // ld (ix+0x07),0x19 -- overwrite (bit7 set)
  mem.write8(ixb(0x08), 0x0c);
  m.step(0x2d11, 19); // ld (ix+0x08),0x0c
  mem.write8(ixb(0x15), 0x01);
  m.step(0x2d15, 19); // ld (ix+0x15),0x01 -- falls into loc_2d15
  return loc_2d15(m);
}
/**
 * loc_2d15 -- frame-gated string/sprite renderer (the 2c-cluster convergence).
 * ROM 0x2D15-0x2DDA (198 bytes). Reached by fall-through from entry_2cf6.
 *
 * Frame gate on (0x62AF); a (0x638F) sub-counter selects an animation table (c*40 + 0x3932)
 * via call 0x004E; then a per-frame CHAR loop (loc_2d54) walks a 0x39xx string through
 * pointer (0x62A8), writing 4-byte records at (0x62AC)=DE with fields from IX=(0x62AA).
 * A 0x7F terminator -> loc_2d8c reinitialises the object record (IX+0..+14) + rst 0x38.
 * Three exits: ret nz frame gate, ret 0x2D82 (per-char), ret 0x2DDA (reinit). `ld ix,(nn)`
 * (0x2D55) is 20T (precedented at state0.js:8990, verified vs MAME).
 */
export function loc_2d15(m) {
  const { regs, mem } = m;

  regs.hl = 0x62af;
  m.step(0x2d18, 10); // ld hl,0x62af
  regs.decMem8(mem, regs.hl);
  m.step(0x2d19, 11); // dec (hl) -- (0x62af)--
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- frame gate
  m.step(0x2d1a, 5);
  mem.write8(regs.hl, 0x18);
  m.step(0x2d1c, 10); // ld (hl),0x18 -- reload
  regs.a = mem.read8(0x638f);
  m.step(0x2d1f, 13); // ld a,(0x638f)
  regs.and(regs.a);
  m.step(0x2d20, 4); // and a
  if (regs.fZ) { m.step(0x2d51, 10); return loc_2d51(m); } // jp z,0x2d51
  m.step(0x2d23, 10);
  regs.c = regs.a;
  m.step(0x2d24, 4); // ld c,a
  regs.hl = 0x3932;
  m.step(0x2d27, 10); // ld hl,0x3932
  regs.a = mem.read8(0x6382);
  m.step(0x2d2a, 13); // ld a,(0x6382)
  regs.rrca();
  m.step(0x2d2b, 4); // rrca -- C = bit0(0x6382)
  if (regs.fC) {
    m.step(0x2d2f, 10); // jp c,0x2d2f (skip dec c)
  } else {
    m.step(0x2d2e, 10);
    regs.c = regs.dec8(regs.c);
    m.step(0x2d2f, 4); // dec c
  }
  // -- loc_2d2f: C * 40 -> DE --
  regs.a = regs.c;
  m.step(0x2d30, 4); // ld a,c
  regs.add(regs.a);
  m.step(0x2d31, 4); // add a,a (*2)
  regs.add(regs.a);
  m.step(0x2d32, 4); // add a,a (*4)
  regs.add(regs.a);
  m.step(0x2d33, 4); // add a,a (*8)
  regs.c = regs.a;
  m.step(0x2d34, 4); // ld c,a (C = c*8)
  regs.add(regs.a);
  m.step(0x2d35, 4); // add a,a (*16)
  regs.add(regs.a);
  m.step(0x2d36, 4); // add a,a (*32)
  regs.add(regs.c);
  m.step(0x2d37, 4); // add a,c (A = c*40)
  regs.e = regs.a;
  m.step(0x2d38, 4); // ld e,a
  regs.d = 0x00;
  m.step(0x2d3a, 7); // ld d,0x00 (DE = c*40)
  regs.addHl(regs.de);
  m.step(0x2d3b, 11); // add hl,de (HL = 0x3932 + c*40)
  m.push16(0x2d3e); m.step(0x004e, 17); sub_004e(m); // call 0x004e
  regs.hl = 0x638f;
  m.step(0x2d41, 10); // ld hl,0x638f
  regs.decMem8(mem, regs.hl);
  m.step(0x2d42, 11); // dec (hl) -- (0x638f)--
  if (regs.fNZ) { m.step(0x2d51, 10); return loc_2d51(m); } // jp nz,0x2d51
  m.step(0x2d45, 10);
  regs.a = 0x01;
  m.step(0x2d47, 7); // ld a,0x01
  mem.write8(0x62af, regs.a);
  m.step(0x2d4a, 13); // ld (0x62af),a
  regs.a = mem.read8(0x6382);
  m.step(0x2d4d, 13); // ld a,(0x6382)
  regs.rrca();
  m.step(0x2d4e, 4); // rrca
  if (regs.fC) { m.step(0x2d83, 10); return loc_2d83(m); } // jp c,0x2d83
  m.step(0x2d51, 10); // jp c NOT taken -> fall into loc_2d51
  return loc_2d51(m);
}

/** loc_2d51 -- load the string pointer (0x62A8), fall into loc_2d54. */
function loc_2d51(m) {
  const { regs, mem } = m;
  regs.hl = mem.read16(0x62a8);
  m.step(0x2d54, 16); // ld hl,(0x62a8)
  return loc_2d54(m);
}

/** loc_2d54 -- char loop body: write a 4-byte record via DE=(0x62AC), IX=(0x62AA); 0x7F -> loc_2d8c. */
function loc_2d54(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(regs.hl);
  m.step(0x2d55, 7); // ld a,(hl)
  regs.ix = mem.read16(0x62aa);
  m.step(0x2d59, 20); // ld ix,(0x62aa) -- 20T
  regs.de = mem.read16(0x62ac);
  m.step(0x2d5d, 20); // ld de,(0x62ac)
  regs.cp(0x7f);
  m.step(0x2d5f, 7); // cp 0x7f
  if (regs.fZ) { m.step(0x2d8c, 10); return loc_2d8c(m); } // jp z,0x2d8c (terminator)
  m.step(0x2d62, 10);
  regs.c = regs.a;
  m.step(0x2d63, 4); // ld c,a -- C = char (bit7 = attribute)
  regs.and(0x7f);
  m.step(0x2d65, 7); // and 0x7f
  mem.write8(regs.de, regs.a);
  m.step(0x2d66, 7); // ld (de),a -- store char
  regs.a = mem.read8((regs.ix + 0x07) & 0xffff);
  m.step(0x2d69, 19); // ld a,(ix+0x07)
  regs.bit(7, regs.c);
  m.step(0x2d6b, 8); // bit 7,c
  if (regs.fZ) {
    m.step(0x2d70, 10); // jp z,0x2d70 (bit7 clear -> skip xor)
  } else {
    m.step(0x2d6e, 10);
    regs.xor(0x03);
    m.step(0x2d70, 7); // xor 0x03 -- flip bits 0,1
  }
  // -- loc_2d70 --
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x2d71, 6); // inc de
  mem.write8(regs.de, regs.a);
  m.step(0x2d72, 7); // ld (de),a
  mem.write8((regs.ix + 0x07) & 0xffff, regs.a);
  m.step(0x2d75, 19); // ld (ix+0x07),a
  regs.a = mem.read8((regs.ix + 0x08) & 0xffff);
  m.step(0x2d78, 19); // ld a,(ix+0x08)
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x2d79, 6); // inc de
  mem.write8(regs.de, regs.a);
  m.step(0x2d7a, 7); // ld (de),a
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2d7b, 6); // inc hl
  regs.a = mem.read8(regs.hl);
  m.step(0x2d7c, 7); // ld a,(hl)
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x2d7d, 6); // inc de
  mem.write8(regs.de, regs.a);
  m.step(0x2d7e, 7); // ld (de),a
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2d7f, 6); // inc hl
  mem.write16(0x62a8, regs.hl);
  m.step(0x2d82, 16); // ld (0x62a8),hl
  m.ret(); // ret (EXIT: per-char, 0x2D82)
}

/** loc_2d83 -- wrap the string pointer to 0x39CC, re-enter loc_2d54. */
function loc_2d83(m) {
  const { regs, mem } = m;
  regs.hl = 0x39cc;
  m.step(0x2d86, 10); // ld hl,0x39cc
  mem.write16(0x62a8, regs.hl);
  m.step(0x2d89, 16); // ld (0x62a8),hl
  m.step(0x2d54, 10); // jp 0x2d54
  return loc_2d54(m);
}

/** loc_2d8c -- 0x7F terminator: reinit the object record (IX+0..+14) + call 0x004E + rst 0x38. */
function loc_2d8c(m) {
  const { regs, mem } = m;
  regs.hl = 0x39c3;
  m.step(0x2d8f, 10); // ld hl,0x39c3
  mem.write16(0x62a8, regs.hl);
  m.step(0x2d92, 16); // ld (0x62a8),hl
  mem.write8((regs.ix + 0x01) & 0xffff, 0x01);
  m.step(0x2d96, 19); // ld (ix+0x01),0x01
  regs.a = mem.read8(0x6382);
  m.step(0x2d99, 13); // ld a,(0x6382)
  regs.rrca();
  m.step(0x2d9a, 4); // rrca
  if (regs.fC) {
    m.step(0x2da5, 10); // jp c,0x2da5 (keep ix+1=1)
  } else {
    m.step(0x2d9d, 10);
    mem.write8((regs.ix + 0x01) & 0xffff, 0x00);
    m.step(0x2da1, 19); // ld (ix+0x01),0x00
    mem.write8((regs.ix + 0x02) & 0xffff, 0x02);
    m.step(0x2da5, 19); // ld (ix+0x02),0x02
  }
  // -- loc_2da5 --
  mem.write8((regs.ix + 0x00) & 0xffff, 0x01);
  m.step(0x2da9, 19); // ld (ix+0x00),0x01
  mem.write8((regs.ix + 0x0f) & 0xffff, 0x01);
  m.step(0x2dad, 19); // ld (ix+0x0f),0x01
  regs.xor(regs.a);
  m.step(0x2dae, 4); // xor a
  mem.write8((regs.ix + 0x10) & 0xffff, regs.a);
  m.step(0x2db1, 19); // ld (ix+0x10),a
  mem.write8((regs.ix + 0x11) & 0xffff, regs.a);
  m.step(0x2db4, 19); // ld (ix+0x11),a
  mem.write8((regs.ix + 0x12) & 0xffff, regs.a);
  m.step(0x2db7, 19); // ld (ix+0x12),a
  mem.write8((regs.ix + 0x13) & 0xffff, regs.a);
  m.step(0x2dba, 19); // ld (ix+0x13),a
  mem.write8((regs.ix + 0x14) & 0xffff, regs.a);
  m.step(0x2dbd, 19); // ld (ix+0x14),a
  mem.write8(0x6393, regs.a);
  m.step(0x2dc0, 13); // ld (0x6393),a
  mem.write8(0x6392, regs.a);
  m.step(0x2dc3, 13); // ld (0x6392),a
  regs.a = mem.read8(regs.de);
  m.step(0x2dc4, 7); // ld a,(de)
  mem.write8((regs.ix + 0x03) & 0xffff, regs.a);
  m.step(0x2dc7, 19); // ld (ix+0x03),a
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x2dc8, 6); // inc de
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x2dc9, 6); // inc de
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x2dca, 6); // inc de
  regs.a = mem.read8(regs.de);
  m.step(0x2dcb, 7); // ld a,(de)
  mem.write8((regs.ix + 0x05) & 0xffff, regs.a);
  m.step(0x2dce, 19); // ld (ix+0x05),a
  regs.hl = 0x385c;
  m.step(0x2dd1, 10); // ld hl,0x385c
  m.push16(0x2dd4); m.step(0x004e, 17); sub_004e(m); // call 0x004e
  regs.hl = 0x690b;
  m.step(0x2dd7, 10); // ld hl,0x690b
  regs.c = 0xfc;
  m.step(0x2dd9, 7); // ld c,0xfc
  m.push16(0x2dda); m.step(0x0038, 11); loc_0038(m); // rst 0x38 = CALL loc_0038
  m.ret(); // ret (EXIT: reinit, 0x2DDA)
}

export function entry_2ddb(m) {
  const { regs, mem } = m;

  regs.a = 0x0a;
  m.push16(0x2dde);
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // skip gate
  m.push16(0x2ddf);
  m.step(0x0010, 11); // rst 0x10
  if (!sub_0010(m)) return; // skip gate

  regs.a = mem.read8(0x6380);
  m.step(0x2de2, 13); // ld a,(0x6380)
  regs.a = regs.inc8(regs.a);
  m.step(0x2de3, 4); // inc a
  regs.and(regs.a); // clears carry
  m.step(0x2de4, 4); // and a
  regs.rra(); // ((0x6380)+1) >> 1
  m.step(0x2de5, 4); // rra
  regs.b = regs.a;
  m.step(0x2de6, 4); // ld b,a
  regs.a = mem.read8(0x6227);
  m.step(0x2de9, 13); // ld a,(0x6227)
  regs.cp(0x02);
  m.step(0x2deb, 7); // cp 0x02
  if (regs.fZ) {
    m.step(0x2ded, 12); // jp z,0x2ded
    regs.b = regs.inc8(regs.b);
    m.step(0x2dee, 4); // inc b
  } else {
    m.step(0x2dee, 7); // jp z not taken
  }

  regs.a = 0xfe;
  m.step(0x2df0, 7); // ld a,0xfe
  regs.scf(); // seed carry
  m.step(0x2df1, 4); // scf
  do {
    // loc_2df1: build the mask
    regs.rra();
    m.step(0x2df2, 4); // rra
    regs.and(regs.a); // CLEAR carry -- must not drop
    m.step(0x2df3, 4); // and a
    regs.djnz();
    m.step(regs.b !== 0 ? 0x2df1 : 0x2df5, regs.b !== 0 ? 13 : 8); // djnz 0x2df1
  } while (regs.b !== 0);

  regs.b = regs.a;
  m.step(0x2df6, 4); // ld b,a
  regs.a = mem.read8(0x601a);
  m.step(0x2df9, 13); // ld a,(0x601a)
  regs.and(regs.b); // (0x601a) & mask
  m.step(0x2dfa, 4); // and b
  if (regs.fNZ) {
    m.ret(11); // ret nz -- masked bit set -> no trigger
    return;
  }
  m.step(0x2dfb, 5); // ret nz NOT taken

  regs.a = 0x01;
  m.step(0x2dfd, 7); // ld a,0x01
  mem.write8(0x63a0, regs.a);
  m.step(0x2e00, 13); // ld (0x63a0),a
  mem.write8(0x639a, regs.a);
  m.step(0x2e03, 13); // ld (0x639a),a
  m.ret(); // ret (0x2E03)
}
/**
 * entry_2e04 -- per-object actor/animation updater.  ROM 0x2E04-0x2ED3.
 * rst 0x30 / rst 0x10 skip gates (A=0x04), then scan 10 objects: IX=0x6500 stride 0x10,
 * IY=0x6980 stride 0x04. Per object: bit0 of (ix+0) active? Every-16-frame toggle (iy+1)^=7;
 * state 4 -> loc_2e84 (rise/deactivate); else advance (ix+3)+=2, walk the 0x39xx string via
 * (ix+0e/0f) (0x7F -> loc_2e9c reset), accumulate into (ix+5); at the 0xB7 boundary + a
 * terminator, set state 4 + sound; mirror (ix+3)/(ix+5) to IY. Inactive -> loc_2ea7 spawns
 * on (0x6396) bit0. Uses add iy,de (addIy).
 */
export function entry_2e04(m) {
  const { regs } = m;
  regs.a = 0x04;
  m.step(0x2e06, 7); // ld a,0x04
  m.push16(0x2e07); m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // skip gate
  m.push16(0x2e08); m.step(0x0010, 11); // rst 0x10
  if (!sub_0010(m)) return; // skip gate
  regs.ix = 0x6500;
  m.step(0x2e0c, 14); // ld ix,0x6500
  regs.iy = 0x6980;
  m.step(0x2e10, 14); // ld iy,0x6980
  regs.b = 0x0a;
  m.step(0x2e12, 7); // ld b,0x0a
  do {
    obj_2e12(m); // one object -- ends at loc_2e78's add iy,de (0x2E81 = the djnz)
    regs.djnz();
    m.step(regs.b !== 0 ? 0x2e12 : 0x2e83, regs.b !== 0 ? 13 : 8); // djnz 0x2e12
  } while (regs.b !== 0);
  m.ret(); // 0x2E83
}

/** obj_2e12 -- process one object; every path converges on loc_2e78 (the IX/IY advance). */
function obj_2e12(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  const RY = (d) => (regs.iy + d) & 0xffff;
  regs.a = mem.read8(R(0x00));
  m.step(0x2e15, 19); // ld a,(ix+0x00)
  regs.rrca();
  m.step(0x2e16, 4); // rrca -- bit0 = active?
  if (regs.fNC) { m.step(0x2ea7, 10); return loc_2ea7(m); } // jp nc,0x2ea7 (inactive)
  m.step(0x2e19, 10);
  regs.a = mem.read8(0x601a);
  m.step(0x2e1c, 13); // ld a,(0x601a)
  regs.and(0x0f);
  m.step(0x2e1e, 7); // and 0x0f
  if (regs.fNZ) {
    m.step(0x2e29, 10); // jp nz,0x2e29 (not the 16-frame tick)
  } else {
    m.step(0x2e21, 10);
    regs.a = mem.read8(RY(0x01));
    m.step(0x2e24, 19); // ld a,(iy+0x01)
    regs.xor(0x07);
    m.step(0x2e26, 7); // xor 0x07
    mem.write8(RY(0x01), regs.a);
    m.step(0x2e29, 19); // ld (iy+0x01),a
  }
  // -- loc_2e29 --
  regs.a = mem.read8(R(0x0d));
  m.step(0x2e2c, 19); // ld a,(ix+0x0d)
  regs.cp(0x04);
  m.step(0x2e2e, 7); // cp 0x04
  if (regs.fZ) { m.step(0x2e84, 10); return loc_2e84(m); } // jp z,0x2e84 (state 4)
  m.step(0x2e31, 10);
  regs.incMem8(mem, R(0x03));
  m.step(0x2e34, 23); // inc (ix+0x03)
  regs.incMem8(mem, R(0x03));
  m.step(0x2e37, 23); // inc (ix+0x03) -- position += 2
  regs.l = mem.read8(R(0x0e));
  m.step(0x2e3a, 19); // ld l,(ix+0x0e)
  regs.h = mem.read8(R(0x0f));
  m.step(0x2e3d, 19); // ld h,(ix+0x0f)
  regs.a = mem.read8(regs.hl);
  m.step(0x2e3e, 7); // ld a,(hl)
  regs.c = regs.a;
  m.step(0x2e3f, 4); // ld c,a
  regs.cp(0x7f);
  m.step(0x2e41, 7); // cp 0x7f
  if (regs.fZ) { m.step(0x2e9c, 10); return loc_2e9c(m); } // jp z,0x2e9c (terminator)
  m.step(0x2e44, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2e45, 6); // inc hl
  regs.add(mem.read8(R(0x05)));
  m.step(0x2e48, 19); // add a,(ix+0x05)
  mem.write8(R(0x05), regs.a);
  m.step(0x2e4b, 19); // ld (ix+0x05),a -- falls into loc_2e4b
  return loc_2e4b(m);
}

/** loc_2e4b -- store the string pointer; at the 0xB7 boundary + terminator, set state 4 + sound. */
function loc_2e4b(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  mem.write8(R(0x0e), regs.l);
  m.step(0x2e4e, 19); // ld (ix+0x0e),l
  mem.write8(R(0x0f), regs.h);
  m.step(0x2e51, 19); // ld (ix+0x0f),h
  regs.a = mem.read8(R(0x03));
  m.step(0x2e54, 19); // ld a,(ix+0x03)
  regs.cp(0xb7);
  m.step(0x2e56, 7); // cp 0xb7
  if (regs.fC) { m.step(0x2e6c, 10); return loc_2e6c(m); } // jp c,0x2e6c (< 0xB7)
  m.step(0x2e59, 10);
  regs.a = regs.c;
  m.step(0x2e5a, 4); // ld a,c
  regs.cp(0x7f);
  m.step(0x2e5c, 7); // cp 0x7f
  if (regs.fNZ) { m.step(0x2e6c, 10); return loc_2e6c(m); } // jp nz,0x2e6c
  m.step(0x2e5f, 10);
  mem.write8(R(0x0d), 0x04);
  m.step(0x2e63, 19); // ld (ix+0x0d),0x04 -- state = 4
  regs.xor(regs.a);
  m.step(0x2e64, 4); // xor a
  mem.write8(0x6083, regs.a);
  m.step(0x2e67, 13); // ld (0x6083),a
  regs.a = 0x03;
  m.step(0x2e69, 7); // ld a,0x03
  mem.write8(0x6084, regs.a);
  m.step(0x2e6c, 13); // ld (0x6084),a -- sound; falls into loc_2e6c
  return loc_2e6c(m);
}

/** loc_2e6c -- mirror (ix+3)/(ix+5) to (iy+0)/(iy+3); falls into loc_2e78. */
function loc_2e6c(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  const RY = (d) => (regs.iy + d) & 0xffff;
  regs.a = mem.read8(R(0x03));
  m.step(0x2e6f, 19); // ld a,(ix+0x03)
  mem.write8(RY(0x00), regs.a);
  m.step(0x2e72, 19); // ld (iy+0x00),a
  regs.a = mem.read8(R(0x05));
  m.step(0x2e75, 19); // ld a,(ix+0x05)
  mem.write8(RY(0x03), regs.a);
  m.step(0x2e78, 19); // ld (iy+0x03),a -- falls into loc_2e78
  return loc_2e78(m);
}

/** loc_2e78 -- advance IX by 0x10 and IY by 0x04; returns to the djnz in entry_2e04. */
function loc_2e78(m) {
  const { regs } = m;
  regs.de = 0x0010;
  m.step(0x2e7b, 10); // ld de,0x0010
  regs.addIx(regs.de);
  m.step(0x2e7d, 15); // add ix,de
  regs.e = 0x04;
  m.step(0x2e7f, 7); // ld e,0x04
  regs.addIy(regs.de);
  m.step(0x2e81, 15); // add iy,de (DE = 0x0004) -- 0x2E81 is the djnz
}

/** loc_2e84 -- state 4: rise (ix+5)+=3; at 0xF8 deactivate the object; -> loc_2e6c. */
function loc_2e84(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = 0x03;
  m.step(0x2e86, 7); // ld a,0x03
  regs.add(mem.read8(R(0x05)));
  m.step(0x2e89, 19); // add a,(ix+0x05)
  mem.write8(R(0x05), regs.a);
  m.step(0x2e8c, 19); // ld (ix+0x05),a
  regs.cp(0xf8);
  m.step(0x2e8e, 7); // cp 0xf8
  if (regs.fC) { m.step(0x2e6c, 10); return loc_2e6c(m); } // jp c,0x2e6c (< 0xF8)
  m.step(0x2e91, 10);
  mem.write8(R(0x03), 0x00);
  m.step(0x2e95, 19); // ld (ix+0x03),0x00
  mem.write8(R(0x00), 0x00);
  m.step(0x2e99, 19); // ld (ix+0x00),0x00 -- deactivate
  m.step(0x2e6c, 10); // jp 0x2e6c
  return loc_2e6c(m);
}

/** loc_2e9c -- 0x7F terminator: reset the string pointer to 0x39AA + sound; -> loc_2e4b. */
function loc_2e9c(m) {
  const { regs, mem } = m;
  regs.hl = 0x39aa;
  m.step(0x2e9f, 10); // ld hl,0x39aa
  regs.a = 0x03;
  m.step(0x2ea1, 7); // ld a,0x03
  mem.write8(0x6083, regs.a);
  m.step(0x2ea4, 13); // ld (0x6083),a
  m.step(0x2e4b, 10); // jp 0x2e4b
  return loc_2e4b(m);
}

/** loc_2ea7 -- inactive object: spawn on (0x6396) bit0 (via sub_0057), else just advance. */
function loc_2ea7(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(0x6396);
  m.step(0x2eaa, 13); // ld a,(0x6396)
  regs.rrca();
  m.step(0x2eab, 4); // rrca
  if (regs.fNC) { m.step(0x2e78, 10); return loc_2e78(m); } // jp nc,0x2e78 (no spawn)
  m.step(0x2eae, 10);
  regs.xor(regs.a);
  m.step(0x2eaf, 4); // xor a
  mem.write8(0x6396, regs.a);
  m.step(0x2eb2, 13); // ld (0x6396),a -- clear spawn flag
  mem.write8(R(0x05), 0x50);
  m.step(0x2eb6, 19); // ld (ix+0x05),0x50
  mem.write8(R(0x0d), 0x01);
  m.step(0x2eba, 19); // ld (ix+0x0d),0x01
  m.push16(0x2ebd); m.step(0x0057, 17); sub_0057(m); // call 0x0057
  regs.and(0x0f);
  m.step(0x2ebf, 7); // and 0x0f
  regs.add(0xf8);
  m.step(0x2ec1, 7); // add a,0xf8
  mem.write8(R(0x03), regs.a);
  m.step(0x2ec4, 19); // ld (ix+0x03),a
  mem.write8(R(0x00), 0x01);
  m.step(0x2ec8, 19); // ld (ix+0x00),0x01 -- activate
  regs.hl = 0x39aa;
  m.step(0x2ecb, 10); // ld hl,0x39aa
  mem.write8(R(0x0e), regs.l);
  m.step(0x2ece, 19); // ld (ix+0x0e),l
  mem.write8(R(0x0f), regs.h);
  m.step(0x2ed1, 19); // ld (ix+0x0f),h
  m.step(0x2e78, 10); // jp 0x2e78
  return loc_2e78(m);
}
/**
 * entry_2ed4 -- two-object sprite-state updater.  ROM 0x2ED4-0x2FCA.
 * rst 0x30 / rst 0x10 skip gates (A=0x0b). Object select by (ix+1) bit0: IX=0x6680/DE=0x6A18
 * or IX=0x6690/DE=0x6A1C. (0x6217) bit0 chooses the build path (loc_2f43 chain) vs loc_2f97.
 * All paths converge on loc_2f7c, which writes the 4-byte record x/B/C/y through DE->HL and
 * mirrors x/y to (ix+3)/(ix+5). NO LOOP (the four jp 0x2f7c are backward but loc_2f7c rets).
 * Uses sla / set n,r / neg.
 */
export function entry_2ed4(m) {
  const { regs, mem } = m;
  regs.a = 0x0b;
  m.step(0x2ed6, 7); // ld a,0x0b
  m.push16(0x2ed7); m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // skip gate
  m.push16(0x2ed8); m.step(0x0010, 11); // rst 0x10
  if (!sub_0010(m)) return; // skip gate
  regs.de = 0x6a18;
  m.step(0x2edb, 10); // ld de,0x6a18
  regs.ix = 0x6680;
  m.step(0x2edf, 14); // ld ix,0x6680
  regs.a = mem.read8((regs.ix + 0x01) & 0xffff);
  m.step(0x2ee2, 19); // ld a,(ix+0x01)
  regs.rrca();
  m.step(0x2ee3, 4); // rrca
  if (regs.fC) {
    m.step(0x2eed, 10); // jp c,0x2eed (bit0 set -> keep defaults)
  } else {
    m.step(0x2ee6, 10);
    regs.de = 0x6a1c;
    m.step(0x2ee9, 10); // ld de,0x6a1c
    regs.ix = 0x6690;
    m.step(0x2eed, 14); // ld ix,0x6690
  }
  // -- loc_2eed --
  const R = (d) => (regs.ix + d) & 0xffff;
  mem.write8(R(0x0e), 0x00);
  m.step(0x2ef1, 19); // ld (ix+0x0e),0x00
  mem.write8(R(0x0f), 0xf0);
  m.step(0x2ef5, 19); // ld (ix+0x0f),0xf0
  regs.a = mem.read8(0x6217);
  m.step(0x2ef8, 13); // ld a,(0x6217)
  regs.rrca();
  m.step(0x2ef9, 4); // rrca
  if (regs.fNC) { m.step(0x2f97, 10); return loc_2f97(m); } // jp nc,0x2f97
  m.step(0x2efc, 10);

  // -- (0x6217) bit0 set: build sprite attributes B/C --
  regs.xor(regs.a);
  m.step(0x2efd, 4); // xor a
  mem.write8(0x6218, regs.a);
  m.step(0x2f00, 13); // ld (0x6218),a
  regs.hl = 0x6089;
  m.step(0x2f03, 10); // ld hl,0x6089
  mem.write8(regs.hl, 0x04);
  m.step(0x2f05, 10); // ld (hl),0x04
  mem.write8(R(0x09), 0x06);
  m.step(0x2f09, 19); // ld (ix+0x09),0x06
  mem.write8(R(0x0a), 0x03);
  m.step(0x2f0d, 19); // ld (ix+0x0a),0x03
  regs.b = 0x1e;
  m.step(0x2f0f, 7); // ld b,0x1e
  regs.a = mem.read8(0x6207);
  m.step(0x2f12, 13); // ld a,(0x6207)
  regs.a = regs.sla(regs.a);
  m.step(0x2f14, 8); // sla a
  if (regs.fNC) {
    m.step(0x2f1b, 10); // jp nc,0x2f1b
  } else {
    m.step(0x2f17, 10);
    regs.or(0x80);
    m.step(0x2f19, 7); // or 0x80
    regs.b = regs.set(7, regs.b);
    m.step(0x2f1b, 8); // set 7,b
  }
  // -- loc_2f1b --
  regs.or(0x08);
  m.step(0x2f1d, 7); // or 0x08
  regs.c = regs.a;
  m.step(0x2f1e, 4); // ld c,a
  regs.a = mem.read8(0x6394);
  m.step(0x2f21, 13); // ld a,(0x6394)
  regs.bit(3, regs.a);
  m.step(0x2f23, 8); // bit 3,a
  if (regs.fZ) { m.step(0x2f43, 10); return loc_2f43(m); } // jp z,0x2f43
  m.step(0x2f26, 10);
  regs.b = regs.set(0, regs.b);
  m.step(0x2f28, 8); // set 0,b
  regs.c = regs.set(0, regs.c);
  m.step(0x2f2a, 8); // set 0,c
  mem.write8(R(0x09), 0x05);
  m.step(0x2f2e, 19); // ld (ix+0x09),0x05
  mem.write8(R(0x0a), 0x06);
  m.step(0x2f32, 19); // ld (ix+0x0a),0x06
  mem.write8(R(0x0f), 0x00);
  m.step(0x2f36, 19); // ld (ix+0x0f),0x00
  mem.write8(R(0x0e), 0xf0);
  m.step(0x2f3a, 19); // ld (ix+0x0e),0xf0
  regs.bit(7, regs.c);
  m.step(0x2f3c, 8); // bit 7,c
  if (regs.fZ) { m.step(0x2f43, 10); return loc_2f43(m); } // jp z,0x2f43
  m.step(0x2f3f, 10);
  mem.write8(R(0x0e), 0x10);
  m.step(0x2f43, 19); // ld (ix+0x0e),0x10 -- falls into loc_2f43
  return loc_2f43(m);
}

/** loc_2f43 -- advance the 0x6394/0x6395 counter chain; on wrap, flip (0x6217) + neg X into (ix+0e). */
function loc_2f43(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = regs.c;
  m.step(0x2f44, 4); // ld a,c
  mem.write8(0x694d, regs.a);
  m.step(0x2f47, 13); // ld (0x694d),a
  regs.c = 0x07;
  m.step(0x2f49, 7); // ld c,0x07
  regs.hl = 0x6394;
  m.step(0x2f4c, 10); // ld hl,0x6394
  regs.incMem8(mem, regs.hl);
  m.step(0x2f4d, 11); // inc (hl)
  if (regs.fNZ) { m.step(0x2fb7, 10); return loc_2fb7(m); } // jp nz,0x2fb7
  m.step(0x2f50, 10);
  regs.hl = 0x6395;
  m.step(0x2f53, 10); // ld hl,0x6395
  regs.incMem8(mem, regs.hl);
  m.step(0x2f54, 11); // inc (hl)
  regs.a = mem.read8(regs.hl);
  m.step(0x2f55, 7); // ld a,(hl)
  regs.cp(0x02);
  m.step(0x2f57, 7); // cp 0x02
  if (regs.fNZ) { m.step(0x2fbe, 10); return loc_2fbe(m); } // jp nz,0x2fbe
  m.step(0x2f5a, 10);
  regs.xor(regs.a);
  m.step(0x2f5b, 4); // xor a
  mem.write8(0x6395, regs.a);
  m.step(0x2f5e, 13); // ld (0x6395),a
  mem.write8(0x6217, regs.a);
  m.step(0x2f61, 13); // ld (0x6217),a
  mem.write8(R(0x01), regs.a);
  m.step(0x2f64, 19); // ld (ix+0x01),a
  regs.a = mem.read8(0x6203);
  m.step(0x2f67, 13); // ld a,(0x6203)
  regs.neg();
  m.step(0x2f69, 8); // neg
  mem.write8(R(0x0e), regs.a);
  m.step(0x2f6c, 19); // ld (ix+0x0e),a
  regs.a = mem.read8(0x6207);
  m.step(0x2f6f, 13); // ld a,(0x6207)
  mem.write8(0x694d, regs.a);
  m.step(0x2f72, 13); // ld (0x694d),a
  mem.write8(R(0x00), 0x00);
  m.step(0x2f76, 19); // ld (ix+0x00),0x00
  regs.a = mem.read8(0x6389);
  m.step(0x2f79, 13); // ld a,(0x6389)
  mem.write8(0x6089, regs.a);
  m.step(0x2f7c, 13); // ld (0x6089),a -- falls into loc_2f7c
  return loc_2f7c(m);
}

/** loc_2f7c -- THE RECORD WRITE (convergence): DE->HL, write x/B/C/y, mirror x/y to (ix+3)/(ix+5). */
function loc_2f7c(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.exDeHl();
  m.step(0x2f7d, 4); // ex de,hl -- HL = record dest
  regs.a = mem.read8(0x6203);
  m.step(0x2f80, 13); // ld a,(0x6203)
  regs.add(mem.read8(R(0x0e)));
  m.step(0x2f83, 19); // add a,(ix+0x0e)
  mem.write8(regs.hl, regs.a);
  m.step(0x2f84, 7); // ld (hl),a -- record[0] = X
  mem.write8(R(0x03), regs.a);
  m.step(0x2f87, 19); // ld (ix+0x03),a
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2f88, 6); // inc hl
  mem.write8(regs.hl, regs.b);
  m.step(0x2f89, 7); // ld (hl),b -- record[1] = B
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2f8a, 6); // inc hl
  mem.write8(regs.hl, regs.c);
  m.step(0x2f8b, 7); // ld (hl),c -- record[2] = C
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2f8c, 6); // inc hl
  regs.a = mem.read8(0x6205);
  m.step(0x2f8f, 13); // ld a,(0x6205)
  regs.add(mem.read8(R(0x0f)));
  m.step(0x2f92, 19); // add a,(ix+0x0f)
  mem.write8(regs.hl, regs.a);
  m.step(0x2f93, 7); // ld (hl),a -- record[3] = Y
  mem.write8(R(0x05), regs.a);
  m.step(0x2f96, 19); // ld (ix+0x05),a
  m.ret(); // 0x2F96 (EXIT-1)
}

/** loc_2f97 -- (0x6217) bit0 clear: ret if (0x6218) bit0 clear; else build an alt B/C -> loc_2f7c. */
function loc_2f97(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.a = mem.read8(0x6218);
  m.step(0x2f9a, 13); // ld a,(0x6218)
  regs.rrca();
  m.step(0x2f9b, 4); // rrca
  if (regs.fNC) { m.ret(11); return; } // ret nc (EXIT-2)
  m.step(0x2f9c, 5);
  mem.write8(R(0x09), 0x06);
  m.step(0x2fa0, 19); // ld (ix+0x09),0x06
  mem.write8(R(0x0a), 0x03);
  m.step(0x2fa4, 19); // ld (ix+0x0a),0x03
  regs.a = mem.read8(0x6207);
  m.step(0x2fa7, 13); // ld a,(0x6207)
  regs.rlca();
  m.step(0x2fa8, 4); // rlca -- carry = bit7, consumed by the rra below
  regs.a = 0x3c;
  m.step(0x2faa, 7); // ld a,0x3c
  regs.rra();
  m.step(0x2fab, 4); // rra -- A = 0x3C >> 1 with carry-in from the rlca
  regs.b = regs.a;
  m.step(0x2fac, 4); // ld b,a
  regs.c = 0x07;
  m.step(0x2fae, 7); // ld c,0x07
  regs.a = mem.read8(0x6089);
  m.step(0x2fb1, 13); // ld a,(0x6089)
  mem.write8(0x6389, regs.a);
  m.step(0x2fb4, 13); // ld (0x6389),a
  m.step(0x2f7c, 10); // jp 0x2f7c
  return loc_2f7c(m);
}

/** loc_2fb7 -- (0x6394) counter did not wrap: (0x6395)==0 -> loc_2f7c, else loc_2fbe. */
function loc_2fb7(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6395);
  m.step(0x2fba, 13); // ld a,(0x6395)
  regs.and(regs.a);
  m.step(0x2fbb, 4); // and a
  if (regs.fZ) { m.step(0x2f7c, 10); return loc_2f7c(m); } // jp z,0x2f7c
  m.step(0x2fbe, 10); // fall into loc_2fbe
  return loc_2fbe(m);
}

/** loc_2fbe -- (0x601A) bit3 gate: clear -> loc_2f7c; set -> C=0x01 -> loc_2f7c. */
function loc_2fbe(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x601a);
  m.step(0x2fc1, 13); // ld a,(0x601a)
  regs.bit(3, regs.a);
  m.step(0x2fc3, 8); // bit 3,a
  if (regs.fZ) { m.step(0x2f7c, 10); return loc_2f7c(m); } // jp z,0x2f7c
  m.step(0x2fc6, 10);
  regs.c = 0x01;
  m.step(0x2fc8, 7); // ld c,0x01
  m.step(0x2f7c, 10); // jp 0x2f7c
  return loc_2f7c(m);
}

/**
 * sub_3f24 -- ROM 0x3F24-0x3F2F
 *
 *   3f24  21 af 74     ld   hl,0x74af
 *   3f27  11 e0 ff     ld   de,0xffe0
 *   3f2a  36 9f        ld   (hl),0x9f
 *   3f2c  19           add  hl,de
 *   3f2d  36 9e        ld   (hl),0x9e
 *   3f2f  c9           ret
 *
 * Writes 0x9F to 0x74AF and 0x9E to 0x748F -- two bytes, 0x20 apart, the
 * second BELOW the first.
 *
 * NO INPUTS. Both HL and DE are loaded from literals; no register or memory
 * cell is read. Unlike sub_004e this routine's behaviour is fully determined
 * by its own twelve bytes.
 *
 * `ld de,0xffe0` + `add hl,de` is a SUBTRACTION BY 0x20 done as an unsigned
 * 16-bit add that wraps: 0x74AF + 0xFFE0 = 0x1748F -> 0x748F. Writing it as
 * `hl -= 0x20` gets the same address and LOSES THE FLAGS.
 *
 * ON EXIT: HL=0x748F, DE=0xFFE0, and CARRY IS SET (always -- both operands
 * are literals, so the wrap is unconditional).
 */
export function sub_3f24(m) {
  const { regs, mem } = m;

  regs.hl = 0x74af;
  m.step(0x3f27, 10);
  regs.de = 0xffe0;
  m.step(0x3f2a, 10);

  mem.write8(regs.hl, 0x9f);
  m.step(0x3f2c, 10);

  // MUST be addHl(0xffe0), not `hl -= 0x20`. Same address, different
  // flags -- this add always carries, and the carry escapes via `ret`.
  regs.addHl(regs.de);
  m.step(0x3f2d, 11);

  mem.write8(regs.hl, 0x9e);
  m.step(0x3f2f, 10);

  m.ret(); // 3f2f -- unconditional, 10 T
}

/**
 * sub_004e -- ROM 0x004E-0x0056
 *
 *   004e  11 08 69     ld   de,0x6908
 *   0051  01 28 00     ld   bc,0x0028
 *   0054  ed b0        ldir
 *   0056  c9           ret
 *
 * Copies 0x28 = 40 bytes to 0x6908-0x692F.
 *
 * HL IS AN IMPLICIT INPUT. This routine sets DE and BC and does NOT set HL,
 * so the SOURCE of the copy is supplied entirely by the caller -- and there
 * are thirteen callers. The source address is not determinable from these nine
 * bytes.
 *
 * Returns normally: one unconditional `ret`, stack balanced, no conditional
 * return and no tail jump.
 *
 * On exit LDIR leaves BC=0, DE=0x6930, HL=HL_in+0x28, and PRESERVES CARRY --
 * all four are visible to the caller.
 */
export function sub_004e(m) {
  const { regs } = m;

  regs.de = 0x6908;
  m.step(0x0051, 10);
  regs.bc = 0x0028;
  m.step(0x0054, 10);

  // Reads through HL, which this routine never sets.
  // LdirAt, NOT the 0x01CF-hardcoded ldir().
  m.ldirAt(0x0054, 0x0056);

  m.ret(); // 0056 -- unconditional, 10 T
}

/**
 * entry_2c8f -- ROM 0x2C8F-0x2CB7  (three-way twin of entry_2c03 / sub_03a2)
 *
 *   2c8f  3e 01        ld   a,0x01
 *   2c91  f7           rst  0x30
 *   2c92  d7           rst  0x10
 *   2c93  3a 93 63     ld   a,(0x6393)
 *   2c96  0f           rrca
 *   2c97  da 15 2d     jp   c,0x2d15
 *   2c9a  3a 92 63     ld   a,(0x6392)
 *   2c9d  0f           rrca
 *   2c9e  d0           ret  nc
 *   2c9f  dd 21 00 67  ld   ix,0x6700
 *   2ca3  11 20 00     ld   de,0x0020
 *   2ca6  06 0a        ld   b,0x0a
 * loc_2ca8:
 *   2ca8  dd 7e 00     ld   a,(ix+0x00)
 *   2cab  0f           rrca
 *   2cac  da b3 2c     jp   c,0x2cb3
 *   2caf  0f           rrca
 *   2cb0  d2 b8 2c     jp   nc,0x2cb8
 * loc_2cb3:
 *   2cb3  dd 19        add  ix,de
 *   2cb5  10 f1        djnz 0x2ca8
 *   2cb7  c9           ret
 *
 * Prologue IDENTICAL to the translated twin sub_03a2 (mainloop.js) for the
 * first five instructions -- ld a,n / rst 0x30 / rst 0x10 / ld a,(nn) / rrca --
 * then DIVERGES: sub_03a2 (and the sibling draft entry_2c03) do `ret c` (d8);
 * this does `jp c,0x2d15` (da 15 2d). A translator copying the twin here would
 * return instead of jumping. The rst 0x30/0x10 gates are
 * the standard caller-skip pair (sub_0030/sub_0010); when either skips, control
 * returns to OUR caller -- mirrors sub_03a2 exactly.
 *
 * Scans 10 records at 0x6700 (stride 0x20) testing bits 0/1 of (ix+0): bit 0
 * set -> advance; bit 1 clear -> the free-slot path at entry_2cb8. add ix,de is
 * INSIDE the loop (djnz target 0x2CA8 is above it) -- hoisting breaks the walk.
 *
 * FLOW-OUTS, both <0x3000 but UNTRANSLATED, rendered as NotImplemented throws
 * (the loc_1dc9 convention): 0x2d15 (jp c, the (0x6393)-bit-0 path) and
 * entry_2cb8 (jp nc, the free-slot-found path). Both are tail jumps -- this
 * routine hands off, it does not call. Not yet wired into the live dispatcher.
 */
export function entry_2c8f(m) {
  const { regs, mem } = m;

  regs.a = 0x01;
  m.step(0x2c91, 7); // ld a,0x01

  m.push16(0x2c92);
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // rst 0x30 skipped OUR body -> back to our caller

  m.push16(0x2c93);
  m.step(0x0010, 11); // rst 0x10
  if (!sub_0010(m)) return; // rst 0x10 skipped OUR body -> back to our caller

  regs.a = mem.read8(0x6393);
  m.step(0x2c96, 13); // ld a,(0x6393)
  regs.rrca();
  m.step(0x2c97, 4); // rrca -- carry = bit 0 of (0x6393)
  if (regs.fC) {
    m.step(0x2d15, 10); // jp c,0x2d15 taken (tail)
    return loc_2d15(m);
  }
  m.step(0x2c9a, 10); // jp c,0x2d15 not taken

  regs.a = mem.read8(0x6392);
  m.step(0x2c9d, 13); // ld a,(0x6392)
  regs.rrca();
  m.step(0x2c9e, 4); // rrca -- carry = bit 0 of (0x6392)
  if (regs.fNC) {
    m.ret(11); // ret nc -- (0x6392) bit 0 clear
    return;
  }
  m.step(0x2c9f, 5); // ret nc not taken

  regs.ix = 0x6700;
  m.step(0x2ca3, 14); // ld ix,0x6700
  regs.de = 0x0020;
  m.step(0x2ca6, 10); // ld de,0x0020
  regs.b = 0x0a;
  m.step(0x2ca8, 7); // ld b,0x0a

  do {
    // loc_2ca8: scan one record for a free slot
    regs.a = mem.read8((regs.ix + 0x00) & 0xffff);
    m.step(0x2cab, 19); // ld a,(ix+0x00)
    regs.rrca();
    m.step(0x2cac, 4); // rrca -- carry = bit 0 of (ix+0)
    if (regs.fC) {
      m.step(0x2cb3, 10); // jp c,0x2cb3 taken -- bit 0 set, advance
    } else {
      m.step(0x2caf, 10); // jp c,0x2cb3 not taken
      regs.rrca();
      m.step(0x2cb0, 4); // rrca -- carry = bit 1 of (ix+0)
      if (regs.fNC) {
        m.step(0x2cb8, 10); // jp nc,0x2cb8 taken (tail) -- bit 1 clear, free slot
        return entry_2cb8(m);
      }
      m.step(0x2cb3, 10); // jp nc,0x2cb8 not taken -> fall to loc_2cb3
    }
    // loc_2cb3:
    regs.addIx(regs.de);
    m.step(0x2cb5, 15); // add ix,de -- INSIDE the loop (draft TEST 2)
    regs.djnz();
    m.step(regs.b !== 0 ? 0x2ca8 : 0x2cb7, regs.b !== 0 ? 13 : 8); // djnz 0x2ca8
  } while (regs.b !== 0);

  m.ret(); // 0x2CB7 -- 10-record scan exhausted, no free slot
}

/**
 * sub_25f2 -- ROM head 0x25F2-0x25F4  (rst 0x30 gate-head; sibling of sub_2207)
 *
 *   25f2  3e 02        ld   a,0x02
 *   25f4  f7           rst  0x30        ; SKIPS on coin_start -> return to caller
 *
 * Reached via `call 0x25F2` @0x199A (197a cascade). Same gate mechanism as sub_2207;
 * differs only in the body it gates (0x25F5: call 0x2602 / 0x262f / 0x2679 sub-cascade),
 * which is a non-executing frontier.
 */
export function sub_25f2(m) {
  const { regs } = m;
  regs.a = 0x02;
  m.step(0x25f4, 7); // ld a,0x02
  m.push16(0x25f5); // rst 0x30 pushes the body address
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // gate SKIPPED (coin_start) -> returned to caller
  return sub_25f2_body(m); // 0x25F5: the object sub-cascade (now translated)
}
/** sub_25f2_body -- sub_25f2's object update: call 2602/262f/2679/2ad3 in sequence. ROM 0x25F5-0x2601. */
export function sub_25f2_body(m) {
  m.push16(0x25f8); m.step(0x2602, 17); sub_2602(m); // call 0x2602
  m.push16(0x25fb); m.step(0x262f, 17); sub_262f(m); // call 0x262f
  m.push16(0x25fe); m.step(0x2679, 17); sub_2679(m); // call 0x2679
  m.push16(0x2601); m.step(0x2ad3, 17); sub_2ad3(m); // call 0x2ad3
  m.ret(10); // 0x2601
}
/**
 * sub_26fa -- ROM head 0x26FA-0x26FC  (rst 0x30 gate-head; sibling of sub_2207)
 *
 *   26fa  3e 04        ld   a,0x04
 *   26fc  f7           rst  0x30        ; SKIPS on coin_start -> return to caller
 *
 * Reached via `call 0x26FA` @0x19A7 (197a cascade). Same gate mechanism as sub_2207;
 * differs in the A value (0x04) and the body it gates (0x26FD): a tile/position
 * dispatch on (0x6205)/(0x6229)/(0x601a) that TAIL-JUMPS to loc_277f (edge reset),
 * sub_271e (call 0x2745 wrapper) or sub_2722 (animate+spawn), else `ret`. The gate
 * skips on coin_start/attract -> the body is unreached there; it runs on
 * the 0x197A gameplay cascade. WIRES sub_271e + sub_2722 (WIRING-SITES sites 8/9):
 * the ROM's 0x2713/0x2716/0x271B are jp z/jp c (tail jumps), not calls as the note
 * read -- reaching those routines by falling through / conditional jump.
 */
export function sub_26fa(m) {
  const { regs, mem } = m;
  regs.a = 0x04;
  m.step(0x26fc, 7); // ld a,0x04
  m.push16(0x26fd); // rst 0x30 pushes the body address
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // gate SKIPPED (coin_start) -> returned to caller

  // -- body @0x26FD: tile/position dispatch --
  regs.a = mem.read8(0x6205);
  m.step(0x2700, 13); // ld a,(0x6205)
  regs.cp(0xf0);
  m.step(0x2702, 7); // cp 0xf0
  if (regs.fNC) { m.step(0x277f, 10); return loc_277f(m); } // jp nc,0x277f -- edge reset
  m.step(0x2705, 10); // jp nc NOT taken
  regs.a = mem.read8(0x6229);
  m.step(0x2708, 13); // ld a,(0x6229)
  regs.a = regs.dec8(regs.a);
  m.step(0x2709, 4); // dec a -- flags feed the 0x270C jp nz
  regs.a = mem.read8(0x601a);
  m.step(0x270c, 13); // ld a,(0x601a) -- reload A (ld preserves dec's flags)
  if (regs.fNZ) {
    m.step(0x271a, 10); // jp nz,0x271a -- (0x6229) != 1
    regs.rrca();
    m.step(0x271b, 4); // rrca (loc_271a)
    if (regs.fC) { m.step(0x2722, 10); return sub_2722(m); } // jp c,0x2722 -- animate+spawn
    m.step(0x271e, 10); // jp c NOT taken -> fall into 0x271e
    return sub_271e(m); // 0x271E: call 0x2745; ret
  }
  m.step(0x270f, 10); // jp nz NOT taken -- (0x6229) == 1
  regs.and(0x03);
  m.step(0x2711, 7); // and 0x03
  regs.cp(0x01);
  m.step(0x2713, 7); // cp 0x01
  if (regs.fZ) { m.step(0x271e, 10); return sub_271e(m); } // jp z,0x271e
  m.step(0x2716, 10); // jp z NOT taken
  if (regs.fC) { m.step(0x2722, 10); return sub_2722(m); } // jp c,0x2722
  m.step(0x2719, 10); // jp c NOT taken -> fall into 0x2719
  m.ret(10); // ret @0x2719
}
/**
 * sub_2fcb -- ROM head 0x2FCB-0x2FCD  (rst 0x30 gate-head; sibling of sub_2207)
 *
 *   2fcb  3e 0e        ld   a,0x0e
 *   2fcd  f7           rst  0x30        ; SKIPS on coin_start -> return to caller
 *
 * Same gate mechanism as sub_2207; the body (0x2FCE: ld hl,0x62b4 / dec (hl) --
 * a down-counter update) is a non-executing frontier.
 */
export function sub_2fcb(m) {
  const { regs, mem } = m;
  regs.a = 0x0e;
  m.step(0x2fcd, 7); // ld a,0x0e
  m.push16(0x2fce); // rst 0x30 pushes the body address
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // gate SKIPPED (coin_start) -> returned to caller

  // -- body @0x2FCE: two-level countdown -> periodic task 0x0501 + 0x6386 advance --
  regs.hl = 0x62b4;
  m.step(0x2fd1, 10); // ld hl,0x62b4
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x2fd2, 11); // dec (hl) -- inner timer
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- period not elapsed
  m.step(0x2fd3, 5); // ret nz NOT taken
  regs.a = 0x03;
  m.step(0x2fd5, 7); // ld a,0x03
  mem.write8(0x62b9, regs.a);
  m.step(0x2fd8, 13); // ld (0x62b9),a
  mem.write8(0x6396, regs.a);
  m.step(0x2fdb, 13); // ld (0x6396),a
  regs.de = 0x0501;
  m.step(0x2fde, 10); // ld de,0x0501
  m.push16(0x2fe1);
  m.step(0x309f, 17); // call 0x309f -- enqueue task 0x0501 (PRESERVES HL=0x62B4)
  sub_309f(m);
  regs.a = mem.read8(0x62b3);
  m.step(0x2fe4, 13); // ld a,(0x62b3)
  mem.write8(regs.hl, regs.a); // ld (hl),a -- (0x62B4):=(0x62B3); HL survived sub_309f
  m.step(0x2fe5, 7);
  regs.hl = 0x62b1;
  m.step(0x2fe8, 10); // ld hl,0x62b1
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x2fe9, 11); // dec (hl) -- outer period counter
  if (regs.fNZ) { m.ret(11); return; } // ret nz
  m.step(0x2fea, 5); // ret nz NOT taken
  regs.a = 0x01;
  m.step(0x2fec, 7); // ld a,0x01
  mem.write8(0x6386, regs.a);
  m.step(0x2fef, 13); // ld (0x6386),a -- advance the sub_1a07 rst-28 machine
  m.ret(10); // ret (0x2FEF)
}
/**
 * sub_26a6 -- ROM 0x26A6-0x26DD  (56 bytes, 36 instructions; calls nothing)
 *
 *   26a6  2c           inc  l
 *   26a7  1a           ld   a,(de)
 *   26a8  17           rla                 ; carry = bit 7 of mem[DE]
 *   26a9  da c5 26     jp   c,0x26c5
 *   -- carry-CLEAR arm (bit7=0): (P) += 1 wrap 0x53->0x50 ; (P+4) -= 1 wrap 0xCF->0xD2
 *   26ac  7e           ld   a,(hl)
 *   26ad  3c           inc  a
 *   26ae  fe 53        cp   0x53
 *   26b0  c2 b5 26     jp   nz,0x26b5
 *   26b3  3e 50        ld   a,0x50
 *   26b5  77           ld   (hl),a
 *   26b6  7d           ld   a,l
 *   26b7  c6 04        add  a,0x04
 *   26b9  6f           ld   l,a
 *   26ba  7e           ld   a,(hl)
 *   26bb  3d           dec  a
 *   26bc  fe cf        cp   0xcf
 *   26be  c2 c3 26     jp   nz,0x26c3
 *   26c1  3e d2        ld   a,0xd2
 *   26c3  77           ld   (hl),a
 *   26c4  c9           ret
 *   -- carry-SET arm (bit7=1): (P) -= 1 wrap 0x4F->0x52 ; (P+4) += 1 wrap 0xD3->0xD0
 *   26c5  7e           ld   a,(hl)
 *   26c6  3d           dec  a
 *   26c7  fe 4f        cp   0x4f
 *   26c9  c2 ce 26     jp   nz,0x26ce
 *   26cc  3e 52        ld   a,0x52
 *   26ce  77           ld   (hl),a
 *   26cf  7d           ld   a,l
 *   26d0  c6 04        add  a,0x04
 *   26d2  6f           ld   l,a
 *   26d3  7e           ld   a,(hl)
 *   26d4  3c           inc  a
 *   26d5  fe d3        cp   0xd3
 *   26d7  c2 dc 26     jp   nz,0x26dc
 *   26da  3e d0        ld   a,0xd0
 *   26dc  77           ld   (hl),a
 *   26dd  c9           ret
 *
 * HL and DE are BOTH live-in (three callers do `ld de,0x69Ex / ex de,hl`): HL is
 * the write target 0x69E4/0x69EC/0x69F4, DE points at the arm-select byte (its
 * value is the caller's pre-ex HL, untraced). `rla` puts bit 7 of
 * mem[DE] into carry; the rotated A is dead (overwritten below), so only the
 * carry-out matters.
 *
 * The two arms are MIRRORS with inc<->dec swapped and the four constants
 * inverted. They are transcribed from the bytes INDEPENDENTLY, not
 * one copied from the other -- a missed inc/dec flip is byte-plausible (3C vs 3D,
 * same flags) and would invert one counter's direction.
 *
 * `inc l` @ 0x26A6: the flag-SETTING form (regs.inc8), per the boot.js:300 /
 * sub_2913 precedent. Its S/Z/H/PV flags are in fact DEAD here -- rla preserves
 * S/Z/PV then the arm's inc a/dec a overwrites them before any conditional reads
 * -- but the faithful form removes any latent-flag doubt (C is preserved either
 * way; inc does not touch carry). Each arm does two single-VALUE-wrap RMW stores
 * at P=HL+1 and P+4, the second address computed by threading L --
 * the wrap is an exact-value guard, not a range clamp, so an off-band cell walks
 * freely. A is live-out (the P+4 result); flags at the ret are from
 * the final `cp`.
 */
export function sub_26a6(m) {
  const { regs, mem } = m;

  regs.l = regs.inc8(regs.l); // inc l -- 8-bit; flags dead here (see doc), C kept
  m.step(0x26a7, 4); // inc l
  regs.a = mem.read8(regs.de);
  m.step(0x26a8, 7); // ld a,(de)
  regs.rla(); // carry = bit 7 of mem[DE]; rotated A is dead
  m.step(0x26a9, 4); // rla

  if (regs.fC) {
    // ---- carry-SET arm: (P) counts DOWN, (P+4) counts UP ----
    m.step(0x26c5, 10); // jp c,0x26c5 TAKEN

    regs.a = mem.read8(regs.hl);
    m.step(0x26c6, 7); // ld a,(hl)
    regs.a = regs.dec8(regs.a);
    m.step(0x26c7, 4); // dec a
    regs.cp(0x4f);
    m.step(0x26c9, 7); // cp 0x4f
    if (!regs.fZ) {
      m.step(0x26ce, 10); // jp nz,0x26ce -- store the decremented value
    } else {
      m.step(0x26cc, 10);
      regs.a = 0x52;
      m.step(0x26ce, 7); // ld a,0x52 -- wrap
    }
    mem.write8(regs.hl, regs.a);
    m.step(0x26cf, 7); // ld (hl),a

    regs.a = regs.l;
    m.step(0x26d0, 4); // ld a,l
    regs.add(0x04);
    m.step(0x26d2, 7); // add a,0x04
    regs.l = regs.a;
    m.step(0x26d3, 4); // ld l,a -- HL now P+4

    regs.a = mem.read8(regs.hl);
    m.step(0x26d4, 7); // ld a,(hl)
    regs.a = regs.inc8(regs.a);
    m.step(0x26d5, 4); // inc a
    regs.cp(0xd3);
    m.step(0x26d7, 7); // cp 0xd3
    if (!regs.fZ) {
      m.step(0x26dc, 10); // jp nz,0x26dc
    } else {
      m.step(0x26da, 10);
      regs.a = 0xd0;
      m.step(0x26dc, 7); // ld a,0xd0 -- wrap
    }
    mem.write8(regs.hl, regs.a);
    m.step(0x26dd, 7); // ld (hl),a
    m.ret(); // 0x26DD -- returns A = the P+4 result
    return;
  }
  m.step(0x26ac, 10); // jp c,0x26c5 NOT taken -- carry-CLEAR arm

  // ---- carry-CLEAR arm: (P) counts UP, (P+4) counts DOWN ----
  regs.a = mem.read8(regs.hl);
  m.step(0x26ad, 7); // ld a,(hl)
  regs.a = regs.inc8(regs.a);
  m.step(0x26ae, 4); // inc a
  regs.cp(0x53);
  m.step(0x26b0, 7); // cp 0x53
  if (!regs.fZ) {
    m.step(0x26b5, 10); // jp nz,0x26b5 -- store the incremented value
  } else {
    m.step(0x26b3, 10);
    regs.a = 0x50;
    m.step(0x26b5, 7); // ld a,0x50 -- wrap
  }
  mem.write8(regs.hl, regs.a);
  m.step(0x26b6, 7); // ld (hl),a

  regs.a = regs.l;
  m.step(0x26b7, 4); // ld a,l
  regs.add(0x04);
  m.step(0x26b9, 7); // add a,0x04
  regs.l = regs.a;
  m.step(0x26ba, 4); // ld l,a -- HL now P+4

  regs.a = mem.read8(regs.hl);
  m.step(0x26bb, 7); // ld a,(hl)
  regs.a = regs.dec8(regs.a);
  m.step(0x26bc, 4); // dec a
  regs.cp(0xcf);
  m.step(0x26be, 7); // cp 0xcf
  if (!regs.fZ) {
    m.step(0x26c3, 10); // jp nz,0x26c3
  } else {
    m.step(0x26c1, 10);
    regs.a = 0xd2;
    m.step(0x26c3, 7); // ld a,0xd2 -- wrap
  }
  mem.write8(regs.hl, regs.a);
  m.step(0x26c4, 7); // ld (hl),a
  m.ret(); // 0x26C4 -- returns A = the P+4 result
}
/** loc_1644 -- rst 0x28 dispatch on 0x6388 (table 0x1648, 6 entries). ROM 0x1644-0x1647. */
export function loc_1644(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6388);
  m.step(0x1647, 13); // ld a,(0x6388)
  m.push16(0x1648); // rst 0x28 pushes the table base
  m.step(0x0028, 11);
  sub_0028(m, "0x1648 (0x6388 sequence)"); // reads the ROM table; ends in jp (hl)
}
/** loc_13aa -- idx 18 small state reset: 0x7D82=(0x6026), 0x600A=0, 0x600D/E=1. ROM 0x13AA-0x13BA. */
export function loc_13aa(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6026);
  m.step(0x13ad, 13); // ld a,(0x6026)
  mem.write8(0x7d82, regs.a, 7); // ld (0x7d82),a
  m.step(0x13b0, 13);
  regs.xor(regs.a);
  m.step(0x13b1, 4); // xor a
  mem.write8(0x600a, regs.a); // 0x600A = 0
  m.step(0x13b4, 13);
  regs.hl = 0x0101;
  m.step(0x13b7, 10); // ld hl,0x0101
  mem.write16(0x600d, regs.hl); // 0x600D=1, 0x600E=1
  m.step(0x13ba, 16);
  m.ret();
}
/** loc_13bb -- idx 19 small state reset: 0x600D/E/A=0, 0x7D82=1. ROM 0x13BB-0x13C9. */
export function loc_13bb(m) {
  const { regs, mem } = m;
  regs.xor(regs.a);
  m.step(0x13bc, 4); // xor a
  mem.write8(0x600d, regs.a);
  m.step(0x13bf, 13); // ld (0x600d),a
  mem.write8(0x600e, regs.a);
  m.step(0x13c2, 13); // ld (0x600e),a
  mem.write8(0x600a, regs.a);
  m.step(0x13c5, 13); // ld (0x600a),a
  regs.a = regs.inc8(regs.a);
  m.step(0x13c6, 4); // inc a
  mem.write8(0x7d82, regs.a, 7); // ld (0x7d82),a = 1
  m.step(0x13c9, 13);
  m.ret();
}
/** sub_1186 -- table copy (0x122A) + object init (0x11D3) over IX=0x6500. ROM 0x1186-0x11A1. */
export function sub_1186(m) {
  const { regs } = m;
  regs.hl = 0x11a2; // -> 4-byte data block, not code
  m.step(0x1189, 10); // ld hl,0x11a2
  regs.de = 0x6507;
  m.step(0x118c, 10); // ld de,0x6507
  regs.bc = 0x0a0c;
  m.step(0x118f, 10); // ld bc,0x0a0c
  m.push16(0x1192); m.step(0x122a, 17); sub_122a(m); // call 0x122a
  regs.ix = 0x6500;
  m.step(0x1196, 14); // ld ix,0x6500
  regs.hl = 0x6980;
  m.step(0x1199, 10); // ld hl,0x6980
  regs.b = 0x0a; // C left by 0x122A
  m.step(0x119b, 7); // ld b,0x0a
  regs.de = 0x0010; // stride
  m.step(0x119e, 10); // ld de,0x0010
  m.push16(0x11a1); m.step(0x11d3, 17); sub_11d3(m); // call 0x11d3
  m.ret();
}
/** loc_1131 -- arm C=4 of the 0x0FCD inline table: 4 table copies + two (ix+d) init (stride 0x20). */
export function loc_1131(m) {
  const { regs, mem } = m;
  regs.hl = 0x3df0;
  m.step(0x1134, 10); // ld hl,0x3df0
  regs.de = 0x6407;
  m.step(0x1137, 10); // ld de,0x6407
  regs.bc = 0x051c;
  m.step(0x113a, 10); // ld bc,0x051c
  m.push16(0x113d); m.step(0x122a, 17); sub_122a(m); // call 0x122a
  regs.hl = 0x3e14;
  m.step(0x1140, 10); // ld hl,0x3e14 (live-in to sub_11a6)
  m.push16(0x1143); m.step(0x11a6, 17); sub_11a6(m); // call 0x11a6
  regs.hl = 0x3e54;
  m.step(0x1146, 10); // ld hl,0x3e54
  regs.de = 0x6a0c;
  m.step(0x1149, 10); // ld de,0x6a0c
  regs.bc = 0x000c;
  m.step(0x114c, 10); // ld bc,0x000c
  m.ldir(0x114e); // ldir 0x0C bytes -> 0x6A0C
  regs.hl = 0x1182; // 2nd data unit, used first
  m.step(0x1151, 10); // ld hl,0x1182
  regs.de = 0x64a3;
  m.step(0x1154, 10); // ld de,0x64a3
  regs.bc = 0x021e;
  m.step(0x1157, 10); // ld bc,0x021e
  m.push16(0x115a); m.step(0x11ec, 17); sub_11ec(m); // call 0x11ec
  regs.hl = 0x117e; // 1st data unit, used second
  m.step(0x115d, 10); // ld hl,0x117e
  regs.de = 0x64a7;
  m.step(0x1160, 10); // ld de,0x64a7
  regs.bc = 0x021c;
  m.step(0x1163, 10); // ld bc,0x021c
  m.push16(0x1166); m.step(0x122a, 17); sub_122a(m); // call 0x122a
  regs.ix = 0x64a0;
  m.step(0x116a, 14); // ld ix,0x64a0
  mem.write8((regs.ix + 0x00) & 0xffff, 0x01);
  m.step(0x116e, 19); // ld (ix+0x00),0x01
  mem.write8((regs.ix + 0x20) & 0xffff, 0x01);
  m.step(0x1172, 19); // ld (ix+0x20),0x01 (stride 0x20)
  regs.hl = 0x6950;
  m.step(0x1175, 10); // ld hl,0x6950
  regs.b = 0x02;
  m.step(0x1177, 7); // ld b,0x02
  regs.de = 0x0020; // stride
  m.step(0x117a, 10); // ld de,0x0020
  m.push16(0x117d); m.step(0x11d3, 17); sub_11d3(m); // call 0x11d3
  m.ret();
}
/** sub_26de -- sign-REVERSING write: (HL)=+2 if bit7 set, else -2. HL live-in. ROM 0x26DE-0x26E8. */
export function sub_26de(m) {
  const { regs, mem } = m;
  const set = regs.bit(7, mem.read8(regs.hl));
  m.step(0x26e0, 12); // bit 7,(hl)
  if (!set) {
    m.step(0x26e6, 10); // jp z,0x26e6
    mem.write8(regs.hl, 0xfe); // -2
    m.step(0x26e8, 10);
    m.ret();
    return;
  }
  m.step(0x26e3, 10);
  mem.write8(regs.hl, 0x02); // +2
  m.step(0x26e5, 10);
  m.ret();
}
/** sub_26e9 -- (0x601A)&1==0 -> ret A=0; else (HL)=0xFF if bit7(HL) set else 0x01. ROM 0x26E9-0x26F9. */
export function sub_26e9(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x601a);
  m.step(0x26ec, 13); // ld a,(0x601a)
  regs.and(0x01);
  m.step(0x26ee, 7); // and 0x01
  if (regs.fZ) { m.ret(11); return; } // ret z -- returns A=0 (a value)
  m.step(0x26ef, 5);
  const b7 = regs.bit(7, mem.read8(regs.hl));
  m.step(0x26f1, 12); // bit 7,(hl)
  regs.a = 0xff;
  m.step(0x26f3, 7); // ld a,0xff
  if (b7) {
    m.step(0x26f8, 10); // jp nz,0x26f8
  } else {
    m.step(0x26f6, 10);
    regs.a = 0x01;
    m.step(0x26f8, 7); // ld a,0x01
  }
  mem.write8(regs.hl, regs.a);
  m.step(0x26f9, 7); // ld (hl),a
  m.ret();
}
/** loc_186f -- 0x1644 idx 3: rst-0x18-gated table copy (0x3A1F->0x6908) + selector advance. ROM 0x186F-0x187F. */
export function loc_186f(m) {
  const { regs, mem } = m;
  m.push16(0x1870); m.step(0x0018, 11); if (!sub_0018(m)) return; // rst 0x18 gate
  regs.hl = 0x3a1f;
  m.step(0x1873, 10); // ld hl,0x3a1f
  m.push16(0x1876); m.step(0x004e, 17); sub_004e(m); // copy 0x28 bytes -> 0x6908
  regs.a = 0x03;
  m.step(0x1878, 7); // ld a,0x03
  mem.write8(0x6084, regs.a);
  m.step(0x187b, 13); // ld (0x6084),a
  regs.hl = 0x6388;
  m.step(0x187e, 10); // ld hl,0x6388
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance the selector
  m.step(0x187f, 11);
  m.ret();
}
/** loc_1839 -- 0x1644 idx 2: rate-limited animation stepper (every-8th; wrap-path full setup). ROM 0x1839-0x186E. */
export function loc_1839(m) {
  const { regs, mem } = m;
  regs.hl = 0x6390;
  m.step(0x183c, 10); // ld hl,0x6390
  regs.incMem8(mem, regs.hl); // inc (hl) -- Z on wrap
  m.step(0x183d, 11);
  if (regs.fZ) {
    m.step(0x1859, 10); // jp z,0x1859 (wrap path)
    regs.hl = 0x385c;
    m.step(0x185c, 10); // ld hl,0x385c
    m.push16(0x185f); m.step(0x004e, 17); sub_004e(m);
    regs.hl = 0x6908;
    m.step(0x1862, 10); // ld hl,0x6908
    regs.c = 0x44;
    m.step(0x1864, 7); // ld c,0x44
    m.push16(0x1865); m.step(0x0038, 11); loc_0038(m); // rst 0x38
    regs.a = 0x20;
    m.step(0x1867, 7); // ld a,0x20
    mem.write8(0x6009, regs.a); // arm countdown
    m.step(0x186a, 13);
    regs.hl = 0x6388;
    m.step(0x186d, 10); // ld hl,0x6388
    regs.incMem8(mem, regs.hl); // inc (hl) -- advance selector
    m.step(0x186e, 11);
    m.ret();
    return;
  }
  m.step(0x1840, 10);
  regs.a = mem.read8(regs.hl);
  m.step(0x1841, 7); // ld a,(hl)
  regs.and(0x07);
  m.step(0x1843, 7); // and 0x07
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- not the 8th tick
  m.step(0x1844, 5);
  regs.de = 0x39cf;
  m.step(0x1847, 10); // ld de,0x39cf
  regs.bit(3, mem.read8(regs.hl)); // bit 3,(hl)
  m.step(0x1849, 12);
  if (regs.fZ) {
    m.step(0x184b, 7); // jr nz not taken (bit clear)
    regs.de = 0x39f7;
    m.step(0x184e, 10); // ld de,0x39f7
  } else {
    m.step(0x184e, 12); // jr nz -- keep 0x39CF
  }
  regs.exDeHl();
  m.step(0x184f, 4); // ex de,hl
  m.push16(0x1852); m.step(0x004e, 17); sub_004e(m);
  regs.hl = 0x6908;
  m.step(0x1855, 10); // ld hl,0x6908
  regs.c = 0x44;
  m.step(0x1857, 7); // ld c,0x44
  m.push16(0x1858); m.step(0x0038, 11); loc_0038(m); // rst 0x38
  m.ret();
}
/** loc_1344 -- idx 15 counter-gated state setup (TWIN of loc_12f2, different constants). ROM 0x1344-0x138E. */
export function loc_1344(m) {
  const { regs, mem } = m;
  m.push16(0x1347); m.step(0x011c, 17); sub_011c(m);
  regs.xor(regs.a);
  m.step(0x1348, 4); // xor a
  mem.write8(0x622c, regs.a);
  m.step(0x134b, 13); // ld (0x622c),a
  regs.hl = 0x6228;
  m.step(0x134e, 10); // ld hl,0x6228
  regs.decMem8(mem, regs.hl); // dec (hl)
  m.step(0x134f, 11);
  regs.a = mem.read8(regs.hl);
  m.step(0x1350, 7); // ld a,(hl)
  regs.de = 0x6048;
  m.step(0x1353, 10); // ld de,0x6048
  regs.bc = 0x0008;
  m.step(0x1356, 10); // ld bc,0x0008
  m.ldir(0x1358); // ldir 8 bytes -> 0x6048
  regs.and(regs.a);
  m.step(0x1359, 4); // and a
  if (regs.fNZ) {
    m.step(0x137f, 10); // jp nz,0x137f (counter != 0)
    regs.c = 0x17;
    m.step(0x1381, 7); // ld c,0x17
    regs.a = mem.read8(0x6040);
    m.step(0x1384, 13); // ld a,(0x6040)
    regs.and(regs.a);
    m.step(0x1385, 4); // and a
    if (regs.fNZ) {
      m.step(0x138a, 10); // jp nz -- keep C=0x17
    } else {
      m.step(0x1388, 10);
      regs.c = 0x08;
      m.step(0x138a, 7); // ld c,0x08
    }
    regs.a = regs.c;
    m.step(0x138b, 4); // ld a,c
    mem.write8(0x600a, regs.a); // 0x600A = 0x17 or 0x08
    m.step(0x138e, 13);
    m.ret();
    return;
  }
  m.step(0x135c, 10);
  regs.a = 0x03;
  m.step(0x135e, 7); // ld a,0x03
  regs.hl = 0x60b5;
  m.step(0x1361, 10); // ld hl,0x60b5
  m.push16(0x1364); m.step(0x13ca, 17); sub_13ca(m); // call 0x13ca (no guard)
  regs.de = 0x0303;
  m.step(0x1367, 10); // ld de,0x0303
  m.push16(0x136a); m.step(0x309f, 17); sub_309f(m);
  regs.de = 0x0300;
  m.step(0x136d, 10); // ld de,0x0300
  m.push16(0x1370); m.step(0x309f, 17); sub_309f(m);
  regs.hl = 0x76d3;
  m.step(0x1373, 10); // ld hl,0x76d3
  m.push16(0x1376); m.step(0x1826, 17); sub_1826(m); // fill helper
  regs.hl = 0x6009;
  m.step(0x1379, 10); // ld hl,0x6009
  mem.write8(regs.hl, 0xc0);
  m.step(0x137b, 10); // ld (hl),0xc0
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x137c, 6); // inc hl
  mem.write8(regs.hl, 0x11); // 0x600A = 0x11
  m.step(0x137e, 10);
  m.ret();
}
/** loc_17b6 -- 0x1644 idx 0: 0x6388-sequence SETUP arm (render 4 items, arm 0x6009, repoint 0x63C0). ROM 0x17B6-0x1825. */
export function loc_17b6(m) {
  const { regs, mem } = m;
  m.step(0x17b7, 4); // nop
  m.push16(0x17ba); m.step(0x011c, 17); sub_011c(m);
  regs.hl = 0x608a;
  m.step(0x17bd, 10); // ld hl,0x608a
  mem.write8(regs.hl, 0x0e);
  m.step(0x17bf, 10); // ld (hl),0x0e
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x17c0, 6); // inc hl
  mem.write8(regs.hl, 0x03);
  m.step(0x17c2, 10); // ld (hl),0x03
  regs.a = 0x10;
  m.step(0x17c4, 7); // ld a,0x10
  regs.de = 0x0020;
  m.step(0x17c7, 10); // ld de,0x0020
  regs.hl = 0x7623;
  m.step(0x17ca, 10); // ld hl,0x7623
  m.push16(0x17cd); m.step(0x0514, 17); sub_0514(m); // A/DE live-in
  regs.hl = 0x7583;
  m.step(0x17d0, 10); // ld hl,0x7583
  m.push16(0x17d3); m.step(0x0514, 17); sub_0514(m);
  // four render pairs: ld hl,vhl / call 0x1826 / ld de,rde / call 0x0da7 (straight-line)
  for (const [vhl, rde, retA, retB] of [
    [0x76da, 0x3a47, 0x17d9, 0x17df],
    [0x76d5, 0x3a4d, 0x17e5, 0x17eb],
    [0x76d0, 0x3a53, 0x17f1, 0x17f7],
    [0x76cb, 0x3a59, 0x17fd, 0x1803],
  ]) {
    regs.hl = vhl;
    m.step(retA - 3, 10); // ld hl,vhl -> the call at retA-3
    m.push16(retA); m.step(0x1826, 17); sub_1826(m);
    regs.de = rde;
    m.step(retB - 3, 10); // ld de,rde -> the call at retB-3
    m.push16(retB); m.step(0x0da7, 17); sub_0da7(m);
  }
  regs.hl = 0x385c;
  m.step(0x1806, 10); // ld hl,0x385c
  m.push16(0x1809); m.step(0x004e, 17); sub_004e(m);
  regs.hl = 0x6908;
  m.step(0x180c, 10); // ld hl,0x6908
  regs.c = 0x44;
  m.step(0x180e, 7); // ld c,0x44
  m.push16(0x180f); m.step(0x0038, 11); loc_0038(m); // rst 0x38
  regs.hl = 0x6905;
  m.step(0x1812, 10); // ld hl,0x6905
  mem.write8(regs.hl, 0x13);
  m.step(0x1814, 10); // ld (hl),0x13
  regs.a = 0x20;
  m.step(0x1816, 7); // ld a,0x20
  mem.write8(0x6009, regs.a); // arm countdown
  m.step(0x1819, 13);
  regs.a = 0x80;
  m.step(0x181b, 7); // ld a,0x80
  mem.write8(0x6390, regs.a);
  m.step(0x181e, 13);
  regs.hl = 0x6388;
  m.step(0x1821, 10); // ld hl,0x6388
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance selector; HL stays 0x6388
  m.step(0x1822, 11);
  mem.write16(0x63c0, regs.hl); // REPOINT loc_3069 at 0x6388
  m.step(0x1825, 16);
  m.ret();
}
/** loc_1880 -- 0x1644 idx 4: gated object setup (0x691B==0xD0 -> spawn record + advance). ROM 0x1880-0x18C5. */
export function loc_1880(m) {
  const { regs, mem } = m;
  regs.hl = 0x690b;
  m.step(0x1883, 10); // ld hl,0x690b
  regs.c = 0x01;
  m.step(0x1885, 7); // ld c,0x01
  m.push16(0x1886); m.step(0x0038, 11); loc_0038(m); // rst 0x38 add-loop
  regs.a = mem.read8(0x691b);
  m.step(0x1889, 13); // ld a,(0x691b)
  regs.cp(0xd0);
  m.step(0x188b, 7); // cp 0xd0
  if (regs.fNZ) { m.ret(11); return; } // ret nz
  m.step(0x188c, 5);
  regs.a = 0x20;
  m.step(0x188e, 7); // ld a,0x20
  mem.write8(0x6919, regs.a);
  m.step(0x1891, 13); // ld (0x6919),a
  regs.hl = 0x6a24;
  m.step(0x1894, 10); // ld hl,0x6a24
  mem.write8(regs.hl, 0x7f);
  m.step(0x1896, 10); // ld (hl),0x7f
  regs.l = regs.inc8(regs.l);
  m.step(0x1897, 4); // inc l
  mem.write8(regs.hl, 0x39);
  m.step(0x1899, 10); // ld (hl),0x39
  regs.l = regs.inc8(regs.l);
  m.step(0x189a, 4); // inc l
  mem.write8(regs.hl, 0x01);
  m.step(0x189c, 10); // ld (hl),0x01
  regs.l = regs.inc8(regs.l);
  m.step(0x189d, 4); // inc l
  mem.write8(regs.hl, 0xd8);
  m.step(0x189f, 10); // ld (hl),0xd8 -- record 7F 39 01 D8
  regs.hl = 0x76c6;
  m.step(0x18a2, 10); // ld hl,0x76c6
  m.push16(0x18a5); m.step(0x1826, 17); sub_1826(m);
  regs.de = 0x3a5f;
  m.step(0x18a8, 10); // ld de,0x3a5f
  m.push16(0x18ab); m.step(0x0da7, 17); sub_0da7(m);
  regs.de = 0x0004;
  m.step(0x18ae, 10); // ld de,0x0004
  regs.bc = 0x0228;
  m.step(0x18b1, 10); // ld bc,0x0228 (B=2 loop count, C=0x28 addend)
  regs.hl = 0x6903;
  m.step(0x18b4, 10); // ld hl,0x6903
  m.push16(0x18b7); m.step(0x003d, 17); sub_003d(m); // DIRECT add-loop body (B=2)
  regs.a = 0x00;
  m.step(0x18b9, 7); // ld a,0x00
  mem.write8(0x62af, regs.a);
  m.step(0x18bc, 13); // ld (0x62af),a
  regs.a = 0x03;
  m.step(0x18be, 7); // ld a,0x03
  mem.write8(0x6082, regs.a);
  m.step(0x18c1, 13); // ld (0x6082),a
  regs.hl = 0x6388;
  m.step(0x18c4, 10); // ld hl,0x6388
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance selector
  m.step(0x18c5, 11);
  m.ret();
}
/** loc_101f -- inline-table arm C=2: table copies + object init + ldir blocks; sets 0x62B9=1. ROM 0x101F-0x1086. */
export function loc_101f(m) {
  const { regs, mem } = m;
  regs.hl = 0x3dec;
  m.step(0x1022, 10); // ld hl,0x3dec
  regs.de = 0x6407;
  m.step(0x1025, 10); // ld de,0x6407
  regs.bc = 0x051c;
  m.step(0x1028, 10); // ld bc,0x051c
  m.push16(0x102b); m.step(0x122a, 17); sub_122a(m);
  m.push16(0x102e); m.step(0x1186, 17); sub_1186(m);
  regs.hl = 0x3e18;
  m.step(0x1031, 10); // ld hl,0x3e18
  regs.de = 0x65a7;
  m.step(0x1034, 10); // ld de,0x65a7
  regs.bc = 0x060c;
  m.step(0x1037, 10); // ld bc,0x060c
  m.push16(0x103a); m.step(0x122a, 17); sub_122a(m);
  regs.ix = 0x65a0;
  m.step(0x103e, 14); // ld ix,0x65a0
  regs.hl = 0x69b8;
  m.step(0x1041, 10); // ld hl,0x69b8
  regs.de = 0x0010;
  m.step(0x1044, 10); // ld de,0x0010 (stride)
  regs.b = 0x06;
  m.step(0x1046, 7); // ld b,0x06
  m.push16(0x1049); m.step(0x11d3, 17); sub_11d3(m);
  regs.hl = 0x3dfa;
  m.step(0x104c, 10); // ld hl,0x3dfa (live-in to sub_11fa)
  m.push16(0x104f); m.step(0x11fa, 17); sub_11fa(m);
  regs.hl = 0x3e04;
  m.step(0x1052, 10); // ld hl,0x3e04
  regs.de = 0x69fc;
  m.step(0x1055, 10); // ld de,0x69fc
  regs.bc = 0x0004;
  m.step(0x1058, 10); // ld bc,0x0004
  m.ldir(0x105a);
  regs.hl = 0x3e1c;
  m.step(0x105d, 10); // ld hl,0x3e1c
  regs.de = 0x6944;
  m.step(0x1060, 10); // ld de,0x6944
  regs.bc = 0x0008;
  m.step(0x1063, 10); // ld bc,0x0008
  m.ldir(0x1065);
  regs.hl = 0x3e24;
  m.step(0x1068, 10); // ld hl,0x3e24
  regs.de = 0x69e4;
  m.step(0x106b, 10); // ld de,0x69e4
  regs.bc = 0x0018;
  m.step(0x106e, 10); // ld bc,0x0018
  m.ldir(0x1070);
  regs.hl = 0x3e10;
  m.step(0x1073, 10); // ld hl,0x3e10 (live-in to sub_11a6)
  m.push16(0x1076); m.step(0x11a6, 17); sub_11a6(m);
  regs.hl = 0x3e3c;
  m.step(0x1079, 10); // ld hl,0x3e3c
  regs.de = 0x6a0c;
  m.step(0x107c, 10); // ld de,0x6a0c
  regs.bc = 0x000c;
  m.step(0x107f, 10); // ld bc,0x000c
  m.ldir(0x1081);
  regs.a = 0x01;
  m.step(0x1083, 7); // ld a,0x01
  mem.write8(0x62b9, regs.a); // 0x62B9 = 1
  m.step(0x1086, 13);
  m.ret();
}
/** loc_18c6 -- 0x1644 idx 5: 0x62AF counter-driven staging; on wrap resets sequence + hands 0x600A=8. ROM 0x18C6-0x196A. */
export function loc_18c6(m) {
  const { regs, mem } = m;
  regs.hl = 0x62af;
  m.step(0x18c9, 10); // ld hl,0x62af
  regs.decMem8(mem, regs.hl); // dec (hl) -- Z gates wrap
  m.step(0x18ca, 11);
  if (regs.fZ) return loc_18c6_wrap(m); // jp z,0x193d
  m.step(0x18cd, 10);
  regs.a = mem.read8(regs.hl);
  m.step(0x18ce, 7); // ld a,(hl)
  regs.and(0x07);
  m.step(0x18d0, 7); // and 0x07
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- every-8th gate
  m.step(0x18d1, 5);
  regs.hl = 0x6a25;
  m.step(0x18d4, 10); // ld hl,0x6a25
  regs.a = mem.read8(regs.hl);
  m.step(0x18d5, 7); // ld a,(hl)
  regs.xor(0x80);
  m.step(0x18d7, 7); // xor 0x80
  mem.write8(regs.hl, regs.a);
  m.step(0x18d8, 7); // ld (hl),a
  regs.hl = 0x6919;
  m.step(0x18db, 10); // ld hl,0x6919
  regs.b = mem.read8(regs.hl);
  m.step(0x18dc, 7); // ld b,(hl)
  regs.b = regs.res(5, regs.b); // res 5,b
  m.step(0x18de, 8);
  regs.xor(regs.a); // A = 0
  m.step(0x18df, 4);
  m.push16(0x18e2); m.step(0x3009, 17); entry_3009(m);
  regs.or(0x20);
  m.step(0x18e4, 7); // or 0x20
  mem.write8(regs.hl, regs.a); // 0x6919 = A | 0x20
  m.step(0x18e5, 7); // ld (hl),a
  regs.hl = 0x62af;
  m.step(0x18e8, 10); // ld hl,0x62af
  regs.a = mem.read8(regs.hl);
  m.step(0x18e9, 7); // ld a,(hl)
  regs.cp(0xe0);
  m.step(0x18eb, 7); // cp 0xe0
  if (regs.fZ) {
    m.step(0x18ee, 10); // stage @0xE0
    regs.a = 0x50; m.step(0x18f0, 7); mem.write8(0x694f, regs.a); m.step(0x18f3, 13);
    regs.a = 0x00; m.step(0x18f5, 7); mem.write8(0x694d, regs.a); m.step(0x18f8, 13);
    regs.a = 0x9f; m.step(0x18fa, 7); mem.write8(0x694c, regs.a); m.step(0x18fd, 13);
    regs.a = mem.read8(0x6203); m.step(0x1900, 13); // ld a,(0x6203)
    regs.cp(0x80); m.step(0x1902, 7); // cp 0x80
    if (regs.fC) {
      m.step(0x1905, 10);
      regs.a = 0x80; m.step(0x1907, 7); mem.write8(0x694d, regs.a); m.step(0x190a, 13);
      regs.a = 0x5f; m.step(0x190c, 7); mem.write8(0x694c, regs.a); m.step(0x190f, 13);
    } else {
      m.step(0x190f, 10); // jp nc,0x190f
    }
    regs.a = mem.read8(regs.hl); // re-read 0x62AF
    m.step(0x1910, 7);
  } else {
    m.step(0x1910, 10); // jp nz,0x1910
  }
  regs.cp(0xc0);
  m.step(0x1912, 7); // cp 0xc0
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- not 0xC0
  m.step(0x1913, 5);
  regs.hl = 0x608a;
  m.step(0x1916, 10); // ld hl,0x608a
  mem.write8(regs.hl, 0x0c);
  m.step(0x1918, 10); // ld (hl),0x0c
  regs.a = mem.read8(0x6229);
  m.step(0x191b, 13); // ld a,(0x6229)
  regs.rrca();
  m.step(0x191c, 4); // rrca
  if (regs.fC) {
    m.step(0x1920, 12); // jr c -- keep 0x0C
  } else {
    m.step(0x191e, 7);
    mem.write8(regs.hl, 0x05); // 0x608A = 0x05
    m.step(0x1920, 10);
  }
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1921, 6); // inc hl
  mem.write8(regs.hl, 0x03);
  m.step(0x1923, 10); // 0x608B = 3
  regs.hl = 0x6a23;
  m.step(0x1926, 10); // ld hl,0x6a23
  mem.write8(regs.hl, 0x40); m.step(0x1928, 10);
  regs.hl = (regs.hl - 1) & 0xffff; m.step(0x1929, 6);
  mem.write8(regs.hl, 0x09); m.step(0x192b, 10);
  regs.hl = (regs.hl - 1) & 0xffff; m.step(0x192c, 6);
  mem.write8(regs.hl, 0x76); m.step(0x192e, 10);
  regs.hl = (regs.hl - 1) & 0xffff; m.step(0x192f, 6);
  mem.write8(regs.hl, 0x8f); m.step(0x1931, 10); // record 8F 76 09 40 at 0x6A20
  regs.a = mem.read8(0x6203);
  m.step(0x1934, 13); // ld a,(0x6203)
  regs.cp(0x80);
  m.step(0x1936, 7); // cp 0x80
  if (regs.fNC) { m.ret(11); return; } // ret nc
  m.step(0x1937, 5);
  regs.a = 0x6f;
  m.step(0x1939, 7); // ld a,0x6f
  mem.write8(0x6a20, regs.a);
  m.step(0x193c, 13);
  m.ret();
}
/** loc_18c6_wrap -- 0x62AF-wrap: walk 0x622A, reset 0x6388=0, set 0x600A=8 (hand to state 8). ROM 0x193D-0x196A. */
function loc_18c6_wrap(m) {
  const { regs, mem } = m;
  regs.hl = mem.read16(0x622a); // ld hl,(0x622a) INDIRECT
  m.step(0x1940, 16);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1941, 6); // inc hl
  regs.a = mem.read8(regs.hl);
  m.step(0x1942, 7); // ld a,(hl)
  regs.cp(0x7f);
  m.step(0x1944, 7); // cp 0x7f
  if (regs.fZ) {
    m.step(0x1947, 10); // sentinel -> reset the walk
    regs.hl = 0x3a73;
    m.step(0x194a, 10); // ld hl,0x3a73
    regs.a = mem.read8(regs.hl);
    m.step(0x194b, 7); // ld a,(hl)
  } else {
    m.step(0x194b, 10);
  }
  mem.write16(0x622a, regs.hl);
  m.step(0x194e, 16); // ld (0x622a),hl
  mem.write8(0x6227, regs.a);
  m.step(0x1951, 13); // ld (0x6227),a
  regs.hl = 0x6229;
  m.step(0x1954, 10); // ld hl,0x6229
  regs.incMem8(mem, regs.hl); // inc (hl)
  m.step(0x1955, 11);
  regs.de = 0x0500;
  m.step(0x1958, 10); // ld de,0x0500
  m.push16(0x195b); m.step(0x309f, 17); sub_309f(m);
  regs.xor(regs.a);
  m.step(0x195c, 4); // xor a
  mem.write8(0x622e, regs.a); // 0x622E = 0
  m.step(0x195f, 13);
  mem.write8(0x6388, regs.a); // 0x6388 = 0 -- RESET sequence
  m.step(0x1962, 13);
  regs.hl = 0x6009;
  m.step(0x1965, 10); // ld hl,0x6009
  mem.write8(regs.hl, 0xe0); // 0x6009 = 0xE0
  m.step(0x1967, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1968, 6); // inc hl
  mem.write8(regs.hl, 0x08); // 0x600A = 8 -- hand to state 8
  m.step(0x196a, 10);
  m.ret();
}
/**
 * entry_0400 -- scheduled task 0x0400 handler.  ROM 0x0400-0x04BD.
 * The SAME body as entry_03fb entered at 0x0400 (the jp nz,0x0413), with the task-runner's
 * Z flag as a LIVE-IN (instead of entry_03fb's ld a,(0x6227)/cp 0x02). Reuses entry_03fb's
 * loc_0413 chain (which already covers the full 0x0486 tail incl. the 0x6227==4 arm).
 */
export function entry_0400(m) {
  const { regs, mem } = m;
  if (regs.fNZ) { m.step(0x0413, 10); return loc_0413(m); } // jp nz,0x0413 (Z live-in)
  m.step(0x0403, 10);
  // -- 0x0403: the (0x6227)==2 preamble (identical to entry_03fb's) -> loc_0413 --
  regs.hl = 0x6908;
  m.step(0x0406, 10); // ld hl,0x6908
  regs.a = mem.read8(0x63a3);
  m.step(0x0409, 13); // ld a,(0x63a3)
  regs.c = regs.a;
  m.step(0x040a, 4); // ld c,a
  m.push16(0x040b); m.step(0x0038, 11); loc_0038(m); // rst 0x38
  regs.a = mem.read8(0x6910);
  m.step(0x040e, 13); // ld a,(0x6910)
  regs.sub(0x3b);
  m.step(0x0410, 7); // sub 0x3b
  mem.write8(0x63b7, regs.a);
  m.step(0x0413, 13); // ld (0x63b7),a -- falls into loc_0413
  return loc_0413(m);
}
/** loc_1df5 -- loc_1dc9 0x6342-bit2 tail: reads 0x6018, dispatches bits 0/1 to setter arms. ROM 0x1DF5-0x1DFF. */
export function loc_1df5(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6018);
  m.step(0x1df8, 13); // ld a,(0x6018)
  regs.rra();
  m.step(0x1df9, 4); // rra -- bit0
  if (regs.fC) { m.step(0x1e08, 10); return loc_1e08(m); } // jp c,0x1e08
  m.step(0x1dfc, 10);
  regs.rra();
  m.step(0x1dfd, 4); // rra -- bit1
  if (regs.fC) { m.step(0x1e10, 10); return loc_1e10(m); } // jp c,0x1e10
  m.step(0x1e00, 10); // -> loc_1e00
  return loc_1e00(m);
}
/** loc_1e08 -- setter B=0x7E, DE=0x0005; jp loc_1e15. ROM 0x1E08-0x1E0F. */
export function loc_1e08(m) {
  const { regs } = m;
  regs.b = 0x7e;
  m.step(0x1e0a, 7); // ld b,0x7e
  regs.de = 0x0005;
  m.step(0x1e0d, 10); // ld de,0x0005
  m.step(0x1e15, 10); // jp 0x1e15
  return loc_1e15(m);
}
/** loc_1e10 -- setter B=0x7F, DE=0x0008; falls into loc_1e15. ROM 0x1E10-0x1E14. */
export function loc_1e10(m) {
  const { regs } = m;
  regs.b = 0x7f;
  m.step(0x1e12, 7); // ld b,0x7f
  regs.de = 0x0008;
  m.step(0x1e15, 10); // ld de,0x0008
  return loc_1e15(m);
}
/** loc_1e36 -- writes 0x6A30 block {A,B,0x07,C}, rst-0x30 gate, 0x6085=3, ret. A/B/C live-in. ROM 0x1E36-0x1E49. */
export function loc_1e36(m) {
  const { regs, mem } = m;
  regs.hl = 0x6a30;
  m.step(0x1e39, 10); // ld hl,0x6a30
  mem.write8(regs.hl, regs.a);
  m.step(0x1e3a, 7); // ld (hl),a
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x1e3b, 4); // inc l
  mem.write8(regs.hl, regs.b);
  m.step(0x1e3c, 7); // ld (hl),b
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x1e3d, 4); // inc l
  mem.write8(regs.hl, 0x07);
  m.step(0x1e3f, 10); // ld (hl),0x07
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x1e40, 4); // inc l
  mem.write8(regs.hl, regs.c);
  m.step(0x1e41, 7); // ld (hl),c
  regs.a = 0x05;
  m.step(0x1e43, 7); // ld a,0x05
  m.push16(0x1e44); m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // caller-skip gate
  regs.hl = 0x6085;
  m.step(0x1e47, 10); // ld hl,0x6085
  mem.write8(regs.hl, 0x03);
  m.step(0x1e49, 10); // 0x6085 = 3
  m.ret(10);
}
/** loc_1087 -- inline-table arm C=3: table copies + two fill loops + IX=0x6400 init block + ldir. ROM 0x1087-0x1120. */
export function loc_1087(m) {
  const { regs, mem } = m;
  regs.hl = 0x3dec;
  m.step(0x108a, 10); // ld hl,0x3dec
  regs.de = 0x6407;
  m.step(0x108d, 10); // ld de,0x6407
  regs.bc = 0x051c;
  m.step(0x1090, 10); // ld bc,0x051c
  m.push16(0x1093); m.step(0x122a, 17); sub_122a(m);
  m.push16(0x1096); m.step(0x1186, 17); sub_1186(m);
  regs.hl = 0x6600;
  m.step(0x1099, 10); // ld hl,0x6600
  regs.de = 0x0010;
  m.step(0x109c, 10); // ld de,0x0010
  regs.a = 0x01;
  m.step(0x109e, 7); // ld a,0x01
  regs.b = 0x06;
  m.step(0x10a0, 7); // ld b,0x06
  do {
    // -- loc_10a0: fill 6 cells stride 0x10 --
    mem.write8(regs.hl, regs.a);
    m.step(0x10a1, 7); // ld (hl),a
    regs.addHl(regs.de);
    m.step(0x10a2, 11); // add hl,de
    regs.djnz();
    m.step(regs.b !== 0 ? 0x10a0 : 0x10a4, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);
  regs.c = 0x02;
  m.step(0x10a6, 7); // ld c,0x02
  regs.a = 0x08;
  m.step(0x10a8, 7); // ld a,0x08
  do {
    // -- loc_10a8 outer (HL reset each pass -> both passes write the same 3 cells) --
    regs.b = 0x03;
    m.step(0x10aa, 7); // ld b,0x03
    regs.hl = 0x660d;
    m.step(0x10ad, 10); // ld hl,0x660d
    do {
      mem.write8(regs.hl, regs.a);
      m.step(0x10ae, 7); // ld (hl),a
      regs.addHl(regs.de);
      m.step(0x10af, 11); // add hl,de
      regs.djnz();
      m.step(regs.b !== 0 ? 0x10ad : 0x10b1, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
    regs.a = 0x08;
    m.step(0x10b3, 7); // ld a,0x08
    regs.c = regs.dec8(regs.c);
    m.step(0x10b4, 4); // dec c
    m.step(regs.fNZ ? 0x10a8 : 0x10b7, 10); // jp nz,0x10a8
  } while (regs.fNZ);
  regs.hl = 0x3e64;
  m.step(0x10ba, 10); // ld hl,0x3e64
  regs.de = 0x6603;
  m.step(0x10bd, 10); // ld de,0x6603
  regs.bc = 0x060e;
  m.step(0x10c0, 10); // ld bc,0x060e
  m.push16(0x10c3); m.step(0x11ec, 17); sub_11ec(m);
  regs.hl = 0x3e60;
  m.step(0x10c6, 10); // ld hl,0x3e60
  regs.de = 0x6607;
  m.step(0x10c9, 10); // ld de,0x6607
  regs.bc = 0x060c;
  m.step(0x10cc, 10); // ld bc,0x060c
  m.push16(0x10cf); m.step(0x122a, 17); sub_122a(m);
  regs.ix = 0x6600;
  m.step(0x10d3, 14); // ld ix,0x6600
  regs.hl = 0x6958;
  m.step(0x10d6, 10); // ld hl,0x6958
  regs.b = 0x06;
  m.step(0x10d8, 7); // ld b,0x06
  regs.de = 0x0010;
  m.step(0x10db, 10); // ld de,0x0010
  m.push16(0x10de); m.step(0x11d3, 17); sub_11d3(m);
  regs.hl = 0x3e48;
  m.step(0x10e1, 10); // ld hl,0x3e48
  regs.de = 0x6a0c;
  m.step(0x10e4, 10); // ld de,0x6a0c
  regs.bc = 0x000c;
  m.step(0x10e7, 10); // ld bc,0x000c
  m.ldir(0x10e9);
  regs.ix = 0x6400;
  m.step(0x10ed, 14); // ld ix,0x6400
  const R = (d) => (regs.ix + d) & 0xffff;
  mem.write8(R(0x00), 0x01);
  m.step(0x10f1, 19); // ld (ix+0x00),0x01
  mem.write8(R(0x03), 0x58);
  m.step(0x10f5, 19); // ld (ix+0x03),0x58
  mem.write8(R(0x0e), 0x58);
  m.step(0x10f9, 19); // ld (ix+0x0e),0x58
  mem.write8(R(0x05), 0x80);
  m.step(0x10fd, 19); // ld (ix+0x05),0x80
  mem.write8(R(0x0f), 0x80);
  m.step(0x1101, 19); // ld (ix+0x0f),0x80
  mem.write8(R(0x20), 0x01);
  m.step(0x1105, 19); // ld (ix+0x20),0x01
  mem.write8(R(0x23), 0xeb);
  m.step(0x1109, 19); // ld (ix+0x23),0xeb
  mem.write8(R(0x2e), 0xeb);
  m.step(0x110d, 19); // ld (ix+0x2e),0xeb
  mem.write8(R(0x25), 0x60);
  m.step(0x1111, 19); // ld (ix+0x25),0x60
  mem.write8(R(0x2f), 0x60);
  m.step(0x1115, 19); // ld (ix+0x2f),0x60
  regs.de = 0x6970;
  m.step(0x1118, 10); // ld de,0x6970
  regs.hl = 0x1121;
  m.step(0x111b, 10); // ld hl,0x1121
  regs.bc = 0x0010;
  m.step(0x111e, 10); // ld bc,0x0010
  m.ldir(0x1120);
  m.ret();
}
/** sub_1641 -- call sub_1dbd, then rst-0x28 dispatch on (0x6388) via the 0x1648 table. ROM 0x1641-0x1647. */
export function sub_1641(m) {
  const { regs, mem } = m;
  m.push16(0x1644); m.step(0x1dbd, 17); sub_1dbd(m); // call 0x1dbd
  regs.a = mem.read8(0x6388);
  m.step(0x1647, 13); // ld a,(0x6388)
  m.push16(0x1648); m.step(0x0028, 11); // rst 0x28
  return sub_0028(m, "0x1648 (0x6388 sequence)"); // ROM table dispatch; jp (hl)
}
/** sub_1670 -- rst-0x18 gate, copy 0x3932->0x6908, arm 0x6009=0x20, advance 0x6388, rst-0x30 gate, rst 0x38. ROM 0x1670-0x1689. */
export function sub_1670(m) {
  const { regs, mem } = m;
  m.push16(0x1671); m.step(0x0018, 11); if (!sub_0018(m)) return; // rst 0x18
  regs.hl = 0x3932;
  m.step(0x1674, 10); // ld hl,0x3932
  m.push16(0x1677); m.step(0x004e, 17); sub_004e(m); // call 0x004e
  regs.a = 0x20;
  m.step(0x1679, 7); // ld a,0x20
  mem.write8(0x6009, regs.a);
  m.step(0x167c, 13); // ld (0x6009),a
  regs.hl = 0x6388;
  m.step(0x167f, 10); // ld hl,0x6388
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x1680, 11); // inc (0x6388)
  regs.a = 0x04;
  m.step(0x1682, 7); // ld a,0x04
  m.push16(0x1683); m.step(0x0030, 11); if (!sub_0030(m)) return; // rst 0x30 caller-skip
  regs.hl = 0x690b;
  m.step(0x1686, 10); // ld hl,0x690b
  regs.c = 0x04;
  m.step(0x1688, 7); // ld c,0x04
  m.push16(0x1689); m.step(0x0038, 11); loc_0038(m); // rst 0x38
  m.ret(10);
}
/** sub_176c -- clamp scan: over 10 cells at 0x692F, HL-=3 via sbc hl,de; if (HL low)<0x19 zero (HL). ROM 0x176C-0x1782. */
export function sub_176c(m) {
  const { regs, mem } = m;
  regs.de = 0x0003;
  m.step(0x176f, 10); // ld de,0x0003
  regs.hl = 0x692f;
  m.step(0x1772, 10); // ld hl,0x692f
  regs.b = 0x0a;
  m.step(0x1774, 7); // ld b,0x0a
  do {
    regs.and(regs.a);
    m.step(0x1775, 4); // and a -- clear carry
    regs.a = mem.read8(regs.hl);
    m.step(0x1776, 7); // ld a,(hl)
    regs.sbcHl(regs.de);
    m.step(0x1778, 15); // sbc hl,de (bare)
    regs.cp(0x19);
    m.step(0x177a, 7); // cp 0x19
    if (regs.fNC) {
      m.step(0x177f, 10); // jp nc -- keep
    } else {
      m.step(0x177d, 10);
      mem.write8(regs.hl, 0x00);
      m.step(0x177f, 10); // ld (hl),0x00
    }
    regs.hl = (regs.hl - 1) & 0xffff;
    m.step(0x1780, 6); // dec hl
    regs.djnz();
    m.step(regs.b ? 0x1774 : 0x1782, regs.b ? 13 : 8);
  } while (regs.b);
  m.ret(10);
}
/** sub_0d00 -- 8-record block-fill from the 0x0D17 table: each record fills 2 cells with a descending 0xB8. ROM 0x0D00-0x0D16. */
export function sub_0d00(m) {
  const { regs, mem } = m;
  regs.b = 0x08;
  m.step(0x0d02, 7); // ld b,0x08
  regs.hl = 0x0d17;
  m.step(0x0d05, 10); // ld hl,0x0d17
  do {
    regs.a = 0xb8;
    m.step(0x0d07, 7); // ld a,0xb8
    regs.c = 0x02;
    m.step(0x0d09, 7); // ld c,0x02
    regs.e = mem.read8(regs.hl);
    m.step(0x0d0a, 7); // ld e,(hl)
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0d0b, 6); // inc hl
    regs.d = mem.read8(regs.hl);
    m.step(0x0d0c, 7); // ld d,(hl)
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0d0d, 6); // inc hl
    do {
      mem.write8(regs.de, regs.a);
      m.step(0x0d0e, 7); // ld (de),a
      regs.a = regs.dec8(regs.a);
      m.step(0x0d0f, 4); // dec a
      regs.de = (regs.de + 1) & 0xffff;
      m.step(0x0d10, 6); // inc de
      regs.c = regs.dec8(regs.c);
      m.step(0x0d11, 4); // dec c
      m.step(regs.c !== 0 ? 0x0d0d : 0x0d14, 10); // jp nz
    } while (regs.c !== 0);
    regs.djnz();
    m.step(regs.b ? 0x0d05 : 0x0d16, regs.b ? 13 : 8);
  } while (regs.b);
  m.ret(10);
}
/** sub_15fa -- build a 4-byte sprite record at 0x6974 from the 0x360F table indexed by C*2 (BC live-in). ROM 0x15FA-0x1614. */
export function sub_15fa(m) {
  const { regs, mem } = m;
  m.push16(regs.de);
  m.step(0x15fb, 11); // push de
  m.push16(regs.hl);
  m.step(0x15fc, 11); // push hl
  regs.c = regs.sla(regs.c);
  m.step(0x15fe, 8); // sla c -- C *= 2
  regs.hl = 0x360f;
  m.step(0x1601, 10); // ld hl,0x360f
  regs.addHl(regs.bc);
  m.step(0x1602, 11); // add hl,bc
  regs.exDeHl();
  m.step(0x1603, 4); // ex de,hl -- DE = record ptr
  regs.hl = 0x6974;
  m.step(0x1606, 10); // ld hl,0x6974
  regs.a = mem.read8(regs.de);
  m.step(0x1607, 7); // ld a,(de)
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x1608, 6); // inc de
  mem.write8(regs.hl, regs.a);
  m.step(0x1609, 7); // 0x6974 = record[0]
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x160a, 6); // inc hl
  mem.write8(regs.hl, 0x72);
  m.step(0x160c, 10); // 0x6975 = 0x72
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x160d, 6); // inc hl
  mem.write8(regs.hl, 0x0c);
  m.step(0x160f, 10); // 0x6976 = 0x0C
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1610, 6); // inc hl
  regs.a = mem.read8(regs.de);
  m.step(0x1611, 7); // ld a,(de)
  mem.write8(regs.hl, regs.a);
  m.step(0x1612, 7); // 0x6977 = record[1]
  regs.hl = m.pop16();
  m.step(0x1613, 10); // pop hl
  regs.de = m.pop16();
  m.step(0x1614, 10); // pop de
  m.ret(10);
}

/**
 * sub_057c -- unpack 3 source bytes into 6 nibbles up a video column (digit
 * renderer). ROM 0x057C-0x059A (body 0x057C-0x0592 + interior helper sub_0593
 * @0x0593-0x059A).
 *
 * DE (source ptr, e.g. 0x01BF) and IX (destination video cell) are LIVE-IN from
 * the caller sub_1486 (DE set @0x159D, IX from push hl/pop ix @0x15AB). `ex de,hl`
 * moves the source into HL, THEN DE is overwritten with the -0x20 up-a-row step,
 * so DE's live-in value survives only in HL. For each of B=3 bytes:
 * write the HIGH nibble (four rrca), then the LOW nibble; source walked DOWN by
 * `dec hl`. sub_0593 masks to a nibble, stores to (ix+0), and steps IX up a row.
 * Transitive gap the reachcrawler missed -- reachable only through sub_1486.
 */
export function sub_057c(m) {
  const { regs, mem } = m;
  regs.exDeHl();
  m.step(0x057d, 4); // ex de,hl -- HL := source (was DE, live-in)
  regs.de = 0xffe0;
  m.step(0x0580, 10); // ld de,0xffe0 -- step = -0x20 (up one row)
  regs.bc = 0x0304;
  m.step(0x0583, 10); // ld bc,0x0304 -- B=3 bytes, C=4 (unused marker)
  do {
    regs.a = mem.read8(regs.hl);
    m.step(0x0584, 7); // ld a,(hl) -- source byte
    regs.rrca();
    m.step(0x0585, 4); // rrca
    regs.rrca();
    m.step(0x0586, 4); // rrca
    regs.rrca();
    m.step(0x0587, 4); // rrca
    regs.rrca();
    m.step(0x0588, 4); // rrca -- A := high nibble (rotated into low 4 bits)
    m.push16(0x058b);
    m.step(0x0593, 17); // call 0x0593 -- write HIGH nibble, IX -= 0x20
    sub_0593(m);
    regs.a = mem.read8(regs.hl);
    m.step(0x058c, 7); // ld a,(hl) -- same byte again
    m.push16(0x058f);
    m.step(0x0593, 17); // call 0x0593 -- write LOW nibble, IX -= 0x20
    sub_0593(m);
    regs.hl = (regs.hl - 1) & 0xffff;
    m.step(0x0590, 6); // dec hl -- next source byte (descending)
    regs.djnz();
    m.step(regs.b ? 0x0583 : 0x0592, regs.b ? 13 : 8); // djnz 0x0583
  } while (regs.b);
  m.ret(10); // ret @0x0592

  function sub_0593(m) {
    const { regs, mem } = m;
    regs.and(0x0f);
    m.step(0x0595, 7); // and 0x0f -- mask to a nibble (0..F)
    mem.write8(regs.ix & 0xffff, regs.a);
    m.step(0x0598, 19); // ld (ix+0x00),a -- write digit to video cell
    regs.addIx(regs.de);
    m.step(0x059a, 15); // add ix,de -- IX += -0x20 (up one row)
    m.ret(10); // ret @0x059a
  }
}

/**
 * sub_1486 -- the (0x600A) phase-21 handler: on-board bonus item mover + its
 * value-digit display. ROM 0x1486-0x15F9 (372 bytes).
 * Dispatched by loc_06fe's
 * 0x0702 table at index 21 (word 0x1486 @0x072C).
 *
 * Init (0x6009==0): clear latches, mark running (0x6009)=1, seed the state block
 * (0x6030)=0x0A/(0x6031)=0/(0x6032)=0x10/(0x6033)=0x1E/(0x6034)=0x3E/(0x6035)=0,
 * set the video pointer (0x6036)=0x75E8, and locate the item slot by scanning the
 * 0x611C table (stride 0x22, 4 rows) for key 2*(0x600E)+1; store the slot at
 * (0x6038) and slot-0x0D at (0x603A); render via sub_15fa.
 * Per frame: count down the display timer (0x6034) (reload 0x3E); on wrap decrement
 * the value (0x6033) (BCD-split to 0x7552/0x7572) -- value==0 EXITs. Step the item
 * position (0x6035) per (0x6010) (bit7 -> the 0x1546 video-column walk 0x7588/0x7608;
 * low bits -> 0x1514 inc/dec with wrap 0..0x1D). Animate the sprite (0x158a: countdown
 * (0x6032), toggle (0x6031), IX from (iy+4/5) with iy=(0x6038), sub_057c renders the
 * 6 digits). EXIT (0x15c6): clear slot, (0x6009)=0x80, DEC (0x600A) [the phase step-
 * back -- do not drop], copy the 0x0C-cell column to iy=(0x603A), and
 * enqueue the follow-up tasks 0x0314..0x0318 (5x) + 0x031A via sub_309f.
 *
 * S2 PROVEN: dense branch tree with a SINGLE ret @0x15F9 (all paths converge via
 * jp/fall-through). Irreducible CFG (backward cross-jumps 0x1543->0x152d,
 * 0x1587->0x1580, 0x15c3->0x15a0) -> a label-dispatch loop: ROM labels as cases,
 * jumps as `label=X; continue`, ROM fall-through as switch fall-through (the
 * entry_3202 idiom). HAZARDS: `jp p` @0x153E is SIGNED -> regs.fP; `dec (hl)` RMW
 * @0x14DF/0x14E6/0x158D/0x15D2 flag-correct via regs.decMem8; bit 7/1 @0x1505/0x151D
 * via regs.bit; sbc hl,bc @0x155A/0x1578 preceded by `and a` to clear carry.
 * Callees sub_0616/sub_15fa/sub_309f INTEGRATED; sub_057c integrated above.
 */
export function sub_1486(m) {
  const { regs, mem } = m;
  let label = 0x1486;
  for (;;) {
    switch (label) {
      case 0x1486:
        m.push16(0x1489);
        m.step(0x0616, 17); // call 0x0616 (INT)
        sub_0616(m);
        regs.hl = 0x6009;
        m.step(0x148c, 10); // ld hl,0x6009
        regs.a = mem.read8(regs.hl);
        m.step(0x148d, 7); // ld a,(hl)
        regs.and(regs.a);
        m.step(0x148e, 4); // and a
        if (regs.fNZ) { label = 0x14dc; continue; } // jp nz,0x14dc -- already running
        m.step(0x1491, 10); // jp nz NOT taken
        // ---- init (0x6009 == 0), A == 0 ----
        mem.write8(0x7d86, regs.a);
        m.step(0x1494, 13); // ld (0x7d86),a -- clear latch
        mem.write8(0x7d87, regs.a);
        m.step(0x1497, 13); // ld (0x7d87),a
        mem.write8(regs.hl, 0x01);
        m.step(0x1499, 10); // ld (hl),0x01 -- (0x6009):=1 running
        regs.hl = 0x6030;
        m.step(0x149c, 10); // ld hl,0x6030 -- init item-state block
        mem.write8(regs.hl, 0x0a);
        m.step(0x149e, 10); // ld (hl),0x0a -- (0x6030):=0x0A
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x149f, 6); // inc hl
        mem.write8(regs.hl, 0x00);
        m.step(0x14a1, 10); // ld (hl),0x00 -- (0x6031):=0
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x14a2, 6); // inc hl
        mem.write8(regs.hl, 0x10);
        m.step(0x14a4, 10); // ld (hl),0x10 -- (0x6032):=0x10
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x14a5, 6); // inc hl
        mem.write8(regs.hl, 0x1e);
        m.step(0x14a7, 10); // ld (hl),0x1e -- (0x6033):=0x1E
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x14a8, 6); // inc hl
        mem.write8(regs.hl, 0x3e);
        m.step(0x14aa, 10); // ld (hl),0x3e -- (0x6034):=0x3E
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x14ab, 6); // inc hl
        mem.write8(regs.hl, 0x00);
        m.step(0x14ad, 10); // ld (hl),0x00 -- (0x6035):=0
        regs.hl = 0x75e8;
        m.step(0x14b0, 10); // ld hl,0x75e8
        mem.write16(0x6036, regs.hl);
        m.step(0x14b3, 16); // ld (0x6036),hl -- (0x6036):=0x75E8 video ptr
        regs.hl = 0x611c;
        m.step(0x14b6, 10); // ld hl,0x611c -- item-slot table
        regs.a = mem.read8(0x600e);
        m.step(0x14b9, 13); // ld a,(0x600e)
        regs.rlca();
        m.step(0x14ba, 4); // rlca
        regs.a = regs.inc8(regs.a);
        m.step(0x14bb, 4); // inc a
        regs.c = regs.a;
        m.step(0x14bc, 4); // ld c,a -- C := 2*(0x600E)+1 search key
        regs.de = 0x0022;
        m.step(0x14bf, 10); // ld de,0x0022 -- table stride
        regs.b = 0x04;
        m.step(0x14c1, 7); // ld b,0x04 -- 4 entries
      // fall into 0x14c1
      case 0x14c1:
        regs.a = mem.read8(regs.hl);
        m.step(0x14c2, 7); // ld a,(hl)
        regs.cp(regs.c);
        m.step(0x14c3, 4); // cp c
        if (regs.fZ) { label = 0x14c9; continue; } // jp z,0x14c9 -- match
        m.step(0x14c6, 10); // jp z NOT taken
        regs.addHl(regs.de);
        m.step(0x14c7, 11); // add hl,de
        regs.djnz();
        m.step(regs.b ? 0x14c1 : 0x14c9, regs.b ? 13 : 8); // djnz 0x14c1
        if (regs.b) { label = 0x14c1; continue; }
      // fall into 0x14c9 (no match -> hl at 4th row, B=0; ROM does not guard)
      case 0x14c9:
        mem.write16(0x6038, regs.hl);
        m.step(0x14cc, 16); // ld (0x6038),hl -- slot ptr
        regs.de = 0xfff3;
        m.step(0x14cf, 10); // ld de,0xfff3
        regs.addHl(regs.de);
        m.step(0x14d0, 11); // add hl,de -- hl -= 0x0D
        mem.write16(0x603a, regs.hl);
        m.step(0x14d3, 16); // ld (0x603a),hl -- slot-0x0D
        regs.b = 0x00;
        m.step(0x14d5, 7); // ld b,0x00
        regs.a = mem.read8(0x6035);
        m.step(0x14d8, 13); // ld a,(0x6035)
        regs.c = regs.a;
        m.step(0x14d9, 4); // ld c,a
        m.push16(0x14dc);
        m.step(0x15fa, 17); // call 0x15fa -- render (INT)
        sub_15fa(m);
      // fall into 0x14dc
      case 0x14dc:
        regs.hl = 0x6034;
        m.step(0x14df, 10); // ld hl,0x6034 -- MAIN LOOP
        regs.decMem8(mem, regs.hl);
        m.step(0x14e0, 11); // dec (hl) -- (0x6034)-- display timer
        if (regs.fNZ) { label = 0x14fc; continue; } // jp nz,0x14fc
        m.step(0x14e3, 10); // jp nz NOT taken
        mem.write8(regs.hl, 0x3e);
        m.step(0x14e5, 10); // ld (hl),0x3e -- reload (0x6034):=0x3E
        regs.hl = (regs.hl - 1) & 0xffff;
        m.step(0x14e6, 6); // dec hl
        regs.decMem8(mem, regs.hl);
        m.step(0x14e7, 11); // dec (hl) -- (0x6033)-- value
        if (regs.fZ) { label = 0x15c6; continue; } // jp z,0x15c6 -- value==0 EXIT
        m.step(0x14ea, 10); // jp z NOT taken
        regs.a = mem.read8(regs.hl);
        m.step(0x14eb, 7); // ld a,(hl)
        regs.b = 0xff;
        m.step(0x14ed, 7); // ld b,0xff
      // fall into 0x14ed
      case 0x14ed:
        regs.b = regs.inc8(regs.b);
        m.step(0x14ee, 4); // inc b -- BCD split of (0x6033)
        regs.sub(0x0a);
        m.step(0x14f0, 7); // sub 0x0a
        if (regs.fNC) { label = 0x14ed; continue; } // jp nc,0x14ed
        m.step(0x14f3, 10); // jp nc NOT taken
        regs.add(0x0a);
        m.step(0x14f5, 7); // add a,0x0a -- A := ones digit, B := tens
        mem.write8(0x7552, regs.a);
        m.step(0x14f8, 13); // ld (0x7552),a -- write ones -> video
        regs.a = regs.b;
        m.step(0x14f9, 4); // ld a,b
        mem.write8(0x7572, regs.a);
        m.step(0x14fc, 13); // ld (0x7572),a -- write tens -> video
      // fall into 0x14fc
      case 0x14fc:
        regs.hl = 0x6030;
        m.step(0x14ff, 10); // ld hl,0x6030 -- position step
        regs.b = mem.read8(regs.hl);
        m.step(0x1500, 7); // ld b,(hl) -- B := (0x6030)
        mem.write8(regs.hl, 0x0a);
        m.step(0x1502, 10); // ld (hl),0x0a
        regs.a = mem.read8(0x6010);
        m.step(0x1505, 13); // ld a,(0x6010) -- input/state
        regs.bit(7, regs.a);
        m.step(0x1507, 8); // bit 7,a
        if (regs.fNZ) { label = 0x1546; continue; } // jp nz,0x1546 -- bit7 set
        m.step(0x150a, 10); // jp nz NOT taken
        regs.and(0x03);
        m.step(0x150c, 7); // and 0x03
        if (regs.fNZ) { label = 0x1514; continue; } // jp nz,0x1514 -- low bits
        m.step(0x150f, 10); // jp nz NOT taken
        regs.a = regs.inc8(regs.a);
        m.step(0x1510, 4); // inc a -- A:=1
        mem.write8(regs.hl, regs.a);
        m.step(0x1511, 7); // ld (hl),a -- (0x6030):=1
        label = 0x158a;
        continue; // jp 0x158a
      case 0x1514:
        regs.b = regs.dec8(regs.b);
        m.step(0x1515, 4); // dec b
        if (regs.fZ) { label = 0x151d; continue; } // jp z,0x151d
        m.step(0x1518, 10); // jp z NOT taken
        regs.a = regs.b;
        m.step(0x1519, 4); // ld a,b
        mem.write8(regs.hl, regs.a);
        m.step(0x151a, 7); // ld (hl),a -- (0x6030):=B
        label = 0x158a;
        continue; // jp 0x158a
      case 0x151d:
        regs.bit(1, regs.a);
        m.step(0x151f, 8); // bit 1,a
        if (regs.fNZ) { label = 0x1539; continue; } // jp nz,0x1539
        m.step(0x1522, 10); // jp nz NOT taken
        regs.a = mem.read8(0x6035);
        m.step(0x1525, 13); // ld a,(0x6035)
        regs.a = regs.inc8(regs.a);
        m.step(0x1526, 4); // inc a
        regs.cp(0x1e);
        m.step(0x1528, 7); // cp 0x1e
        if (regs.fNZ) { label = 0x152d; continue; } // jp nz,0x152d
        m.step(0x152b, 10); // jp nz NOT taken
        regs.a = 0x00;
        m.step(0x152d, 7); // ld a,0x00 -- wrap 0x1E -> 0
      // fall into 0x152d
      case 0x152d:
        mem.write8(0x6035, regs.a);
        m.step(0x1530, 13); // ld (0x6035),a
        regs.c = regs.a;
        m.step(0x1531, 4); // ld c,a
        regs.b = 0x00;
        m.step(0x1533, 7); // ld b,0x00
        m.push16(0x1536);
        m.step(0x15fa, 17); // call 0x15fa -- render (INT)
        sub_15fa(m);
        label = 0x158a;
        continue; // jp 0x158a
      case 0x1539:
        regs.a = mem.read8(0x6035);
        m.step(0x153c, 13); // ld a,(0x6035)
        regs.sub(0x01);
        m.step(0x153e, 7); // sub 0x01
        if (regs.fP) { label = 0x152d; continue; } // jp p,0x152d (SIGNED) -- >=0 store
        m.step(0x1541, 10); // jp p NOT taken
        regs.a = 0x1d;
        m.step(0x1543, 7); // ld a,0x1d -- underflow -> 0x1D
        label = 0x152d;
        continue; // jp 0x152d
      case 0x1546:
        regs.a = mem.read8(0x6035);
        m.step(0x1549, 13); // ld a,(0x6035)
        regs.cp(0x1c);
        m.step(0x154b, 7); // cp 0x1c
        if (regs.fZ) { label = 0x156d; continue; } // jp z,0x156d
        m.step(0x154e, 10); // jp z NOT taken
        regs.cp(0x1d);
        m.step(0x1550, 7); // cp 0x1d
        if (regs.fZ) { label = 0x15c6; continue; } // jp z,0x15c6 -- EXIT
        m.step(0x1553, 10); // jp z NOT taken
        regs.hl = mem.read16(0x6036);
        m.step(0x1556, 16); // ld hl,(0x6036)
        regs.bc = 0x7588;
        m.step(0x1559, 10); // ld bc,0x7588
        regs.and(regs.a);
        m.step(0x155a, 4); // and a -- clear carry for sbc
        regs.sbcHl(regs.bc);
        m.step(0x155c, 15); // sbc hl,bc
        if (regs.fZ) { label = 0x158a; continue; } // jp z,0x158a
        m.step(0x155f, 10); // jp z NOT taken
        regs.addHl(regs.bc);
        m.step(0x1560, 11); // add hl,bc -- restore hl
        regs.add(0x11);
        m.step(0x1562, 7); // add a,0x11
        mem.write8(regs.hl, regs.a);
        m.step(0x1563, 7); // ld (hl),a
        regs.bc = 0xffe0;
        m.step(0x1566, 10); // ld bc,0xffe0
        regs.addHl(regs.bc);
        m.step(0x1567, 11); // add hl,bc
      // fall into 0x1567
      case 0x1567:
        mem.write16(0x6036, regs.hl);
        m.step(0x156a, 16); // ld (0x6036),hl
        label = 0x158a;
        continue; // jp 0x158a
      case 0x156d:
        regs.hl = mem.read16(0x6036);
        m.step(0x1570, 16); // ld hl,(0x6036)
        regs.bc = 0x0020;
        m.step(0x1573, 10); // ld bc,0x0020
        regs.addHl(regs.bc);
        m.step(0x1574, 11); // add hl,bc
        regs.and(regs.a);
        m.step(0x1575, 4); // and a -- clear carry for sbc
        regs.bc = 0x7608;
        m.step(0x1578, 10); // ld bc,0x7608
        regs.sbcHl(regs.bc);
        m.step(0x157a, 15); // sbc hl,bc
        if (regs.fNZ) { label = 0x1586; continue; } // jp nz,0x1586
        m.step(0x157d, 10); // jp nz NOT taken
        regs.hl = 0x75e8;
        m.step(0x1580, 10); // ld hl,0x75e8
      // fall into 0x1580
      case 0x1580:
        regs.a = 0x10;
        m.step(0x1582, 7); // ld a,0x10
        mem.write8(regs.hl, regs.a);
        m.step(0x1583, 7); // ld (hl),a
        label = 0x1567;
        continue; // jp 0x1567
      case 0x1586:
        regs.addHl(regs.bc);
        m.step(0x1587, 11); // add hl,bc
        label = 0x1580;
        continue; // jp 0x1580
      case 0x158a:
        regs.hl = 0x6032;
        m.step(0x158d, 10); // ld hl,0x6032 -- sprite animate
        regs.decMem8(mem, regs.hl);
        m.step(0x158e, 11); // dec (hl) -- (0x6032)-- anim timer
        if (regs.fNZ) { label = 0x15f9; continue; } // jp nz,0x15f9
        m.step(0x1591, 10); // jp nz NOT taken
        regs.a = mem.read8(0x6031);
        m.step(0x1594, 13); // ld a,(0x6031)
        regs.and(regs.a);
        m.step(0x1595, 4); // and a
        if (regs.fNZ) { label = 0x15b8; continue; } // jp nz,0x15b8
        m.step(0x1598, 10); // jp nz NOT taken
        regs.a = 0x01;
        m.step(0x159a, 7); // ld a,0x01
        mem.write8(0x6031, regs.a);
        m.step(0x159d, 13); // ld (0x6031),a -- (0x6031):=1
        regs.de = 0x01bf;
        m.step(0x15a0, 10); // ld de,0x01bf -- digit source ptr
      // fall into 0x15a0
      case 0x15a0:
        regs.iy = mem.read16(0x6038);
        m.step(0x15a4, 20); // ld iy,(0x6038)
        regs.l = mem.read8((regs.iy + 0x04) & 0xffff);
        m.step(0x15a7, 19); // ld l,(iy+0x04)
        regs.h = mem.read8((regs.iy + 0x05) & 0xffff);
        m.step(0x15aa, 19); // ld h,(iy+0x05)
        m.push16(regs.hl);
        m.step(0x15ab, 11); // push hl
        regs.ix = m.pop16();
        m.step(0x15ad, 14); // pop ix -- IX := sprite ptr (iy+4/5)
        m.push16(0x15b0);
        m.step(0x057c, 17); // call 0x057c -- render digits
        sub_057c(m);
        regs.a = 0x10;
        m.step(0x15b2, 7); // ld a,0x10
        mem.write8(0x6032, regs.a);
        m.step(0x15b5, 13); // ld (0x6032),a -- reload (0x6032):=0x10
        label = 0x15f9;
        continue; // jp 0x15f9
      case 0x15b8:
        regs.xor(regs.a);
        m.step(0x15b9, 4); // xor a
        mem.write8(0x6031, regs.a);
        m.step(0x15bc, 13); // ld (0x6031),a -- (0x6031):=0
        regs.de = mem.read16(0x6038);
        m.step(0x15c0, 20); // ld de,(0x6038)
        regs.de = (regs.de + 1) & 0xffff;
        m.step(0x15c1, 6); // inc de
        regs.de = (regs.de + 1) & 0xffff;
        m.step(0x15c2, 6); // inc de
        regs.de = (regs.de + 1) & 0xffff;
        m.step(0x15c3, 6); // inc de -- DE := (0x6038)+3
        label = 0x15a0;
        continue; // jp 0x15a0
      case 0x15c6:
        regs.de = mem.read16(0x6038);
        m.step(0x15ca, 20); // ld de,(0x6038) -- EXIT/cleanup
        regs.xor(regs.a);
        m.step(0x15cb, 4); // xor a
        mem.write8(regs.de, regs.a);
        m.step(0x15cc, 7); // ld (de),a -- clear the item slot
        regs.hl = 0x6009;
        m.step(0x15cf, 10); // ld hl,0x6009
        mem.write8(regs.hl, 0x80);
        m.step(0x15d1, 10); // ld (hl),0x80 -- (0x6009):=0x80
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x15d2, 6); // inc hl
        regs.decMem8(mem, regs.hl);
        m.step(0x15d3, 11); // dec (hl) -- (0x600A)-- PHASE DECREMENT
        regs.b = 0x0c;
        m.step(0x15d5, 7); // ld b,0x0c
        regs.hl = 0x75e8;
        m.step(0x15d8, 10); // ld hl,0x75e8
        regs.iy = mem.read16(0x603a);
        m.step(0x15dc, 20); // ld iy,(0x603a)
        regs.de = 0xffe0;
        m.step(0x15df, 10); // ld de,0xffe0
      // fall into 0x15df
      case 0x15df:
        regs.a = mem.read8(regs.hl);
        m.step(0x15e0, 7); // ld a,(hl) -- copy 0x0C cells (video->iy)
        mem.write8((regs.iy + 0x00) & 0xffff, regs.a);
        m.step(0x15e3, 19); // ld (iy+0x00),a
        regs.iy = (regs.iy + 1) & 0xffff;
        m.step(0x15e5, 10); // inc iy
        regs.addHl(regs.de);
        m.step(0x15e6, 11); // add hl,de
        regs.djnz();
        m.step(regs.b ? 0x15df : 0x15e8, regs.b ? 13 : 8); // djnz 0x15df
        if (regs.b) { label = 0x15df; continue; }
        regs.b = 0x05;
        m.step(0x15ea, 7); // ld b,0x05
        regs.de = 0x0314;
        m.step(0x15ed, 10); // ld de,0x0314 -- enqueue tasks 0x0314..0x0318
      // fall into 0x15ed
      case 0x15ed:
        m.push16(0x15f0);
        m.step(0x309f, 17); // call 0x309f
        sub_309f(m);
        regs.de = (regs.de + 1) & 0xffff;
        m.step(0x15f1, 6); // inc de
        regs.djnz();
        m.step(regs.b ? 0x15ed : 0x15f3, regs.b ? 13 : 8); // djnz 0x15ed
        if (regs.b) { label = 0x15ed; continue; }
        regs.de = 0x031a;
        m.step(0x15f6, 10); // ld de,0x031a -- enqueue task 0x031A
        m.push16(0x15f9);
        m.step(0x309f, 17); // call 0x309f
        sub_309f(m);
      // fall into 0x15f9
      case 0x15f9:
        m.ret(10); // ret @0x15F9 (the single ret; all paths converge here)
        return;
      default:
        throw new Error(`sub_1486: unreachable label 0x${label.toString(16)}`);
    }
  }
}

/**
 * loc_196b -- (0x600A) phase arm at index 23 (word 0x196B @0x0730 of the 0x0702
 * table). ROM 0x196B-0x1977.
 * Runs sub_0852 (INTEGRATED), then jumps the master phase byte
 * (0x600A) to (0x600E)+0x12 -- a computed transition into the next phase group. Do
 * not fold the 0x12 base offset.
 */
export function loc_196b(m) {
  const { regs, mem } = m;
  m.push16(0x196e);
  m.step(0x0852, 17); // call 0x0852 (INTEGRATED)
  sub_0852(m);
  regs.a = mem.read8(0x600e);
  m.step(0x1971, 13); // ld a,(0x600e) -- level/screen selector
  regs.add(0x12);
  m.step(0x1973, 7); // add a,0x12
  mem.write8(0x600a, regs.a);
  m.step(0x1976, 13); // ld (0x600a),a -- (0x600A) := (0x600E) + 0x12
  m.ret(10);
}

/** sub_1708 -- init: record 80 76 09 20 at 0x6A20, 0x6905=0x13, colour column (0x0514), 0x608A/B=07/03. ROM 0x1708-0x1731. */
export function sub_1708(m) {
  const { regs, mem } = m;
  m.push16(0x170b); m.step(0x011c, 17); sub_011c(m); // call 0x011c
  regs.hl = 0x6a20;
  m.step(0x170e, 10);
  mem.write8(regs.hl, 0x80);
  m.step(0x1710, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1711, 6);
  mem.write8(regs.hl, 0x76);
  m.step(0x1713, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1714, 6);
  mem.write8(regs.hl, 0x09);
  m.step(0x1716, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1717, 6);
  mem.write8(regs.hl, 0x20);
  m.step(0x1719, 10); // record 80 76 09 20 at 0x6A20
  regs.hl = 0x6905;
  m.step(0x171c, 10);
  mem.write8(regs.hl, 0x13);
  m.step(0x171e, 10); // 0x6905 = 0x13
  regs.hl = 0x75c4;
  m.step(0x1721, 10);
  regs.de = 0x0020;
  m.step(0x1724, 10);
  regs.a = 0x10;
  m.step(0x1726, 7);
  m.push16(0x1729); m.step(0x0514, 17); sub_0514(m); // colour column
  regs.hl = 0x608a;
  m.step(0x172c, 10);
  mem.write8(regs.hl, 0x07);
  m.step(0x172e, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x172f, 6);
  mem.write8(regs.hl, 0x03);
  m.step(0x1731, 10); // 0x608A/B = 07/03
  m.ret(10);
}
/** sub_1732 -- call 0x306f; if (0x6913)>=0x2C hold; else reset object block, seed 0x6924/2C, advance 0x6388. ROM 0x1732-0x1757. */
export function sub_1732(m) {
  const { regs, mem } = m;
  m.push16(0x1735); m.step(0x306f, 17); sub_306f(m); // call 0x306f
  regs.a = mem.read8(0x6913);
  m.step(0x1738, 13);
  regs.cp(0x2c);
  m.step(0x173a, 7);
  if (regs.fNC) { m.ret(11); return; } // ret nc -- hold
  m.step(0x173b, 5);
  regs.xor(regs.a);
  m.step(0x173c, 4);
  mem.write8(0x6900, regs.a);
  m.step(0x173f, 13);
  mem.write8(0x6904, regs.a);
  m.step(0x1742, 13);
  mem.write8(0x690c, regs.a);
  m.step(0x1745, 13);
  regs.a = 0x6b;
  m.step(0x1747, 7);
  mem.write8(0x6924, regs.a);
  m.step(0x174a, 13);
  regs.a = regs.dec8(regs.a);
  m.step(0x174b, 4); // 0x6B -> 0x6A
  mem.write8(0x692c, regs.a);
  m.step(0x174e, 13);
  regs.hl = 0x6a21;
  m.step(0x1751, 10);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x1752, 11); // inc (0x6A21)
  regs.hl = 0x6388;
  m.step(0x1755, 10);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x1756, 11); // inc (0x6388)
  m.ret(10);
}
/** sub_1783 -- scan 10 cells (HL stride DE); first non-zero -> jp 0x0026 CALLER-SKIP to grandparent; all clear -> ret. ROM 0x1783-0x178D. HL/DE/B live-in. */
export function sub_1783(m) {
  const { regs, mem } = m;
  regs.b = 0x0a;
  m.step(0x1785, 7);
  do {
    regs.a = mem.read8(regs.hl);
    m.step(0x1786, 7);
    regs.and(regs.a);
    m.step(0x1787, 4);
    if (regs.fNZ) {
      m.step(0x0026, 10); // jp 0x0026 -- caller-skip
      m.pop16(); // pop hl @0x0026 (discard sub_1783's return)
      m.step(0x0027, 10);
      m.ret(10); // ret -> grandparent
      return false; // SKIP -- caller must not continue
    }
    m.step(0x178a, 10);
    regs.addHl(regs.de);
    m.step(0x178b, 11); // add hl,de
    regs.djnz();
    m.step(regs.b ? 0x1785 : 0x178d, regs.b ? 13 : 8);
  } while (regs.b);
  m.ret(10); // all clear
  return true; // normal -- caller continues
}
/** sub_178e -- rst-0x18 gate; walk 0x622A record ptr (0x7F sentinel -> 0x3A73), store 0x6227, enqueue 0x0500, reset 0x6388=0, hand 0x600A=8. ROM 0x178E-0x17B5. */
export function sub_178e(m) {
  const { regs, mem } = m;
  m.push16(0x178f); m.step(0x0018, 11); if (!sub_0018(m)) return; // rst 0x18
  regs.hl = mem.read16(0x622a);
  m.step(0x1792, 16); // ld hl,(0x622a)
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1793, 6);
  regs.a = mem.read8(regs.hl);
  m.step(0x1794, 7);
  regs.cp(0x7f);
  m.step(0x1796, 7);
  if (regs.fZ) {
    m.step(0x1799, 10);
    regs.hl = 0x3a73;
    m.step(0x179c, 10);
    regs.a = mem.read8(regs.hl);
    m.step(0x179d, 7);
  } else {
    m.step(0x179d, 10);
  }
  mem.write16(0x622a, regs.hl);
  m.step(0x17a0, 16);
  mem.write8(0x6227, regs.a);
  m.step(0x17a3, 13);
  regs.de = 0x0500;
  m.step(0x17a6, 10);
  m.push16(0x17a9); m.step(0x309f, 17); sub_309f(m); // enqueue
  regs.xor(regs.a);
  m.step(0x17aa, 4);
  mem.write8(0x6388, regs.a);
  m.step(0x17ad, 13); // 0x6388 = 0
  regs.hl = 0x6009;
  m.step(0x17b0, 10);
  mem.write8(regs.hl, 0x30);
  m.step(0x17b2, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x17b3, 6);
  mem.write8(regs.hl, 0x08);
  m.step(0x17b5, 10); // 0x600A = 8
  m.ret(10);
}
/** sub_2243 -- hit test: (0x6205)<0x7A && (0x6216)==0 && (0x6203)==(HL) -> ret to caller; else pop-hl/ret caller-skip. ROM 0x2243-0x2258. HL live-in. */
export function sub_2243(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6205);
  m.step(0x2246, 13);
  regs.cp(0x7a);
  m.step(0x2248, 7);
  if (regs.fNC) { return skip_2257(m); } // jp nc -- no hit
  m.step(0x224b, 10);
  regs.a = mem.read8(0x6216);
  m.step(0x224e, 13);
  regs.and(regs.a);
  m.step(0x224f, 4);
  if (regs.fNZ) { return skip_2257(m); } // jp nz -- no hit
  m.step(0x2252, 10);
  regs.a = mem.read8(0x6203);
  m.step(0x2255, 13);
  regs.cp(mem.read8(regs.hl));
  m.step(0x2256, 7);
  if (regs.fZ) { m.ret(11); return true; } // ret z -- HIT (caller continues)
  m.step(0x2257, 5);
  return skip_2257(m);
}
/** loc_2257 -- pop hl / ret: caller-skip to the grandparent. Returns false so the
 *  caller (loc_2227/loc_2259) PROPAGATES the skip and does NOT run its own tail/ret
 *  (the pop hl + ret here already unwound this frame + the grandparent's return). */
function skip_2257(m) {
  const { regs } = m;
  regs.hl = m.pop16();
  m.step(0x2258, 10); // pop hl
  m.ret(10); // ret -> caller's caller
  return false;
}
/** sub_2602 -- sub_25f2's 1st callee: even-frame 0x62A0 countdown (call 0x26de), update 0x62A1->0x63A3 (0x26e9), every 32nd frame call 0x26a6. ROM 0x2602-0x262E. */
export function sub_2602(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x601a);
  m.step(0x2605, 13); // ld a,(0x601a)
  regs.rrca();
  m.step(0x2606, 4); // rrca
  if (regs.fC) {
    m.step(0x2616, 10); // jp c,0x2616 (odd frame)
  } else {
    m.step(0x2609, 10);
    regs.hl = 0x62a0;
    m.step(0x260c, 10); // ld hl,0x62a0
    regs.decMem8(mem, regs.hl);
    m.step(0x260d, 11); // dec (hl)
    if (regs.fNZ) {
      m.step(0x2616, 10); // jp nz,0x2616
    } else {
      m.step(0x2610, 10);
      mem.write8(regs.hl, 0x80);
      m.step(0x2612, 10); // ld (hl),0x80
      regs.l = (regs.l + 1) & 0xff;
      m.step(0x2613, 4); // inc l
      m.push16(0x2616); m.step(0x26de, 17); sub_26de(m); // call 0x26de
    }
  }
  regs.hl = 0x62a1;
  m.step(0x2619, 10); // ld hl,0x62a1
  m.push16(0x261c); m.step(0x26e9, 17); sub_26e9(m); // call 0x26e9 -> A
  mem.write8(0x63a3, regs.a);
  m.step(0x261f, 13); // ld (0x63a3),a
  regs.a = mem.read8(0x601a);
  m.step(0x2622, 13); // ld a,(0x601a)
  regs.and(0x1f);
  m.step(0x2624, 7); // and 0x1f
  regs.cp(0x01);
  m.step(0x2626, 7); // cp 0x01
  if (regs.fNZ) { m.ret(11); return; } // ret nz
  m.step(0x2627, 5);
  regs.de = 0x69e4;
  m.step(0x262a, 10); // ld de,0x69e4
  regs.exDeHl();
  m.step(0x262b, 4); // ex de,hl -- HL = 0x69E4
  m.push16(0x262e); m.step(0x26a6, 17); sub_26a6(m); // call 0x26a6
  m.ret(10);
}
/** sub_2797 -- animate 6 objects (IX=0x6600 stride 0x10): active + (ix+0d) bit3 -> dec (ix+5) to 0x60 (land), else inc to 0xF8 (deactivate). ROM 0x2797-0x27C5. */
export function sub_2797(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;
  regs.b = 0x06;
  m.step(0x2799, 7);
  regs.de = 0x0010;
  m.step(0x279c, 10);
  regs.ix = 0x6600;
  m.step(0x27a0, 14);
  do {
    if (!regs.bit(0, mem.read8(R(0x00)))) {
      m.step(0x27c2, 30); // bit 0,(ix+0) + jp z,0x27c2 -- inactive
    } else {
      m.step(0x27a7, 20);
      if (!regs.bit(3, mem.read8(R(0x0d)))) {
        m.step(0x27c7, 30); // bit3 clear -> increment arm (rise/deactivate)
        const a = (mem.read8(R(0x05)) + 1) & 0xff;
        mem.write8(R(0x05), a);
        m.step(0x27ce, 38);
        regs.a = a;
        regs.cp(0xf8);
        m.step(0x27d0, 7);
        if (a !== 0xf8) {
          m.step(0x27c2, 10);
        } else {
          m.step(0x27d3, 10);
          mem.write8(R(0x00), 0x00);
          m.step(0x27c2, 29); // deactivate
        }
      } else {
        const a = (mem.read8(R(0x05)) - 1) & 0xff;
        mem.write8(R(0x05), a);
        m.step(0x27b5, 38);
        regs.a = a;
        regs.cp(0x60);
        m.step(0x27b7, 7);
        if (a !== 0x60) {
          m.step(0x27c2, 10);
        } else {
          m.step(0x27ba, 10);
          mem.write8(R(0x03), 0x77);
          m.step(0x27be, 19);
          mem.write8(R(0x0d), 0x04);
          m.step(0x27c2, 19); // land
        }
      }
    }
    regs.ix = (regs.ix + regs.de) & 0xffff;
    m.step(0x27c4, 15); // add ix,de
    regs.djnz();
    m.step(regs.b ? 0x27a0 : 0x27c6, regs.b ? 13 : 8);
  } while (regs.b);
  m.ret(10);
}
/** sub_27da -- spawn: if (0x62A7)==0, find a free slot in IX=0x6600[6] (DE=0x10 live-in) and seed it; always dec (0x62A7). ROM 0x27DA-0x2807. */
export function sub_27da(m) {
  const { regs, mem } = m;
  regs.hl = 0x62a7;
  m.step(0x27dd, 10);
  regs.a = mem.read8(regs.hl);
  m.step(0x27de, 7);
  regs.and(regs.a);
  m.step(0x27df, 4);
  if (regs.fNZ) { m.step(0x2806, 10); return dec_2806(m); } // jp nz -> just decrement
  m.step(0x27e2, 10);
  regs.b = 0x06;
  m.step(0x27e4, 7);
  regs.ix = 0x6600;
  m.step(0x27e8, 14);
  for (;;) {
    if (!regs.bit(0, mem.read8((regs.ix + 0) & 0xffff))) { m.step(0x27f4, 30); break; } // free slot
    m.step(0x27ef, 20);
    regs.ix = (regs.ix + regs.de) & 0xffff;
    m.step(0x27f1, 15); // add ix,de
    regs.djnz();
    m.step(regs.b ? 0x27e8 : 0x27f3, regs.b ? 13 : 8);
    if (regs.b === 0) { m.ret(10); return; } // no free slot
  }
  mem.write8((regs.ix + 0) & 0xffff, 0x01);
  m.step(0x27f8, 19);
  mem.write8((regs.ix + 3) & 0xffff, 0x37);
  m.step(0x27fc, 19);
  mem.write8((regs.ix + 5) & 0xffff, 0xf8);
  m.step(0x2800, 19);
  mem.write8((regs.ix + 0x0d) & 0xffff, 0x08);
  m.step(0x2804, 19);
  mem.write8(regs.hl, 0x34);
  m.step(0x2806, 10); // (0x62A7) = 0x34
  return dec_2806(m);
}
function dec_2806(m) {
  const { regs, mem } = m;
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x2807, 11); // dec (0x62A7)
  m.ret(10);
}
/** sub_2722 -- animate (2797) + spawn (27da), then mirror (ix+3)/(ix+5) of 6 objects to 0x6958. ROM 0x2722-0x2744. */
export function sub_2722(m) {
  const { regs, mem } = m;
  m.push16(0x2725); m.step(0x2797, 17); sub_2797(m); // leaves DE=0x10
  m.push16(0x2728); m.step(0x27da, 17); sub_27da(m); // uses DE=0x10
  regs.b = 0x06;
  m.step(0x272a, 7);
  regs.de = 0x0010;
  m.step(0x272d, 10);
  regs.hl = 0x6958;
  m.step(0x2730, 10);
  regs.ix = 0x6600;
  m.step(0x2734, 14);
  do {
    regs.a = mem.read8((regs.ix + 3) & 0xffff);
    m.step(0x2737, 19);
    mem.write8(regs.hl, regs.a);
    m.step(0x2738, 7);
    regs.l = (regs.l + 1) & 0xff;
    m.step(0x2739, 4);
    regs.l = (regs.l + 1) & 0xff;
    m.step(0x273a, 4);
    regs.l = (regs.l + 1) & 0xff;
    m.step(0x273b, 4);
    regs.a = mem.read8((regs.ix + 5) & 0xffff);
    m.step(0x273e, 19);
    mem.write8(regs.hl, regs.a);
    m.step(0x273f, 7);
    regs.l = (regs.l + 1) & 0xff;
    m.step(0x2740, 4);
    regs.ix = (regs.ix + regs.de) & 0xffff;
    m.step(0x2742, 15);
    regs.djnz();
    m.step(regs.b ? 0x2734 : 0x2744, regs.b ? 13 : 8);
  } while (regs.b);
  m.ret(10);
}
/** sub_1654 -- 0x1644 idx: spawn (0x1708) + copy 0x385C + arm 0x6009=0x20, then the shared tail_1662. ROM 0x1654-0x1663. */
export function sub_1654(m) {
  const { regs, mem } = m;
  m.push16(0x1657); m.step(0x1708, 17); sub_1708(m); // call 0x1708
  regs.hl = 0x385c;
  m.step(0x165a, 10);
  m.push16(0x165d); m.step(0x004e, 17); sub_004e(m); // call 0x004e
  regs.a = 0x20;
  m.step(0x165f, 7);
  mem.write8(0x6009, regs.a);
  m.step(0x1662, 13); // 0x6009 = 0x20 -> tail_1662
  return tail_1662(m);
}
/**
 * loc_1615 -- L2 board-advance dispatcher (game sub-state 0x600A=0x16).  ROM 0x1615-0x1653.
 * call 0x30bd; then by (0x6227) bit0/bit1, rst-0x28-dispatch (0x6388) via table @0x1623
 * ([1654,1670,168a,1732,1757,178e]) or @0x1637 ([16a3,16bb,1732,1757,178e]); else fall into
 * sub_1641 (call 0x1dbd + rst 0x28 @0x1648). All rst-0x28 tails route through dispatchGameState.
 */
export function loc_1615(m) {
  const { regs, mem } = m;
  m.push16(0x1618); m.step(0x30bd, 17); sub_30bd(m); // call 0x30bd
  regs.a = mem.read8(0x6227);
  m.step(0x161b, 13); // ld a,(0x6227)
  regs.rrca();
  m.step(0x161c, 4); // rrca -- bit0
  if (regs.fC) {
    m.step(0x161f, 10);
    regs.a = mem.read8(0x6388);
    m.step(0x1622, 13); // ld a,(0x6388)
    m.push16(0x1623); m.step(0x0028, 11); // rst 0x28 (table @0x1623)
    return sub_0028(m, "0x1623 (0x6388 board sub-dispatch)");
  }
  m.step(0x162f, 10); // jp nc,0x162f
  regs.rrca();
  m.step(0x1630, 4); // rrca -- bit1
  if (regs.fC) {
    m.step(0x1633, 10);
    regs.a = mem.read8(0x6388);
    m.step(0x1636, 13); // ld a,(0x6388)
    m.push16(0x1637); m.step(0x0028, 11); // rst 0x28 (table @0x1637)
    return sub_0028(m, "0x1637 (0x6388 board sub-dispatch)");
  }
  m.step(0x1641, 10); // jp nc,0x1641 -> sub_1641 (call 0x1dbd + rst 0x28 @0x1648)
  return sub_1641(m);
}
/** loc_16a3 -- board load: spawn (0x1708), copy 0x385C, rst 0x38, advance 0x6388. ROM 0x16A3-0x16BA. */
export function loc_16a3(m) {
  const { regs, mem } = m;
  m.push16(0x16a6); m.step(0x1708, 17); sub_1708(m); // call 0x1708
  regs.a = mem.read8(0x6910);
  m.step(0x16a9, 13);
  regs.sub(0x3b);
  m.step(0x16ab, 7);
  regs.hl = 0x385c;
  m.step(0x16ae, 10);
  m.push16(0x16b1); m.step(0x004e, 17); sub_004e(m); // call 0x004e
  regs.hl = 0x6908;
  m.step(0x16b4, 10);
  regs.c = regs.a;
  m.step(0x16b5, 4); // ld c,a
  m.push16(0x16b6); m.step(0x0038, 11); loc_0038(m); // rst 0x38
  regs.hl = 0x6388;
  m.step(0x16b9, 10);
  regs.incMem8(mem, regs.hl);
  m.step(0x16ba, 11); // inc (0x6388)
  m.ret(10);
}
/** loc_16bb -- board load variant: 0x62A0 flag by (0x6910) vs 0x5A/0x5D + bit7(0x63A3); call 0x2602 / reinit. ROM 0x16BB-0x1707. */
export function loc_16bb(m) {
  const { regs, mem } = m;
  regs.xor(regs.a);
  m.step(0x16bc, 4);
  mem.write8(0x62a0, regs.a);
  m.step(0x16bf, 13);
  regs.a = mem.read8(0x63a3);
  m.step(0x16c2, 13);
  regs.c = regs.a;
  m.step(0x16c3, 4); // ld c,a
  regs.a = mem.read8(0x6910);
  m.step(0x16c6, 13);
  regs.cp(0x5a);
  m.step(0x16c8, 7);
  if (regs.fNC) { m.step(0x16e1, 10); return loc_16e1(m); } // jp nc,0x16e1
  m.step(0x16cb, 10);
  regs.bit(7, regs.c);
  m.step(0x16cd, 8);
  if (regs.fZ) { m.step(0x16d5, 10); return loc_16d5(m); } // jp z,0x16d5
  m.step(0x16d0, 10);
  return loc_16d0(m);
}
/** loc_16d0 -- 0x62A0 = 1, then loc_16d5. */
function loc_16d0(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  m.step(0x16d2, 7);
  mem.write8(0x62a0, regs.a);
  m.step(0x16d5, 13); // 0x62A0 = 1 -> loc_16d5
  return loc_16d5(m);
}
/** loc_16d5 -- call 0x2602, rst 0x38, ret. */
function loc_16d5(m) {
  const { regs, mem } = m;
  m.push16(0x16d8); m.step(0x2602, 17); sub_2602(m); // call 0x2602
  regs.a = mem.read8(0x63a3);
  m.step(0x16db, 13);
  regs.c = regs.a;
  m.step(0x16dc, 4);
  regs.hl = 0x6908;
  m.step(0x16df, 10);
  m.push16(0x16e0); m.step(0x0038, 11); loc_0038(m); // rst 0x38
  m.ret(10);
}
/** loc_16e1 -- (0x6910) >= 0x5A: vs 0x5D + bit7(C) -> loc_16d0/16d5, else reinit + advance 0x6388. */
function loc_16e1(m) {
  const { regs, mem } = m;
  regs.cp(0x5d);
  m.step(0x16e3, 7);
  if (regs.fC) { m.step(0x16ee, 10); return loc_16ee(m); } // jp c,0x16ee
  m.step(0x16e6, 10);
  regs.bit(7, regs.c);
  m.step(0x16e8, 8);
  if (regs.fZ) { m.step(0x16d0, 10); return loc_16d0(m); } // jp z,0x16d0
  m.step(0x16eb, 10);
  m.step(0x16d5, 10); // jp 0x16d5
  return loc_16d5(m);
}
/** loc_16ee -- reinit board object block (0x690C=0x66, clear 0x6924/2C/62AF), advance 0x6388. */
function loc_16ee(m) {
  const { regs, mem } = m;
  regs.hl = 0x388c;
  m.step(0x16f1, 10);
  m.push16(0x16f4); m.step(0x004e, 17); sub_004e(m); // call 0x004e
  regs.a = 0x66;
  m.step(0x16f6, 7);
  mem.write8(0x690c, regs.a);
  m.step(0x16f9, 13);
  regs.xor(regs.a);
  m.step(0x16fa, 4);
  mem.write8(0x6924, regs.a);
  m.step(0x16fd, 13);
  mem.write8(0x692c, regs.a);
  m.step(0x1700, 13);
  mem.write8(0x62af, regs.a);
  m.step(0x1703, 13);
  regs.hl = 0x6388;
  m.step(0x1706, 10);
  regs.incMem8(mem, regs.hl);
  m.step(0x1707, 11); // inc (0x6388)
  m.ret(10);
}
/** loc_1662 -- shared tail (sub_1654 fall-through + sub_168a jp): advance 0x6388, rst-0x30 gate, rst 0x38. ROM 0x1662-0x166F. */
function tail_1662(m) {
  const { regs, mem } = m;
  regs.hl = 0x6388;
  m.step(0x1665, 10);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x1666, 11); // inc (0x6388)
  regs.a = 0x01;
  m.step(0x1668, 7);
  m.push16(0x1669); m.step(0x0030, 11); if (!sub_0030(m)) return; // rst 0x30 caller-skip
  regs.hl = 0x690b;
  m.step(0x166c, 10);
  regs.c = 0xfc;
  m.step(0x166e, 7);
  m.push16(0x166f); m.step(0x0038, 11); loc_0038(m); // rst 0x38
  m.ret(10);
}
/** sub_168a -- 0x1644 idx: rst-0x18 gate, copy 0x388C, 0x690C=0x66, clear 0x6924/2C/62AF, then tail_1662. ROM 0x168A-0x16A0. */
export function sub_168a(m) {
  const { regs, mem } = m;
  m.push16(0x168b); m.step(0x0018, 11); if (!sub_0018(m)) return; // rst 0x18
  regs.hl = 0x388c;
  m.step(0x168e, 10);
  m.push16(0x1691); m.step(0x004e, 17); sub_004e(m); // call 0x004e
  regs.a = 0x66;
  m.step(0x1693, 7);
  mem.write8(0x690c, regs.a);
  m.step(0x1696, 13);
  regs.xor(regs.a);
  m.step(0x1697, 4);
  mem.write8(0x6924, regs.a);
  m.step(0x169a, 13);
  mem.write8(0x692c, regs.a);
  m.step(0x169d, 13);
  mem.write8(0x62af, regs.a);
  m.step(0x16a0, 13);
  m.step(0x1662, 10); // jp 0x1662
  return tail_1662(m);
}
/** sub_1757 -- call 0x306f + 0x176c (cull), then 0x1783 sprite-clear caller-skip; if clear, arm 0x6009=0x40 + advance 0x6388. ROM 0x1757-0x176B. */
export function sub_1757(m) {
  const { regs, mem } = m;
  m.push16(0x175a); m.step(0x306f, 17); sub_306f(m); // call 0x306f
  m.push16(0x175d); m.step(0x176c, 17); sub_176c(m); // call 0x176c
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x175e, 6); // inc hl
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x175f, 6); // inc de
  m.push16(0x1762); m.step(0x1783, 17);
  if (!sub_1783(m)) return; // sub_1783 caller-skip: sprites not clear -> abort
  regs.a = 0x40;
  m.step(0x1764, 7);
  mem.write8(0x6009, regs.a);
  m.step(0x1767, 13);
  regs.hl = 0x6388;
  m.step(0x176a, 10);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x176b, 11); // inc (0x6388)
  m.ret(10);
}
/** sub_0d27 -- fill two 0x11-cell rows of 0xFD/0xFC via sub_0d30 (HL=0x770D then 0x760D). ROM 0x0D27-0x0D42. */
export function sub_0d27(m) {
  const { regs } = m;
  regs.hl = 0x770d;
  m.step(0x0d2a, 10); // ld hl,0x770d
  m.push16(0x0d2d); m.step(0x0d30, 17); sub_0d30(m); // call 0x0d30
  regs.hl = 0x760d;
  m.step(0x0d30, 10); // ld hl,0x760d -- falls into sub_0d30
  return sub_0d30(m);
}
/** sub_0d30 -- fill 0x11 cells 0xFD, +0x0F, fill 0x11 cells 0xFC. HL live-in. ROM 0x0D30-0x0D42. */
function sub_0d30(m) {
  const { regs, mem } = m;
  regs.b = 0x11;
  m.step(0x0d32, 7);
  do {
    mem.write8(regs.hl, 0xfd);
    m.step(0x0d34, 10);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0d35, 6);
    regs.djnz();
    m.step(regs.b ? 0x0d32 : 0x0d37, regs.b ? 13 : 8);
  } while (regs.b);
  regs.de = 0x000f;
  m.step(0x0d3a, 10);
  regs.addHl(regs.de);
  m.step(0x0d3b, 11);
  regs.b = 0x11;
  m.step(0x0d3d, 7);
  do {
    mem.write8(regs.hl, 0xfc);
    m.step(0x0d3f, 10);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0d40, 6);
    regs.djnz();
    m.step(regs.b ? 0x0d3d : 0x0d42, regs.b ? 13 : 8);
  } while (regs.b);
  m.ret(10);
}
/** sub_0d43 -- fill two 0x04-cell rows of 0xFD/0xFC via sub_0d4c (HL=0x7687 then 0x7547). ROM 0x0D43-0x0D5E. */
export function sub_0d43(m) {
  const { regs } = m;
  regs.hl = 0x7687;
  m.step(0x0d46, 10); // ld hl,0x7687
  m.push16(0x0d49); m.step(0x0d4c, 17); sub_0d4c(m); // call 0x0d4c
  regs.hl = 0x7547;
  m.step(0x0d4c, 10); // ld hl,0x7547 -- falls into sub_0d4c
  return sub_0d4c(m);
}
/** sub_0d4c -- fill 0x04 cells 0xFD, +0x1C, fill 0x04 cells 0xFC. HL live-in. ROM 0x0D4C-0x0D5E. */
function sub_0d4c(m) {
  const { regs, mem } = m;
  regs.b = 0x04;
  m.step(0x0d4e, 7);
  do {
    mem.write8(regs.hl, 0xfd);
    m.step(0x0d50, 10);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0d51, 6);
    regs.djnz();
    m.step(regs.b ? 0x0d4e : 0x0d53, regs.b ? 13 : 8);
  } while (regs.b);
  regs.de = 0x001c;
  m.step(0x0d56, 10);
  regs.addHl(regs.de);
  m.step(0x0d57, 11);
  regs.b = 0x04;
  m.step(0x0d59, 7);
  do {
    mem.write8(regs.hl, 0xfc);
    m.step(0x0d5b, 10);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0d5c, 6);
    regs.djnz();
    m.step(regs.b ? 0x0d59 : 0x0d5e, regs.b ? 13 : 8);
  } while (regs.b);
  m.ret(10);
}
/** sub_2745 -- player-position state machine on (0x6203): band-dispatch to reset/down/up arms. ROM 0x2745-0x2796. */
export function sub_2745(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6398);
  m.step(0x2748, 13);
  regs.and(regs.a);
  m.step(0x2749, 4);
  if (regs.fZ) { m.ret(11); return; } // ret z inactive
  m.step(0x274a, 5);
  regs.a = mem.read8(0x6216);
  m.step(0x274d, 13);
  regs.and(regs.a);
  m.step(0x274e, 4);
  if (regs.fNZ) { m.ret(11); return; } // ret nz busy
  m.step(0x274f, 5);
  regs.a = mem.read8(0x6203);
  m.step(0x2752, 13);
  regs.cp(0x2c);
  m.step(0x2754, 7);
  if (regs.fC) { m.step(0x2766, 10); return loc_2766(m); }
  m.step(0x2757, 10);
  regs.cp(0x43);
  m.step(0x2759, 7);
  if (regs.fC) { m.step(0x276f, 10); return loc_276f(m); }
  m.step(0x275c, 10);
  regs.cp(0x6c);
  m.step(0x275e, 7);
  if (regs.fC) { m.step(0x2766, 10); return loc_2766(m); }
  m.step(0x2761, 10);
  regs.cp(0x83);
  m.step(0x2763, 7);
  if (regs.fC) { m.step(0x2787, 10); return loc_2787(m); }
  m.step(0x2766, 10);
  return loc_2766(m);
}
/** loc_2766 -- reset: 0x6398=0, 0x6221=1. */
function loc_2766(m) {
  const { regs, mem } = m;
  regs.xor(regs.a);
  m.step(0x2767, 4);
  mem.write8(0x6398, regs.a);
  m.step(0x276a, 13);
  regs.a = regs.inc8(regs.a);
  m.step(0x276b, 4);
  mem.write8(0x6221, regs.a);
  m.step(0x276e, 13);
  m.ret(10);
}
/** loc_276f -- move down: (0x6205)<0x71 -> reset277f; else dec (0x6205), mirror to 0x694F. */
function loc_276f(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6205);
  m.step(0x2772, 13);
  regs.cp(0x71);
  m.step(0x2774, 7);
  if (regs.fC) { m.step(0x277f, 10); return loc_277f(m); }
  m.step(0x2777, 10);
  regs.a = regs.dec8(regs.a);
  m.step(0x2778, 4);
  mem.write8(0x6205, regs.a);
  m.step(0x277b, 13);
  mem.write8(0x694f, regs.a);
  m.step(0x277e, 13);
  m.ret(10);
}
/** loc_2787 -- move up: (0x6205)>=0xE8 -> reset277f; else inc (0x6205), mirror to 0x694F. */
function loc_2787(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6205);
  m.step(0x278a, 13);
  regs.cp(0xe8);
  m.step(0x278c, 7);
  if (regs.fNC) { m.step(0x277f, 10); return loc_277f(m); }
  m.step(0x278f, 10);
  regs.a = regs.inc8(regs.a);
  m.step(0x2790, 4);
  mem.write8(0x6205, regs.a);
  m.step(0x2793, 13);
  mem.write8(0x694f, regs.a);
  m.step(0x2796, 13);
  m.ret(10);
}
/** loc_277f -- edge reset: 0x6200=0, 0x6398=0. */
function loc_277f(m) {
  const { regs, mem } = m;
  regs.xor(regs.a);
  m.step(0x2780, 4);
  mem.write8(0x6200, regs.a);
  m.step(0x2783, 13);
  mem.write8(0x6398, regs.a);
  m.step(0x2786, 13);
  m.ret(10);
}
/** sub_271e -- thin wrapper: call sub_2745, ret. ROM 0x271E-0x2721. */
export function sub_271e(m) {
  m.push16(0x2721); m.step(0x2745, 17); sub_2745(m);
  m.ret(10);
}
/** sub_2679 -- sub_25f2's 3rd callee: even-frame 0x62A5 countdown (call 0x26de), publish 0x62A6->0x63A6 (0x26e9), every 32nd frame call 0x26a6. ROM 0x2679-0x26A6. */
export function sub_2679(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x601a);
  m.step(0x267c, 13);
  regs.rrca();
  m.step(0x267d, 4);
  if (regs.fC) { m.step(0x268d, 10); return tail_268d(m); } // odd frame
  m.step(0x2680, 10);
  regs.hl = 0x62a5;
  m.step(0x2683, 10);
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x2684, 11); // dec (0x62A5)
  if (regs.fNZ) { m.step(0x268d, 10); return tail_268d(m); }
  m.step(0x2687, 10);
  mem.write8(regs.hl, 0xff);
  m.step(0x2689, 10); // reload
  regs.l = regs.inc8(regs.l);
  m.step(0x268a, 4); // -> 0x62A6
  m.push16(0x268d); m.step(0x26de, 17); sub_26de(m); // call 0x26de
  return tail_268d(m);
}
/** tail_268d -- sub_2679 shared tail: 0x62A6->0x63A6 via 0x26e9; every 32nd frame call 0x26a6(0x69F4). */
function tail_268d(m) {
  const { regs, mem } = m;
  regs.hl = 0x62a6;
  m.step(0x2690, 10);
  m.push16(0x2693); m.step(0x26e9, 17); sub_26e9(m); // -> A
  mem.write8(0x63a6, regs.a);
  m.step(0x2696, 13);
  regs.a = mem.read8(0x601a);
  m.step(0x2699, 13);
  regs.and(0x1f);
  m.step(0x269b, 7);
  regs.cp(0x02);
  m.step(0x269d, 7);
  if (regs.fNZ) { m.ret(5); return; } // ret nz
  m.step(0x269e, 11);
  regs.de = 0x69f4;
  m.step(0x26a1, 10);
  regs.exDeHl();
  m.step(0x26a2, 4); // HL=0x69F4
  m.push16(0x26a5); m.step(0x26a6, 17); sub_26a6(m); // call 0x26a6
  m.ret(10);
}
/** sub_262f -- sub_25f2's 2nd callee: Y>=0xC0 counts down 0x62A2 (call 0x26de); Y<0xC0 sets 0x62A3=0xFF. Tail: 0x63A5/0x63A4 via 0x26e9, every 32nd frame 0x26a6->0x69ED. ROM 0x262F-0x2676. */
export function sub_262f(m) {
  const { regs, mem } = m;
  regs.hl = 0x62a3;
  m.step(0x2632, 10);
  regs.a = mem.read8(0x6205);
  m.step(0x2635, 13);
  regs.cp(0xc0);
  m.step(0x2637, 7);
  if (regs.fC) { m.step(0x266f, 10); return loc_266f(m); } // jp c,0x266f
  m.step(0x263a, 10);
  regs.a = mem.read8(0x601a);
  m.step(0x263d, 13);
  regs.rrca();
  m.step(0x263e, 4);
  if (regs.fC) { m.step(0x264c, 10); return loc_264c(m); } // odd frame
  m.step(0x2641, 10);
  regs.l = (regs.l - 1) & 0xff;
  m.step(0x2642, 4); // -> 0x62A2
  regs.decMem8(mem, regs.hl);
  m.step(0x2643, 11); // dec (0x62A2)
  if (regs.fNZ) { m.step(0x264c, 10); return loc_264c(m); }
  m.step(0x2646, 10);
  mem.write8(regs.hl, 0xc0);
  m.step(0x2648, 10); // reload
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x2649, 4); // -> 0x62A3
  m.push16(0x264c); m.step(0x26de, 17); sub_26de(m); // call 0x26de
  return loc_264c(m);
}
/** loc_264c -- sub_262f shared tail. */
function loc_264c(m) {
  const { regs, mem } = m;
  regs.hl = 0x62a3;
  m.step(0x264f, 10);
  m.push16(0x2652); m.step(0x26e9, 17); sub_26e9(m); // -> A
  mem.write8(0x63a5, regs.a);
  m.step(0x2655, 13); // 0x63A5 = +val
  regs.neg();
  m.step(0x2657, 8);
  mem.write8(0x63a4, regs.a);
  m.step(0x265a, 13); // 0x63A4 = -val
  regs.a = mem.read8(0x601a);
  m.step(0x265d, 13);
  regs.and(0x1f);
  m.step(0x265f, 7);
  if (regs.fNZ) { m.ret(11); return; } // ret nz
  m.step(0x2660, 5);
  regs.l = (regs.l - 1) & 0xff;
  m.step(0x2661, 4); // -> 0x62A2
  regs.de = 0x69ec;
  m.step(0x2664, 10);
  regs.exDeHl();
  m.step(0x2665, 4);
  m.push16(0x2668); m.step(0x26a6, 17); sub_26a6(m); // call 0x26a6 -> A
  regs.and(0x7f);
  m.step(0x266a, 7);
  regs.hl = 0x69ed;
  m.step(0x266d, 10);
  mem.write8(regs.hl, regs.a);
  m.step(0x266e, 10); // 0x69ED = A & 0x7F
  m.ret(10);
}
/** loc_266f -- sub_262f Y<0xC0 pre-check: if bit7(0x62A3) -> tail; else (0x62A3)=0xFF. */
function loc_266f(m) {
  const { regs, mem } = m;
  regs.bit(7, mem.read8(regs.hl));
  m.step(0x2671, 12); // bit 7,(hl)
  if (regs.fNZ) { m.step(0x264c, 10); return loc_264c(m); }
  m.step(0x2674, 10);
  mem.write8(regs.hl, 0xff);
  m.step(0x2676, 10);
  m.step(0x264c, 10); // jp 0x264c
  return loc_264c(m);
}
/** sub_2ad3 -- platform-row player mover: Y==0x50/0x78/0xC8 -> pick velocity, X+=vel, clamp via 0x241F, edge-adjust. ROM 0x2AD3-0x2B1B. */
export function sub_2ad3(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6203);
  m.step(0x2ad6, 13);
  regs.b = regs.a;
  m.step(0x2ad7, 4); // B = X
  regs.a = mem.read8(0x6205);
  m.step(0x2ada, 13);
  regs.cp(0x50);
  m.step(0x2adc, 7);
  if (regs.fZ) {
    m.step(0x2aea, 10);
    regs.a = mem.read8(0x63a3);
    m.step(0x2aed, 13);
    m.step(0x2b02, 10);
    return move_2b02(m);
  }
  m.step(0x2adf, 10);
  regs.cp(0x78);
  m.step(0x2ae1, 7);
  if (regs.fZ) { m.step(0x2af6, 10); return arm_2af6(m); }
  m.step(0x2ae4, 10);
  regs.cp(0xc8);
  m.step(0x2ae6, 7);
  if (regs.fZ) {
    m.step(0x2af0, 10);
    regs.a = mem.read8(0x63a6);
    m.step(0x2af3, 13);
    m.step(0x2b02, 10);
    return move_2b02(m);
  }
  m.step(0x2ae9, 10);
  m.ret(10); // Y not on a platform row
}
/** arm_2af6 -- Y==0x78: pick 0x63A5 (X>=0x80) or 0x63A4, then move. */
function arm_2af6(m) {
  const { regs, mem } = m;
  regs.a = regs.b;
  m.step(0x2af7, 4);
  regs.cp(0x80);
  m.step(0x2af9, 7);
  regs.a = mem.read8(0x63a5);
  m.step(0x2afc, 13); // ld a,(nn) flag-neutral
  if (regs.fNC) { m.step(0x2b02, 10); return move_2b02(m); } // X >= 0x80
  m.step(0x2aff, 10);
  regs.a = mem.read8(0x63a4);
  m.step(0x2b02, 13);
  return move_2b02(m);
}
/** move_2b02 -- A=velocity: X+=A, mirror 0x694C, clamp via sub_241F, edge-adjust X. */
function move_2b02(m) {
  const { regs, mem } = m;
  regs.add(regs.b);
  m.step(0x2b03, 4); // velocity + X
  mem.write8(0x6203, regs.a);
  m.step(0x2b06, 13);
  mem.write8(0x694c, regs.a);
  m.step(0x2b09, 13); // mirror
  m.push16(0x2b0c); m.step(0x241f, 17); sub_241f(m); // clamp -> DE
  regs.hl = 0x6203;
  m.step(0x2b0f, 10);
  regs.e = regs.dec8(regs.e);
  m.step(0x2b10, 4);
  if (regs.fZ) {
    m.step(0x2b18, 10); // right edge -> dec X
    mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
    m.step(0x2b19, 11);
    m.ret(10);
    return;
  }
  m.step(0x2b13, 10);
  regs.d = regs.dec8(regs.d);
  m.step(0x2b14, 4);
  if (regs.fZ) {
    m.step(0x2b1a, 10); // left edge -> inc X
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
    m.step(0x2b1b, 11);
    m.ret(10);
    return;
  }
  m.step(0x2b17, 10);
  m.ret(10);
}
/** loc_2227 -- sub_2207-body state arm: timer RMW at record base+1; on underflow advance state + set 0x621A. HL=record base popped. ROM 0x2227-0x2242. */
export function loc_2227(m) {
  const { regs, mem } = m;
  regs.hl = m.pop16();
  m.step(0x2228, 10); // record base (live-in via 2207)
  regs.l = regs.inc8(regs.l);
  m.step(0x2229, 4); // base+1
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x222a, 11); // dec timer
  if (regs.fZ) {
    m.step(0x222d, 10);
    regs.l = regs.dec8(regs.l);
    m.step(0x222e, 4); // base+0
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
    m.step(0x222f, 11); // advance state
    regs.l = regs.inc8(regs.l);
    m.step(0x2230, 4);
    regs.l = regs.inc8(regs.l);
    m.step(0x2231, 4); // base+2
    m.push16(0x2234); m.step(0x2243, 17);
    if (!sub_2243(m)) return; // MISS -> caller-skip already unwound to loc_197a; do NOT continue/ret
    regs.a = 0x01;
    m.step(0x2236, 7);
    mem.write8(0x621a, regs.a);
    m.step(0x2239, 13);
    m.ret(10);
    return;
  }
  m.step(0x223a, 10);
  regs.l = regs.inc8(regs.l);
  m.step(0x223b, 4); // base+2
  m.push16(0x223e); m.step(0x2243, 17);
  if (!sub_2243(m)) return; // MISS -> caller-skip already unwound to loc_197a; do NOT continue/ret
  regs.xor(regs.a);
  m.step(0x223f, 4);
  mem.write8(0x621a, regs.a);
  m.step(0x2242, 13);
  m.ret(10);
}
/** loc_2259 -- sub_2207-body arm: base+4 timer; on 0 reload + bump base+3 counter, mirror (22bd), at 0x78 advance state; player-Y descend logic. ROM 0x2259-0x2298. */
export function loc_2259(m) {
  const { regs, mem } = m;
  regs.hl = m.pop16();
  m.step(0x225a, 10);
  for (const t of [0x225b, 0x225c, 0x225d, 0x225e]) { regs.l = regs.inc8(regs.l); m.step(t, 4); } // base+4
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x225f, 11); // dec timer
  if (regs.fNZ) { m.ret(5); return; }
  m.step(0x2260, 11);
  regs.a = 0x04;
  m.step(0x2262, 7);
  mem.write8(regs.hl, regs.a);
  m.step(0x2263, 7); // reload timer
  regs.l = regs.dec8(regs.l);
  m.step(0x2264, 4); // base+3
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x2265, 11); // bump counter
  m.push16(0x2268); m.step(0x22bd, 17); sub_22bd(m); // display mirror
  regs.a = 0x78;
  m.step(0x226a, 7);
  regs.cp(mem.read8(regs.hl));
  m.step(0x226b, 7);
  if (regs.fZ) {
    m.step(0x226e, 10);
    for (const t of [0x226f, 0x2270, 0x2271]) { regs.l = regs.dec8(regs.l); m.step(t, 4); } // base+0
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
    m.step(0x2272, 11); // advance state
    for (const t of [0x2273, 0x2274, 0x2275]) { regs.l = regs.inc8(regs.l); m.step(t, 4); } // base+3
  } else {
    m.step(0x2275, 10);
  }
  regs.l = regs.dec8(regs.l);
  m.step(0x2276, 4); // base+2
  m.push16(0x2279); m.step(0x2243, 17);
  if (!sub_2243(m)) return; // MISS -> caller-skip already unwound to loc_197a; do NOT continue/ret
  regs.a = mem.read8(0x6205);
  m.step(0x227c, 13); // player Y
  regs.cp(0x68);
  m.step(0x227e, 7);
  if (regs.fC) return descend_2284(m); // Y < 0x68
  m.step(0x228a, 10);
  regs.rra();
  m.step(0x228b, 4);
  if (regs.fC) { m.step(0x2281, 10); return descend_2284(m); } // Y odd
  m.step(0x228e, 10);
  regs.rra();
  m.step(0x228f, 4);
  regs.a = 0x01;
  m.step(0x2291, 7);
  if (!regs.fC) {
    regs.xor(regs.a);
    m.step(0x2295, 4);
  } else {
    m.step(0x2295, 10);
  }
  mem.write8(0x6222, regs.a);
  m.step(0x2298, 13);
  m.ret(10);
}
/** descend_2284 -- loc_2259's Y-descend: Y++ / call 0x3FC0 / Y++. */
function descend_2284(m) {
  const { regs, mem } = m;
  regs.hl = 0x6205;
  m.step(0x2284, 10);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x2285, 11); // Y++
  m.push16(0x2288); m.step(0x3fc0, 17); sub_3fc0(m);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x2289, 11); // Y++
  m.ret(10);
}
/** loc_2299 -- sub_2207-body arm: every-4th-frame (0x6018&0x3C==0) advance state at record base. ROM 0x2299-0x22A1. */
export function loc_2299(m) {
  const { regs, mem } = m;
  regs.hl = m.pop16();
  m.step(0x229a, 10);
  regs.a = mem.read8(0x6018);
  m.step(0x229d, 13);
  regs.and(0x3c);
  m.step(0x229f, 7);
  if (regs.fNZ) { m.ret(5); return; }
  m.step(0x22a0, 11);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x22a1, 11); // advance state
  m.ret(10);
}
/** loc_22a2 -- sub_2207-body arm: base+4 timer; on 0 counter DOWN, mirror (22bd); at 0x68 reset record to state 0. ROM 0x22A2-0x22BC. */
export function loc_22a2(m) {
  const { regs, mem } = m;
  regs.hl = m.pop16();
  m.step(0x22a3, 10);
  for (const t of [0x22a4, 0x22a5, 0x22a6, 0x22a7]) { regs.l = regs.inc8(regs.l); m.step(t, 4); } // base+4
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x22a8, 11); // dec timer
  if (regs.fNZ) { m.ret(5); return; }
  m.step(0x22a9, 11);
  mem.write8(regs.hl, 0x02);
  m.step(0x22ab, 10); // reload timer
  regs.l = regs.dec8(regs.l);
  m.step(0x22ac, 4); // base+3
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
  m.step(0x22ad, 11); // counter DOWN
  m.push16(0x22b0); m.step(0x22bd, 17); sub_22bd(m); // display mirror
  regs.a = 0x68;
  m.step(0x22b2, 7);
  regs.cp(mem.read8(regs.hl));
  m.step(0x22b3, 7);
  if (regs.fNZ) { m.ret(5); return; }
  m.step(0x22b4, 11);
  regs.xor(regs.a);
  m.step(0x22b5, 4);
  regs.b = 0x80;
  m.step(0x22b7, 7);
  regs.l = regs.dec8(regs.l);
  m.step(0x22b8, 4); // base+2
  regs.l = regs.dec8(regs.l);
  m.step(0x22b9, 4); // base+1
  mem.write8(regs.hl, regs.b);
  m.step(0x22ba, 7); // (base+1) = 0x80
  regs.l = regs.dec8(regs.l);
  m.step(0x22bb, 4); // base+0
  mem.write8(regs.hl, regs.a);
  m.step(0x22bc, 7); // (base+0) = 0 -- reset to state 0
  m.ret(10);
}
/** loc_2303 -- sub_22cb diff-3/4 velocity: (ix+0x11)=frame, (ix+0x10)=dir sign (playerX vs objX). IX live-in. ROM 0x2303-0x2319. */
export function loc_2303(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6018);
  m.step(0x2306, 13);
  mem.write8((regs.ix + 0x11) & 0xffff, regs.a);
  m.step(0x2309, 19); // (ix+0x11) = frame
  regs.a = mem.read8(0x6203);
  m.step(0x230c, 13);
  regs.cp(mem.read8((regs.ix + 0x03) & 0xffff));
  m.step(0x230f, 19); // playerX vs objX
  regs.a = 0x01;
  m.step(0x2311, 7);
  if (regs.fC) {
    m.step(0x2314, 10);
    regs.a = regs.dec8(regs.a);
    m.step(0x2315, 4);
    regs.a = regs.dec8(regs.a);
    m.step(0x2316, 4); // A = 0xFF (-1)
  } else {
    m.step(0x2316, 10);
  }
  mem.write8((regs.ix + 0x10) & 0xffff, regs.a);
  m.step(0x2319, 19); // (ix+0x10) = dir
  m.ret(10);
}
/** loc_231a -- sub_22cb diff-5 velocity: 2-bit direction code (from playerX-objX sign, rotated) into (ix+0x10), delta into (ix+0x11). IX live-in. ROM 0x231A-0x2332. */
export function loc_231a(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6203);
  m.step(0x231d, 13);
  regs.sub(mem.read8((regs.ix + 0x03) & 0xffff));
  m.step(0x2320, 19); // playerX - objX
  regs.c = 0xff;
  m.step(0x2322, 7);
  if (!regs.fC) {
    m.step(0x2325, 10);
    regs.c = regs.inc8(regs.c);
    m.step(0x2326, 4); // player right -> C=0
  } else {
    m.step(0x2326, 10);
  }
  regs.rlca();
  m.step(0x2327, 4);
  regs.c = regs.rl(regs.c);
  m.step(0x2329, 8);
  regs.rlca();
  m.step(0x232a, 4);
  regs.c = regs.rl(regs.c);
  m.step(0x232c, 8);
  mem.write8((regs.ix + 0x10) & 0xffff, regs.c);
  m.step(0x232f, 19); // (ix+0x10) = code
  mem.write8((regs.ix + 0x11) & 0xffff, regs.a);
  m.step(0x2332, 19); // (ix+0x11) = delta
  m.ret(10);
}
/**
 * sub_2207_body -- sub_2207's object-update body (0x220A onward).  Reads (0x601A) frame parity to
 * pick record 0x6280 (odd) / 0x6288 (even); push the record base; rst 0x28 dispatches on the state
 * byte to loc_2227/2259/2299/22a2 (table @0x221B). rst-0x28 body modelled faithfully.
 */
export function sub_2207_body(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x601a);
  m.step(0x220d, 13); // ld a,(0x601a)
  regs.rra();
  m.step(0x220e, 4); // rra -- frame bit0 -> carry
  regs.hl = 0x6280;
  m.step(0x2211, 10); // ld hl,0x6280
  regs.a = mem.read8(regs.hl);
  m.step(0x2212, 7); // ld a,(hl)
  if (regs.fC) {
    m.step(0x2219, 10); // jp c,0x2219 (odd frame -> keep 0x6280)
  } else {
    m.step(0x2215, 10);
    regs.hl = 0x6288;
    m.step(0x2218, 10); // ld hl,0x6288
    regs.a = mem.read8(regs.hl);
    m.step(0x2219, 7); // ld a,(hl)
  }
  m.push16(regs.hl); // push hl -- the record base (each arm pops it)
  m.step(0x221a, 11);
  m.push16(0x221b); // rst 0x28 pushes the table base 0x221B
  m.step(0x0028, 11);
  // -- inline rst 0x28 body (ROM 0x0028-0x0037), state A in 0..3 --
  regs.add(regs.a);
  m.step(0x0029, 4); // add a,a
  regs.hl = m.pop16();
  m.step(0x002a, 10); // pop hl = 0x221B
  regs.e = regs.a;
  m.step(0x002b, 4);
  regs.d = 0x00;
  m.step(0x002d, 7);
  m.step(0x0032, 10);
  regs.addHl(regs.de);
  m.step(0x0033, 11);
  regs.e = mem.read8(regs.hl);
  m.step(0x0034, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0035, 6);
  regs.d = mem.read8(regs.hl);
  m.step(0x0036, 7);
  const target = regs.de;
  regs.de = regs.hl;
  regs.hl = target;
  m.step(0x0037, 4); // ex de,hl
  m.step(target, 4); // jp (hl)
  if (target === 0x2227) return loc_2227(m);
  if (target === 0x2259) return loc_2259(m);
  if (target === 0x2299) return loc_2299(m);
  if (target === 0x22a2) return loc_22a2(m);
  throw new NotImplemented(
    `sub_2207 body rst 0x28 -> unexpected ROM 0x${target.toString(16).padStart(4, "0")}`,
  );
}

/**
 * entry_2c03 -- ROM 0x2C03-0x2C40  (head of the 0x2C.. cluster; one caller @ 0x1989)
 *
 *   2c03  3e 01        ld   a,0x01
 *   2c05  f7           rst  0x30
 *   2c06  d7           rst  0x10
 *   2c07  3a 93 63     ld   a,(0x6393)
 *   2c0a  0f           rrca
 *   2c0b  d8           ret  c
 *   2c0c  3a b1 62     ld   a,(0x62b1)
 *   2c0f  a7           and  a
 *   2c10  c8           ret  z
 *   2c11  4f           ld   c,a
 *   2c12  3a b0 62     ld   a,(0x62b0)
 *   2c15  d6 02        sub  0x02
 *   2c17  b9           cp   c
 *   2c18  da 7b 2c     jp   c,0x2c7b
 *   2c1b  3a 82 63     ld   a,(0x6382)
 *   2c1e  cb 4f        bit  1,a
 *   2c20  c2 86 2c     jp   nz,0x2c86
 *   2c23  3a 80 63     ld   a,(0x6380)
 *   2c26  47           ld   b,a
 *   2c27  3a 1a 60     ld   a,(0x601a)
 *   2c2a  e6 1f        and  0x1f
 *   2c2c  b8           cp   b          ; loc_2c2c
 *   2c2d  ca 33 2c     jp   z,0x2c33
 *   2c30  10 fa        djnz 0x2c2c
 *   2c32  c9           ret
 *   2c33  3a b0 62     ld   a,(0x62b0) ; loc_2c33
 *   2c36  cb 3f        srl  a
 *   2c38  b9           cp   c
 *   2c39  da 41 2c     jp   c,0x2c41
 *   2c3c  3a 19 60     ld   a,(0x6019)
 *   2c3f  0f           rrca
 *   2c40  d0           ret  nc
 *
 * TWIN of sub_03a2 (mainloop.js) -- SAME rst 0x30/0x10 prologue, constants
 * 0x01/0x6393 not 0x03/0x6350. A copy of the twin reads the wrong cell.
 * The two rst are the conditional caller-skip pair (sub_0030/
 * sub_0010); each `if (!..) return;` -- modelling either as a plain call loses
 * the skip. srl a @ 0x2C36 is the first use of the primitive:
 * LOGICAL (0 into bit 7), not sra. The djnz loop's `cp b` is
 * INSIDE the loop and B decrements, so it matches A against B, B-1, .., 1 -- the
 * compare is not loop-invariant.
 *
 * FLOW-OUTS to the untranslated 0x2C.. cluster, rendered as NotImplemented throws
 * (the loc_1dc9 convention): 0x2c7b (jp c), 0x2c86 (jp nz), and 0x2c41 -- reached
 * BOTH by jp c @ 0x2C39 AND by fall-through when `ret nc` @ 0x2C40 is not taken
 * (the invisible-boundary continuation). Not yet wired into the live
 * dispatcher; only caller 0x1989 is itself untranslated.
 */
export function entry_2c03(m) {
  const { regs, mem } = m;

  regs.a = 0x01; // ld a,0x01 -- NOT 0x03 (twin sub_03a2)
  m.step(0x2c05, 7); // ld a,0x01
  m.push16(0x2c06);
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // rst 0x30 -- may SKIP
  m.push16(0x2c07);
  m.step(0x0010, 11); // rst 0x10
  if (!sub_0010(m)) return; // rst 0x10 -- may SKIP

  regs.a = mem.read8(0x6393); // NOT 0x6350 (twin sub_03a2)
  m.step(0x2c0a, 13); // ld a,(0x6393)
  regs.rrca();
  m.step(0x2c0b, 4); // rrca -- carry = bit 0 of (0x6393)
  if (regs.fC) {
    m.ret(11); // ret c -- (0x6393) bit 0 set
    return;
  }
  m.step(0x2c0c, 5); // ret c not taken

  regs.a = mem.read8(0x62b1);
  m.step(0x2c0f, 13); // ld a,(0x62b1)
  regs.and(regs.a); // and a -- test A for zero
  m.step(0x2c10, 4); // and a
  if (regs.fZ) {
    m.ret(11); // ret z -- (0x62b1) == 0
    return;
  }
  m.step(0x2c11, 5); // ret z not taken
  regs.c = regs.a;
  m.step(0x2c12, 4); // ld c,a -- C := (0x62b1)

  regs.a = mem.read8(0x62b0);
  m.step(0x2c15, 13); // ld a,(0x62b0)
  regs.sub(0x02);
  m.step(0x2c17, 7); // sub 0x02
  regs.cp(regs.c);
  m.step(0x2c18, 4); // cp c
  if (regs.fC) {
    m.step(0x2c7b, 10); // jp c,0x2c7b taken (tail)
    return entry_2c7b(m);
  }
  m.step(0x2c1b, 10); // jp c,0x2c7b not taken

  regs.a = mem.read8(0x6382);
  m.step(0x2c1e, 13); // ld a,(0x6382)
  const bit1 = regs.bit(1, regs.a); // bit 1,a -- F3/F5-from-value correct for reg form
  m.step(0x2c20, 8); // bit 1,a
  if (bit1) {
    m.step(0x2c86, 10); // jp nz,0x2c86 taken (tail)
    return loc_2c86(m);
  }
  m.step(0x2c23, 10); // jp nz,0x2c86 not taken

  regs.a = mem.read8(0x6380);
  m.step(0x2c26, 13); // ld a,(0x6380)
  regs.b = regs.a;
  m.step(0x2c27, 4); // ld b,a -- B := (0x6380)
  regs.a = mem.read8(0x601a);
  m.step(0x2c2a, 13); // ld a,(0x601a)
  regs.and(0x1f);
  m.step(0x2c2c, 7); // and 0x1f

  for (;;) {
    // loc_2c2c: cp b is INSIDE the loop; djnz decrements B, so the compare tests
    // A against B, B-1, .., 1 -- NOT loop-invariant.
    regs.cp(regs.b);
    m.step(0x2c2d, 4); // cp b
    if (regs.fZ) {
      m.step(0x2c33, 10); // jp z,0x2c33 taken -> loc_2c33
      break;
    }
    m.step(0x2c30, 10); // jp z,0x2c33 not taken
    regs.djnz();
    if (regs.b === 0) {
      m.step(0x2c32, 8); // djnz falls through
      m.ret(); // 0x2C32 -- no match in [1,(0x6380)]
      return;
    }
    m.step(0x2c2c, 13); // djnz taken -> loc_2c2c
  }

  // ---- loc_2c33 ----
  regs.a = mem.read8(0x62b0);
  m.step(0x2c36, 13); // ld a,(0x62b0)
  regs.a = regs.srl(regs.a); // srl a -- LOGICAL (0 into bit 7), NOT sra
  m.step(0x2c38, 8); // srl a
  regs.cp(regs.c);
  m.step(0x2c39, 4); // cp c
  if (regs.fC) {
    m.step(0x2c41, 10); // jp c,0x2c41 taken (tail)
    return entry_2c41(m);
  }
  m.step(0x2c3c, 10); // jp c,0x2c41 not taken

  regs.a = mem.read8(0x6019);
  m.step(0x2c3f, 13); // ld a,(0x6019)
  regs.rrca();
  m.step(0x2c40, 4); // rrca -- carry = bit 0 of (0x6019)
  if (regs.fNC) {
    m.ret(11); // ret nc -- (0x6019) bit 0 clear
    return;
  }
  m.step(0x2c41, 5); // ret nc not taken -- FALL-THROUGH into entry_2c41
  return entry_2c41(m);
}

/**
 * entry_2c41 -- ROM 0x2C41-0x2C71  (continuation of entry_2c03; MULTI-ENTRY)
 *
 *   2c41  cd 57 00     call 0x0057             ; entry_2c41
 *   2c44  e6 0f        and  0x0f
 *   2c46  c2 86 2c     jp   nz,0x2c86
 *   2c49  3e 01        ld   a,0x01             ; loc_2c49
 *   2c4b  32 82 63     ld   (0x6382),a         ; loc_2c4b
 *   2c4e  3c           inc  a
 *   2c4f  32 8f 63     ld   (0x638f),a         ; loc_2c4f
 *   2c52  3e 01        ld   a,0x01
 *   2c54  32 92 63     ld   (0x6392),a
 *   2c57  3a b2 62     ld   a,(0x62b2)
 *   2c5a  b9           cp   c
 *   2c5b  c0           ret  nz
 *   2c5c  d6 08        sub  0x08
 *   2c5e  32 b2 62     ld   (0x62b2),a
 *   2c61  11 20 00     ld   de,0x0020
 *   2c64  21 00 64     ld   hl,0x6400
 *   2c67  06 05        ld   b,0x05
 *   2c69  7e           ld   a,(hl)             ; loc_2c69
 *   2c6a  a7           and  a
 *   2c6b  ca 72 2c     jp   z,0x2c72
 *   2c6e  19           add  hl,de
 *   2c6f  10 f8        djnz 0x2c69
 *   2c71  c9           ret
 *
 * FOUR ENTRY POINTS: 0x2C41 (from entry_2c03, jp c + fall-through)
 * and loc_2c49 / loc_2c4b / loc_2c4f (from the untranslated entry_2c7b, with the
 * caller's A). Modelled as four exported functions chained by tail-calls so the
 * cluster can enter at any label. The store values differ by entry: via
 * 0x2C41/loc_2c49 (0x6382=1, 0x638f=2); via loc_2c4b (0x6382=A, 0x638f=A+1); via
 * loc_2c4f (0x638f=A only). 0x638f = 0x6382 + 1 because `inc a` @ 0x2C4E sits
 * BETWEEN the two stores. C is a live-in (entry_2c03's ld c,a).
 *
 * (0x62b2) is a gated RMW: proceeds past `ret nz` ONLY when (0x62b2)==C, then
 * (0x62b2) -= 8. loc_2c69 finds the FIRST ZERO of 5 records at
 * 0x6400 stride 0x20 (jp z). Flow-outs: 0x2c86 (jp nz,
 * untranslated -> NotImplemented) and entry_2c72 (jp z -- TRANSLATED, wired).
 * Not yet wired into the live dispatcher (its only in-partition caller entry_2c03
 * is itself unreached; the alt entries' source entry_2c7b is untranslated).
 */
export function entry_2c41(m) {
  const { regs } = m;

  m.push16(0x2c44);
  m.step(0x0057, 17); // call 0x0057
  sub_0057(m); // translated -- A = (0x6018)+(0x601a)+(0x6019)
  regs.and(0x0f);
  m.step(0x2c46, 7); // and 0x0f
  if (regs.fNZ) {
    m.step(0x2c86, 10); // jp nz,0x2c86 taken (tail)
    return loc_2c86(m);
  }
  m.step(0x2c49, 10); // jp nz,0x2c86 not taken
  return loc_2c49(m);
}

/** loc_2c49 -- ROM 0x2C49 entry (from entry_2c7b jp z,0x2c49): A := 0x01. */
export function loc_2c49(m) {
  const { regs } = m;
  regs.a = 0x01;
  m.step(0x2c4b, 7); // ld a,0x01
  return loc_2c4b(m);
}

/** loc_2c4b -- ROM 0x2C4B entry (from entry_2c7b jp 0x2c4b): stores caller's A
 *  at 0x6382, then 0x638f = A+1 (inc a BETWEEN the two stores, draft TEST 1). */
export function loc_2c4b(m) {
  const { regs, mem } = m;
  mem.write8(0x6382, regs.a); // ld (0x6382),a
  m.step(0x2c4e, 13); // ld (0x6382),a
  regs.a = regs.inc8(regs.a); // inc a -- BETWEEN the two stores
  m.step(0x2c4f, 4); // inc a
  return loc_2c4f(m);
}

/** loc_2c4f -- ROM 0x2C4F entry (from entry_2c7b jp 0x2c4f): stores caller's A at
 *  0x638f (0x6382 NOT written on this entry), then the gate + free-slot search. */
export function loc_2c4f(m) {
  const { regs, mem } = m;
  mem.write8(0x638f, regs.a); // ld (0x638f),a
  m.step(0x2c52, 13); // ld (0x638f),a
  regs.a = 0x01;
  m.step(0x2c54, 7); // ld a,0x01
  mem.write8(0x6392, regs.a);
  m.step(0x2c57, 13); // ld (0x6392),a

  regs.a = mem.read8(0x62b2);
  m.step(0x2c5a, 13); // ld a,(0x62b2)
  regs.cp(regs.c); // cp c -- C is the entry_2c03 live-in
  m.step(0x2c5b, 4); // cp c
  if (regs.fNZ) {
    m.ret(11); // ret nz -- returns unless (0x62b2) == C
    return;
  }
  m.step(0x2c5c, 5); // ret nz not taken

  regs.sub(0x08);
  m.step(0x2c5e, 7); // sub 0x08
  mem.write8(0x62b2, regs.a); // (0x62b2) -= 8 (RMW)
  m.step(0x2c61, 13); // ld (0x62b2),a
  regs.de = 0x0020;
  m.step(0x2c64, 10); // ld de,0x0020
  regs.hl = 0x6400;
  m.step(0x2c67, 10); // ld hl,0x6400
  regs.b = 0x05;
  m.step(0x2c69, 7); // ld b,0x05

  do {
    // loc_2c69: find the FIRST ZERO of 5 records at 0x6400 stride 0x20 (draft TEST 2)
    regs.a = mem.read8(regs.hl);
    m.step(0x2c6a, 7); // ld a,(hl)
    regs.and(regs.a); // and a -- test (hl) for zero
    m.step(0x2c6b, 4); // and a
    if (regs.fZ) {
      m.step(0x2c72, 10); // jp z,0x2c72 taken (tail) -- free slot found
      return entry_2c72(m); // entry_2c72 IS translated (0acc93f): set bit 7 of 0x6382
    }
    m.step(0x2c6e, 10); // jp z,0x2c72 not taken
    regs.addHl(regs.de); // add hl,de -- next record
    m.step(0x2c6f, 11); // add hl,de
    regs.djnz();
    m.step(regs.b !== 0 ? 0x2c69 : 0x2c71, regs.b !== 0 ? 13 : 8); // djnz 0x2c69
  } while (regs.b !== 0);

  m.ret(); // 0x2C71 -- no free slot in the 5 records
}

/**
 * entry_2c7b / loc_2c86 -- ROM 0x2C7B-0x2C8E  (the multi-entry SOURCES into entry_2c41)
 *
 *   2c7b  c6 02        add  a,0x02            ; entry_2c7b
 *   2c7d  b9           cp   c
 *   2c7e  ca 49 2c     jp   z,0x2c49
 *   2c81  3e 02        ld   a,0x02
 *   2c83  c3 4b 2c     jp   0x2c4b
 *   2c86  af           xor  a                 ; loc_2c86
 *   2c87  32 82 63     ld   (0x6382),a
 *   2c8a  3e 03        ld   a,0x03
 *   2c8c  c3 4f 2c     jp   0x2c4f
 *
 * These resolve entry_2c41's four entries. entry_2c7b (from entry_2c03's
 * jp c,0x2c7b): A += 2 (A is entry_2c03's `sub 0x02` result), then cp c -- if
 * A+2 == C it jumps to loc_2c49 (A kept -> the 0x6382=1/0x638f=2 path); else
 * A := 0x02 into loc_2c4b (-> 0x6382=2/0x638f=3). loc_2c86 (from entry_2c03's
 * AND entry_2c41's jp nz,0x2c86): CLEARS 0x6382 (xor a; ld (0x6382),a -- the
 * OPPOSITE of entry_2c72 which SETS bit 7, same byte inverse op),
 * then A := 0x03 into loc_2c4f (-> 0x638f=3, 0x6382 stays 0). Both TAIL-JUMP into
 * entry_2c41's body -- wired to the translated loc_2c49/loc_2c4b/loc_2c4f; no
 * ret here, entry_2c41's ret/skip handles the return. Not yet wired into the
 * live dispatcher (reached only from the dead entry_2c03/entry_2c41).
 *
 * NOTE the two `ld a,n`/`jp nn` pairs (0x2C81-83, 0x2C8A-8C) are TWO instructions
 * each -- both charged (the draft skeleton folded them into one m.step).
 */
export function entry_2c7b(m) {
  const { regs } = m;
  regs.add(0x02); // add a,0x02 -- A is entry_2c03's sub-0x02 result
  m.step(0x2c7d, 7); // add a,0x02
  regs.cp(regs.c); // cp c -- C = (0x62b1), the entry_2c03 live-in
  m.step(0x2c7e, 4); // cp c
  if (regs.fZ) {
    m.step(0x2c49, 10); // jp z,0x2c49 taken -- A+2 == C, A kept
    return loc_2c49(m);
  }
  m.step(0x2c81, 10); // jp z,0x2c49 not taken
  regs.a = 0x02;
  m.step(0x2c83, 7); // ld a,0x02
  m.step(0x2c4b, 10); // jp 0x2c4b -- A = 0x02 into loc_2c4b
  return loc_2c4b(m);
}

/** loc_2c86 -- ROM 0x2C86 entry (from entry_2c03 @ 0x2C20 and entry_2c41 @ 0x2C46). */
export function loc_2c86(m) {
  const { regs, mem } = m;
  regs.xor(regs.a); // xor a -- A = 0 (CLEARS 0x6382, NOT entry_2c72's set-bit-7)
  m.step(0x2c87, 4); // xor a
  mem.write8(0x6382, regs.a); // ld (0x6382),a -- (0x6382) := 0 (draft TEST 2)
  m.step(0x2c8a, 13); // ld (0x6382),a
  regs.a = 0x03;
  m.step(0x2c8c, 7); // ld a,0x03
  m.step(0x2c4f, 10); // jp 0x2c4f -- A = 0x03 into loc_2c4f
  return loc_2c4f(m);
}
