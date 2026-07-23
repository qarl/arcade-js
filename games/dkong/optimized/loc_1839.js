// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1839 — hand-optimized rewrite of the translated routine at ROM 0x1839,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x004e, 0x0038) is reached through
 * `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to its own optimized rewrite once one exists —
 * never a copy. Only the RAM name SUBSTATE_TIMER is imported (from ram.js);
 * 0x6390 / 0x6388 / 0x6908 stay hex (ram.js leaves them deliberately unnamed —
 * engine/animation scratch, no evidence to name).
 */

import { SUBSTATE_TIMER } from "./ram.js";

/**
 * loc_1839 -- 0x1644 idx 2: rate-limited animation stepper (every-8th tick;
 * wrap-path full re-setup).  [ROM 0x1839-0x186E]
 *
 * Reached during BOARD-ADVANCE (GAME_SUBSTATE 0x600A == 0x16): loc_1615 routes
 * on BOARD (0x6227) to sub_1641, whose rst-0x28 dispatch on the 0x6388 sequence
 * selector (table 0x1648) lands here at index 2. Runs once per NMI while that
 * sequence step is active.
 *
 *   183c  21 90 63   ld  hl,0x6390    ; HL -> private animation frame counter
 *   183d  34         inc (hl)         ; bump it; Z set iff it wrapped 0xFF->0x00
 *   183e  ca 59 18   jp  z,0x1859     ; wrap -> full re-setup arm
 *   1841  7e         ld  a,(hl)       ; else A = counter
 *   1842  e6 07      and 0x07
 *   1844  c0         ret nz           ; act only every 8th tick
 *   1845  11 cf 39   ld  de,0x39cf    ; 8th tick: default animation-table source
 *   1848  cb 5e      bit 3,(hl)       ; bit 3 of counter selects the table
 *   184a  20 02      jr  nz,0x184e    ; bit set -> keep 0x39CF
 *   184c  11 f7 39   ld  de,0x39f7    ; bit clear -> 0x39F7
 *   184f  eb         ex  de,hl        ; HL = table ptr, DE = 0x6390
 *   1850  cd 4e 00   call 0x004e      ; copy 0x28 bytes -> 0x6908
 *   1853  21 08 69   ld  hl,0x6908
 *   1856  0e 44      ld  c,0x44
 *   1858  ff         rst 0x38         ; second copy stage (stride 4, 10 rows)
 *   1859  ...        (wrap arm)       ; ld hl,0x385c / call 0x004e / ld hl,0x6908
 *                                     ; / ld c,0x44 / rst 0x38 / ld a,0x20
 *                                     ; / ld (0x6009),a / ld hl,0x6388 / inc (hl)
 *   186e  c9         ret
 *
 * WHAT IT DOES. Every frame the step is active it increments a private 8-bit
 * animation counter at 0x6390. Three outcomes:
 *   • WRAP (counter 0xFF->0x00, ~1 in 256): re-arm the whole step -- copy the
 *     0x385C source table -> 0x6908 (sub_004e), run the rst-0x38 second copy
 *     stage, arm SUBSTATE_TIMER (0x6009) = 0x20, and advance the 0x6388 sequence
 *     selector (inc) so the next sequence arm takes over.
 *   • NON-8th tick (7 frames of 8): do nothing but the increment -- `ret nz`.
 *   • 8th tick: pick the animation source table by bit 3 of the counter
 *     (bit set -> 0x39CF, clear -> 0x39F7), copy it -> 0x6908 (sub_004e), then
 *     the rst-0x38 second copy stage. No counter/selector change.
 *
 * INPUTS: (0x6390) counter, BOARD sequence context. OUTPUTS: (0x6390) bumped
 * every call; on the 8th tick and on wrap the 0x6908 tile block is refreshed
 * from a ROM table (via the callees); on wrap additionally (0x6009)=0x20 and
 * (0x6388) advanced. Callees 0x004e/0x0038 do the actual block copies and are
 * invoked verbatim through m.call, so their writes (0x6908.. region) are the
 * oracle's.
 *
 * FLAGS. Every path ends in a plain `ret` (never `ret cc`), so no flag is a
 * return value; but the unit gate compares the whole register file incl. F, so
 * F is left exactly as the oracle leaves it. That falls out of replicating the
 * SAME flag-affecting ops in order: `inc (hl)` (incMem8) sets Z for the wrap
 * test; `and 0x07` sets Z for the ret-nz test AND is the final F on that branch;
 * `bit 3,(hl)` sets Z for the table select; and on the wrap / 8th-tick paths the
 * final F is whatever the last callee (0x0038 arm) leaves -- identical both sides
 * because it is the same routine reached via m.call. Registers left: wrap A=0x20
 * HL=0x6388 C=0x44; ret-nz A=(counter&7) HL=0x6390; 8th-tick C=0x44 plus
 * callee-set A/HL/DE/B -- all matched by doing the same assignments in the same
 * order around the same m.call's.
 *
 * LADDER STATUS -- rung 5 (idiomatic), cycles collapsed per straight-line
 * SEGMENT to a single m.step. loc_1839 is ATOMIC in the sense that matters: it
 * runs entirely INSIDE the vblank NMI (which is entered with the mask cleared
 * and is not re-entrant), and no frame boundary lands inside a single NMI (the
 * handler costs a few thousand of the frame's 50688 t), so nothing samples this
 * routine's cycles mid-flight -- only the NMI's TOTAL cost is observable (it sets
 * the main-loop spin count = PRNG entropy, README §2). The distribution is thus
 * free, and the collapse is done at the safest granularity: each run of
 * instructions between call boundaries folds into ONE m.step charging that
 * segment's exact t-state sum, so the cumulative cycle count AT EVERY m.call is
 * byte-identical to the oracle (belt-and-braces: even the callees see the
 * oracle's exact clock). Per-branch OWN totals (sum of the oracle's per-
 * instruction charges, callee internals excluded), all preserved exactly:
 *   wrap        = 58 + [0x004e] + 28 + [0x0038] + 41 + 10(ret) = 137 t
 *   ret-nz      = 45 + 11(ret nz)                              =  56 t
 *   8th, 0x39F7 = 110 + [0x004e] + 28 + [0x0038] + 10(ret)     = 148 t
 *   8th, 0x39CF = 105 + [0x004e] + 28 + [0x0038] + 10(ret)     = 143 t
 * Verified EQUAL whole-machine AND unit with the collapse in place (equivalence-
 * 1839.test.js); the per-branch cycle-total teeth prove each collapsed total
 * equals the oracle's, so a wrong lump total has teeth on every arm.
 */
export function loc_1839(m) {
  const { regs, mem } = m;

  // ld hl,0x6390 / inc (hl) -- bump the private animation counter; Z on wrap.
  regs.hl = 0x6390;
  regs.incMem8(mem, regs.hl);

  if (regs.fZ) {
    // -- WRAP PATH (0xFF -> 0x00): full step re-setup, then advance the selector.
    // seg1: jp z / ld hl,0x385c / call 0x004e   (10+11+10+10+17 = 58 t)
    regs.hl = 0x385c;
    m.push16(0x185f);
    m.step(0x004e, 58);
    m.call(0x004e); // copy 0x28 bytes (0x385C table) -> 0x6908

    // seg2: ld hl,0x6908 / ld c,0x44 / rst 0x38   (10+7+11 = 28 t)
    regs.hl = 0x6908;
    regs.c = 0x44;
    m.push16(0x1865);
    m.step(0x0038, 28);
    m.call(0x0038); // rst-0x38 second copy stage (stride 4, 10 rows)

    // seg3: ld a,0x20 / ld (SUBSTATE_TIMER),a / ld hl,0x6388 / inc (hl)  (7+13+10+11 = 41 t)
    regs.a = 0x20;
    mem.write8(SUBSTATE_TIMER, regs.a); // arm the sub-state countdown
    regs.hl = 0x6388;
    regs.incMem8(mem, regs.hl); // advance the 0x6388 sequence selector
    m.step(0x186e, 41);
    m.ret(); // 10 t -- wrap own total 137
    return;
  }

  // -- NON-WRAP: ld a,(hl) / and 0x07 -- rate-limit to every 8th tick.
  regs.a = mem.read8(0x6390);
  regs.and(0x07);
  if (regs.fNZ) {
    // ret nz -- not the 8th tick. prologue+ld a+and = 10+11+10+7+7 = 45 t, then ret nz 11.
    m.step(0x1843, 45);
    m.ret(11); // ret-nz own total 56
    return;
  }

  // -- 8th tick: select the ROM animation-source table by bit 3 of the counter.
  regs.de = 0x39cf; // default
  regs.bit(3, mem.read8(0x6390)); // bit 3,(hl) -- Z iff bit clear
  let ownToCall;
  if (regs.fZ) {
    regs.de = 0x39f7; // jr nz not taken (bit clear)
    ownToCall = 110; // entry..call 0x004e, bit-clear arm
  } else {
    ownToCall = 105; // jr nz taken (bit set) -- keep 0x39CF
  }
  regs.exDeHl(); // ex de,hl -- HL = table ptr, DE = 0x6390

  m.push16(0x1852);
  m.step(0x004e, ownToCall);
  m.call(0x004e); // copy 0x28 bytes (selected table) -> 0x6908

  // ld hl,0x6908 / ld c,0x44 / rst 0x38   (10+7+11 = 28 t)
  regs.hl = 0x6908;
  regs.c = 0x44;
  m.push16(0x1858);
  m.step(0x0038, 28);
  m.call(0x0038); // rst-0x38 second copy stage

  m.ret(); // 10 t -- 8th-tick own total 148 (0x39F7) / 143 (0x39CF)
}
