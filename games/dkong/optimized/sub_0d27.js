// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0d27 — hand-optimized rewrite of the translated routine at ROM 0x0D27,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its only callee (0x0D30, sub_0d30) is reached through
 * `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle — or to a future optimized rewrite — never a copy.
 * Nothing is imported: sub_0d27 reads and writes no *named* work RAM (its stores
 * land in video RAM, which is not ram.js's domain), so there is no RAM name to import.
 */

/**
 * sub_0d27 -- draw the two decorative fill rows of the 75m board.  [ROM 0x0D27-0x0D42]
 *
 *   0d27  21 0d 77     ld   hl,0x770d   ; HL -> upper fill row in video RAM
 *   0d2a  cd 30 0d     call 0x0d30      ; sub_0d30: fill 0x11 cells 0xFD, skip 0x0F, fill 0x11 cells 0xFC
 *   0d2d  21 0d 76     ld   hl,0x760d   ; HL -> lower fill row in video RAM
 *   0d30  ...          (falls straight into sub_0d30 at 0x0D30 — tail call)
 *
 * WHAT IT DOES. Called once during 75m (board 3) setup (from loc_0cf2's leading
 * `call 0x0d27`) to lay down two fixed tile bands in the background tilemap. It
 * points HL at each row base and runs the shared filler sub_0d30 twice:
 *   - HL=0x770D: sub_0d30 writes 0xFD to 0x770D..0x771D (0x11=17 cells), advances
 *     HL by 0x0F, then writes 0xFC to 0x772D..0x773D (17 cells).
 *   - HL=0x760D: the same 0xFD then 0xFC pattern one tilemap page lower
 *     (0x760D..0x761D, then 0x762D..0x763D).
 * The two byte values are the tile codes for the row's left/right decoration; the
 * 0x0F gap is the middle of the row that the filler steps over.
 *
 * NOTABLE IDIOM — TAIL CALL / FALL-THROUGH. The FIRST invocation of sub_0d30 is a
 * real `call` (return address 0x0D2D pushed). The SECOND is a fall-through: the
 * `ld hl,0x760d` at 0x0D2D is immediately followed in memory by sub_0d30 at 0x0D30,
 * so execution drops into it with NO call — sub_0d30's own `ret` then returns to
 * sub_0d27's CALLER (the caller-skip / tail-jump idiom). So the first site keeps
 * its `m.push16`, the second has none and is written `return m.call(0x0d30)`.
 *
 * INPUTS: none. Every value is an immediate; sub_0d27 reads no register or RAM as
 *   input (it sets HL itself before each fill).
 * OUTPUTS: video RAM only — 0x760D..0x763D and 0x770D..0x773D bands (via sub_0d30,
 *   reached by m.call, unchanged). No work RAM is touched, so there is no ram.js
 *   name to use here. Registers end as sub_0d30 leaves them (HL past 0x763D, B=0,
 *   DE=0x000F, F from the final `add hl,de`).
 *
 * FLAGS. sub_0d27's own instructions (2× `ld hl,nn`, one `call`, the fall-through)
 *   set NO flags. The observable exit F is whatever sub_0d30's last flag-affecting
 *   op (`add hl,de`) leaves, reached identically through m.call on both sides, so F
 *   matches automatically. loc_0cf2 does not consume flags after its `call 0x0d27`
 *   (its next op is `ld a,0x0a`). The `rrca`-style verbatim retention needed by
 *   flag-returning routines does not apply — nothing here to keep. The unit gate
 *   compares the whole register file (F included) and confirms it.
 *
 * ATOMIC — cycles collapsed, TOTAL preserved. sub_0d27's ONLY caller is loc_0cf2
 *   (the BOARD==3 arm of the setup cascade loc_0c92; grep `m.call(0x0d27)` finds
 *   only loc_0cf2's translated copy in nmi.js and its optimized rewrite). loc_0cf2
 *   is itself reachable only through loc_0c92, whose two entries are game-state
 *   handlers dispatched by dispatchGameState — which runs INSIDE the vblank NMI
 *   (entry_0066 clears the 0x7D84 mask on entry, restores it only at the 0x00DB
 *   epilogue), so a second vblank cannot re-enter. And sub_0d27's own callee
 *   sub_0d30 is a pure VRAM-fill leaf (no m.call of its own). So the NMI never
 *   lands inside sub_0d27 or sub_0d30 on ANY call path — sub_0d27 is ATOMIC, and
 *   its internal cycle DISTRIBUTION is unobservable.
 *
 *   Therefore its own three per-instruction charges (ld 10 + call 17 + ld 10 = 37t)
 *   collapse: the leading `ld hl` folds into the first `call` (nothing runs between
 *   them) for one 27t charge, and the trailing `ld hl` keeps its 10t (sub_0d30's
 *   first execution runs between it and the first call, so it stays a separate
 *   charge that also positions PC at 0x0D30 before the fall-through). 27 + 10 = 37,
 *   the oracle's exact total. sub_0d30's own ~1021t per call are UNCHANGED — they
 *   run through m.call to the oracle on both sides, so they cancel in the diff.
 *   No hardware register (0x7Dxx latch) is written anywhere in sub_0d27 or sub_0d30
 *   — the stores are plain video RAM (0x74xx-0x77xx), value-preserve only — so,
 *   unlike loc_0a8a, there is no write-bus-cycle to pin and the collapse needs no
 *   write-trace test. The TOTAL stays load-bearing (as part of the NMI's cost it
 *   feeds the main-loop spin count, README §2), so it is preserved exactly; the
 *   single-path cycle test pins it to the oracle's with teeth.
 *
 * SINGLE PATH. sub_0d27 has no data-dependent branch — it always fills both rows,
 *   in the same order, regardless of any register or RAM. There is one path; the
 *   whole/unit/single-path gates all exercise that one path.
 */
export function sub_0d27(m) {
  const { regs } = m;

  // ld hl,0x770d ; call 0x0d30 -- fill the upper row.  Atomic routine, nothing
  // runs between the load and the call, so their charges fold: 10 + 17 = 27t.
  regs.hl = 0x770d;
  m.push16(0x0d2d);
  m.step(0x0d30, 27);
  m.call(0x0d30);

  // ld hl,0x760d -- then FALL THROUGH into sub_0d30 (tail call): no push, its
  // `ret` returns to sub_0d27's caller.  10t, and it also advances PC to 0x0D30.
  regs.hl = 0x760d;
  m.step(0x0d30, 10);
  return m.call(0x0d30);
}
