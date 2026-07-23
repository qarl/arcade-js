// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0008 — hand-optimized rewrite of the translated routine at ROM 0x0008,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It is a LEAF (it calls nothing), so it imports no code —
 * only the RAM name ATTRACT (from ram.js). It goes live at every `m.call(0x0008)`
 * site through the routine registry (games/dkong/routines.js), which is what makes
 * the caller-skip idiom `if (!m.call(0x0008)) return;` resolve to this rewrite.
 */

import { ATTRACT } from "./ram.js";

/**
 * sub_0008 -- the `rst 0x08` conditional caller-skip helper.
 * [ROM 0x0008-0x000F]
 *
 *   0008  3a 07 60   ld  a,(0x6007)   ; A = ATTRACT
 *   000b  0f         rrca             ; bit 0 of ATTRACT -> carry
 *   000c  d0         ret nc           ; bit clear: normal return to caller
 *   000d  33         inc sp           ; bit set: discard our own return address
 *   000e  33         inc sp           ;          (both halves of it)
 *   000f  c9         ret              ; ...so this ret goes to the CALLER'S CALLER
 *
 * A STACK-SKIP IDIOM invoked as `rst 0x08` from many routines. It tests bit 0 of
 * ATTRACT (0x6007): `rrca` rotates that bit into carry, so `ret nc` returns
 * normally UNLESS the bit is set -- the same `ld a,(0x6007) / rrca` enable test
 * entry_0611 uses on the identical byte, but wired to the STACK instead of a draw.
 *
 * When the bit IS set, the two `inc sp` throw away this routine's own return
 * address without reading it, so the final `ret` pops the NEXT word -- the return
 * address of whoever called our caller. Control resumes two levels up, skipping
 * the rest of the routine that executed `rst 0x08`. The translation models that
 * skip with a BOOLEAN RETURN the caller consumes as an early-return signal:
 *   true  = returned normally (bit clear) -- caller keeps going;
 *   false = skipped (bit set) -- caller must `return` immediately (its own tail
 *           has already been bypassed by the two-level ret).
 *
 * INPUTS:  reads ATTRACT (0x6007); reads the Z80 stack (the two return words).
 * OUTPUTS: SP (+2 normal / +4 skip), PC (caller / caller's-caller), A (ATTRACT
 *          rotated right one bit), F (carry = old bit 0, per rrca), and the
 *          boolean return. Writes NO work RAM -- its whole contract is SP + PC +
 *          A/F + the return value, which is exactly what the unit gate compares
 *          (RAM + the full register file incl. SP, A, F, and pc).
 *
 * The `rrca` is kept verbatim so BOTH A and F match the oracle exactly (A is left
 * rotated and read by nothing downstream; F's carry is only the branch decision).
 * The boolean is the load-bearing output; A/F are preserved for the gate, not
 * because a caller reads them.
 *
 * CYCLES -- PER-INSTRUCTION, DELIBERATELY (NOT collapsed). sub_0008 is atomic on
 * the NMI game-state dispatch path (that handler runs mask-cleared), BUT it is a
 * leaf `rst` helper ALSO reached from the mask-ENABLED main loop: entry_051c
 * (mainloop.js) is a dispatchTask task that does `m.push16(0x051e) / rst 0x08 /
 * if (!m.call(0x0008)) return;`, and the main loop runs with the vblank NMI mask
 * ENABLED. So the NMI CAN land inside this ~4-instruction routine. If it lands
 * while a collapsed `m.ret(28/44)` is charging, fireNmi pushes the ret-target PC,
 * whereas the oracle -- charging 13/4/5/6/6 per instruction at its own PC -- would
 * push 0x000b/0x000c/0x000d/0x000e for those cycles. A different pushed PC lands in
 * diffed stack RAM and diverges from MAME (README §2's "NMI lands mid-logic"
 * caveat; the same reason sibling sub_0020 and loc_197a are kept per-instruction).
 * A 30-frame attract run does NOT exercise the interruptible entry_051c path, so it
 * cannot prove the collapse safe -- and it is not. Therefore the oracle's cycle
 * DISTRIBUTION is preserved charge-for-charge: each instruction is charged at its
 * own PC. The per-branch totals are the oracle's by construction (normal 13+4+11 =
 * 28; skip 13+4+5+6+6+10 = 44). Optimization here buys the ATTRACT name, the
 * plain-English contract, and structured control flow -- not a cycle collapse.
 */
export function sub_0008(m) {
  const { regs, mem } = m;

  // ld a,(ATTRACT) / rrca -- rotate the enable bit (bit 0) into carry.
  regs.a = mem.read8(ATTRACT);
  m.step(0x000b, 13);
  regs.rrca();
  m.step(0x000c, 4);

  if (regs.fNC) {
    // ret nc taken: bit 0 clear -- normal return to the caller (SP += 2).
    m.ret(11);
    return true;
  }

  // ret nc not taken: bit 0 set. inc sp / inc sp discards our own return address,
  // then ret pops the CALLER'S CALLER return (net SP += 4) -- the skip.
  m.step(0x000d, 5); // ret nc not taken
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x000e, 6); // inc sp
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x000f, 6); // inc sp
  m.ret(); // ret -- returns to the caller's caller
  return false;
}
