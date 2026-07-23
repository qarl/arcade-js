// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0a63 — hand-optimized rewrite of the translated routine at ROM 0x0A63,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Both callees (the `rst 0x18` skip helper sub_0018 at
 * 0x0018 and the playfield/sprite clear sub_0874 at 0x0874) are reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so each resolves to
 * the oracle — or to that callee's own optimized rewrite once one exists — never
 * a copied implementation. Only RAM *names* are imported (from ram.js).
 */

import { SUBSTATE_TIMER, GAME_SUBSTATE, PLAY_INTRO } from "./ram.js";

/**
 * loc_0a63 -- in-game (GAME_STATE==3) sub-state 6: the timed gate that decides
 * INTRO vs HOW-HIGH before a board starts.  [ROM 0x0A63-0x0A75]
 *
 *   0a63  df           rst  0x18          ; sub_0018: dec SUBSTATE_TIMER, skip unless it hit 0
 *   0a64  cd 74 08     call 0x0874        ; clear playfield tilemap + sprite buffer
 *   0a67  21 09 60     ld   hl,SUBSTATE_TIMER  ; 0x6009
 *   0a6a  36 01        ld   (hl),0x01     ; re-arm the sub-state countdown to 1
 *   0a6c  2c           inc  l             ; HL = GAME_SUBSTATE (0x600A)
 *   0a6d  34           inc  (hl)          ; 0x600A += 1   (-> sub-state 7)
 *   0a6e  11 2c 62     ld   de,PLAY_INTRO ; 0x622C
 *   0a71  1a           ld   a,(de)        ; A = PLAY_INTRO
 *   0a72  a7           and  a             ; Z iff PLAY_INTRO == 0
 *   0a73  c0           ret  nz            ; play-intro set -> stay at +1 (sub-state 7, cutscene)
 *   0a74  34           inc  (hl)          ; 0x600A += 1 again (-> sub-state 8, how-high)
 *   0a75  c9           ret
 *
 * WHAT IT DOES. Sub-state 6 is a one-frame-armed WAIT gate reached from loc_06fe's
 * 0x0702 table (index 6). The `rst 0x18` decrements SUBSTATE_TIMER (0x6009); while
 * it is still counting, sub_0018 discards this routine's remainder and returns to
 * loc_06fe's caller — nothing happens this frame. The frame it underflows to 0,
 * control falls through and the routine: wipes the playfield tilemap + sprite
 * buffer (sub_0874), re-arms SUBSTATE_TIMER to 1 for the next sub-state, and
 * advances GAME_SUBSTATE (0x600A) from 6 to 7. It then reads PLAY_INTRO (0x622C):
 * NON-ZERO leaves the selector at 7 (the opening Kong-climb cutscene); ZERO bumps
 * it once more to 8 (the "HOW HIGH CAN YOU GET?" interlude), which is why a board
 * begun after a death — both death handlers zero 0x622C — skips the cutscene.
 *
 * INPUTS.  RAM: SUBSTATE_TIMER (0x6009, via sub_0018), PLAY_INTRO (0x622C).
 *   Registers on entry: none consumed (dispatched via jp (hl) from sub_0028).
 * OUTPUTS. RAM written by THIS routine: SUBSTATE_TIMER (0x6009) = 1, GAME_SUBSTATE
 *   (0x600A) incremented by 1 or 2; plus everything sub_0874 clears (the 28-wide
 *   playfield from 0x7404, the two columns at 0x7522/0x7523, and the 384-byte
 *   sprite buffer 0x6900-0x6A7F) and sub_0018's `dec (0x6009)`. Registers on exit:
 *   A = PLAY_INTRO, HL = 0x600A, DE = 0x622C, SP balanced by the calls' ret.
 *
 * BRANCHES (three, all given committed teeth by the test):
 *   A. gate still counting (SUBSTATE_TIMER > 1) — sub_0018 returns false, this
 *      routine returns immediately having done nothing but the `dec`.
 *   B. gate expired, PLAY_INTRO != 0 — advance +1 (sub-state 7, intro). ret nz.
 *   C. gate expired, PLAY_INTRO == 0 — advance +2 (sub-state 8, how-high). ret.
 * The natural coin+start run reaches ONLY B (first board: SUBSTATE_TIMER already 1
 * on entry, PLAY_INTRO == 1); A and C are synthesised in the test.
 *
 * FLAGS. The flag-affecting ops (inc l, inc (hl), and a) are kept verbatim so F on
 * exit matches the oracle: branch B ends on `and a`'s NZ, branch C on the second
 * `inc (hl)`. `ret nz` is an early return, NOT a boolean-returning `ret cc`, so no
 * value is modelled — F is kept only because the unit gate compares the whole
 * register file (F included). `inc l`'s flags are dead (overwritten by the next
 * `inc (hl)`); it is kept anyway so HL and the register file stay byte-identical.
 *
 * LADDER STATUS — idiomatic, cycles collapsed to one total per branch.
 * loc_0a63 is ATOMIC: it runs INSIDE the vblank NMI (dispatched by dispatchGameState
 * off GAME_STATE==3, then loc_06fe's 0x0702 sub-state table), and the NMI handler's
 * first act clears the NMI mask (0x7D84), so the vblank NMI cannot re-fire anywhere
 * inside loc_0a63 or its callees — measured: nmiMask == 0 at every dispatch. Its
 * internal cycle DISTRIBUTION is therefore unobservable, so the trailing straight-
 * line block (0x0A67-0x0A75) is charged as ONE m.step per branch: branch B = 56 (the
 * seven ops 0x0A67-0x0A72) + 11 (ret nz taken) = 67 t; branch C = 56 + 5 (ret nz not
 * taken) + 11 (inc (hl)) = 72, then 10 (ret) = 82 t. The two call-instruction charges
 * (rst 0x18 = 11 t, call 0x0874 = 17 t) stay before their `m.call` as the calling
 * convention, exactly as loc_08ba keeps a per-call-boundary charge. The TOTAL is still
 * load-bearing (like handler_01c3 / loc_08ba): a cheaper NMI reaches the main-loop
 * vblank spin sooner and reseeds the PRNG at SPIN_COUNT (0x6019), so each branch's
 * total is preserved exactly and the cumulative cycle count entering every callee is
 * unchanged. Harness-proven EQUAL whole-machine over the 40-frame window (branch B),
 * with A and C's collapsed totals asserted against the oracle in the branch test.
 */
export function loc_0a63(m) {
  const { regs, mem } = m;

  // 0x0A63 rst 0x18 -- sub_0018 decrements SUBSTATE_TIMER (0x6009) and, UNLESS it
  // underflowed to 0, discards this routine's remainder and returns to loc_06fe's
  // caller (the skip). false => still counting: do nothing this frame.
  m.push16(0x0a64); // rst 0x18 pushes its return address
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return; // branch A: gate still counting

  // 0x0A64 call 0x0874 -- clear the playfield tilemap + sprite buffer (no reg input).
  m.push16(0x0a67);
  m.step(0x0874, 17);
  m.call(0x0874);

  // 0x0A67 ld hl,0x6009 / 0x0A6A ld (hl),0x01 / 0x0A6C inc l / 0x0A6D inc (hl) /
  // 0x0A6E ld de,0x622c / 0x0A71 ld a,(de) / 0x0A72 and a.
  // Re-arm the sub-state timer to 1, step GAME_SUBSTATE 6 -> 7, then test PLAY_INTRO.
  regs.hl = SUBSTATE_TIMER; // 0x6009
  mem.write8(regs.hl, 0x01); // re-arm the countdown to 1 (absolute)
  regs.l = regs.inc8(regs.l); // inc l -> HL = GAME_SUBSTATE (0x600A); flags dead
  regs.incMem8(mem, regs.hl); // inc (0x600A) -- advance the selector by 1
  regs.de = PLAY_INTRO; // 0x622C
  regs.a = mem.read8(regs.de); // A = PLAY_INTRO
  regs.and(regs.a); // Z iff PLAY_INTRO == 0

  if (regs.fNZ) {
    // 0x0A73 ret nz taken -- branch B: play the intro, leave sub-state at 7.
    // collapsed trailing total: 10+10+4+11+10+7+4 = 56, then ret nz 11 = 67 t.
    m.step(0x0a73, 56);
    m.ret(11);
    return;
  }

  // 0x0A73 ret nz NOT taken (5) / 0x0A74 inc (hl) (11) -- branch C: skip the intro,
  // advance the selector once more to 8 (how-high), then 0x0A75 ret (10).
  regs.incMem8(mem, regs.hl); // inc (0x600A) again -- advance by 2 total
  // collapsed trailing total: 56 + 5 (ret nz not taken) + 11 (inc (hl)) = 72 t.
  m.step(0x0a75, 72);
  m.ret(10);
}
