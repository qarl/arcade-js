// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_1757 — hand-optimized rewrite of the translated routine at ROM 0x1757,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its three callees (0x306F, 0x176C, 0x1783) are reached
 * through `m.call(0xADDR)` — the routine registry (games/dkong/routines.js) — so
 * each resolves to the oracle or to a future optimized rewrite, never a copy.
 * Only the RAM name SUBSTATE_TIMER is imported (from ram.js).
 */

import { SUBSTATE_TIMER } from "./ram.js";

/**
 * sub_1757 -- board-advance "arm the next sub-state once the sprites are gone".
 * [ROM 0x1757-0x176B]
 *
 *   1757  cd 6f 30   call 0x306f       ; cull helper
 *   175a  cd 6c 17   call 0x176c       ; clamp-scan the 0x692F block, leaves HL/DE
 *   175d  23         inc  hl           ; advance the scan pointer
 *   175e  13         inc  de           ; advance the scan stride (3 -> 4)
 *   175f  cd 83 17   call 0x1783       ; sprite-clear scan (CALLER-SKIP capable)
 *   1762  3e 40      ld   a,0x40
 *   1764  32 09 60   ld   (0x6009),a   ; SUBSTATE_TIMER = 0x40
 *   1767  21 88 63   ld   hl,0x6388
 *   176a  34         inc  (hl)         ; advance the 0x6388 sequence selector
 *   176b  c9         ret
 *
 * WHAT IT DOES. This is one arm of the board-advance sequence dispatched from
 * inside the vblank NMI: dispatchGameState (GAME_STATE 0x6005 == 3) -> loc_06fe
 * (GAME_SUBSTATE 0x600A == 0x16, board-advance) -> loc_1615 -> rst 0x28 on the
 * 0x6388 selector through the BOARD(0x6227)-bit-selected table (0x1623 idx4, or
 * 0x1637 idx3) -> here. It runs the two cull/clamp helpers, advances the pointer
 * pair HL/DE that sub_1783 walks, then asks sub_1783 whether the sprite block is
 * fully cleared:
 *   - NOT clear: sub_1783 takes its `jp 0x0026` CALLER-SKIP -- it discards this
 *     routine's return address and returns straight to the GRANDPARENT, so this
 *     routine must NOT continue. The `if (!m.call(0x1783)) return;` models exactly
 *     that: on a false return we abort without our own `ret` (sub_1783 already
 *     unwound two levels).
 *   - CLEAR: arm SUBSTATE_TIMER (0x6009) = 0x40 (the frames-to-wait before the next
 *     sub-state proceeds) and advance the 0x6388 sequence selector by one so the
 *     next NMI dispatches the following arm.
 *
 * INPUTS: HL/DE as left by sub_176c (HL=0x6907, DE=0x0003 at the natural entry),
 * plus the sprite block sub_1783 scans. OUTPUTS (this routine's own stores, clear
 * branch only): SUBSTATE_TIMER (0x6009) = 0x40; 0x6388 incremented. Both are work
 * RAM -- there is NO 0x7Dxx hardware-latch write here, so no --writes-trace test is
 * needed (unlike loc_0a8a).
 *
 * 0x6388 stays HEX: ram.js explicitly rejects it ("0x63xx engine scratch"), so
 * naming it would be a confident guess. It is the board-advance SEQUENCE SELECTOR
 * that loc_1615's rst-0x28 indexes and that many advance arms `inc`.
 *
 * FLAGS. The clear branch's final `inc (hl)` sets S/Z/H/P/V and clears N (leaves
 * carry) -- replicated verbatim via regs.inc8 so F matches the oracle. The caller
 * (a plain `ret`, not `ret cc`) consumes no flag, but the unit gate compares the
 * whole register file including F, so F is preserved exactly either way. `inc hl`
 * / `inc de` are 16-bit and set no flags (matched by the plain +1 & 0xffff). A is
 * left = 0x40 on the clear branch, exactly as the oracle leaves it.
 *
 * CYCLES -- collapsed to per-call-segment + one epilogue charge; totals preserved.
 * sub_1757 is ATOMIC: it is dispatched from inside the NMI, where the mask is held
 * (the handler clears 0x7D84 last), so the vblank NMI can never land inside it OR
 * any of its three callees. Its internal cycle DISTRIBUTION is therefore free, but
 * each executed branch's TOTAL is load-bearing -- as part of the NMI cost it sets
 * the main-loop vblank-spin count (README §2) and where a LATER frame's NMI lands
 * in diffed stack RAM. So the per-instruction charges collapse but each branch's
 * SUM is kept exact:
 *   SKIP branch     17 + 17 + (6+6+17)             = 63t
 *   CLEAR branch    17 + 17 + (6+6+17) + (7+13+10+11+10) = 114t
 * Each call's CALL charge stays immediately before its `m.call` so every callee
 * still starts at the oracle's exact cumulative cycle; inc hl(6)+inc de(6) fold
 * into the pre-0x1783 charge (29t); the clear epilogue (51t) folds into the ret.
 * Harness-verified EQUAL whole-machine + unit; a wrong total (113/62) is CAUGHT.
 */
export function sub_1757(m) {
  const { regs, mem } = m;

  // call 0x306f -- cull helper. CALL costs 17t.
  m.push16(0x175a); m.step(0x306f, 17); m.call(0x306f);

  // call 0x176c -- clamp-scan the 0x692F block; leaves HL/DE for the sprite scan.
  m.push16(0x175d); m.step(0x176c, 17); m.call(0x176c);

  // inc hl / inc de -- advance the scan pointer and stride (no flags, 16-bit).
  regs.hl = (regs.hl + 1) & 0xffff;
  regs.de = (regs.de + 1) & 0xffff;

  // call 0x1783 -- sprite-clear scan. Charge inc hl(6)+inc de(6)+CALL(17)=29t
  // immediately before the call so sub_1783 starts at the oracle's cumulative cycle.
  m.push16(0x1762); m.step(0x1783, 6 + 6 + 17);
  if (!m.call(0x1783)) return; // not clear -> sub_1783 already skipped to the grandparent

  // Sprites clear: arm the sub-state timer and advance the 0x6388 sequence selector.
  regs.a = 0x40;
  mem.write8(SUBSTATE_TIMER, regs.a); // ld (0x6009),a
  regs.hl = 0x6388;
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (0x6388) -- sets F
  // epilogue ld a(7)+ld(6009)(13)+ld hl(10)+inc(hl)(11)+ret(10) = 51t, folded into ret.
  m.ret(7 + 13 + 10 + 11 + 10);
}
