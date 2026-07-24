// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_2441 — hand-optimized rewrite of the translated routine at ROM 0x2441,
 * proven equal to its oracle by the equivalence harness. Only 0x6227 (BOARD) is settled;
 * the object-block bases 0x6300/0x6310 and ROM record tables stay hex.
 */

import { BOARD } from "./ram.js";

/**
 * sub_2441 -- seed the object-position blocks from a board-selected ROM record table.
 * [ROM 0x2441-0x24B1]
 *
 * The second board-setup helper loc_0d5f calls (after sub_0f56's board dispatch has run).
 *   head A: sum six ROM bytes at 0x3F0C mod 256; IY = 0x6310, bumped to 0x6311 iff the
 *           sum is non-zero (a checksum-parity nudge of the type-1 block base).
 *   head B: pick the record table by BOARD -- 1->0x3AE4, 2->0x3B5D, 3->0x3BE5, else
 *           0x3C8B. IX = 0x6300 (type-0 block base), DE = 5 (record stride).
 *   walk:   for each record, the lead byte is the type. Type 0 copies three payload bytes
 *           into the IX block at +0x00/+0x15/+0x2A and steps IX; type 1 does the same into
 *           the IY block; 0xA9 (tested against the decremented type) TERMINATES with `ret`;
 *           anything else steps HL by DE (5) to the next record.
 *
 * The record byte at +3 is stepped over and never read (two `inc hl` with no load between).
 * The walk is a JUMP cycle -- no call/push/rst in its 115 bytes, stack-flat -- so it is one
 * for(;;) loop. `inc ix`/`inc iy` are 16-bit INCs (no flags); NOT the flag-setting add-helpers.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached through the board-build chain (loc_0d5f),
 * whose atomicity is not pinned to the mask-cleared NMI, so charges are kept verbatim.
 */
export function sub_2441(m) {
  const { regs, mem } = m;

  // -- head A: sum six ROM bytes mod 256 ---------------------------------
  regs.hl = 0x3f0c;
  m.step(0x2444, 10);
  regs.a = 0x5e;
  m.step(0x2446, 7);
  regs.b = 0x06;
  m.step(0x2448, 7);
  do {
    regs.add(mem.read8(regs.hl)); // masks to 8 bits -- carry out is DISCARDED
    m.step(0x2449, 7);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x244a, 6);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x2448 : 0x244c, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  regs.iy = 0x6310; // flag-neutral load; `and a` below regenerates flags from A
  m.step(0x2450, 14);
  regs.and(regs.a);
  m.step(0x2451, 4);
  if (regs.fZ) {
    m.step(0x2456, 10); // sum was 0 -- IY stays 0x6310
  } else {
    m.step(0x2454, 10);
    regs.iy = (regs.iy + 1) & 0xffff; // 16-bit INC: no flags -- IY = 0x6311
    m.step(0x2456, 10);
  }

  // -- head B: pick the record table by BOARD ----------------------------
  // Every `ld hl,nn` below is FLAG-NEUTRAL, so each `jp z` tests the `dec a`
  // two instructions earlier, across the intervening load.
  regs.a = mem.read8(BOARD);
  m.step(0x2459, 13);

  selectTable: {
    regs.a = regs.dec8(regs.a);
    m.step(0x245a, 4);
    regs.hl = 0x3ae4;
    m.step(0x245d, 10);
    if (regs.fZ) { m.step(0x2471, 10); break selectTable; } // BOARD == 1
    m.step(0x2460, 10);

    regs.a = regs.dec8(regs.a);
    m.step(0x2461, 4);
    regs.hl = 0x3b5d;
    m.step(0x2464, 10);
    if (regs.fZ) { m.step(0x2471, 10); break selectTable; } // BOARD == 2
    m.step(0x2467, 10);

    regs.a = regs.dec8(regs.a);
    m.step(0x2468, 4);
    regs.hl = 0x3be5;
    m.step(0x246b, 10);
    if (regs.fZ) { m.step(0x2471, 10); break selectTable; } // BOARD == 3
    m.step(0x246e, 10);

    // Default: everything else, including BOARD == 0 (wraps to 0xFF, never Z).
    regs.hl = 0x3c8b;
    m.step(0x2471, 10);
  }

  regs.ix = 0x6300;
  m.step(0x2475, 14);
  regs.de = 0x0005;
  m.step(0x2478, 10);

  // -- the walk ----------------------------------------------------------
  for (;;) {
    regs.a = mem.read8(regs.hl);
    m.step(0x2479, 7);
    regs.and(regs.a);
    m.step(0x247a, 4);

    if (regs.fZ) {
      // type 0 -> IX block
      m.step(0x2488, 10);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x2489, 6);
      regs.a = mem.read8(regs.hl);
      m.step(0x248a, 7);
      mem.write8((regs.ix + 0x00) & 0xffff, regs.a);
      m.step(0x248d, 19);

      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x248e, 6);
      regs.a = mem.read8(regs.hl);
      m.step(0x248f, 7);
      mem.write8((regs.ix + 0x15) & 0xffff, regs.a);
      m.step(0x2492, 19);

      regs.hl = (regs.hl + 1) & 0xffff; // record byte +3 stepped over, never read
      m.step(0x2493, 6);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x2494, 6);
      regs.a = mem.read8(regs.hl);
      m.step(0x2495, 7);
      mem.write8((regs.ix + 0x2a) & 0xffff, regs.a);
      m.step(0x2498, 19);

      regs.ix = (regs.ix + 1) & 0xffff; // 16-bit INC: no flags
      m.step(0x249a, 10);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x249b, 6);
      m.step(0x2478, 10);
      continue;
    }
    m.step(0x247d, 10);

    regs.a = regs.dec8(regs.a);
    m.step(0x247e, 4); // A is (type - 1) from here down

    if (regs.fZ) {
      // type 1 -> IY block
      m.step(0x249e, 10);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x249f, 6);
      regs.a = mem.read8(regs.hl);
      m.step(0x24a0, 7);
      mem.write8((regs.iy + 0x00) & 0xffff, regs.a);
      m.step(0x24a3, 19);

      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x24a4, 6);
      regs.a = mem.read8(regs.hl);
      m.step(0x24a5, 7);
      mem.write8((regs.iy + 0x15) & 0xffff, regs.a);
      m.step(0x24a8, 19);

      regs.hl = (regs.hl + 1) & 0xffff; // record byte +3 stepped over here too
      m.step(0x24a9, 6);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x24aa, 6);
      regs.a = mem.read8(regs.hl);
      m.step(0x24ab, 7);
      mem.write8((regs.iy + 0x2a) & 0xffff, regs.a);
      m.step(0x24ae, 19);

      regs.iy = (regs.iy + 1) & 0xffff; // 16-bit INC: no flags
      m.step(0x24b0, 10);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x24b1, 6);
      m.step(0x2478, 10);
      continue;
    }
    m.step(0x2481, 10);

    regs.cp(0xa9);
    m.step(0x2483, 7); // against the DECREMENTED A
    if (regs.fZ) {
      m.ret(11); // ret z -- 11 T-states, THE ONLY EXIT
      return;
    }
    m.step(0x2484, 5); // ret z not taken -- 5 T-states

    regs.addHl(regs.de);
    m.step(0x2485, 11);
    m.step(0x2478, 10);
  }
}
