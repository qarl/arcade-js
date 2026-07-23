// SPDX-License-Identifier: GPL-3.0-only
/**
 * guard_3110 — hand-optimized rewrite of the translated routine at ROM 0x3110,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It has NO callee (a pure read-compare-return leaf), so
 * nothing here is reached through `m.call`; only the RAM name FRAME is imported
 * (from ram.js). The calling convention (`m.ret` pops the return the dispatcher
 * pushed) is preserved exactly.
 */

import { FRAME } from "./ram.js";

/**
 * guard_3110 -- rst-0x28 dispatch guard: gate the caller on frame-counter parity.
 * [ROM 0x3110-0x311A]
 *
 *   3110  3a 1a 60   ld  a,(0x601A)   ; A = FRAME (the vblank frame counter)
 *   3113  e6 01      and 0x01         ; isolate bit 0 (frame parity)
 *   3115  fe 01      cp  0x01         ; Z set iff bit 0 was SET
 *   3117  c8         ret z            ; bit 0 SET -> return NORMALLY (skip = continue)
 *   3118  33         inc sp           ; bit 0 CLEAR -> discard OUR return address...
 *   3119  33         inc sp
 *   311a  c9         ret              ; ...so this ret lands in the CALLER'S CALLER
 *
 * WHAT IT DOES. The first of four sibling rst-0x28 guards (0x3110/311b/3126/3131)
 * reached from sub_30fa's difficulty-indexed dispatch table (base 0x3104), itself
 * called by entry_30ed (0x30ED, guarded `if (!m.call(0x30fa)) return;`). guard_3110
 * reads FRAME (0x601A, decremented once per vblank NMI) and tests bit 0 -- the
 * frame's parity. It returns a SKIP BOOLEAN under the settled sub_0008 convention
 * (mainloop.js): true = the caller resumes normally; false = the caller (and, one
 * `rst 0x28` layer up, sub_30fa's caller entry_30ed) is spliced past and must
 * `return` at once. So entry_30ed's tail runs only on ODD frames -- a 1-in-2 pacer.
 *
 * THE POLARITY TRAP (oracle header): 0x3110 uses `ret z` (EQUALITY, bit 0 == 1);
 * its three siblings use `ret m` (SIGN, `(FRAME & mask) < n`). They are one opcode
 * apart (0xC8 vs 0xF8) and MEAN different things -- copying a sibling's condition
 * onto this one is silently wrong and the write-gate (RAM only) cannot see it, so
 * the `cp 0x01 / ret z` is kept verbatim and the unit gate compares the full
 * register file. The teeth test flips exactly this (`ret m`) and it is CAUGHT.
 *
 * INPUTS: FRAME (0x601A). OUTPUTS: none to RAM -- this routine writes NO memory. It
 * changes only registers: A (= FRAME & 1), F (the `and`/`cp` result), SP (+2 on the
 * normal ret, +4 on the splice), and PC (the popped return). RETURN: boolean skip
 * flag (true = normal, false = spliced).
 *
 * FLAGS. The caller consumes the RETURN VALUE, not F -- but the unit gate compares
 * A and F, and `and 0x01` / `cp 0x01` set them exactly as the oracle, so they are
 * kept verbatim (A ends 0 or 1; F is the cp result). SP is load-bearing: it IS the
 * mechanism (the two `inc sp` are the caller-skip), so it is reproduced exactly.
 *
 * ATOMIC -- cycles collapsed to one total per branch, TOTAL preserved (normal 38 t,
 * splice 54 t). Unlike its stale oracle header ("not yet wired into the live
 * dispatcher"), guard_3110 IS live-dispatched: the entry_30ed -> sub_30fa -> sub_0028
 * -> m.call(0x3110) chain runs in plain attract (measured: 916 dispatches over 1500
 * attract frames, first at frame 586; both branches occur naturally as FRAME parity
 * alternates -- 458 normal / 458 splice). It makes NO call to an interruptible
 * routine (no `m.call` at all), so the vblank NMI never lands inside its 4-6
 * instructions and its internal cycle DISTRIBUTION is free. Harness-proven: charging
 * each branch's per-instruction tstate SUM in a single charge stays EQUAL
 * whole-machine over 1000 frames. The TOTAL stays load-bearing (it sets the main-loop
 * spin count, README §2 / SPIN_COUNT): a wrong total diverges at 0x6019, which the
 * per-branch cycle-total teeth also assert.
 */
export function guard_3110(m) {
  const { regs, mem } = m;

  // ld a,(FRAME) / and 0x01 / cp 0x01 -- isolate frame-counter bit 0; Z set iff SET.
  regs.a = mem.read8(FRAME);
  regs.and(0x01);
  regs.cp(0x01);

  if (regs.fZ) {
    // ret z taken -- bit 0 SET: return NORMALLY (caller resumes). total 13+7+7+11 = 38 t.
    m.ret(38);
    return true;
  }

  // ret z NOT taken -- bit 0 CLEAR: inc sp / inc sp discards our own return address so
  // the ret unwinds to the caller's CALLER (the splice). total 13+7+7+5+6+6+10 = 54 t.
  m.step(0x311a, 44); // ld+and+cp (27) + ret-z-not-taken (5) + inc sp (6) + inc sp (6)
  regs.sp = (regs.sp + 2) & 0xffff; // the two `inc sp`
  m.ret(10);
  return false;
}
