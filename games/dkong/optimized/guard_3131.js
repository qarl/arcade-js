// SPDX-License-Identifier: GPL-3.0-only
/**
 * guard_3131 — hand-optimized rewrite of the translated routine at ROM 0x3131,
 * proven equal to its oracle (translated/state0.js) by the equivalence harness.
 *
 * One routine per file. It has NO callee — it is a pure leaf — so this file
 * imports no code; every observable output is computed inline. The one RAM
 * address it reads, 0x601A, IS evidenced in ram.js as FRAME (the vblank frame
 * counter, ROM 0x00B5), so it is imported and used by name (README §4).
 */

import { FRAME } from "./ram.js";

/**
 * guard_3131 -- one of the four 0x3110 rst-0x28 GUARD-FAMILY members (0x3110 /
 * 0x311b / 0x3126 / 0x3131), reached from sub_30fa's inline dispatch table.
 * [ROM 0x3131-0x313B, 11 bytes, 7 instructions]
 *
 *   3131  3a 1a 60   ld  a,(0x601a)   ; A = FRAME (vblank frame counter)
 *   3134  e6 07      and 0x07         ; keep the low 3 bits (0..7)
 *   3136  fe 07      cp  0x07         ; sign of (A - 7): set M when A < 7
 *   3138  f8         ret m            ; (FRAME & 7) < 7 -> return NORMALLY to caller
 *   3139  33         inc sp           ; else discard our own return address...
 *   313a  33         inc sp           ; ...(two inc sp = pop it without using it)
 *   313b  c9         ret              ; ...and return to the caller's CALLER
 *
 * WHAT IT DOES. A one-way GUARD on the low 3 bits of FRAME (0x601A). It masks
 * FRAME to 0..7 and asks "is it < 7?". When YES (values 0-6 -- seven frames in
 * every eight) it returns normally, handing control back to whoever called it.
 * When NO (the value is exactly 7 -- one frame in eight) it performs the
 * CALLER-SKIP idiom: two `inc sp` discard its own return address so the final
 * `ret` pops the NEXT frame instead, landing in the caller's CALLER -- the caller
 * (entry_30ed) is skipped entirely and must not run its own body.
 *
 * WHERE IT SITS -- IT IS LIVE. This is one of four frame-rate gates selected by
 * DIFFICULTY (0x6380) through sub_30fa's clamp+dispatch. The reach is real and
 * translated: the gameplay/attract cascade loc_197a (dispatched in the vblank NMI)
 * calls entry_30ed -> sub_30fa, which reads DIFFICULTY, clamps it to [0,5], and
 * rst-0x28 dispatches the guard-family table [3110,3110,311b,3126,3126,3131].
 * guard_3110 (bit0, ~1/2 of frames) runs at low difficulty, guard_311b ((&7)<5),
 * guard_3126 ((&3)<3 = 3/4) at DIFFICULTY 3-4, and guard_3131 ((&7)<7 = 7/8) at
 * DIFFICULTY 5 -- so the higher the difficulty, the more often the guarded caller
 * runs. In pure attract DIFFICULTY is 1, so an identical-both-sides poke holding
 * 0x6380 = 5 dispatches guard_3131 live 56x across the attract-demo window (both
 * branches firing as FRAME cycles 0..7). guard_3131 itself reads only FRAME; the
 * DIFFICULTY selection happens one level up in sub_30fa.
 *
 * The translation models the caller-skip as a BOOLEAN return (settled convention,
 * sub_0008 / mainloop.js): true  = the caller was returned to normally, so it
 * continues; false = the caller was skipped and must `return` immediately. So
 * this returns true when (FRAME & 7) < 7 and false when it == 7. entry_30ed
 * consumes it as `if (!m.call(0x30fa)) return;` (sub_30fa tail-passes it through).
 *
 * THE POLARITY TRAP (documented at the family in translated/state0.js). This
 * member is `and 0x07 / cp 0x07 / ret m` (SIGN). Its siblings differ in mask,
 * compare, AND condition -- 0x3110 alone uses `ret z` (EQUALITY). At FRAME == 7
 * ONLY 0x3110 returns normally; the other three (this one included) skip. Copying
 * any sibling's mask or compare onto this one is silently wrong and the write-gate
 * cannot see it (this routine writes NO RAM), so the equivalence teeth here compare
 * the boolean, SP, PC and F -- see the exhaustive v=0..15 branch test.
 *
 * INPUTS:  FRAME (0x601A, RAM, read). OUTPUTS: A = FRAME & 7; F = flags from
 * `cp 0x07`; SP += 2 on the skip branch (its own return popped). It writes NO RAM
 * and NO hardware register (no 0x7Dxx latch) -- so the hardware-write / write-
 * trace caveat does not apply and there is no bus-cycle to pin.
 *
 * FLAGS. A and F are both live observable outputs (the unit gate compares the
 * whole register file, F included), so `and 0x07` / `cp 0x07` are kept verbatim:
 * they leave A = (FRAME & 7) and the exact F the oracle leaves. The boolean return
 * is the value entry_30ed branches on. Nothing is dropped as dead because the gate
 * would catch it.
 *
 * ATOMIC + CYCLES -- collapsed to one total per branch. guard_3131 is ATOMIC by
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
 * main-loop vblank-spin count (README §2, SPIN_COUNT). Because guard_3131 IS
 * reachable from boot (DIFFICULTY=5 selects it; forcing 0x6380=5 across the attract
 * demo dispatches it live 56x), the collapse is proven BOTH whole-machine (the
 * poke-driven EQUAL run exercises both branches and would surface a wrong total at
 * SPIN_COUNT) AND in the synthesised per-branch cycle teeth (equivalence-3131.test.js).
 */
export function guard_3131(m) {
  const { regs, mem } = m;

  // ld a,(0x601a) / and 0x07 -- mask FRAME's low 3 bits into A (0..7).
  regs.a = mem.read8(FRAME);
  regs.and(0x07);
  // cp 0x07 -- set the sign flag (M) when (FRAME & 7) < 7; equal (7) clears it.
  regs.cp(0x07);

  if (regs.fM) {
    // ret m taken: (FRAME & 7) < 7 -- return NORMALLY to the caller.
    // path total 13+7+7+11 = 38 t, charged once on the ret.
    m.ret(38);
    return true;
  }

  // ret m not taken: (FRAME & 7) == 7 -- CALLER-SKIP. `inc sp / inc sp` discard
  // our own return address so the ret lands in the caller's caller. path total
  // 13+7+7+5+6+6+10 = 54 t, charged once on the final ret.
  regs.sp = (regs.sp + 2) & 0xffff;
  m.ret(54);
  return false;
}
