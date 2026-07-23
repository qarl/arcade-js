// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0986 — hand-optimized rewrite of the translated routine at ROM 0x0986,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0852, 0x011c) is reached through
 * `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copied implementation. Only RAM *names* are imported (ram.js).
 */

import { GAME_SUBSTATE, DIP_UPRIGHT } from "./ram.js";

// Flip-screen control latch (ls259.6h bit 2). A board HARDWARE register, not work
// RAM, so it lives in the dkong board rather than ram.js (as in handler_01c3).
const FLIPSCREEN = 0x7d82;

// The 16-bit "join value" loc_08f8 stored at game-start: 0 for a 1-player start,
// 0x0100 for a 2-player start (loc_08f8 names the byte JOIN_VALUE; NOT evidenced
// in ram.js, so it stays hex). loc_0986 reads its LOW byte to branch.
const JOIN_VALUE_LO = 0x600e;

/**
 * loc_0986 -- BOARD-SETUP PROLOGUE: clear the screen + sound, set flip-screen for
 * the cabinet, and advance the sub-state.  [ROM 0x0986-0x09AA; the 0x0702 table's
 * arm 0, reached via dispatchGameState when GAME_STATE(0x6005)==3 (in game) and
 * GAME_SUBSTATE(0x600A)==0 — the first NMI after loc_08f8 commits a game start.]
 *
 * WHAT IT DOES.
 *   1. call 0x0852 -- blank the tilemap (fill VRAM 0x7400-0x77FF with tile 0x10,
 *      then zero 0x6900-0x69BF).
 *   2. call 0x011c -- clear the eight sound latches + the audio IRQ / 3d latch.
 *   3. Turn the flip-screen latch ON (0x7D82 = 1).
 *   4. Read the low byte of loc_08f8's join value at 0x600E:
 *        == 0  (a 1-player start): GAME_SUBSTATE = 1 and RETURN, leaving flip on.
 *        != 0  (a 2-player start): consult DIP_UPRIGHT and set GAME_SUBSTATE = 3:
 *                DIP_UPRIGHT == 1 (upright cabinet)  -> keep flip ON.
 *                DIP_UPRIGHT != 1 (cocktail)         -> flip OFF (0x7D82 = 0), so
 *                                                       player 2 sees the mirror.
 *
 * INPUTS: 0x600E (join-value low byte, from loc_08f8); DIP_UPRIGHT(0x6026).
 * OUTPUTS: the tilemap + sound latches (via the two callees), FLIPSCREEN(0x7D82),
 *   GAME_SUBSTATE(0x600A) := 1 or 3. 0x7D82 is a hardware latch OUTSIDE the compared
 *   state dump; GAME_SUBSTATE and every callee write land in it.
 *
 * FLAGS: nothing downstream consumes loc_0986's flags — the caller (loc_06fe's
 *   rst-0x28 dispatch) makes no `ret cc` and branches on no flag it sets. But the
 *   unit gate compares F, so the flag-writing idioms are replicated verbatim: the
 *   `and a` selector test, the `dec a` cabinet test, and the cocktail `xor a`.
 *   On every branch the last flag-writer is faithful, so F matches the oracle
 *   exactly (branch A ends with and-a flags on A=0; the 3-arms end with dec-a or
 *   xor-a flags on A=0). A/DE/HL also match: DE stays 0x7D82, HL stays 0x600A.
 *
 * ATOMIC — cycles collapsed, TOTAL preserved. loc_0986 runs INSIDE the vblank NMI
 * (dispatchGameState), and the NMI does not re-enter, so no NMI ever lands inside it
 * OR its callees: a boot+coin+start probe dispatched it once (the 1-player-start
 * frame, own cost 37339 cycles — mostly the sub_0852 VRAM clear) with nmiInside == 0.
 * So its internal cycle DISTRIBUTION is unobservable to the RAM+regs gate and the
 * straight-line tail collapses. The two leading CALLs keep their own 17t (so the
 * callee-start cumulative matches the oracle exactly; 0x0852/0x011c charge their own
 * bodies). The per-branch TOTAL is still load-bearing — as part of the NMI's total it
 * sets the main-loop spin count (README §2, SPIN_COUNT) — so each branch preserves
 * its exact sum: branch A (join==0) = 115, upright (2P, DIP==1) = 142, cocktail (2P,
 * DIP!=1) = 153. Whole-machine EQUAL confirms branch A's total; the synthesised
 * branch tests assert the two unreached arms' totals (142/153) directly.
 *
 * THE COLLAPSE IS ONLY PARTIAL AROUND THE 0x7D82 WRITES, deliberately (as in the
 * sibling loc_0a8a): 0x7D82 (flip-screen) is a HARDWARE write, recorded in the emit
 * --writes trace at clock()+busOffset (write #1 @ +37282t on every branch; the
 * cocktail arm's write #2 @ +37357t, exactly 75t later). The equivalence gate can't
 * see that trace (0x7D8x is not in the state dump), so collapsing across a 0x7D82
 * write would silently shift its bus-cycle column. To prevent that, the 17t before
 * write #1 (ld de / ld a) and the 75t between the two cocktail writes are charged
 * per-instruction BEFORE their write; only the untraced work-RAM tail collapses. The
 * bus cycles are pinned by the WRITE-TRACE test in equivalence-0986.test.js.
 */
export function loc_0986(m) {
  const { regs, mem } = m;

  // call 0x0852 -- blank the tilemap. 17t (the CALL itself); the fill charges its own.
  m.push16(0x0989);
  m.step(0x0852, 17);
  m.call(0x0852);

  // call 0x011c -- clear the sound latches. 17t; the clear loop charges its own.
  m.push16(0x098c);
  m.step(0x011c, 17);
  m.call(0x011c);

  // ld de,FLIPSCREEN / ld a,1 -- charge these two (17t) BEFORE the write, so the
  // 0x7D82 hardware write lands at the oracle's EXACT bus cycle. 0x7D82 IS a hardware
  // write (recorded in the emit --writes trace at clock()+busOffset), so collapsing
  // the 17t ACROSS it would shift that column -- invisible to the RAM+regs gate but a
  // real recordable divergence. Kept per-instruction here for that reason; proven by
  // the WRITE-TRACE test (see the block comment). busOffset 7 matches the oracle's.
  regs.de = FLIPSCREEN; // 0x7d82
  regs.a = 0x01;
  m.step(0x0991, 17); // ld de,0x7d82 (10) + ld a,0x01 (7)
  mem.write8(regs.de, regs.a, 7); // WRITE #1: flip-screen ON, at CALLEE_TOTAL+17

  // ld hl,GAME_SUBSTATE / ld a,(0x600e) / and a -- Z iff the join-value low byte is 0.
  regs.hl = GAME_SUBSTATE; // 0x600a
  regs.a = mem.read8(JOIN_VALUE_LO); // 0x600e
  regs.and(regs.a);

  if (regs.fZ) {
    // 1-player start: GAME_SUBSTATE = 1, leaving flip-screen ON. Return. No second
    // hardware write, so the whole post-write tail collapses to one charge.
    mem.write8(regs.hl, 0x01); // ld (hl),0x01 -- work RAM, untraced, position free
    // ld(de),a(7)+ld hl(10)+ld a,(600e)(13)+and a(4)+jp nz not-taken(10)+ld (hl),1(10)
    //   = 54t, then ret(10). Total 17+17 (calls) + 17+54+10 = 115.
    m.step(0x099e, 54);
    m.ret(10);
    return;
  }

  // 2-player start: ld a,(DIP_UPRIGHT) / dec a -- Z iff the cabinet is upright (==1).
  regs.a = mem.read8(DIP_UPRIGHT); // 0x6026
  regs.a = regs.dec8(regs.a);
  if (regs.fZ) {
    // Upright cabinet: keep flip-screen ON; GAME_SUBSTATE = 3. No second hardware
    // write, so the post-write tail collapses to one charge.
    mem.write8(regs.hl, 0x03); // ld (hl),0x03 -- work RAM, untraced
    // ld(de),a(7)+ld hl(10)+ld a,(600e)(13)+and a(4)+jp nz taken(10)+ld a,(6026)(13)
    //   +dec a(4)+jp z taken(10)+ld (hl),3(10) = 81t, then ret(10). Total 17+17+17+81+10 = 142.
    m.step(0x09aa, 81);
    m.ret(10);
    return;
  }

  // Cocktail cabinet: clear the flip-screen latch (DE is still 0x7D82), then
  // GAME_SUBSTATE = 3. A SECOND 0x7D82 hardware write -- charge the 75t between the
  // two writes BEFORE it, so it lands exactly 75t after the first (oracle spacing).
  regs.xor(regs.a); // A = 0
  // ld(de),a(7)+ld hl(10)+ld a,(600e)(13)+and a(4)+jp nz taken(10)+ld a,(6026)(13)
  //   +dec a(4)+jp z not-taken(10)+xor a(4) = 75t.
  m.step(0x09a7, 75);
  mem.write8(regs.de, regs.a, 7); // WRITE #2: flip-screen OFF, at CALLEE_TOTAL+17+75
  mem.write8(regs.hl, 0x03); // ld (hl),0x03 -- work RAM, untraced
  // ld(de),a(7)+ld (hl),3(10) = 17t, then ret(10). Total 17+17+17+75+17+10 = 153.
  m.step(0x09aa, 17);
  m.ret(10);
}
