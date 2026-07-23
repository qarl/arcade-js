// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_28e0 — hand-optimized rewrite of the translated routine at ROM 0x28E0,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (entry_2913 @ 0x2913) is reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so it resolves to the
 * oracle or to a future optimized rewrite. No RAM name is imported: the only
 * address this routine writes (0x63B9) is un-evidenced in ram.js, so it stays hex
 * (README §4 — name only what can be evidenced, leave the rest hex).
 */

/**
 * sub_28e0 -- collision-search driver: TWO entry_2913 sweeps. [ROM 0x28E0-0x2900]
 *
 *   28e0  e1           pop  hl                ; recover the dispatcher's pushed HL
 *                                             ;   (the 2913 axis-2 search bounds H/L)
 *   -- sweep 1: count 5, stride 0x0020, object base 0x6400 --
 *   28e1  06 05        ld   b,0x05
 *   28e3  78           ld   a,b
 *   28e4  32 b9 63     ld   (0x63b9),a        ; 0x63B9 = this sweep's record count
 *   28e7  11 20 00     ld   de,0x0020
 *   28ea  dd 21 00 64  ld   ix,0x6400
 *   28ee  cd 13 29     call 0x2913            ; GUARDED: 2913 HIT unwinds past us
 *   -- sweep 2: count 10, stride 0x0010 (only E reloaded; D stays 0x00), base 0x6500 --
 *   28f1  06 0a        ld   b,0x0a
 *   28f3  78           ld   a,b
 *   28f4  32 b9 63     ld   (0x63b9),a
 *   28f9  1e 10        ld   e,0x10            ; E only -> DE = 0x0010 (D preserved)
 *   28fd  dd 21 00 65  ld   ix,0x6500
 *   2900  c9           ret
 *
 * WHAT IT DOES. The 0x6227 collision-dispatch (sub_286f -> rst 0x28 table @0x2874,
 * index 3) routes here. It runs entry_2913 -- the object-list proximity search --
 * TWICE, over two object tables: five records at 0x6400 (stride 0x20), then ten at
 * 0x6500 (stride 0x10). entry_2913 (LIVE-IN C, L, H, DE, B, IY, IX) walks a table
 * looking for an object within range of the search center; on a HIT it sets A=1,
 * DISCARDS OUR return address (inc sp / inc sp), and rets straight to OUR caller --
 * a frame-skip that unwinds past sub_28e0 entirely (the sub_0008 boolean
 * convention: `false` == skipped/hit, `true` == returned normally). So each guarded
 * call `if (!m.call(0x2913)) return true;` stops the sweep chain the instant a
 * collision is found. If both sweeps miss, control reaches the final `ret`.
 *
 * INPUTS  (read): stack (the dispatcher's HL, popped); registers C, IY (search
 *   center/bounds, live-in and untouched here); plus whatever entry_2913 reads.
 * OUTPUTS (written): 0x63B9 (the current sweep's record count, later read back by
 *   sub_286f); registers B, A, DE(E), IX per sweep; and entry_2913's own effects
 *   (A, IX restored, B->0, SP). RETURNS true on every path (twin of sub_28b0):
 *   the `false`/HIT case never returns THROUGH sub_28e0 -- 2913 already unwound
 *   past it -- so the `return true` after a caught HIT is control-flow bookkeeping,
 *   and the caller (dispatchGameState, nmi.js) forwards the boolean.
 *
 * FLAGS. sub_28e0's own instructions (pop, ld) set no flags. The observable
 * register/flag state on exit is entirely entry_2913's (reached via m.call, so
 * preserved verbatim). The caller consumes only the boolean return value, kept
 * identical (always true). Nothing else to preserve.
 *
 * The second sweep uses `regs.e = 0x10` (E only), NOT `regs.de = 0x0010`: the ROM
 * reloads E alone, relying on D still being 0x00 from sweep 1's `ld de,0x0020`.
 * entry_2913 never writes D, so both are equal here -- but E-only is kept so the
 * whole register file matches the oracle exactly whatever D holds.
 *
 * ATOMIC + CYCLES -- collapsed to one total per straight-line segment. sub_28e0
 * runs INSIDE the vblank NMI (dispatchGameState is reached from entry_0066, which
 * clears the NMI mask 0x7D84 on entry), so NO nested NMI can fire while it
 * executes, and its ~147 T-states never span a frame boundary -- its internal
 * cycle DISTRIBUTION is therefore unobservable. So each segment charges its
 * per-instruction tstate SUM (folding the trailing CALL's 17t) in a single
 * m.step: sweep-1 prologue 10+7+4+13+10+14+17 = 75, sweep-2 prologue
 * 7+4+13+7+14+17 = 62, final ret 10. The TOTAL is still load-bearing: sub_28e0
 * runs in the NMI, and the NMI's total cost feeds the main loop's vblank-spin
 * count (0x6019, the PRNG entropy) -- a cheaper NMI spins one more time and
 * reseeds. Whole-machine EQUAL confirms the collapsed total exactly; stripping the
 * charges diverges at SPIN_COUNT 0x6019 (README §2; same mechanism as
 * handler_05c6 / sub_09d6). entry_2913 keeps charging its own instructions.
 */
export function sub_28e0(m) {
  const { regs, mem } = m;

  regs.hl = m.pop16(); // pop hl -- the dispatcher's pushed HL (2913's axis-2 bounds)

  // -- sweep 1: B=5, DE=0x0020, IX=0x6400 --
  regs.b = 0x05;
  regs.a = 0x05; // ld a,b
  mem.write8(0x63b9, 0x05); // 0x63B9 = record count (read back by sub_286f)
  regs.de = 0x0020;
  regs.ix = 0x6400;
  m.push16(0x28f1); // call 0x2913 return address
  m.step(0x2913, 75); // collapsed prologue: 10+7+4+13+10+14+17
  if (!m.call(0x2913)) return true; // 2913 HIT unwound past us -> our caller resumes

  // -- sweep 2: B=10, E=0x10 (D preserved = 0x00 -> DE=0x0010), IX=0x6500 --
  regs.b = 0x0a;
  regs.a = 0x0a; // ld a,b
  mem.write8(0x63b9, 0x0a);
  regs.e = 0x10; // E only; D stays 0x00 across the call
  regs.ix = 0x6500;
  m.push16(0x2900); // call 0x2913 return address
  m.step(0x2913, 62); // collapsed prologue: 7+4+13+7+14+17
  if (!m.call(0x2913)) return true;

  m.ret(); // ret (0x2900) -- both sweeps missed; 10 T-states
  return true; // all sweeps completed normally -> caller continues
}
