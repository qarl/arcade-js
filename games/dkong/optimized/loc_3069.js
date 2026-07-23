// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3069 — hand-optimized rewrite of the translated routine at ROM 0x3069,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0018, the rst-0x18 skip helper) is reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so it resolves to
 * the oracle — or a future optimized rewrite — never a copy. No RAM names are imported:
 * the only address this routine names directly is the unnamed pointer cell 0x63C0
 * (ram.js names neither it nor its runtime target, so it stays hex, per README §4).
 */

/**
 * loc_3069 -- shared "advance every Nth frame" rate-limiter. [ROM 0x3069-0x306E,
 * 4 instructions; dispatched via dispatchGameState as BOTH idx3 and idx5 of loc_0a76's
 * 0x0A7A rst-0x28 table, while GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)==3 or
 * ==5 -- the Kong-climb intro's two paced step-advances.]
 *
 *   3069  df           rst  0x18          ; sub_0018: dec (0x6009); skip body unless it hit 0
 *   306a  2a c0 63     ld   hl,(0x63c0)   ; INDIRECT: HL = the WORD stored AT 0x63C0
 *   306d  34           inc  (hl)          ; bump the byte that word points at
 *   306e  c9           ret
 *
 * WHAT IT DOES. A prescaled counter-bump. `rst 0x18` (sub_0018) decrements the
 * countdown at 0x6009; while that is still counting it splices this routine's body out
 * (see BRANCHES); only when it EXPIRES does the body run and `inc (hl)` bump the byte
 * POINTED AT by 0x63C0. `ld hl,(nn)` (opcode 0x2A) is the INDIRECT load -- HL becomes
 * the WORD STORED at 0x63C0, not the address 0x63C0 itself; the pointer cell is never
 * written, only its target. In the observed intro the pointer holds 0x6385, so an
 * expiry advances INTRO_STEP (3->4, 5->6) once per 0x6009-full frames, pacing the
 * cutscene. `ld hl,(nn)` has 10 precedents in the ROM -- not a novel form.
 *
 * INPUTS: 0x6009 (read+decremented via sub_0018), the pointer word at 0x63C0, and the
 *   byte it targets. OUTPUTS: 0x6009 (decremented, by sub_0018) and, on the EXPIRY path
 *   only, the target byte (+1). The target is ALWAYS work RAM (0x6385 observed every
 *   dispatch; 0x6388 when repointed by 0x17B6) -- NEVER a 0x7Dxx latch -- so loc_3069
 *   makes NO hardware write and needs no write-trace test (verified: the 0x63C0 pointer
 *   is a work-RAM cell on every dispatch). HL ends 0x6009 on the skip path (sub_0018's
 *   side effect) or the pointer word on the expiry path; both match the oracle, which
 *   the unit gate confirms (it diffs the whole register file, HL included).
 *
 * BRANCHES (both reached naturally by the coin+start whole-machine run):
 *   - SKIP (0x6009 still counting, sub_0018 -> false): return TRUE at once. The body is
 *     cut short but the CALLER continues -- sub_0018's `inc sp/inc sp/ret` discards the
 *     rst's own return (which pointed mid-loc_3069) and rets to loc_3069's return
 *     address, exactly where our `ret` would have gone. So loc_3069 NEVER skips its
 *     caller; it returns TRUE on BOTH paths (never FALSE) so a stray
 *     `if (!m.call(0x3069)) return;` stays inert rather than a live defect. (~62/64
 *     dispatches; counter 2..32 at entry.)
 *   - EXPIRY (0x6009 hit 0, sub_0018 -> true): indirect-load the pointer, `inc (hl)`
 *     the target with correct RMW flags, ret normally. (~2/64 dispatches; counter==1.)
 *
 * rst 0x18 POLARITY (do not read it as rst 08/10): sub_0018 is `dec (0x6009) / ret z /
 *   inc sp / inc sp / ret`, so the body RUNS WHEN THE COUNTER EXPIRES (reaches 0) and is
 *   SKIPPED while it is still counting down. Reading it the other way inverts the routine.
 *
 * REGISTER CONTRACT: sub_0018 sets HL = 0x6009 as a side effect. Harmless because 0x306A
 *   overwrites HL on the expiry path -- but the `m.call(0x0018)` is a real side effect,
 *   not a pure predicate, so the rst is kept verbatim (not "simplified" to a boolean).
 *
 * FLAGS. loc_3069 returns TRUE on both paths and no caller does a `ret cc` on, or a
 *   branch after, a flag it sets. But the unit gate compares the whole register file
 *   (F + HL + pc), so every flag writer is kept verbatim: sub_0018's `dec (0x6009)` sets
 *   F on the skip path; `inc (hl)` sets F on the expiry path -- both via the SAME
 *   primitives the oracle uses, so F matches exactly.
 *
 * ATOMIC -- expiry-path body cycles collapsed, TOTAL preserved. loc_3069 runs INSIDE the
 *   vblank NMI (dispatchGameState), which does not re-enter, and its only callee sub_0018
 *   is a non-interruptible leaf -- so the NMI never lands inside loc_3069 and its internal
 *   cycle DISTRIBUTION is unobservable. The expiry path's two body charges (ld hl,(nn) 16
 *   + inc (hl) 11) collapse to one 27t m.step; the rst charge (11t) stays separate
 *   because it PRECEDES the m.call, and the ret keeps its 10t. Per-branch totals: skip
 *   11t, expiry 11+27+10 = 48t (both loc_3069-proper, i.e. excluding sub_0018's own
 *   identical charges). The total is still load-bearing (loc_3069's cost is part of the
 *   NMI's, which sets the main-loop spin count -- README §2), so each branch's sum is
 *   preserved exactly; whole-machine EQUAL confirms it. (Same lesson as loc_0a8a /
 *   entry_0611: internal distribution free, total observable.)
 */
export function loc_3069(m) {
  const { regs, mem } = m;

  // rst 0x18 -- sub_0018 decrements 0x6009; false = still counting (skip the body).
  m.push16(0x306a);
  m.step(0x0018, 11); // rst 0x18
  if (!m.call(0x0018)) return true; // body cut short; caller continues (never skips it)

  // Expiry path: 0x6009 hit 0. HL = the WORD at 0x63C0 (indirect), then bump (hl).
  regs.hl = mem.read16(0x63c0); // INDIRECT -- the word AT 0x63C0, not 0x63C0
  regs.incMem8(mem, regs.hl); // inc (hl) -- flag-correct RMW; target is work RAM
  m.step(0x306d, 27); // ld hl,(0x63c0) 16 + inc (hl) 11 -- collapsed (atomic)

  m.ret(); // ret (0x306E) -- 10t; pops loc_3069's return
  return true;
}
