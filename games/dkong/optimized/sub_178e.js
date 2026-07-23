// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_178e — hand-optimized rewrite of the translated routine at ROM 0x178E,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Both callees (0x0018 the `rst 0x18` gate, 0x309F the task
 * enqueue) are reached through `m.call(0xADDR)`, the routine registry
 * (games/dkong/routines.js), so each resolves to the oracle — or to that callee's
 * own optimized rewrite once one exists — never a copy. Only RAM *names* are
 * imported (from ram.js); addresses ram.js leaves unnamed stay hex.
 */

import { BOARD_SEQ_PTR, BOARD, SUBSTATE_TIMER, GAME_SUBSTATE } from "./ram.js";

/**
 * sub_178e -- board-sequence ADVANCE: step the board-order pointer, publish the
 * next BOARD, enqueue its task, and hand off to the "how-high" sub-state. It is
 * the tail arm of the board-advance sequence (index 5 of loc_1615's 0x1623 and
 * 0x1637 tables). [ROM 0x178E-0x17B5]
 *
 *   178e  df           rst 0x18           ; every-Nth-frame gate on SUBSTATE_TIMER
 *   178f  2a 2a 62     ld   hl,(0x622a)   ; HL = BOARD_SEQ_PTR
 *   1792  23           inc  hl            ; advance to the next board entry
 *   1793  7e           ld   a,(hl)        ; A = that entry's board byte
 *   1794  fe 7f        cp   0x7f          ; 0x7F = end-of-table sentinel?
 *   1796  c2 9d 17     jp   nz,0x179d     ; not the sentinel -> keep the walked ptr
 *   1799  21 73 3a     ld   hl,0x3a73     ; sentinel: reload the L5+ group start
 *   179c  7e           ld   a,(hl)        ; A = 0x3A73's board byte
 *   179d  22 2a 62     ld   (0x622a),hl   ; BOARD_SEQ_PTR := (walked | reloaded)
 *   17a0  32 27 62     ld   (0x6227),a    ; BOARD := that byte
 *   17a3  11 00 05     ld   de,0x0500     ; task (D=0x05 opcode, E=0x00 arg)
 *   17a6  cd 9f 30     call 0x309f        ; enqueue it
 *   17a9  af           xor  a             ; A := 0 (sets final F)
 *   17aa  32 88 63     ld   (0x6388),a    ; clear the board-sub-sequence selector
 *   17ad  21 09 60     ld   hl,0x6009     ; HL = SUBSTATE_TIMER
 *   17b0  36 30        ld   (hl),0x30     ; arm the gate: 48 frames
 *   17b2  23           inc  hl            ; -> GAME_SUBSTATE (0x600A)
 *   17b3  36 08        ld   (hl),0x08     ; hand off to sub-state 8 (how-high)
 *   17b5  c9           ret
 *
 * THE GATE (rst 0x18, ROM 0x0018): decrements SUBSTATE_TIMER (0x6009) and, unless
 * it hit zero, discards this routine's return and returns to OUR caller — a "do it
 * every Nth expiry" gate, not a "while counting" one. `m.call(0x0018)` returns
 * false on that skip, so `if (!m.call(0x0018)) return;` propagates it verbatim, SP
 * and all (the callee already unwound this frame). The body below runs only on the
 * frame the timer expires; its own epilogue then re-arms the timer to 0x30.
 *
 * THE WALK: BOARD_SEQ_PTR (0x622A) is a 16-bit ROM pointer into the board-order
 * table. Advance it one entry and read the board byte there; the 0x7F terminator
 * means "end of this level's list" and reloads 0x3A73 (the start of the level-5+
 * group), which is why boards 5+ repeat forever. The resulting pointer is written
 * back and the board byte becomes BOARD (0x6227). Then a task [0x05,0x00] is
 * enqueued (sub_309f), the selector at 0x6388 is cleared, the gate timer is re-set
 * to 0x30 (48), and GAME_SUBSTATE (0x600A) is advanced to 8 (the how-high
 * interlude) — the visible hand-off out of board-advance.
 *
 * INPUTS (RAM read): SUBSTATE_TIMER (via the gate), BOARD_SEQ_PTR, and the ROM the
 * pointer addresses. OUTPUTS (RAM written by THIS body): BOARD_SEQ_PTR, BOARD,
 * 0x6388, SUBSTATE_TIMER, GAME_SUBSTATE, plus the task ring via sub_309f. NO
 * hardware register (0x7Dxx latch) is touched — every store is work RAM — so the
 * cycle collapse below has no --writes bus-cycle consequence and needs no
 * write-trace test.
 *
 * REGISTERS AT RET: A=0, HL=GAME_SUBSTATE(0x600A) (the pointer walk's end), DE=0x0500,
 * BC untouched. The intermediate HL/A the walk computes are all overwritten before
 * ret (sub_309f preserves HL then the epilogue reloads it), so only these finals
 * are observable. FLAGS: the routine ends in an unconditional `ret`; the last
 * flag-writer on the body path is `xor a`, kept verbatim so F == the oracle's
 * (Z set, S/H/N/C clear, P/V set). The `cp 0x7f` flags are dead (overwritten by
 * sub_309f then xor a) but the compare is kept for fidelity — the unit gate
 * compares the whole register file, F included.
 *
 * ATOMIC — cycles collapsed, TOTAL preserved (own charge = 193t on the reload
 * branch, 176t on the walk branch, 11t on the gate-skip). sub_178e is dispatched
 * from INSIDE the vblank NMI (dispatchGameState with GAME_STATE==3 -> loc_06fe ->
 * loc_1615 -> `rst 0x28` on 0x6388 -> here), where the NMI mask is held and the
 * dispatcher does not re-enter, so the NMI can never land inside this routine OR
 * either callee — the whole subtree runs with interrupts disabled. Its internal
 * cycle DISTRIBUTION is therefore unobservable and the per-instruction m.step
 * charges collapse to one per call-segment (the preceding straight-line run + that
 * call's cost) plus one call-free epilogue. Each collapsed charge is placed in the
 * m.step IMMEDIATELY before its call, so every callee still starts at the oracle's
 * exact cumulative cycle. The TOTAL stays load-bearing — as part of the NMI's cost
 * it sets the main-loop vblank-spin count (README §2, SPIN_COUNT) — so each
 * branch's sum is preserved exactly; the synthesised-branch cycle teeth confirm it.
 * (Same lesson as loc_17b6, its board-advance sibling.)
 */
export function sub_178e(m) {
  const { regs, mem } = m;

  // rst 0x18 -- every-Nth-frame gate on SUBSTATE_TIMER. Skips (returns to our
  // caller) unless the timer expires this frame.
  m.push16(0x178f);
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return; // counter still ticking -- skipped to our caller

  // Walk the board-order pointer, publish the next board byte. 0x7F sentinel ->
  // reload the level-5+ group start so boards 5+ repeat.
  regs.hl = (mem.read16(BOARD_SEQ_PTR) + 1) & 0xffff; // ld hl,(0x622a) / inc hl
  regs.a = mem.read8(regs.hl); // ld a,(hl)
  regs.cp(0x7f); // cp 0x7f -- sets F (dead: overwritten by sub_309f then xor a); kept for fidelity
  let segB; // straight-line t-states between the two calls, per branch
  if (regs.fZ) {
    // sentinel hit -> reload L5+ group start
    regs.hl = 0x3a73;
    regs.a = mem.read8(regs.hl); // ld a,(0x3a73)
    segB = 102; // 16+6+7+7+10 + 10+7 + 16+13+10
  } else {
    // not the sentinel -> keep the walked pointer
    segB = 85; // 16+6+7+7+10 + 16+13+10
  }

  mem.write16(BOARD_SEQ_PTR, regs.hl); // ld (0x622a),hl
  mem.write8(BOARD, regs.a); // ld (0x6227),a
  regs.de = 0x0500; // task opcode/arg for the enqueue

  // call 0x309f -- enqueue the task. Segment charge = straight-line run + call(17).
  m.push16(0x17a9);
  m.step(0x309f, segB + 17);
  m.call(0x309f);

  // Epilogue (call-free, atomic): clear the selector, re-arm the gate, hand off to
  // the how-high sub-state. Collapsed to one 53t charge; ret adds 10t.
  regs.xor(regs.a); // xor a -- A=0, sets final F
  mem.write8(0x6388, regs.a); // clear the 0x6388 board-sub-sequence selector
  regs.hl = SUBSTATE_TIMER; // ld hl,0x6009
  mem.write8(regs.hl, 0x30); // arm the gate: 48 frames
  regs.hl = (regs.hl + 1) & 0xffff; // inc hl -> GAME_SUBSTATE (0x600A)
  mem.write8(regs.hl, 0x08); // hand off to sub-state 8 (how-high)

  // xor a(4)+ld(6388)(13)+ld hl(10)+ld(hl)(10)+inc hl(6)+ld(hl)(10) = 53t
  m.step(0x17b5, 53);
  m.ret(); // ret (0x17b5) -- 10t; pops sub_178e's return
}
