// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0691 — hand-optimized rewrite of the translated routine at ROM 0x0691,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (entry_051c @ 0x051c) is reached through
 * `m.call(0x051c)` — the routine registry (games/dkong/routines.js) — so it
 * resolves to the oracle (entry_051c) or a future optimized rewrite; never a copy.
 * No RAM name is imported: the only work-RAM address this routine touches, 0x638C,
 * is an explicit REJECT in ram.js's Deliberately-unnamed list (a 0x63xx scratch
 * byte, shared/no-evidenced-meaning), so it stays hex with a comment.
 */

/**
 * loc_0691 -- award both BCD digits of 0x638C to the score, via entry_051c twice.
 * [ROM 0x0691-0x06A7, 13 instructions; the A==0 arm of task-entry-10 entry_062a]
 *
 *   0691  3a 8c 63     ld   a,(0x638c)
 *   0694  47           ld   b,a          ; keep the ORIGINAL packed BCD in B
 *   0695  e6 0f        and  0x0f         ; low nibble left in A (1st award index)
 *   0697  c5           push bc           ; C is the caller's -- LIVE-IN, never set here
 *   0698  cd 1c 05     call 0x051c       ; entry_051c: add score-table[low digit]
 *   069b  c1           pop  bc           ; restore B (entry_051c clobbered C via `ld c,a`)
 *   069c  78           ld   a,b
 *   069d  0f 0f 0f 0f  rrca x4           ; high nibble down into the low nibble
 *   06a1  e6 0f        and  0x0f         ; high nibble in A
 *   06a3  c6 0a        add  a,0x0a       ; the 2nd index is offset by ten
 *   06a5  c3 1c 05     jp   0x051c       ; TAIL JUMP: add score-table[10 + high digit]
 *
 * WHAT IT DOES. entry_062a (task entry 10) jumps here when its dispatch payload A
 * is zero. It reads the packed two-digit BCD counter at 0x638C, splits it into its
 * low and high nibbles, and invokes entry_051c (task entry 0, "add to a BCD score")
 * once per digit -- first with the low digit as the score-table index, then with
 * the high digit + 10. The twin loc_066a RENDERS the same two nibbles to VRAM; this
 * one TALLIES them into the score (0x638C holds the board's leftover bonus/10, so
 * this is the bonus-into-score award). When the game is in ATTRACT (0x6007 != 0),
 * entry_051c's `rst 0x08` gate pops its own return and skips the add, so on that
 * path the only observable effect is the two stack pushes.
 *
 * INPUTS
 *   A          dispatch payload, 0 on this arm (unread here; entry_051c reloads it).
 *   C          LIVE-IN -- pushed at 0x0697 before it is ever written, so the value
 *              handed to entry_051c's FIRST call is the caller's C (entry_062a does
 *              not set C; via dispatchTask it equals the task arg, 0 on this arm).
 *              entry_051c's first act is `ld c,a`, so C is clobbered before use and
 *              the pushed byte's only footprint is on the stack (see OUTPUTS).
 *   (0x638C)   the packed two-digit BCD counter to award.
 * OUTPUTS
 *   score RAM  entry_051c adds two table entries to the current player's BCD score
 *              (0x60B2/0x60B5, selected by 0x600D) -- unless ATTRACT gates it off.
 *   stack RAM  `push bc` (0x0697) and the 0x0698 `call`'s return-address push land
 *              B/C and 0x069B in the diffed work-RAM stack; kept verbatim as the
 *              calling convention requires (README §2, "not scaffolding").
 *   A/flags    left as entry_051c leaves them: this block never reaches a `ret` of
 *              its own -- the 0x06A5 TAIL JUMP means entry_051c's `ret` returns to
 *              entry_062a's caller, so loc_0691's return value IS entry_051c's.
 *
 * NOTABLE IDIOMS (all preserved exactly as the oracle behaves them):
 *   - ENTERS entry_051c TWICE BY TWO MECHANISMS, thirteen bytes apart: a `call` at
 *     0x0698 (return address pushed) and a TAIL JUMP at 0x06A5 (nothing pushed).
 *   - TWIN OF loc_066a WITH INVERTED REGISTER ROLES: loc_066a keeps the original in
 *     C and the low nibble in B; loc_0691 keeps the original in B and leaves the low
 *     nibble in A. Not factorable into a shared helper.
 *   - `push bc` / `pop bc` bracket the first call because entry_051c's `ld c,a`
 *     clobbers C; they preserve B (the ORIGINAL) FOR THIS ROUTINE, not for its caller.
 *
 * FLAGS KEPT. Every register/flag op (`and`, the four `rrca`, `add`) is the same
 * regs helper the oracle uses, so the register file the unit gate compares (F
 * included) is byte-identical at each step and at exit. The final A/F are whatever
 * entry_051c leaves (its result is this routine's return value via the tail jump).
 *
 * NOT ATOMIC -- KEPT PER-INSTRUCTION (cycles NOT collapsed). loc_0691's ONLY caller
 * is entry_062a (task entry 10), dispatched from the MAIN LOOP with the vblank NMI
 * mask ENABLED; and loc_0691 itself calls entry_051c, a substantial INTERRUPTIBLE
 * routine (BCD add loop + score compare + a `rst 0x08` gate). By the per-call-path
 * atomicity rule (README §2, brief's ATOMICITY-IS-PER-CALL-PATH), a leaf reached via
 * m.call from a main-loop/interruptible path is NOT atomic: the NMI can land inside
 * this routine's own instruction run, and collapsing the per-instruction charges
 * would move where it lands and change the PC pushed into diffed stack RAM. So each
 * instruction keeps its own m.step charge -- always correct, and the whole-machine
 * gate confirms EQUAL. (Same decision as sub_0350 / sub_0020 / handler_05e9.) The
 * push16/step/call scaffolding is the calling convention and stays regardless.
 */
export function loc_0691(m) {
  const { regs, mem } = m;

  // ld a,(0x638C) / ld b,a -- load the packed BCD, keep the ORIGINAL in B.
  // 0x638C stays hex: ram.js REJECTS it (0x63xx scratch, no evidenced meaning).
  regs.a = mem.read8(0x638c);
  m.step(0x0694, 13); // ld a,(0x638c)
  regs.b = regs.a;
  m.step(0x0695, 4); // ld b,a

  // and 0x0f -- isolate the low digit in A: the first score-table index.
  regs.and(0x0f);
  m.step(0x0697, 7); // and 0x0f

  // push bc (C is the caller's, live-in) then call entry_051c -- award the low digit.
  m.push16(regs.bc);
  m.step(0x0698, 11); // push bc
  m.push16(0x069b);
  m.step(0x051c, 17); // call 0x051c
  m.call(0x051c);

  // pop bc -- entry_051c's `ld c,a` clobbered C; restore B (the ORIGINAL).
  regs.bc = m.pop16();
  m.step(0x069c, 10); // pop bc

  // ld a,b / rrca x4 / and 0x0f -- rotate the high nibble down and isolate it.
  regs.a = regs.b;
  m.step(0x069d, 4); // ld a,b
  for (const next of [0x069e, 0x069f, 0x06a0, 0x06a1]) {
    regs.rrca();
    m.step(next, 4); // rrca
  }
  regs.and(0x0f);
  m.step(0x06a3, 7); // and 0x0f

  // add a,0x0a -- the high digit's table index is offset by ten.
  regs.add(0x0a);
  m.step(0x06a5, 7); // add a,0x0a

  // jp 0x051c -- TAIL JUMP (nothing pushed): award the high digit and return to
  // entry_062a's caller through entry_051c's own ret. loc_0691's return == its return.
  m.step(0x051c, 10); // jp 0x051c
  return m.call(0x051c);
}
