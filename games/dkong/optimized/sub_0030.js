// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0030 — hand-optimized rewrite of the translated routine at ROM 0x0030,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. This routine calls nothing (it is a leaf), so there is
 * no `m.call` here; the only import is the RAM *name* BOARD from ram.js.
 */

import { BOARD } from "./ram.js";

/**
 * sub_0030 -- the `rst 0x30` vector helper: a bit-select skip gate.
 * [ROM 0x0030 is `jr 0x0044`; body at 0x0044-0x004D]
 *
 *   0030  18 12        jr   0x0044          ; the rst-0x30 entry point is a jump into the body
 *   0044  21 27 62     ld   hl,0x6227       ; HL = BOARD
 *   0047  46           ld   b,(hl)          ; B  = (BOARD)  -- the rotate count
 *   0048  0f           rrca            loc_0048
 *   0049  10 fd        djnz 0x0048          ; rotate A right B times
 *   004b  d8           ret  c               ; selected bit SET   -> NORMAL return
 *   004c  e1           pop  hl              ; selected bit CLEAR -> drop caller's return addr
 *   004d  c9           ret                  ; ...and return, so the caller's next op is skipped
 *
 * WHAT IT DOES. A `rst 0x30` (opcode 0xF7, a single byte) is a compact "test a
 * bit of A and, if it's clear, skip my caller's next action". It rotates A right
 * B times, where B is the value at BOARD (0x6227), so the final carry holds the
 * bit of A that ends up in position 0 -- effectively a RAM-indexed bit select of
 * A. Then:
 *   - carry SET   -> `ret c` returns NORMALLY to the caller  (this fn returns true);
 *   - carry CLEAR -> `pop hl` discards THIS routine's own return address, so the
 *                    final `ret` lands on the caller's caller -- i.e. the caller's
 *                    instruction after the `rst 0x30` is skipped (this fn returns
 *                    false). Callers spell the skip `if (!m.call(0x0030)) return;`.
 * B is the rotate count; with B==0 the `djnz` underflows and rotates 256 times
 * (a full-circle no-op on A, carry ending as bit 7), exactly as the Z80 does.
 *
 * INPUTS:  A (the value a bit is selected from), (BOARD) 0x6227 (rotate count /
 *          bit index).
 * OUTPUTS: A rotated in place; B = 0 on exit; HL = 0x6227 on the normal-return
 *          branch, or the popped (discarded) return address on the skip branch;
 *          SP += 2 relative to the other branch on the skip branch (the extra
 *          `pop`); F carry = the selected bit. RETURN: the rst-skip boolean the
 *          caller consumes.
 *
 * CONTRACT PRESERVED VERBATIM. The SP manipulation (`pop hl` on the skip branch),
 * the boolean return value, HL, and the carry flag are all load-bearing and are
 * reproduced exactly. The unit gate diffs the whole register file (A, F, B, HL,
 * SP, PC) plus RAM, so none of them may drift; the boolean is what every caller
 * branches on, so a wrong one diverges the whole machine downstream.
 *
 * LADDER STATUS -- named + documented, cycles KEPT PER-INSTRUCTION (NOT collapsed).
 * sub_0030 is an rst-vector leaf in the sub_0008/0010/0018 family, and those were
 * REVERTED to per-instruction for a reason that applies here identically:
 * ATOMICITY IS PER-CALL-PATH, and this routine is reached via `m.call(0x0030)`
 * from 20 sites -- MOST of them mask-ENABLED main-loop / interruptible gameplay
 * routines (sub_03a2 on the main loop; entry_2954, entry_2ed4, sub_2fcb, sub_29af,
 * sub_2207, sub_24ea, entry_2c03, entry_2c8f, sub_25f2, sub_26fa, loc_1e28/1e36,
 * sub_1670, tail_1662, sub_1a33, sub_33a1, entry_2ddb, entry_2e04 ...), plus one
 * NMI-side caller (sub_3fa6). On a main-loop call path the vblank NMI CAN land
 * between this routine's instructions, and the rrca/djnz loop can run up to 256
 * iterations, so it plainly spans NMI-eligible instruction boundaries. Collapsing
 * the per-instruction m.step charges to a single per-branch total would move where
 * the NMI lands INSIDE the routine and push a different PC into the diffed stack
 * RAM -- exactly the divergence that reverted sub_0008/0010/0018. A short attract
 * run happening not to interrupt it is NOT proof (README §"ATOMICITY IS PER-CALL-
 * PATH"; when unsure, per-instruction is always correct). So every m.step charge
 * is kept at the oracle's exact cycle, byte-for-byte; the win here is the BOARD
 * name, structured control flow, and this behavior documentation -- not de-scaffolding.
 * Returns true for a normal return.
 */
export function sub_0030(m) {
  const { regs, mem } = m;

  m.step(0x0044, 12); // jr 0x0044 -- the rst-0x30 body starts here

  regs.hl = BOARD;             // ld hl,0x6227
  m.step(0x0047, 10);
  regs.b = mem.read8(regs.hl); // ld b,(hl) -- B = rotate count = (BOARD)
  m.step(0x0048, 7);

  // rrca / djnz 0x0048 -- rotate A right B times (B==0 rotates 256× via djnz underflow).
  do {
    regs.rrca();
    m.step(0x0049, 4);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x0048 : 0x004b, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  // ret c -- selected bit set: return normally to the caller.
  if (regs.fC) {
    m.ret(11);
    return true;
  }

  // pop hl / ret -- selected bit clear: drop our return address so the caller is skipped.
  m.step(0x004c, 5);
  regs.hl = m.pop16();
  m.step(0x004d, 10);
  m.ret();
  return false;
}
