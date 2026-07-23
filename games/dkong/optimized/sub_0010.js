// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0010 — hand-optimized rewrite of the translated routine at ROM 0x0010,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It has NO callee (a pure read-rotate-return leaf), so
 * nothing here is reached through `m.call`; only the RAM name MARIO_ACTIVE is
 * imported (from ram.js). The calling convention is preserved exactly: `m.ret`
 * pops the return address the caller's `rst 0x10` pushed, and on the skip branch
 * the two `inc sp` discard it first so the `ret` lands one frame higher.
 */

import { MARIO_ACTIVE } from "./ram.js";

/**
 * sub_0010 -- the `rst 0x10` player-alive skip gate. [ROM 0x0010-0x0017]
 *
 *   0010  3a 00 62   ld  a,(0x6200)   ; A = MARIO_ACTIVE
 *   0013  0f         rrca             ; bit 0 -> carry
 *   0014  d8         ret c            ; bit 0 SET -> return NORMALLY (caller resumes)
 *   0015  33         inc sp           ; bit 0 CLEAR -> discard OUR return address...
 *   0016  33         inc sp
 *   0017  c9         ret              ; ...so this ret lands in the CALLER'S CALLER
 *
 * WHAT IT DOES. The `rst 0x10` vector helper: a one-byte call every player-context
 * routine uses to gate itself on whether Mario is alive. It reads MARIO_ACTIVE
 * (0x6200, 1 = alive/processed, 0 = dead/inert), rotates bit 0 into carry, and
 * returns a SKIP BOOLEAN under the settled sub_0008 convention (mainloop.js):
 * true = the caller resumes normally; false = the caller is spliced past and must
 * `return` at once (`if (!m.call(0x0010)) return;`). So the callers' bodies (the
 * difficulty tick entry_2ddb, the periodic-event arms entry_2c03/sub_03a2, the
 * movement handlers) run only while Mario is active. Reached only via
 * `m.call(0x0010)` from many routines -- a LEAF, never a dispatch target.
 *
 * THE POLARITY TRAP. sub_0010 is the EXACT MIRROR of sub_0008 (`rst 0x08`) with the
 * opposite polarity: sub_0008 tests the SAME `rrca` bit but returns normally on
 * `ret nc` (bit CLEAR), whereas sub_0010 returns normally on `ret c` (bit SET). They
 * are one opcode apart (0xD0 vs 0xD8) and mean OPPOSITE things -- copying sub_0008's
 * `if (regs.fNC)` onto this routine takes the wrong branch on EVERY call, and the
 * write-gate (RAM only) cannot see it because sub_0010 writes NO memory. So the
 * `rrca` + carry test is kept verbatim and the unit gate compares the full register
 * file. The teeth test flips exactly this (`fNC` for `fC`) and it is CAUGHT as an SP
 * divergence.
 *
 * INPUTS: MARIO_ACTIVE (0x6200). OUTPUTS: none to RAM -- this routine writes NO
 * memory. It changes only registers: A (= 0x6200 rotated right one), F (the `rrca`
 * result), SP (+2 on the normal ret, +4 on the splice), and PC (the popped return).
 * RETURN: boolean skip flag (true = normal, false = spliced).
 *
 * FLAGS. The caller consumes the RETURN VALUE, not F -- but the unit gate compares
 * A and F, and `rrca` sets them exactly as the oracle (carry = old bit 0; A rotated),
 * so both are kept verbatim. A ends = (0x6200 >> 1) | (bit0 << 7); F = the rrca flags.
 * SP is load-bearing: the two `inc sp` ARE the caller-skip mechanism, so SP is
 * reproduced exactly (+2 normal, +4 splice).
 *
 * CYCLES -- PER-INSTRUCTION, DELIBERATELY (NOT collapsed). sub_0010 is atomic on the
 * NMI game-state path (the handler runs with the NMI mask cleared, so no nested NMI
 * lands inside it there), BUT it is ALSO reached from the INTERRUPTIBLE main-loop
 * path: loc_197a -- the per-frame in-game update cascade, documented decisively
 * NON-atomic (the vblank NMI lands mid-cascade, diverging at stack 0x6BF6) -- calls
 * entry_2c03 (ROM 0x2C03) and entry_2ddb (ROM 0x2DDB), and BOTH `rst 0x10` into here
 * while the NMI mask is SET. So the vblank NMI CAN fire inside this 4-6 instruction
 * body on the gameplay path. Collapsing the per-instruction m.step charges to one
 * per-branch lump would move where such an NMI lands: fireNmi would push the
 * ret-target PC instead of the oracle's exact 0x0013/0x0014/0x0015/0x0016 -- a
 * divergent byte in the diffed stack RAM (vs MAME). So the oracle's cycle
 * DISTRIBUTION is preserved charge-for-charge; each branch's TOTAL is the oracle's by
 * construction (normal 13+4+11 = 28; splice 13+4+5+6+6+10 = 44). Kept per-instruction
 * for the same reason as its siblings sub_0020 and loc_197a. (A whole-machine test on
 * ATTRACT frames alone would not exercise this interruptible caller -- no credited
 * game runs loc_197a -- so atomicity there is NOT provable by that gate.) Optimization
 * here buys the MARIO_ACTIVE name, the plain-English contract, and structured control
 * flow -- not a collapse.
 */
export function sub_0010(m) {
  const { regs, mem } = m;

  // ld a,(MARIO_ACTIVE) -- load the player-alive byte.
  regs.a = mem.read8(MARIO_ACTIVE);
  m.step(0x0013, 13);

  // rrca -- rotate the alive bit (bit 0) into carry.
  regs.rrca();
  m.step(0x0014, 4);

  if (regs.fC) {
    // ret c taken -- bit 0 SET: Mario alive, return NORMALLY (caller resumes).
    m.ret(11);
    return true;
  }

  // ret c NOT taken -- bit 0 CLEAR: the two `inc sp` discard our own return address
  // so the final ret unwinds to the caller's CALLER (the splice). Per-instruction, so
  // an NMI landing between these boundaries pushes the oracle's exact PC.
  m.step(0x0015, 5); // ret c not taken
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x0016, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x0017, 6); // inc sp
  m.ret(); // ret -- returns to the caller's CALLER
  return false;
}
