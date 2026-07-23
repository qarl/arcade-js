// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_09ee — hand-optimized rewrite of the translated routine at ROM 0x09EE,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It is a LEAF — it calls nothing, so there is no `m.call`
 * here and no import. Its three stores target VIDEO RAM (0x74A0/0x74C0/0x74E0),
 * which is out of ram.js's work-RAM scope, so the addresses stay hex; the store
 * VALUES are preserved byte-for-byte.
 */

/**
 * sub_09ee -- shared 3-cell tilemap-column draw fragment.  [ROM 0x09EE-0x09FD]
 *
 *   09ee  3e 02        ld   a,0x02      ; tile 0x02
 *   09f0  32 e0 74     ld   (0x74e0),a  ; -> VRAM 0x74E0
 *   09f3  3e 25        ld   a,0x25      ; tile 0x25
 *   09f5  32 c0 74     ld   (0x74c0),a  ; -> VRAM 0x74C0
 *   09f8  3e 20        ld   a,0x20      ; tile 0x20
 *   09fa  32 a0 74     ld   (0x74a0),a  ; -> VRAM 0x74A0
 *   09fd  c9           ret
 *
 * WHAT IT DOES / WHERE IT SITS. A shared drawing fragment that stamps three fixed
 * tile bytes into one tilemap column — three video-RAM cells 0x20 apart, which in
 * the rotated DK tilemap layout are three rows apart in the same column (the P2
 * "2UP" marker column). It reads no RAM and takes no argument: every value is an
 * immediate. It is called from THREE sites, all of which are the P2/2-player marker
 * draw:
 *   - handler_0779 (ROM 0x07A0) — attract screen, CONDITIONALLY, only when the
 *     two-player marker 0x600F == 1.
 *   - sub_09d6 (ROM 0x09EE) — the 2-player board-setup arm FALLS THROUGH into it
 *     (its own `ret` returns from sub_09d6).
 *   - sub_0a1b (ROM 0x0A2E) — the 2-player board-setup step CALLs it unconditionally.
 *
 * INPUTS: none (no RAM read, no incoming register consumed — the first act is
 *   `ld a,0x02`). OUTPUTS: VRAM 0x74E0 = 0x02, 0x74C0 = 0x25, 0x74A0 = 0x20. On
 *   return A = 0x20 (the last tile loaded); every other register is untouched, and
 *   SP is restored by the `ret`. These are plain video-RAM byte writes, NOT the
 *   0x7Dxx-style hardware latches whose effect is bus-cycle-position-dependent
 *   (boards/dkong/memory.js AddressSpace.isHardwareWrite covers only 0x78xx / 0x7c00
 *   / 0x7c80 / 0x7d0x / 0x7d8x), so no write-trace timing is at stake here and the
 *   only observable is the final cell VALUE.
 *
 * FLAGS. This routine touches NO flag — `ld a,n` and `ld (nn),a` leave F untouched
 *   and there is no arithmetic — so F on return equals F on entry, exactly as the
 *   oracle. Nothing downstream consumes a flag from it in any case (its callers make
 *   no `ret cc` off it). The unit gate compares the whole register file incl. F and
 *   confirms it; A is written verbatim (0x02 -> 0x25 -> 0x20) so it matches too.
 *
 * ATOMIC — cycles collapsed to ONE total. sub_09ee runs only ever INSIDE the vblank
 *   NMI: ALL THREE call paths reach it with the NMI mask cleared — handler_0779,
 *   sub_09d6 and sub_0a1b are each dispatched by the NMI (dispatchGameState /
 *   dispatchTask), whose handler zeroes io.nmiMask on entry, and this leaf calls
 *   nothing that could span a frame. So the NMI can never fire INSIDE it on ANY path
 *   (ATOMICITY-IS-PER-CALL-PATH: every caller is mask-cleared), its internal cycle
 *   DISTRIBUTION is unobservable, and the six per-instruction m.step charges collapse
 *   to one: 7+13 + 7+13 + 7+13 = 60t. The `ret` keeps its own 10t (it must pop the
 *   return address and set PC). The TOTAL is still load-bearing — as part of the NMI's
 *   cost it feeds the frame's cycle budget (README §2) — so 60t is preserved exactly
 *   and the harness confirms it: stripping the charge DIVERGES (the cycle-teeth test).
 *   Where it surfaces differs from its caller sub_09d6, though: sub_09d6's stripped
 *   twin diverges at SPIN_COUNT 0x6019 (a cheaper frame reaches the vblank spin sooner
 *   and reseeds the PRNG), whereas sub_09ee's diverges at a STACK address (0x6bf4, base
 *   179 vs 180) — the cheaper NMI shifts WHERE its pushed PC lands, the entry_0611
 *   mechanism rather than the spin count. Same conclusion (total is observable),
 *   different surface. Collapse still verified EQUAL whole-machine + unit.
 *
 * SINGLE PATH. No data-dependent branch — always the same three stores — so there is
 *   exactly one path, exercised end-to-end by any single dispatch.
 */
export function sub_09ee(m) {
  const { regs, mem } = m;

  // Three fixed tiles into one tilemap column (VRAM, addresses stay hex; values exact).
  regs.a = 0x02; mem.write8(0x74e0, regs.a); // tile 0x02 -> 0x74E0
  regs.a = 0x25; mem.write8(0x74c0, regs.a); // tile 0x25 -> 0x74C0
  regs.a = 0x20; mem.write8(0x74a0, regs.a); // tile 0x20 -> 0x74A0
  // A ends 0x20; no flag touched, so F is preserved exactly (matches the oracle).

  // ATOMIC: the six per-instruction charges (7+13 x3) fold into one 60t total; PC
  // lands on the ret at 0x09FD just as the oracle's last m.step leaves it.
  m.step(0x09fd, 60);
  m.ret(); // pop the caller's return address, +10t (Z80 ret)
}
