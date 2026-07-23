// SPDX-License-Identifier: GPL-3.0-only
/**
 * tail_05da — hand-optimized rewrite of the translated routine at ROM 0x05DA,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0578, draw_0578) is reached through
 * `m.call` — the routine registry, games/dkong/routines.js — so it resolves to the
 * oracle or to its own optimized rewrite (0x0578 IS already optimized) and never to
 * a copy. Nothing is imported: the routine reads/writes no named RAM field; it only
 * loads a pointer constant into DE and tail-jumps.
 */

/**
 * tail_05da -- the two-instruction tail of handler_05c6: load DE, tail-jump the
 * high-score renderer.  [ROM 0x05DA-0x05DF]
 *
 *   05da  11 ba 60   ld  de,0x60ba   ; DE = high-score MSB pointer
 *   05dd  c3 78 05   jp  0x0578      ; TAIL jump into draw_0578, nothing pushed
 *
 * NOT A ROM ROUTINE OF ITS OWN — it is the fall-through tail of handler_05c6
 * (0x05C6), extracted only because entry_051c ALSO reaches these exact two
 * instructions, by `jp 0x05da` at 0x055C. Two callers, one shared tail; extracted
 * rather than duplicated so a later edit can't fix one copy and miss the other.
 *
 * WHAT IT DOES: point DE at 0x60BA and tail-jump draw_0578, which renders a 3-byte
 * little-endian BCD score walking DOWNWARD from that MSB into VRAM. 0x60BA is the
 * +2 (most-significant) byte of HIGH_SCORE (0x60B8) — the same "address the score
 * by its top byte" convention handler_05c6's payload arms use — so it stays hex
 * here: a pointer into the score, not a field in its own right (exactly as
 * handler_05c6 documents for 0x60B4/B7/BA). draw_0578 is entered at its TOP entry
 * (0x0578, enteredAt057C=false — the oracle passes no arg, so the default holds),
 * so draw_0578 itself establishes IX=0x7641, the high-score display column.
 *
 * INPUTS: none — DE is loaded outright, nothing is read. OUTPUTS: DE = 0x60BA on
 * entry to draw_0578; the visible effect (the six VRAM digit cells) is entirely
 * draw_0578's, reached identically on both sides through m.call.
 *
 * FLAGS: `ld de,nn` and `jp` set no flags, and this tail reads none, so F is pure
 * pass-through — nothing to preserve or drop. (The unit gate compares F anyway and
 * confirms it is untouched.)
 *
 * ATOMICITY -- PER-INSTRUCTION, NOT collapsed. tail_05da is reached ONLY via
 * m.call(0x05da), and BOTH callers are MAIN-LOOP tasks: handler_05c6 (dispatchTask
 * entry 2) and entry_051c (task entry 0, itself reached from entry_062a task 10).
 * On every path the vblank NMI mask is ENABLED, so the NMI CAN fire BETWEEN the
 * `ld de` and the `jp`. Collapsing the two 10 T charges into a single total would
 * move the cycle boundary at which the NMI lands and change the PC it pushes onto
 * the (diffed) stack — a divergence a short attract run can hide by the NMI simply
 * not landing there. So the tail is modelled EXACTLY as the oracle: two 10 T steps
 * then `return m.call(0x0578)` — no push16 (a `jp`, not a `call`, so draw_0578's
 * eventual `ret` returns to tail_05da's caller's caller, which is the point of the
 * tail jump). Per ATOMICITY-IS-PER-CALL-PATH: any interruptible call path ⇒ keep
 * per-instruction, which is always correct. (There is only ONE branch here — a
 * straight line — so "each branch's total preserved" is trivially the 20 T total.)
 */
export function tail_05da(m) {
  const { regs } = m;

  // ld de,0x60ba -- point DE at HIGH_SCORE (0x60B8) MSB; draw_0578 walks 3 BCD
  // bytes downward from here. Kept hex: a pointer into the score, not a field.
  regs.de = 0x60ba;
  m.step(0x05dd, 10);

  // jp 0x0578 -- TAIL jump into the (already-optimized) renderer at its TOP entry
  // (enteredAt057C defaults false, matching the oracle's arg-less m.call). Nothing
  // is pushed; per-instruction charge kept because the NMI can land here.
  m.step(0x0578, 10);
  return m.call(0x0578);
}
