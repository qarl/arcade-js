// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0977 — hand-optimized rewrite of the translated routine at ROM 0x0977,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x309f, the task enqueue) is reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle or to a future optimized rewrite — never a copy. Only
 * the RAM name CREDITS is imported (from ram.js).
 */

import { CREDITS } from "./ram.js";

/**
 * sub_0977 -- consume one credit, then enqueue task 0x0400.  [ROM 0x0977-0x0985]
 *
 *   0977  21 01 60   ld   hl,0x6001     ; HL = &CREDITS
 *   097a  3e 99      ld   a,0x99
 *   097c  86         add  a,(hl)        ; A = 0x99 + CREDITS  (sets H/C for daa)
 *   097d  27         daa                ; -> BCD (CREDITS - 1)
 *   097e  77         ld   (hl),a        ; CREDITS = BCD (CREDITS - 1)
 *   097f  11 00 04   ld   de,0x0400     ; task opcode 0x04, argument 0x00
 *   0982  cd 9f 30   call 0x309f        ; enqueue [D,E] on the task ring
 *   0985  c9         ret
 *
 * WHAT IT DOES. A start button has been accepted, so one credit is spent: the
 * routine BCD-decrements CREDITS (0x6001) and enqueues task 0x0400. The decrement
 * is the classic Z80 "add 0x99 then daa" idiom -- 0x99 is the ten's-complement of
 * 1 in packed BCD, so `A = 0x99 + CREDITS` followed by `daa` yields BCD(CREDITS-1),
 * wrapping 0x00 -> 0x99. The `add`/`daa` are kept verbatim (via regs.add/regs.daa)
 * so the stored byte AND the intermediate flags match the oracle exactly for every
 * input, canonical BCD or not -- the unit gate compares the whole register file, F
 * included. (Nothing downstream reads those flags: sub_309f overwrites F before the
 * routine returns, and the caller loc_08f8 loads a register right after the call,
 * consuming no flag. So the flags are matched for the gate, not for a reader.)
 *
 * INPUTS:  CREDITS (0x6001).
 * OUTPUTS: CREDITS := BCD(CREDITS-1); a task [0x04,0x00] appended to the ring by
 *          sub_309f (which may silently drop it if the ring is full). A = the
 *          stored byte; F = whatever sub_309f leaves.
 *
 * HL IS A LIVE OUTPUT -- do NOT drop the `ld hl,0x6001`. Although CREDITS could be
 * read/written by name, the oracle leaves HL = 0x6001, and that value is observed
 * twice: H is a register the unit gate compares, and sub_309f does `push hl` on
 * entry / `pop hl` on exit, so HL's bytes land in the diffed Z80 stack. Setting HL
 * = CREDITS and dereferencing through it is what keeps both identical. (The gate
 * caught exactly this when HL was skipped: H diverged 0x60 vs 0x08 and stack 0x6BEA
 * differed.)
 *
 * CALL PATH / ATOMICITY. sub_0977's ONLY caller is loc_08f8 (ROM 0x08F8, the
 * game-state-2 start-select machine): the 1-player arm (loc_0906) calls it once,
 * the 2-player arm (loc_0919) calls it twice. loc_08f8 is reached ONLY through the
 * top-level game-state dispatch at ROM 0x00CA (state 2 -> loc_08b2 table[1]), which
 * runs INSIDE the vblank NMI with the mask already cleared. So on its single call
 * path the NMI cannot re-enter, and the NMI handler never spans a frame boundary --
 * no state dump is ever sampled mid-routine. sub_0977 is therefore ATOMIC.
 *
 * LADDER STATUS -- idiomatic, cycles collapsed to ONE per-branch total. There is
 * only one branch (fully straight-line, no data-dependent control flow). Being
 * atomic, its per-instruction m.step charges collapse to a single total: the six
 * leading instructions (10+7+7+4+7+10 = 45t) plus the CALL (17t) fold into one
 * m.step(0x309f, 62), leaving the ret (10t) charged by m.ret() -- 72t total,
 * preserved exactly. sub_309f begins at the same cumulative cycle (45+17 = 62)
 * either way. The TOTAL is still load-bearing (it feeds the main-loop vblank-spin
 * count that seeds the PRNG, README §2), only the DISTRIBUTION is free; the harness
 * confirms the collapse stays EQUAL whole-machine AND unit. No 0x7Dxx hardware
 * write occurs here or in sub_309f, so there is no bus-cycle-position to preserve.
 */
export function sub_0977(m) {
  const { regs, mem } = m;

  // Spend one credit: CREDITS = BCD(CREDITS - 1), wrapping 0x00 -> 0x99.
  // HL = &CREDITS is load-bearing (see header): it is the routine's H output and
  // sub_309f pushes it onto the diffed stack.
  regs.hl = CREDITS; // ld hl,0x6001
  regs.a = 0x99;
  regs.add(mem.read8(regs.hl)); // add a,(hl) -- sets H/C that daa consumes
  regs.daa(); // -> BCD (CREDITS - 1)
  mem.write8(regs.hl, regs.a); // ld (hl),a

  // Enqueue task 0x0400 (opcode 0x04, arg 0x00) via the ring enqueuer.
  regs.de = 0x0400;
  m.push16(0x0985); // balanced call: sub_309f's ret pops this
  m.step(0x309f, 62); // ROM 0x0977..0x0982 (45t) + the CALL (17t)
  m.call(0x309f);
  m.ret(); // ret @0x0985 (10t)
}
