// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1344 — hand-optimized rewrite of the translated routine at ROM 0x1344,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x011C, 0x13CA, 0x309F, 0x1826) is reached
 * through `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copy. Only RAM *names* are imported (from ram.js).
 */

import {
  PLAY_INTRO,
  LIVES,
  P2_CONTEXT,
  P1_CONTEXT,
  P2_SCORE,
  GAME_SUBSTATE,
  SUBSTATE_TIMER,
} from "./ram.js";

/**
 * loc_1344 -- 0x0702 table idx15: decrement-lives / save-context state setup.
 * [ROM 0x1344-0x138E; entry 15 (0x0F) of loc_06fe's 0x0702 rst-0x28 table, reached
 * via dispatchGameState (the NMI game-state path) while GAME_STATE(0x6005)==3 and
 * GAME_SUBSTATE(0x600A)==0x0F. TWIN of loc_12f2 (idx14), same shape, different
 * constants — idx14 saves to P1_CONTEXT, idx15 to P2_CONTEXT.]
 *
 * WHAT IT DOES.
 *   1. call 0x011C (sub_011c) -- silence/reset the ls259 sound latches + shadows
 *      (a fixed prologue this state shares with the play-start states).
 *   2. Clear PLAY_INTRO(0x622C) to 0 (so the next board skips the Kong-climb intro).
 *   3. `dec (LIVES)` -- spend one life -- then read the decremented count into A.
 *   4. `ldir` the live 8-byte player context (LIVES..0x622F) into the P2 save slot
 *      (P2_CONTEXT..0x604F). HL stays at LIVES as the source, so the just-decremented
 *      count is the first byte copied.
 *   5. Branch on the decremented life count (A):
 *      - LIVES != 0  (branch 1): arm the NEXT substate. GAME_SUBSTATE(0x600A) :=
 *        0x17 when P1_CONTEXT[0](0x6040) != 0, else 0x08. (No further work.)
 *      - LIVES == 0  (branch 2): the out-of-lives path. Render P2's score (call
 *        0x13CA with A=3, HL=P2_SCORE), enqueue two tasks (0x0303, 0x0300 via
 *        sub_309f), run the fill helper (0x1826 over VRAM 0x76D3), then arm this
 *        state's own countdown: SUBSTATE_TIMER(0x6009) := 0xC0 and GAME_SUBSTATE
 *        (0x600A) := 0x11.
 *
 * INPUTS (RAM read): LIVES(0x6228) (decremented then tested); P1_CONTEXT[0](0x6040)
 *   (branch-1 arm selector); P2_SCORE(0x60B5) (branch-2, passed to 0x13CA). OUTPUTS
 *   (RAM written): PLAY_INTRO(0x622C):=0; LIVES(0x6228) decremented; the 8-byte
 *   P2_CONTEXT(0x6048..0x604F) copy; then either GAME_SUBSTATE(0x600A) alone
 *   (branch 1) or SUBSTATE_TIMER(0x6009)+GAME_SUBSTATE(0x600A) (branch 2). All
 *   callee-side writes (sub_011c's hardware sound latches, etc.) happen inside the
 *   oracle via m.call, unchanged.
 *
 * REGISTERS. Branch 1 ends A=C=the armed value (0x17/0x08), B=0, DE=0x6050,
 *   HL=0x6230 (the ldir's post-increment values, untouched afterward). Branch 2
 *   ends HL=0x600A; A/B/C/DE are whatever the last callee (0x1826) left, read by
 *   nothing downstream.
 *
 * FLAGS. The dispatch tail (rst 0x28) makes no `ret cc` and branches on no flag
 *   loc_1344 sets, but the unit gate compares F, so every flag-writer is kept
 *   verbatim. The final observable F is: branch 1 -> the `and a`(0x1385) test of
 *   P1_CONTEXT[0]; branch 2 -> whatever sub_1826 leaves (the ld/inc-hl epilogue
 *   touches no flags; `inc hl` is 16-bit and flag-transparent). The `and a`(0x1358)
 *   that picks the branch is computed for real (`regs.and(regs.a)`) so its transient
 *   flags match the oracle even though nothing survives to read them.
 *
 * ATOMIC — cycles collapsed to one charge per straight-line run, TOTAL preserved.
 *   loc_1344 runs INSIDE the vblank NMI (dispatchGameState), which clears the NMI
 *   mask and does not re-enter, so the NMI never lands inside loc_1344 OR any of its
 *   callees (sub_011c even runs on `m.tick`, i.e. no maintained PC, which is only
 *   safe BECAUSE nothing can interrupt it here). Its internal cycle DISTRIBUTION is
 *   therefore unobservable and the per-instruction m.step charges collapse: each
 *   run between real operations (the calls and the ldir) becomes ONE m.step whose
 *   count is the exact sum of the instructions it replaces, and the pre-call runs
 *   fold their trailing `call`'s 17t in (matching handler_05c6 / entry_0611 /
 *   loc_138f). The TOTAL stays load-bearing — as part of the NMI handler's cost it
 *   sets the main-loop spin count that seeds the PRNG (README §2, SPIN_COUNT) — so
 *   each branch's sum is preserved exactly; whole-machine EQUAL confirms it (a wrong
 *   total would diverge at 0x6019). Per-branch totals (incl. the identical callees'
 *   own charges are added on top by m.call): branch 1a 0x17-arm and branch 1b
 *   0x08-arm differ by the extra `ld c,0x08` (7t); branch 2 sums its five collapsed
 *   scaffold stretches. loc_1344 makes NO hardware (0x7Dxx) write of its own, so no
 *   write-bus-cycle trace is at stake (sub_011c's are inside the oracle via m.call).
 */
export function loc_1344(m) {
  const { regs, mem } = m;

  // 1. call 0x011C -- reset the ls259 sound latches + shadows (17t is the call).
  m.push16(0x1347);
  m.step(0x011c, 17);
  m.call(0x011c);

  // 2-4. xor a / ld (PLAY_INTRO),a / ld hl,LIVES / dec (hl) / ld a,(hl) /
  //      ld de,P2_CONTEXT / ld bc,8  --  collapsed 4+13+10+11+7+10+10 = 65t.
  mem.write8(PLAY_INTRO, 0); // xor a -> ld (0x622c),a : PLAY_INTRO = 0
  regs.hl = LIVES; // 0x6228
  regs.decMem8(mem, regs.hl); // dec (hl) -- spend a life
  regs.a = mem.read8(LIVES); // ld a,(hl) -- A = the decremented life count
  regs.de = P2_CONTEXT; // 0x6048
  regs.bc = 0x0008;
  m.step(0x1356, 65);
  m.ldir(0x1358); // copy 8 bytes LIVES..0x622F -> P2_CONTEXT..0x604F (HL src = LIVES)

  // and a -- test the decremented life count (its 4t is folded into the branch below).
  regs.and(regs.a);

  if (regs.fNZ) {
    // ---- BRANCH 1: lives remain. Arm the next substate. ----
    regs.c = 0x17; // ld c,0x17
    regs.a = mem.read8(P1_CONTEXT); // ld a,(0x6040) -- P1's saved life count
    regs.and(regs.a); // and a -- this test's flags are the routine's final F
    if (regs.fZ) {
      // P1_CONTEXT[0] == 0: jp nz not taken, ld c,0x08.
      regs.c = 0x08;
      // and a(4) + jp nz(10) + ld c,0x17(7) + ld a(13) + and a(4) + jp nz-nt(10) + ld c,0x08(7)
      m.step(0x138a, 4 + 10 + 7 + 13 + 4 + 10 + 7);
    } else {
      // P1_CONTEXT[0] != 0: keep C = 0x17.
      // and a(4) + jp nz(10) + ld c,0x17(7) + ld a(13) + and a(4) + jp nz taken(10)
      m.step(0x138a, 4 + 10 + 7 + 13 + 4 + 10);
    }
    regs.a = regs.c; // ld a,c
    mem.write8(GAME_SUBSTATE, regs.a); // ld (0x600a),a := 0x17 or 0x08
    m.step(0x138e, 4 + 13); // ld a,c(4) + ld (0x600a),a(13)
    m.ret();
    return;
  }

  // ---- BRANCH 2: out of lives. Render P2 score, enqueue tasks, arm substate 0x11. ----
  regs.a = 0x03; // ld a,0x03
  regs.hl = P2_SCORE; // ld hl,0x60b5
  m.push16(0x1364);
  // and a(4) + jp nz-not-taken(10) + ld a,0x03(7) + ld hl(10) + call(17) = 48t
  m.step(0x13ca, 4 + 10 + 7 + 10 + 17);
  m.call(0x13ca); // render P2's score into the display buffer

  regs.de = 0x0303;
  m.push16(0x136a);
  m.step(0x309f, 10 + 17); // ld de(10) + call(17)
  m.call(0x309f); // enqueue task 0x0303

  regs.de = 0x0300;
  m.push16(0x1370);
  m.step(0x309f, 10 + 17);
  m.call(0x309f); // enqueue task 0x0300

  regs.hl = 0x76d3;
  m.push16(0x1376);
  m.step(0x1826, 10 + 17); // ld hl(10) + call(17)
  m.call(0x1826); // fill helper over VRAM 0x76D3

  regs.hl = SUBSTATE_TIMER; // ld hl,0x6009
  mem.write8(SUBSTATE_TIMER, 0xc0); // ld (hl),0xc0 -- arm the countdown
  regs.hl = GAME_SUBSTATE; // inc hl -> 0x600a
  mem.write8(GAME_SUBSTATE, 0x11); // ld (hl),0x11 -- next substate
  m.step(0x137e, 10 + 10 + 6 + 10); // ld hl(10) + ld(hl),0xc0(10) + inc hl(6) + ld(hl),0x11(10)
  m.ret();
}
