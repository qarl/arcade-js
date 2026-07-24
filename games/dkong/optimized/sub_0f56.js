// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0f56 — hand-optimized rewrite of the translated routine at ROM 0x0F56,
 * proven equal to its oracle by the equivalence harness. Only 0x6227 has a settled
 * name (BOARD); the timer/work-RAM operands it seeds are left hex with descriptive
 * comments until they are confirmed.
 */

import { NotImplemented } from "../../../boards/dkong/io.js";
import { BOARD } from "./ram.js";

/**
 * sub_0f56 -- per-board work-RAM setup, then dispatch to the board's own setup.
 * [ROM 0x0F56-0x0FCC, inlining the rst 0x28 dispatcher at 0x0028-0x0037]
 *
 * Called once from loc_0d5f (`call 0x0f56`). It:
 *   1. zeroes 0x6200-0x6226 (0x27 bytes) and 0x6280-0x6AFF (17 blocks of 0x80),
 *   2. copies 0x40 bytes of board-layout ROM data 0x3D9C-0x3DDB into 0x6280,
 *   3. computes the BONUS TIMER = min((0x6229)*10 + 0x28, 0x50) and stores it at
 *      0x62B0/B1/B2 (the *10 is three `and a`/`rla` doublings summed twice, all mod 256),
 *   4. computes a paired value max(0xDC - 2*timer, 0x28) at 0x62B3/B4,
 *   5. sets 0x6209 = 4, 0x620A = 8,
 *   6. unless bit 2 of BOARD is set, seeds three 4-byte sprite records at 0x6A00,
 *   7. loads C = BOARD and DISPATCHES through an inline jump table at 0x0FCD to the
 *      per-board setup routine (1->loc_0fd7, 2->0x101f, 3->0x1087, 4->0x1131).
 *
 * This routine has NO `ret`: it exits through `rst 0x28`, whose `pop hl` takes back the
 * 0x0FCD the `rst` pushed (the TABLE BASE) -- the caller's 0x0D62 stays one slot deeper
 * and is what the dispatched target's own `ret` eventually pops. The dispatcher is
 * inlined (not m.call(0x0028)) precisely because its table is inline ROM after the rst.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached via the board-build chain (loc_0d5f),
 * whose atomicity is not pinned to the mask-cleared NMI, so charges are kept verbatim.
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

  // ---- copy 0x40 bytes of board-layout ROM 0x3D9C-0x3DDB to 0x6280 ----
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
  // `and a` clears carry so the following `rla` shifts a 0 into bit 0 and the bit
  // shifted OUT of bit 7 is discarded. Three pairs = A = (A*8) & 0xFF.
  for (const [andNext, rlaNext] of [[0x0f7f, 0x0f80], [0x0f81, 0x0f82], [0x0f83, 0x0f84]]) {
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

  // ---- store that bonus-timer value at 0x62B0,B1,B2 ----
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
    regs.a = 0x28; // clamp
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

  // ---- C = BOARD. C IS THE DISPATCHER INDEX -- live to 0x0FCB ----
  regs.a = mem.read8(BOARD);
  m.step(0x0fb0, 13);
  regs.c = regs.a;
  m.step(0x0fb1, 4);
  const bit2 = regs.bit(2, regs.a); // does not modify A; preserves carry
  m.step(0x0fb3, 8);
  if (bit2) {
    m.step(0x0fcb, 12); // straight to the dispatcher
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

  // ---- 0x0FCB: ld a,c / rst 0x28 -- the inline jump-table dispatcher ----
  regs.a = regs.c;
  m.step(0x0fcc, 4);
  m.push16(0x0fcd); // rst 0x28 pushes the address AFTER it -- the TABLE BASE
  m.step(0x0028, 11);

  // THE rst 0x28 BODY, inlined (ROM 0x0028-0x0037). Table at 0x0FCD, C=BOARD:
  //   0 -> 0x0000 (unused)  1 -> 0x0FD7  2 -> 0x101F  3 -> 0x1087  4 -> 0x1131
  regs.add(regs.a);
  m.step(0x0029, 4); // add a,a -- A = 2*index
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

  if (target === 0x0fd7) return m.call(0x0fd7);
  if (target === 0x101f) return m.call(0x101f); // board 2
  if (target === 0x1087) return m.call(0x1087); // board 3
  if (target === 0x1131) return m.call(0x1131); // board 4
  throw new NotImplemented(
    `sub_0f56 dispatches via rst 0x28 to ROM 0x${target.toString(16).padStart(4, "0")} ` +
      `(table at 0x0FCD, index C=${regs.c}), which is not translated.`,
  );
}
