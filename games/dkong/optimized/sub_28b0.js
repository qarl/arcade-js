// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_28b0 — hand-optimized rewrite of the translated routine at ROM 0x28B0,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x2913 / entry_2913) is reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so it resolves to the
 * oracle — or to a future optimized rewrite — and never becomes a copy that can
 * drift. Nothing here needs a name from ram.js: 0x63B9 (the per-sweep active
 * count) and the three object-list bases (0x6400/0x65A0/0x66A0) are unnamed in
 * ram.js, so they stay hex per README §4 ("leave the rest hex").
 */

/**
 * sub_28b0 -- three sequential entry_2913 collision sweeps.  [ROM 0x28B0-0x28DF]
 *
 * Reached as index 2 of the rst-0x28 table at ROM 0x2874 (dispatched by sub_286f
 * when BOARD-collision selector 0x6227 == 2), which sub_2808 drives from the
 * state-3 gameplay cascade (loc_197a @ 0x19B6). The dispatcher pushed HL (the
 * axis-2 bounds 0x0407, H=hi-span, L=lo-span) before the rst; the routine's first
 * act is `pop hl` to recover it for entry_2913.
 *
 * WHAT IT DOES. It runs entry_2913 (object-list range search) three times over
 * three object tables, each with its own count / stride / base:
 *
 *   sweep 1:  B=0x05  DE(stride)=0x0020  IX=0x6400   (5 records, 0x20 apart)
 *   sweep 2:  B=0x06  DE(stride)=0x0010  IX=0x65A0   (6 records, 0x10 apart)
 *   sweep 3:  B=0x01  DE(stride)=0x0000  IX=0x66A0   (1 record)
 *
 * Before each sweep it also stores the count into 0x63B9. entry_2913 searches its
 * table for a record whose two-axis distance to the probe point (C, plus IY+3 vs
 * record fields, bounded by H/L) is in range:
 *   - MISS (list exhausted, A=0): entry_2913 returns true, control falls to the
 *     next sweep.
 *   - HIT (A=1): entry_2913 restores IX, DISCARDS this routine's return address,
 *     and `ret`s straight to OUR caller (a frame-skip). In JS that callee already
 *     ran m.ret and returns false, so this routine just `return true`s — the
 *     later sweeps are skipped, exactly as the discarded-return-address ROM does.
 *
 * INPUTS  (registers, from the dispatch chain): C = probe axis-1 (0x6205 via
 *   sub_2808), IY = 0x6200 (entry_2913 reads IY+3), stack top = pushed HL 0x0407.
 * OUTPUTS: 0x63B9 = last sweep's count; entry_2913's own writes; registers left
 *   as entry_2913 leaves them (A=0 all-miss / A=1 on the hitting sweep, B=0,
 *   IX=the hitting/last sweep's base, DE=that sweep's stride, HL=0x0407).
 *
 * FLAGS / RETURN. Every path returns `true` — identical to the oracle, whose
 * dispatch caller (sub_0028 → dispatchGameState) propagates the boolean as
 * "continue". There is no branch on which the return differs, so `true` is
 * unconditional here too. Registers/F are the callee's; nothing in this routine
 * computes a flag its caller consumes.
 *
 * ATOMIC / CYCLES. sub_28b0 runs inside the NMI handler with the NMI mask cleared
 * (dispatchGameState is reached from entry_0066, whose first act clears the mask),
 * so the vblank NMI cannot fire inside it OR inside entry_2913 — the routine is
 * ATOMIC. Its total is still observable (it shifts how long the following main
 * loop spins = the PRNG entropy, README §2), but its DISTRIBUTION is free, so each
 * sweep's per-instruction m.step charges are collapsed to ONE total per sweep,
 * placed on the `call 0x2913` step (sweep 1 = 10+7+4+13+10+14+17 = 75, incl. the
 * `pop hl`; sweeps 2 & 3 = 7+4+13+7+14+17 = 62), plus the final `ret` (10) on the
 * all-miss path. Verified EQUAL whole-machine + unit; each branch's total is also
 * asserted against the oracle in the test (teeth against a wrong/over-collapsed
 * charge). The `m.push16` before each `call` stays (calling convention: entry_2913
 * pops it, or discards+rets through it on a hit).
 */
export function sub_28b0(m) {
  const { regs, mem } = m;

  regs.hl = m.pop16(); // pop hl -- recover the dispatcher's pushed HL (0x0407 axis bounds)

  // [count, stride(DE), IX base, call-site return addr, collapsed sweep cycles].
  // D stays 0x00 throughout (sweep 1 sets DE=0x0020; entry_2913 never touches DE),
  // so writing the full stride into DE each sweep is identical to the ROM's
  // `ld e,NN` on sweeps 2/3.
  const SWEEPS = [
    [0x05, 0x0020, 0x6400, 0x28c1, 75],
    [0x06, 0x0010, 0x65a0, 0x28d0, 62],
    [0x01, 0x0000, 0x66a0, 0x28df, 62],
  ];

  for (const [count, stride, base, ret, cycles] of SWEEPS) {
    regs.b = count;
    regs.a = count;                // ld a,b
    mem.write8(0x63b9, regs.a);    // 0x63B9 = this sweep's active count (unnamed in ram.js)
    regs.de = stride;
    regs.ix = base;
    m.push16(ret);                 // call 0x2913 pushes its return address
    m.step(0x2913, cycles);        // collapsed sweep total (atomic: distribution is free)
    if (!m.call(0x2913)) return true; // entry_2913 HIT: it unwound to our caller -> stop
  }

  m.ret(); // ret (0x28DF) -- all three sweeps missed
  return true; // all sweeps completed normally -> caller continues
}
