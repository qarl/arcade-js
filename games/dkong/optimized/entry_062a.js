// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_062a — hand-optimized rewrite of the translated routine at ROM 0x062A,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its five branches use three distinct callees (0x0691, 0x06a8, 0x066a), which are
 * reached through `m.call(0xADDR)` — the routine registry (games/dkong/routines.js)
 * — so each resolves to the oracle (loc_0691 / loc_06a8 / loc_066a) or to a future
 * optimized rewrite; never a copy. Only the RAM name BONUS_START is imported from
 * ram.js. 0x638C and 0x63B8 stay hex: both are in ram.js's Deliberately-unnamed
 * list (0x638C is an explicit 0x63xx-scratch REJECT; 0x63B8 has no evidenced name).
 */

import { BONUS_START } from "./ram.js";

/**
 * entry_062a -- task table entry 10: render 0x638C's two BCD digits, with a
 * once-per-board "seed 0x638C from BONUS_START/10 + paint the label" first pass.
 * [ROM 0x062A-0x06B7, 142 bytes, 74 instructions]
 *
 * FIVE BRANCHES on two guard bytes and the dispatch payload A (all LIVE-IN):
 *   A == 0               -> jp z,0x0691  (loc_0691: render both digits via 0x051c)
 *   A != 0, (638C) != 0  -> jp nz,0x06a8 (loc_06a8: BCD-decrement 638C, re-render)
 *   ... (63B8) != 0      -> ret nz       (CONDITIONAL early exit -- do nothing)
 *   ... (63B8) == 0      -> divide BONUS_START by 10, pack the quotient into the
 *                           high nibble of 0x638C, LDIR a 6-row VRAM label, then
 *                           fall into loc_066a to paint the digits.
 *
 * INPUTS
 *   A            dispatch payload (the first `and a` at 0x062A tests it un-set).
 *   C            live-in on the A==0 arm only -- loc_0691 pushes it before it is
 *                ever written (documented at that callee); entry_062a itself does
 *                not touch C, so forwarding A unchanged is enough.
 *   (0x638C)     packed two-digit BCD to render; guards branch B.
 *   (0x63B8)     "already seeded" latch; non-zero guards the divide/label pass off.
 *   BONUS_START  (0x62B0) the board bonus, divided by 10 on the seed pass.
 * OUTPUTS
 *   (0x638C)     seed pass writes (BONUS_START/10) << 4.
 *   VRAM 0x7465.. six 3-byte tile groups copied from ROM 0x384A at stride 0x20
 *                (the label column); plus whatever loc_066a/loc_0691/loc_06a8 draw.
 *   stack RAM    each LDIR-loop pass does `push ix / pop de` (a 16-bit IX->DE move)
 *                which LEAVES ix's bytes below SP -- a real, diffed memory effect,
 *                so push16/pop16 are kept verbatim (README §2, "calling convention
 *                is not scaffolding").
 *
 * NOTABLE IDIOMS (all preserved as the oracle behaves them):
 *   - DIVIDE-BY-TEN BY REPEATED SUBTRACTION with NO iteration guard. It exits only
 *     when A hits EXACTLY 0, and A steps by 10 mod 256; gcd(10,256)=2, so an ODD
 *     0x62B0 never reaches 0 and the CPU spins forever. NO GUARD IS ADDED -- the
 *     hang is the faithful behaviour and it is loud (adding a guard would convert
 *     it to a silently wrong answer). sub_0f56's clamp does not detect wrap, so a
 *     wrapped odd value is the named trigger; it fires on no tape we hold.
 *   - `ld ix,0x001d` IS INSIDE THE LDIR LOOP: IX is a fresh STRIDE reloaded every
 *     pass, not a running pointer (`add ix,de` computes DE+0x1D, the push/pop moves
 *     it back to DE -- a 16-bit add with no `add de,rr` available). Hoisting it out
 *     would add an already-advanced IX on later passes.
 *   - The LDIR is inlined as a 3-byte copy (HL->DE, BC->0). Its own flag effects
 *     (H/N/PV reset) are DEAD -- the following `add ix,de` (H,N,C) and `dec a`
 *     (S,Z,H,PV,N) overwrite every bit before anything reads F -- so, exactly like
 *     the oracle's m.ldirAt, no flags are set here.
 *
 * FLAGS KEPT. Every branch's F is produced by the same regs helpers the oracle
 * uses (`and`, `sub`, `inc8`, `dec8`, `addIx`, `rlca`), so the register file the
 * unit gate compares (F included) is byte-identical. The three guard tests read
 * `fZ`/`fNZ` off `regs.and(...)`, the `ret nz` off the `and a` at 0x0638. On the
 * fall-through branch F is handed to loc_066a already overwritten by the loop's
 * final `dec a` over `add ix,de`'s carry -- nothing between reads it.
 *
 * ATOMIC -- COLLAPSED to ONE total charge per branch (README §2 / handler_05c6
 * / entry_0611 rung). entry_062a calls nothing interruptible within its own body
 * (its callees run only at the tail m.call), and a boot+attract probe dispatched
 * it 14x over 2400 frames -- once via the full divide+LDIR path (branch D, 1157t
 * incl. callees) and 13x via branch B -- with the vblank NMI landing INSIDE it
 * ZERO times (it finishes ~36000t before the frame boundary even on branch D).
 * So its internal cycle distribution is unobservable; each branch charges its
 * per-instruction tstate SUM in a single m.step, and the whole-machine gate
 * confirms EQUAL (a wrong total would diverge at SPIN_COUNT 0x6019). Per-branch
 * totals: A=14, B=41, C=69 (58 pre + 11 ret), D=975+18*q where q = the divide
 * loop's iteration count (q=5 for the observed BONUS_START=0x32 -> D=1065, and
 * 1065 + 92 for loc_066a/loc_0689 = the probe's 1157, exactly).
 */
export function entry_062a(m) {
  const { regs, mem } = m;

  // 0x062A `and a` -- tests the LIVE-IN dispatch payload A.
  regs.and(regs.a);
  if (regs.fZ) {
    // 0x062B `jp z,0x0691` taken. total 4 + 10 = 14t.
    m.step(0x0691, 14);
    return m.call(0x0691);
  }

  // 0x062E/0x0631 `ld a,(0x638c) / and a` -- branch B on the render latch.
  regs.a = mem.read8(0x638c);
  regs.and(regs.a);
  if (regs.fNZ) {
    // 0x0632 `jp nz,0x06a8` taken. total 4+10+13+4+10 = 41t.
    m.step(0x06a8, 41);
    return m.call(0x06a8);
  }

  // 0x0635/0x0638 `ld a,(0x63b8) / and a` -- the "already seeded" guard.
  regs.a = mem.read8(0x63b8);
  regs.and(regs.a);
  if (regs.fNZ) {
    // 0x0639 `ret nz` taken -- a CONDITIONAL exit, do nothing. total 58 + 11 = 69t.
    m.ret(69);
    return;
  }

  // ---- Branch D: seed 0x638C from BONUS_START/10 and paint the label. ----
  // Shared prologue 0x062A..0x0639 all not-taken: 4+10+13+4+10+13+4+5 = 63t.
  let cyc = 63;

  // 0x063D `ld a,(0x62b0)`. Divide by ten by repeated subtraction, quotient in B.
  regs.a = mem.read8(BONUS_START);
  cyc += 13;
  regs.bc = 0x000a; // B = 0 quotient, C = 10 divisor
  cyc += 10;
  do {
    regs.b = regs.inc8(regs.b);
    regs.sub(regs.c);
    cyc += 18; // inc b (4) + sub c (4) + jp nz (10)
  } while (regs.fNZ); // NO GUARD -- hangs on odd 0x62B0, see docstring

  // 0x0646 `ld a,b` then four `rlca` = move the low nibble into the high nibble.
  regs.a = regs.b;
  cyc += 4;
  for (let i = 0; i < 4; i++) regs.rlca();
  cyc += 16;
  mem.write8(0x638c, regs.a);
  cyc += 13; // ld (0x638c),a

  // 0x0650 set up the LDIR label draw: ROM 0x384A -> VRAM 0x7465, six 3-tile rows.
  regs.hl = 0x384a;
  regs.de = 0x7465;
  regs.a = 0x06; // row counter
  cyc += 10 + 10 + 7; // ld hl / ld de / ld a,0x06

  do {
    regs.ix = 0x001d; // LOOP BODY reload -- a stride, not a pointer
    regs.bc = 0x0003;
    // LDIR: copy BC=3 bytes (HL)->(DE); flags are dead (see docstring).
    for (let i = 0; i < 3; i++) {
      mem.write8(regs.de, mem.read8(regs.hl));
      regs.hl = (regs.hl + 1) & 0xffff;
      regs.de = (regs.de + 1) & 0xffff;
    }
    regs.bc = 0x0000;
    regs.addIx(regs.de); // ix = de + 0x1d (writes H,N,C)
    m.push16(regs.ix); // push ix / pop de == a 16-bit IX->DE move (leaves ix in stack RAM)
    regs.de = m.pop16();
    regs.a = regs.dec8(regs.a);
    // ld ix (14) + ld bc (10) + ldir 3 bytes (21+21+16=58) + add ix,de (15)
    //   + push ix (15) + pop de (10) + dec a (4) + jp nz (10) = 136t
    cyc += 136;
  } while (regs.fNZ);

  // 0x0667 `ld a,(0x638c)` -- hand the packed BCD to loc_066a in A.
  regs.a = mem.read8(0x638c);
  cyc += 13;
  m.step(0x066a, cyc); // ONE total charge for branch D (atomic: distribution free)
  return m.call(0x066a);
}
