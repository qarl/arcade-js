// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_08f8 — hand-optimized rewrite of the translated routine at ROM 0x08F8,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x08d5, 0x0977, 0x0874, 0x309f) is reached
 * through `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copied implementation. Only RAM *names* are imported (ram.js).
 */

import { GAME_STATE, GAME_SUBSTATE, P1_CONTEXT, P2_CONTEXT, DIP_LIVES } from "./ram.js";

// The 16-bit "join value" the start-arm hands to the shared tail: written to
// 0x600E/0x600F (not evidenced in ram.js, so it stays hex). 0 for a 1-player
// start (arm A=0x04), 0x0100 for a 2-player start (arm A=0x08).
const JOIN_VALUE = 0x600e;

/**
 * loc_08f8 -- COMMIT A GAME START: game state 2 (credited), sub-state 1.
 * [ROM 0x08F8-0x095D; arm 1 of loc_08b2's 0x08B6 table, reached when
 *  GAME_STATE(0x6005)==2 and GAME_SUBSTATE(0x600A)==1.]
 *
 * WHAT IT DOES. It first calls loc_08d5, whose RETURN VALUE in A is which start
 * button the player pressed: loc_08d5 computes A = IN2(0x7D00) & B, with B masking
 * in START1 (bit 2 = 0x04) and, unless exactly one credit is held, START2 (bit 3 =
 * 0x08). loc_08f8 then dispatches on that value:
 *
 *   A == 0x04  START1 / 1-PLAYER (loc_0906): zero the 8-byte P2_CONTEXT (0x6048),
 *              join value HL = 0x0000, then the shared tail.
 *   A == 0x08  START2 / 2-PLAYER (loc_0919): seed P2_CONTEXT from DIP_LIVES + a
 *              7-byte ROM template (0x095E), join value HL = 0x0100, then the tail.
 *   else       A == 0x00 (no start yet) or 0x0C (both buttons): do NOTHING and
 *              return -- which is why this routine re-runs every frame from the
 *              credit until a single start button is seen.
 *
 * THE SHARED TAIL (loc_0938) always runs for the two start arms: store the arm's
 * join value to 0x600E, clear the playfield (0x0874), seed P1_CONTEXT (0x6040)
 * from DIP_LIVES + the same 7-byte template, enqueue task 0x0100 (0x309f), then
 * END the sub-state machine -- GAME_SUBSTATE(0x600A) = 0 and GAME_STATE(0x6005) = 3
 * (advance into gameplay). The 1P arm zeroes P2's saved context; the 2P arm seeds
 * it; the tail always seeds P1's.
 *
 * INPUTS: A returned by loc_08d5 (the start selector); DIP_LIVES(0x6020); the
 *   7-byte ROM template at 0x095E. OUTPUTS: P2_CONTEXT (zeroed or seeded),
 *   P1_CONTEXT (seeded), 0x600E/F (join value), the task ring (via 0x309f), the
 *   playfield tilemap (via 0x0874), GAME_SUBSTATE=0, GAME_STATE=3. On the else
 *   arm NOTHING is written. The two ldir blocks differ only in destination
 *   (P2_CONTEXT+1/DE=0x0101 vs P1_CONTEXT+1/DE=0x0100), byte-exact vs ROM.
 *
 * FLAGS: nothing downstream consumes loc_08f8's flags -- the caller (loc_08b2's
 *   rst-0x28 dispatch) makes no `ret cc` and branches on no flag it sets. But the
 *   unit gate compares F, so the register churn is replicated verbatim: the `cp`
 *   pair that selects the branch, the loop's `inc l`/`djnz`, and the tail's final
 *   `xor a`. On every arm the last flag-writer is faithful, so F matches the
 *   oracle exactly. A/B/HL/DE also match: the else arm leaves A = loc_08d5's value
 *   with cp-0x08 flags; the start arms end A = 0x03 with xor-a flags.
 *
 * ATOMIC — cycles collapsed to one per-branch total. loc_08f8 runs INSIDE the
 * vblank NMI (dispatchGameState), and the NMI does not re-enter, so no NMI ever
 * lands inside it OR its callees: a boot+coin+start probe dispatched it 59x
 * (frames 93-151, including the 36717-cycle 1P-start frame) with nmiInside == 0
 * every time. So its internal cycle DISTRIBUTION is unobservable and the per-
 * instruction m.step charges collapse to ONE per straight-line segment (each
 * folds the following CALL's 17t; ldir/callees keep charging themselves). The
 * per-branch TOTAL is still load-bearing -- as part of the NMI's total it sets the
 * main-loop spin count (README §2, SPIN_COUNT) -- so each branch preserves its
 * exact sum: else = 61, 1P (A=4) = 582, 2P (A=8) = 621. Whole-machine EQUAL
 * confirms the totals; a wrong one would diverge at SPIN_COUNT 0x6019.
 */
export function loc_08f8(m) {
  const { regs, mem } = m;

  // call loc_08d5 -> A = the start selector (IN2 & B). 17t (the CALL itself).
  m.push16(0x08fb);
  m.step(0x08d5, 17);
  m.call(0x08d5);

  regs.cp(0x04);
  if (regs.fZ) {
    // ---- A == 0x04: 1-PLAYER start (loc_0906) ----
    // cp04(7) + jp z taken(10) + call-0977(17) = 34t.
    m.push16(0x0909);
    m.step(0x0977, 34);
    m.call(0x0977); // BCD-decrement CREDITS(0x6001) then enqueue task 0x0400

    // Zero the 8-byte P2_CONTEXT (0x6048..0x604F). A stays 0 throughout.
    regs.hl = P2_CONTEXT;
    regs.b = 0x08;
    regs.xor(regs.a); // A = 0
    do {
      mem.write8(regs.hl, regs.a);
      regs.l = regs.inc8(regs.l); // inc l -- 8-bit, H unchanged
      regs.djnz();
    } while (regs.b !== 0);

    regs.hl = 0x0000; // join value for the 1P arm
    // ld hl(10) + ld b(7) + xor a(4) + loop(187) + ld hl,0(10) + jp 0938(10) = 228t.
    m.step(0x0938, 228);
  } else {
    regs.cp(0x08);
    if (!regs.fZ) {
      // ---- A == 0x00 / 0x0C: no start selected -- do NOTHING ----
      // cp04(7) + jp z not-taken(10) + cp08(7) + jp z not-taken(10) = 34t, then ret(10).
      m.step(0x0905, 34);
      m.ret(10);
      return;
    }

    // ---- A == 0x08: 2-PLAYER start (loc_0919) ----
    // cp04(7)+jp z not(10)+cp08(7)+jp z taken(10)+call-0977(17) = 51t.
    m.push16(0x091c);
    m.step(0x0977, 51);
    m.call(0x0977); // first BCD-decrement + enqueue
    m.push16(0x091f);
    m.step(0x0977, 17); // 17t (the second CALL) -- not a duplicate
    m.call(0x0977); // second BCD-decrement + enqueue

    // Seed P2_CONTEXT: byte 0 = DIP_LIVES, bytes 1..7 = ROM template (0x095E).
    regs.de = P2_CONTEXT; // 0x6048
    regs.a = mem.read8(DIP_LIVES); // 0x6020
    mem.write8(regs.de, regs.a);
    regs.e = regs.inc8(regs.e); // -> 0x6049
    regs.hl = 0x095e; // ROM template source (live data, read here + in the tail)
    regs.bc = 0x0007;
    // ld de(10)+ld a(13)+ld(de),a(7)+inc e(4)+ld hl(10)+ld bc(10) = 54t (pre-ldir).
    m.step(0x092f, 54);
    m.ldir(0x092f); // copies 7 bytes -> 0x6049..0x604F; charges its own 142t

    regs.de = 0x0101; // task arg for this arm (tail uses 0x0100)
    m.push16(0x0935);
    m.step(0x309f, 27); // ld de(10) + call-309f(17) = 27t
    m.call(0x309f); // enqueue task 0x0101

    regs.hl = 0x0100; // join value for the 2P arm
    m.step(0x0938, 10); // ld hl,0x0100 = 10t; falls into the shared tail
  }

  // ---- SHARED TAIL (loc_0938): HL carries the arm's join value ----
  mem.write16(JOIN_VALUE, regs.hl); // ld (0x600E),hl -- writes 0x600E and 0x600F
  m.push16(0x093e);
  m.step(0x0874, 33); // ld(nn),hl(16) + call-0874(17) = 33t
  m.call(0x0874); // clear the playfield

  // Seed P1_CONTEXT: byte 0 = DIP_LIVES, bytes 1..7 = ROM template (0x095E).
  regs.de = P1_CONTEXT; // 0x6040 -- NOT 0x6048
  regs.a = mem.read8(DIP_LIVES);
  mem.write8(regs.de, regs.a);
  regs.e = regs.inc8(regs.e); // -> 0x6041
  regs.hl = 0x095e;
  regs.bc = 0x0007;
  // ld de(10)+ld a(13)+ld(de),a(7)+inc e(4)+ld hl(10)+ld bc(10) = 54t (pre-ldir).
  m.step(0x094e, 54);
  m.ldir(0x094e); // copies 7 bytes -> 0x6041..0x6047; charges its own 142t

  regs.de = 0x0100; // task arg -- NOT 0x0101
  m.push16(0x0954);
  m.step(0x309f, 27); // ld de(10) + call-309f(17) = 27t
  m.call(0x309f); // enqueue task 0x0100

  // End the sub-state machine: reset this dispatcher's selector, advance state.
  regs.xor(regs.a); // A = 0
  mem.write8(GAME_SUBSTATE, regs.a); // 0x600A = 0
  regs.a = 0x03;
  mem.write8(GAME_STATE, regs.a); // 0x6005 = 3 -- ADVANCE INTO GAMEPLAY
  // xor a(4) + ld(600a),a(13) + ld a,3(7) + ld(6005),a(13) = 37t, then ret(10).
  m.step(0x095d, 37);
  m.ret(10);
}
