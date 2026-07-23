// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_2880 — hand-optimized rewrite of the translated routine at ROM 0x2880,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x2913, entry_2913) is reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so it resolves to the
 * oracle or to a future optimized rewrite — never a copied implementation here.
 * No RAM name is imported: every address this routine touches (the count scratch
 * 0x63B9 and the three list bases) is un-evidenced, so it stays hex (ram.js rule).
 */

/**
 * sub_2880 -- board-1 collision search: three fixed object-list sweeps.
 * [ROM 0x2880-0x28AF]
 *
 *   2880  e1           pop  hl                 ; recover sub_286f's pushed HL
 *   2881  06 0a        ld   b,0x0a             ; sweep 1: 10 records
 *   2883  78           ld   a,b
 *   2884  32 b9 63     ld   (0x63b9),a         ; 0x63B9 = record count
 *   2887  11 20 00     ld   de,0x0020          ; D=0x00 survives sweeps 2-3
 *   288a  dd 21 00 67  ld   ix,0x6700          ; list base
 *   288e  cd 13 29     call 0x2913             ; GUARDED search
 *   2891  06 05 ...    ld   b,0x05 ...         ; sweep 2: ld e,0x20 (D kept), ix=0x6400
 *   28a0  cd 13 29     call 0x2913             ; GUARDED
 *   28a2  06 01 ...    ld   b,0x01 ...         ; sweep 3: ld e,0x00 (stride 0), ix=0x66a0
 *   28ad  cd 13 29     call 0x2913             ; GUARDED
 *   28af  c9           ret                     ; all sweeps missed
 *
 * WHAT IT DOES. Reached via sub_286f's 0x2874 collision-dispatch table (index =
 * BOARD 0x6227, so this is the board-1 arm; also listed under dispatchGameState's
 * rst-0x28 wiring). It runs entry_2913 (0x2913) three times over three fixed
 * object lists — 0x6700 (10 records, stride 0x20), 0x6400 (5 records, stride
 * 0x20), 0x66A0 (1 record, stride 0) — writing each list's record count to the
 * search scratch 0x63B9 first. entry_2913 is a bounding-box search: LIVE-IN
 * C/L/H/IY are the caller's collision key; B/DE/IX are set per sweep here.
 *
 * The `pop hl` at entry balances sub_286f, which pushed HL before its rst-0x28
 * jump landed here (the same dispatcher idiom sub_28b0/sub_28e0/sub_2901 open
 * with). HL is not read afterward.
 *
 * INPUTS:  stack top = sub_286f's pushed HL; C/L/H/IY = collision key (consumed
 *          only by entry_2913, untouched here).
 * OUTPUTS: RAM 0x63B9 = the last-attempted sweep's record count; B/A/DE/IX left
 *          as entry_2913 returned them; A/flags = entry_2913's exit (A=0 on the
 *          all-miss return, A=1 on a hit).
 *
 * RETURN CONVENTION (load-bearing — the caller branches on it). entry_2913
 * returns false on a HIT: it has already discarded OUR return address (inc sp;
 * inc sp) and returned to sub_286f's caller (sub_2808 @0x2816), so control does
 * NOT come back here — we simply propagate `false` and STOP. On a MISS it
 * returns true and we fall through to the next sweep. If all three miss we `ret`
 * (0x28AF) and return `undefined` — EXACTLY the oracle's per-branch return
 * values (false on any hit, undefined on the all-miss ret). The unit gate does
 * not compare the JS return, but the whole-machine gate does: a wrong boolean
 * would flip the rst-0x28 dispatcher's branch, so it is preserved verbatim.
 *
 * FLAGS. Nothing here sets a flag the caller reads: after the all-miss `ret`,
 * sub_2808 does `and a` on A, and A/flags were last written by entry_2913
 * (xor a -> A=0), not by this routine. Every register/flag the unit gate
 * compares therefore comes through the shared m.call(0x2913) oracle, so it
 * matches by construction.
 *
 * ATOMIC / CYCLES -- collapsed to one total per sweep. sub_2880 runs INSIDE the
 * NMI (dispatchGameState -> game-state-3 gameplay loc_197a -> sub_2808 ->
 * sub_286f -> here), and its only callee entry_2913 makes no interruptible call,
 * so the vblank NMI never lands inside this routine: it is ATOMIC and its
 * internal cycle DISTRIBUTION is free. The TOTAL is still load-bearing (the
 * NMI's total cost sets the main-loop spin count = PRNG entropy, README §2), so
 * each sweep charges the exact sum of the oracle's per-instruction t-states in a
 * single m.step: sweep 1 = pop-hl 10 + (7+4+13+10+14) + call 17 = 75; sweeps 2
 * and 3 = (7+4+13+7+14) + call 17 = 62; the all-miss ret adds 10. Verified: the
 * collapse stays EQUAL whole-machine across the 316 natural fall-through
 * dispatches, and the three synthesised hit branches assert their cycle totals
 * match the oracle (equivalence-2880.test.js). The push16/call pairs stay — each
 * balances entry_2913's ret; only the per-instruction m.step charges collapsed.
 */
export function sub_2880(m) {
  const { regs, mem } = m;

  // pop hl -- recover sub_286f's pushed HL (balances the stack). Its 10 t-states
  // are folded into sweep 1's collapsed charge below.
  regs.hl = m.pop16();

  // The three fixed sweeps. `fullDE` marks sweep 1's `ld de,0x0020` (D=0x00 then
  // survives into sweeps 2-3, which reload only E); `cycles` is that sweep's
  // collapsed t-state total (README §2 cycle rule; see the header derivation).
  const SWEEPS = [
    { count: 0x0a, ix: 0x6700, ret: 0x2891, cycles: 75, fullDE: true,  e: 0x20 },
    { count: 0x05, ix: 0x6400, ret: 0x28a0, cycles: 62, fullDE: false, e: 0x20 },
    { count: 0x01, ix: 0x66a0, ret: 0x28af, cycles: 62, fullDE: false, e: 0x00 },
  ];

  for (const s of SWEEPS) {
    regs.b = s.count;
    regs.a = regs.b; // ld a,b
    mem.write8(0x63b9, regs.a); // ld (0x63b9),a -- record count for entry_2913
    if (s.fullDE) regs.de = 0x0020; // sweep 1: full DE; D=0x00 preserved after
    else regs.e = s.e; // sweeps 2-3: E only (stride 0x0020 / 0x0000)
    regs.ix = s.ix;

    m.step(0x2913, s.cycles); // collapsed sweep total (atomic: distribution free)
    m.push16(s.ret); // balances entry_2913's ret (calling convention)
    if (!m.call(0x2913)) return false; // HIT: entry_2913 unwound past us -- STOP
  }

  m.ret(); // ret (0x28AF) -- all three sweeps missed
}
