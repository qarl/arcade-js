// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_059b — hand-optimized rewrite of the translated routine at ROM 0x059B,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x05c6, handler_05c6) is reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so it resolves to the
 * oracle or to handler_05c6's own optimized rewrite — never a copy. Only RAM
 * *names* are imported (from ram.js), plus NotImplemented for the untranslated
 * high-payload stub.
 */

import { P1_SCORE, P2_SCORE, HIGH_SCORE } from "./ram.js";
import { NotImplemented } from "../../../boards/dkong/io.js";

/**
 * loc_059b -- task table entry 2 (0x0307 idx 2): CLEAR a BCD score slot, then
 * render it by tail-jumping into handler_05c6.  [ROM 0x059B-0x05C5]
 *
 *   059b  fe 03        cp   0x03          ; F := payload - 3 (kept to boundary)
 *   059d  d2 bd 05     jp   nc,0x05bd     ; payload >= 3 -> recursion (STUBBED)
 *   05a0  f5           push af            ; preserve payload + these flags
 *   05a1  21 b2 60     ld   hl,0x60b2     ; default slot = P1_SCORE
 *   05a4  a7           and  a             ; Z iff payload == 0
 *   05a5  ca ab 05     jp   z,0x05ab      ; ==0 keep 0x60B2
 *   05a8  21 b5 60     ld   hl,0x60b5     ; else P2_SCORE
 *   05ab  fe 02        cp   0x02
 *   05ad  c2 b3 05     jp   nz,0x05b3     ; !=2 keep current
 *   05b0  21 b8 60     ld   hl,0x60b8     ; ==2 -> HIGH_SCORE
 *   05b3  af           xor  a             ; A = 0
 *   05b4  77 23 77 23 77   ld (hl),a / inc hl (x2) ; clear 3 bytes
 *   05b9  f1           pop  af            ; restore payload + the cp-0x03 flags
 *   05ba  c3 c6 05     jp   0x05c6        ; TAIL jump into handler_05c6
 *
 * This is the HL-twin of handler_05c6. The payload in A (0/1/2) selects one of
 * the three 3-byte little-endian BCD score slots by its BASE address:
 *   0 -> P1_SCORE  (0x60B2)
 *   1 -> P2_SCORE  (0x60B5)
 *   2 -> HIGH_SCORE (0x60B8)
 * It zeroes all three bytes of that slot (base..base+2 -- the same bytes
 * handler_05c6 then renders from base+2 downward), then tail-jumps to 0x05c6 to
 * draw it. (handler_05c6 addresses the slots by their +2 MSB, 0x60B4/B7/BA; loc_059b
 * addresses them by the base, and the 3-byte clear spans exactly the gap.)
 *
 * PAYLOAD >= 3 is a recursive "clear all lower slots" loop the translation left
 * as a NotImplemented stub, exactly as its twin handler_05c6 stubs its own
 * analogous high-payload arm. The common payload<3 path is fully rewritten.
 *
 * BOUNDARY STATE reproduced before the tail-jump (m.call resolves 0x05c6 to the
 * same handler_05c6 in both oracle and optimized, so an identical machine here
 * guarantees identical downstream):
 *   - HL = base+2  -- the oracle's `inc hl` twice during the 3-byte clear leaves
 *     HL two past the base; handler_05c6 uses DE not HL, but the unit gate
 *     compares the whole register file, so HL is set explicitly.
 *   - A  = payload -- `push af`/`pop af` restore it across the `xor a`; the
 *     optimized clear writes 0 straight to RAM and never touches regs.a, so A is
 *     already the payload here.
 *   - F  = the `cp 0x03` flags -- this is what `push af` at 0x05a0 captured and
 *     `pop af` at 0x05b9 restored (the intervening `and a`/`cp 0x02` results are
 *     discarded by the pop). handler_05c6's first act is its own `cp 0x03`, so
 *     this F is overwritten unobserved -- but it is reproduced anyway (one `cp`)
 *     so the boundary register file is byte-identical, per README §3 ("keep the
 *     flag when unsure"). The unit gate compares F.
 *
 * LADDER STATUS -- idiomatic, cycles collapsed to one total per branch.
 * loc_059b is ATOMIC in its own body: it is a straight-line clear with no
 * interruptible call before the tail-jump, so the vblank NMI never lands inside
 * its ~13 instructions. Charging each executed branch's per-instruction tstate
 * SUM in a single m.step -- payload 0/1/2 = 126/136/146 t (the sums of the
 * oracle's own charges along each branch) -- stays EQUAL whole-machine AND unit
 * (harness-verified; collapsing did NOT diverge). The TOTAL is still load-bearing
 * per README §2 (it reaches the spin-count / downstream-NMI mechanisms via the
 * tail-called handler_05c6), so it is preserved exactly -- only its internal
 * DISTRIBUTION is dropped. 0x05c6 is left per-instruction inside its own file
 * (it is interruptible via the renderer); it is invoked via m.call so it resolves
 * to the oracle or a future optimized rewrite.
 */
export function loc_059b(m) {
  const { regs, mem } = m;
  const payload = regs.a;

  if (payload >= 3) {
    // payload >= 3: recursive "clear all lower slots" -- untranslated stub.
    // path total: cp 0x03 (7) + jp nc taken (10) = 17 t.
    m.step(0x05bd, 17);
    throw new NotImplemented(
      "loc_059b payload>=3 recursion at ROM 0x05BD (twin-consistent stub; see the header)",
    );
  }

  // Select the 3-byte BCD score slot to clear, addressed by its base.
  const base = payload === 0 ? P1_SCORE : payload === 2 ? HIGH_SCORE : P2_SCORE;

  // Clear the whole 3-byte little-endian BCD slot (base, base+1, base+2).
  mem.write8(base, 0);
  mem.write8((base + 1) & 0xffff, 0);
  mem.write8((base + 2) & 0xffff, 0);

  // Reproduce the oracle register file at the tail-jump boundary (see header):
  //   HL = base+2 (two `inc hl`), A = payload (untouched), F = `cp 0x03` flags.
  regs.hl = (base + 2) & 0xffff;
  regs.cp(0x03); // A is still the payload; this sets F to the popped cp-0x03 flags.

  // Collapsed per-branch total, then TAIL jump into handler_05c6 (nothing pushed).
  m.step(0x05c6, payload === 0 ? 126 : payload === 1 ? 136 : 146);
  return m.call(0x05c6); // its ret returns on our behalf
}
