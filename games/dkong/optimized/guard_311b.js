// SPDX-License-Identifier: GPL-3.0-only
/**
 * guard_311b — hand-optimized rewrite of the translated routine at ROM 0x311b,
 * proven equal to its oracle (translated/state0.js) by the equivalence harness.
 *
 * One routine per file. It has NO callee — it is a pure leaf — so this file
 * imports no code; every observable output is computed inline. The one RAM
 * address it reads, 0x601A, IS evidenced in ram.js as FRAME (the vblank frame
 * counter, ROM 0x00B5), so it is imported and used by name (README §4).
 */

import { FRAME } from "./ram.js";

/**
 * guard_311b -- one of the four 0x3110 rst-0x28 GUARD-FAMILY members (0x3110 /
 * 0x311b / 0x3126 / 0x3131), reached from sub_30fa's inline dispatch table.
 * [ROM 0x311b-0x3125, 11 bytes, 7 instructions]
 *
 *   311b  3a 1a 60   ld  a,(0x601a)   ; A = FRAME (vblank frame counter)
 *   311e  e6 07      and 0x07         ; keep the low 3 bits (0..7)
 *   3120  fe 05      cp  0x05         ; sign of (A - 5): set M when A < 5
 *   3122  f8         ret m            ; (FRAME & 7) < 5 -> return NORMALLY to caller
 *   3123  33         inc sp           ; else discard our own return address...
 *   3124  33         inc sp           ; ...(two inc sp = pop it without using it)
 *   3125  c9         ret              ; ...and return to the caller's CALLER
 *
 * WHAT IT DOES. A one-way GUARD on the low 3 bits of FRAME (0x601A). It masks
 * FRAME to 0..7 and asks "is it < 5?". When YES (values 0-4 -- five frames in
 * every eight) it returns normally, handing control back to whoever called it.
 * When NO (values 5,6,7 -- three frames in eight) it performs the CALLER-SKIP
 * idiom: two `inc sp` discard its own return address so the final `ret` pops the
 * NEXT frame instead, landing in the caller's CALLER -- the caller (entry_30ed) is
 * skipped entirely and must not run its own body.
 *
 * WHERE IT SITS -- a LIVE, DIFFICULTY-selected frame-rate gate. The reach chain is
 * real and fully translated: the attract-demo / gameplay cascade loc_197a
 * (dispatched inside the vblank NMI as game-state 3's 0x0702-table handler) calls
 * entry_30ed, which calls sub_30fa, which reads DIFFICULTY (0x6380), clamps it to
 * [0,5], and rst-0x28 dispatches the guard-family table
 * [3110,3110,311b,3126,3126,3131]. index 2 -- DIFFICULTY == 2 -- selects THIS
 * member. The four members are progressively-permissive frame gates: guard_3110
 * (bit0, ~1/2) at low difficulty, guard_311b ((&7)<5 = 5/8), guard_3126 ((&3)<3 =
 * 3/4), guard_3131 ((&7)<7 = 7/8) at the top -- the higher the difficulty, the more
 * often the guarded caller runs. In pure attract DIFFICULTY is 1 (-> guard_3110), so
 * the whole-machine gate holds 0x6380 = 2 across the attract-demo window (Karl's
 * sanctioned identical-both-sides poke), which dispatches guard_311b live 56x with
 * BOTH branches occurring naturally as FRAME cycles 0..7 (equivalence-311b.test.js).
 *
 * The translation models the caller-skip as a BOOLEAN return (settled convention,
 * sub_0008 / mainloop.js): true  = the caller was returned to normally, so it
 * continues; false = the caller was skipped and must `return` immediately. So this
 * returns true when (FRAME & 7) < 5 and false when it is 5, 6, or 7. entry_30ed
 * consumes it as `if (!m.call(0x30fa)) return;` (sub_30fa tail-passes it through).
 *
 * THE POLARITY TRAP (documented at the family in translated/state0.js). This
 * member is `and 0x07 / cp 0x05 / ret m` (SIGN). Its siblings differ in mask,
 * compare, AND condition: 0x3126 is `and 0x03 / cp 0x03`, 0x3131 is `and 0x07 /
 * cp 0x07`, and 0x3110 alone uses `ret z` (EQUALITY) on `and 0x01 / cp 0x01`. At
 * FRAME & 7 == 5 or 6 THIS member skips while its `cp 0x07` sibling (0x3131) still
 * returns normally -- copying any sibling onto another is silently wrong, and the
 * write-gate cannot see it (this routine writes NO RAM). So the equivalence teeth
 * here compare the boolean, SP, PC and F -- see the exhaustive v-sweep branch test.
 *
 * INPUTS:  FRAME (0x601A, RAM, read). OUTPUTS: A = FRAME & 7; F = flags from
 * `cp 0x05`; SP += 2 on the skip branch (its own return popped). It writes NO RAM
 * and NO hardware register (no 0x7Dxx latch) -- so the hardware-write / write-
 * trace caveat does not apply and there is no bus-cycle to pin.
 *
 * FLAGS. A and F are both live observable outputs (the unit gate compares the
 * whole register file, F included), so `and 0x07` / `cp 0x05` are kept verbatim:
 * they leave A = (FRAME & 7) and the exact F the oracle leaves (including the
 * undocumented F3/F5/H/PV/N bits `cp` sets). The `ret m` condition is taken
 * straight off that F via `regs.fM`. The boolean return is the value entry_30ed
 * branches on. Nothing is dropped as dead because the gate would catch it.
 *
 * ATOMIC + CYCLES -- collapsed to one total per branch. guard_311b is ATOMIC by
 * construction: it is a PURE LEAF (it makes no `m.call`, so there is no
 * interruptible downstream), and its only live entry is sub_30fa's dispatch on the
 * NMI path (dispatchGameState), where the vblank NMI is masked -- so no NMI can
 * ever land inside it and push a divergent PC into diffed stack RAM (the exact
 * hazard that keeps an interruptible routine like handler_05e9 per-instruction).
 * With no mid-routine NMI possible, the internal cycle DISTRIBUTION is
 * unobservable, so each branch's per-instruction charges collapse to a single
 * total (README §2):
 *   normal-return: 13+7+7+11              = 38 t   (charged on m.ret)
 *   caller-skip:   13+7+7+5+6+6+10        = 54 t   (charged on the final m.ret)
 * The TOTAL is still preserved exactly -- as part of the NMI's cost it feeds the
 * main-loop vblank-spin count (README §2, SPIN_COUNT). Because guard_311b IS
 * reachable (DIFFICULTY==2 dispatches it live across the attract demo), the
 * collapse is proven BOTH whole-machine (the poke-driven EQUAL run exercises both
 * branches 56x and would surface a wrong total at SPIN_COUNT) AND in the
 * synthesised per-branch cycle teeth (equivalence-311b.test.js).
 */
export function guard_311b(m) {
  const { regs, mem } = m;

  // ld a,(0x601a) / and 0x07 -- mask FRAME's low 3 bits into A (0..7).
  regs.a = mem.read8(FRAME);
  regs.and(0x07);
  // cp 0x05 -- set the sign flag (M) when (FRAME & 7) < 5; 5/6/7 clear it.
  regs.cp(0x05);

  if (regs.fM) {
    // ret m taken: (FRAME & 7) < 5 -- return NORMALLY to the caller.
    // path total 13+7+7+11 = 38 t, charged once on the ret.
    m.ret(38);
    return true;
  }

  // ret m not taken: (FRAME & 7) >= 5 -- CALLER-SKIP. `inc sp / inc sp` discard
  // our own return address so the ret lands in the caller's caller. path total
  // 13+7+7+5+6+6+10 = 54 t, charged once on the final ret.
  regs.sp = (regs.sp + 2) & 0xffff;
  m.ret(54);
  return false;
}
