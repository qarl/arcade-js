// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_08ba — hand-optimized rewrite of the translated routine at ROM 0x08BA,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0874, 0x309f, 0x0965, 0x08d5) is reached
 * through `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copied implementation. Only RAM *names* are imported (ram.js);
 * the two palette-bank latch bits are board control (0x7Dxx), not work RAM, so they
 * are local consts here exactly as handler_01c3 keeps FLIPSCREEN.
 */

import { ATTRACT, GAME_SUBSTATE } from "./ram.js";

// ls259.6h palette-bank bits: 0x7D86 = bit 0, 0x7D87 = bit 1 (memory.js decodes
// both to io.writePaletteBank(addr-0x7D86)). Board latches, not work RAM, so — like
// handler_01c3's FLIPSCREEN — they live here rather than in ram.js.
const PALETTE_BANK_0 = 0x7d86; // 0x7D87 (bit 1) is reached by inc l from here, not named separately

/**
 * loc_08ba -- game state 2 (credited), sub-state 0: build the board and step on.
 * [ROM 0x08BA-0x08D4, then FALLS THROUGH into loc_08d5 @ 0x08D5]
 *
 *   08ba  cd 74 08   call 0x0874    ; clear playfield + sprite buffer
 *   08bd  af         xor  a
 *   08be  32 07 60   ld   (ATTRACT),a    ; 0x6007 = 0 -- leave attract
 *   08c1  11 0c 03   ld   de,0x030c
 *   08c4  cd 9f 30   call 0x309f    ; enqueue task, payload DE = 0x030C
 *   08c7  21 0a 60   ld   hl,GAME_SUBSTATE
 *   08ca  34         inc  (hl)      ; 0x600A++ -- advance the sub-state selector
 *   08cb  cd 65 09   call 0x0965    ; sees the ALREADY-incremented 0x600A
 *   08ce  af         xor  a
 *   08cf  21 86 7d   ld   hl,0x7d86
 *   08d2  77         ld   (hl),a    ; palette-bank bit 0 = 0
 *   08d3  2c         inc  l
 *   08d4  77         ld   (hl),a    ; palette-bank bit 1 = 0  (0, NOT 1 -- cf. loc_0c92)
 *   -- falls through into loc_08d5 --
 *
 * WHAT IT DOES. The one-shot entry that stands up a board once a game is credited:
 * wipe the playfield and sprite buffer (0x0874), drop out of attract (ATTRACT=0),
 * queue one draw task (0x309F with DE=0x030C), advance the state-2 sub-state
 * selector (0x600A++, so the NEXT dispatch takes loc_08f8, the 0x08B6 table's arm
 * 1), enqueue the how-high task set (0x0965, which reads the just-incremented
 * 0x600A), and clear both palette-bank latch bits. It then FALLS THROUGH into
 * loc_08d5, whose `ret` returns for both.
 *
 * INPUTS: none in registers -- every callee's input is set here (DE for 0x309F).
 * Reads no work RAM of its own; 0x0874/0x309F/0x0965/0x08D5 read what they read.
 * OUTPUTS (RAM/latches written by THIS routine): ATTRACT(0x6007)=0,
 * GAME_SUBSTATE(0x600A) incremented, palette-bank latch bits 0x7D86/0x7D87 = 0;
 * plus everything the four callees write (playfield/sprite clear, task ring, and
 * loc_08d5's own effects). Registers/flags entering loc_08d5 are left byte-identical
 * to the oracle (same callee order, same xor/inc/incMem ops), which is what lets the
 * fall-through produce the same final register file.
 *
 * FLAGS. loc_08ba's own flag writers (two `xor a`, `inc (hl)`, `inc l`) are kept
 * verbatim, but none is CONSUMED: control falls into loc_08d5, which overwrites F
 * before it returns, and the value the caller reads is loc_08d5's `and b`
 * (A = mem[0x7D00] & B). The verbatim ops matter only so the whole register file
 * ENTERING loc_08d5 matches the oracle -- loc_08d5 leaves c/d/ix/iy/sp untouched, so
 * those must arrive identical, and the unit gate compares the full register file.
 *
 * LADDER STATUS -- idiomatic, cycles collapsed to one total per call-boundary.
 * loc_08ba is ATOMIC: it runs INSIDE the vblank NMI (dispatched by dispatchGameState
 * off GAME_STATE=2), and the NMI handler's first act clears the NMI mask (0x7D84),
 * so the vblank NMI cannot re-fire anywhere inside loc_08ba or its callees. Its
 * internal cycle DISTRIBUTION is therefore unobservable -- proven by the harness:
 * charging each run-between-calls as a single m.step total (17 / 44 / 38 / 32,
 * summing the oracle's per-instruction charges) stays EQUAL whole-machine over the
 * 30-frame window. The TOTAL is still load-bearing (like handler_01c3): a cheaper
 * NMI reaches the main-loop vblank spin sooner and reseeds the PRNG at SPIN_COUNT
 * (0x6019), so each run's total is preserved and the cumulative cycle count entering
 * every callee is unchanged -- keeping any downstream NMI landing (e.g. inside
 * loc_08d5's interruptible 0x05e9/0x0616 arm) identical.
 */
export function loc_08ba(m) {
  const { regs, mem } = m;

  // 0x08BA: call 0x0874 -- clear the playfield + sprite buffer (no register input).
  m.push16(0x08bd);
  m.step(0x0874, 17);
  m.call(0x0874);

  // 0x08BD xor a / 0x08BE ld (ATTRACT),a / 0x08C1 ld de,0x030C / 0x08C4 call 0x309F.
  // Leave attract, then enqueue the draw task with payload DE. run+call = 4+13+10+17.
  regs.xor(regs.a); // A = 0
  mem.write8(ATTRACT, regs.a); // 0x6007 = 0
  regs.de = 0x030c; // sub_309f task payload
  m.push16(0x08c7);
  m.step(0x309f, 44);
  m.call(0x309f);

  // 0x08C7 ld hl,GAME_SUBSTATE / 0x08CA inc (hl) / 0x08CB call 0x0965.
  // Advance the sub-state selector, then sub_0965 (reads the incremented 0x600A).
  // run+call = 10+11+17.
  regs.hl = GAME_SUBSTATE; // 0x600A
  regs.incMem8(mem, regs.hl); // inc (0x600A)
  m.push16(0x08ce);
  m.step(0x0965, 38);
  m.call(0x0965);

  // 0x08CE xor a / 0x08CF ld hl,0x7D86 / 0x08D2 ld (hl),a / 0x08D3 inc l / 0x08D4 ld (hl),a.
  // Clear both palette-bank latch bits, then fall through. run = 4+10+7+4+7 = 32.
  //
  // PARTIAL COLLAPSE across the two palette-bank HARDWARE writes (0x7D86/0x7D87 are
  // ls259.6h latches, in the emit.js --writes trace with a write-bus-cycle column =
  // clock()+7). Collapsing all 32t into one m.step would put BOTH writes at the same
  // (too-early) cycle -- the oracle records 0x7D86 at +7-past-a-14t-clock and 0x7D87
  // at +7-past-a-25t-clock. The RAM+regs gate can't see that column, so keep just
  // enough m.step granularity (14 / 11 / 7 = 32, total unchanged) that each write
  // lands at the oracle's exact bus cycle. Proven by the WRITE-TRACE test; same
  // partial-collapse pattern as loc_0a8a.
  regs.xor(regs.a); // A = 0
  regs.hl = PALETTE_BANK_0; // 0x7D86
  m.step(0x08d2, 14); // xor a (4) + ld hl,0x7d86 (10)
  mem.write8(regs.hl, regs.a, 7); // 0x7D86 = 0 (ld (hl),a -> write bus at +7)
  regs.l = regs.inc8(regs.l); // inc l -> 0x87 (8-bit, no carry into H)
  m.step(0x08d4, 11); // ld (hl),a (7) + inc l (4)
  mem.write8(regs.hl, regs.a, 7); // 0x7D87 = 0
  m.step(0x08d5, 7); // ld (hl),a

  // Fall through into loc_08d5 (0x08D5). It is a JUMP target, not a call, so there
  // is NO push16: loc_08d5's ret pops loc_08ba's own return address and returns for
  // both. Reached via m.call so it resolves to the oracle (or a future rewrite).
  return m.call(0x08d5);
}
