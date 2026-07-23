// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0a8a — hand-optimized rewrite of the translated routine at ROM 0x0A8A,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0DA7) is reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so it resolves to the oracle — or to
 * a future optimized rewrite — never a copy. Only RAM *names* are imported (ram.js).
 */

import { SUBSTATE_TIMER, INTRO_STEP } from "./ram.js";

// The two-bit palette-bank select latch (ls259.6h at 0x7D86/0x7D87) — a board
// control output, NOT work RAM, so it lives in the dkong board (io.js
// writePaletteBank), not ram.js. loc_0a8a sets the bank to %01: LO<-0, HI<-1.
const PALETTE_BANK_LO = 0x7d86;
const PALETTE_BANK_HI = 0x7d87;

/**
 * loc_0a8a -- INTRO_STEP 0: set up the opening Kong-climb cutscene. [ROM 0x0A8A-
 * 0x0ABE; entry 0 of loc_0a76's 0x0A7A rst-0x28 table, reached via
 * dispatchGameState while GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)==0.]
 *
 * WHAT IT DOES. The first phase of the intro where Kong hauls Pauline up the
 * girders. Straight-line (no data-dependent branch), one path:
 *   - Select palette bank %01 (PALETTE_BANK_LO<-0, PALETTE_BANK_HI<-1).
 *   - call 0x0DA7 (sub_0da7): walk the ROM record table at 0x380D, unpacking its
 *     0xAA-terminated position/sprite records into the 0x63AB.. region.
 *   - Stamp three fixed cutscene tiles into video RAM: 0x76A3<-0x10, 0x7663<-0x10,
 *     0x75AA<-0xD4.
 *   - Clear 0x62AF (work-RAM cutscene bookkeeping) to 0.
 *   - Seed the two cutscene walk pointers: 0x63C2<-0x38B4 (loc_0b06's) and
 *     0x63C4<-0x38CB (loc_0b68's).
 *   - Arm SUBSTATE_TIMER(0x6009) to 0x40 (a 64-frame countdown for this phase).
 *   - `inc (0x6385)` — advance INTRO_STEP so the NEXT NMI dispatches the following
 *     cutscene phase (loc_0abf) instead of re-running this one.
 *
 * INPUTS: none read from RAM — every value is an immediate or a ROM table walked by
 *   sub_0da7. OUTPUTS: the palette latch; video RAM (0x76A3/0x7663/0x75AA); the
 *   0x63AB.. records (via sub_0da7); 0x62AF; 0x63C2/0x63C4; SUBSTATE_TIMER; and
 *   INTRO_STEP (incremented). A ends 0x40, HL ends 0x6385; DE/BC are whatever
 *   sub_0da7 leaves (the epilogue does not touch them) and are not read downstream.
 *
 * FLAGS: nothing downstream consumes loc_0a8a's flags — its caller
 *   (dispatchGameState's rst-0x28 tail) makes no `ret cc` and branches on no flag
 *   it sets. But the unit gate compares F, so the flag-writers are kept verbatim.
 *   The final observable F is `inc (0x6385)`'s (0->1: S/Z/H/PV/N clear, C preserved
 *   0 from the preceding `xor a`) = 0x00, exactly the oracle's. The two `xor a` /
 *   `inc a` are kept for their VALUES too (A=0 written to the LO latch and to
 *   0x62AF; A=1 written to the HI palette bit).
 *
 * ATOMIC — cycles collapsed, TOTAL preserved (the one path = 234t of loc_0a8a
 *   proper: prologue 61 + epilogue 163 + ret 10; plus sub_0da7's own charges).
 *   loc_0a8a runs INSIDE the vblank NMI (dispatchGameState), which does not
 *   re-enter, so the NMI never lands inside it OR sub_0da7 — a coin+start probe
 *   dispatched it once (frame 96, a 42378-cycle frame) with the NMI landing inside
 *   ZERO times. So its internal cycle DISTRIBUTION is unobservable and the
 *   epilogue's 15 per-instruction m.step charges collapse to ONE (163t). The TOTAL
 *   stays load-bearing — as part of the NMI's cost it sets the main-loop spin count
 *   (README §2, SPIN_COUNT) — so the sum is preserved exactly; whole-machine EQUAL
 *   confirms it (a wrong total would diverge at 0x6019).
 *
 *   THE PROLOGUE IS ONLY PARTIALLY COLLAPSED, deliberately: loc_0a8a is the first
 *   optimized routine that makes its OWN hardware writes — the two palette-bank
 *   latches ARE hardware writes, recorded in the emit.js --writes trace with a
 *   write-bus-cycle column (= clock()+busOffset: +14t / +31t for the two writes).
 *   Collapsing across them would shift that column. The equivalence gate can't see
 *   the trace (it compares RAM+regs), so it is proven separately by the write-trace
 *   test; the prologue keeps just enough m.step granularity (4 / 17 / 40 = 61t) to
 *   land both palette writes at their exact bus cycle. The epilogue is video + work
 *   RAM only (no hardware writes), so it collapses with no trace consequence.
 */
export function loc_0a8a(m) {
  const { regs, mem } = m;

  // ---- Prologue: palette bank %01, then walk the 0x380D record table ----
  // Per-hardware-write granularity, so the two palette latches trace at their exact
  // bus cycle: xor a (4t); then ld(7d86)+inc a (17t); then ld(7d87)+ld de+call
  // (40t). Sum 61t, identical to the oracle's 4+13+4+13+10+17.
  regs.xor(regs.a); // A = 0
  m.step(0x0a8b, 4);
  mem.write8(PALETTE_BANK_LO, regs.a, 10); // palette bank bit0 = 0   [HW write @ +14t]
  regs.a = regs.inc8(regs.a); // A = 1
  m.step(0x0a8f, 17); // ld (0x7d86),a (13) + inc a (4)
  mem.write8(PALETTE_BANK_HI, regs.a, 10); // palette bank bit1 = 1   [HW write @ +31t]

  regs.de = 0x380d; // ROM record table sub_0da7 walks
  m.push16(0x0a98); // call 0x0da7 return address (balances sub_0da7's ret)
  m.step(0x0da7, 40); // ld (0x7d87),a (13) + ld de (10) + call (17); pc -> 0x0da7
  m.call(0x0da7); // unpack the 0x380D records into the 0x63AB.. region

  // ---- Epilogue: stamp cutscene tiles, seed pointers, arm the timer, advance ----
  // No hardware writes (video + work RAM only) and atomic, so the 15 per-
  // instruction charges collapse to one 163t total (see the block comment).
  regs.a = 0x10;
  mem.write8(0x76a3, regs.a, 10); // cutscene tile
  mem.write8(0x7663, regs.a, 10); // cutscene tile
  regs.a = 0xd4;
  mem.write8(0x75aa, regs.a, 10); // cutscene tile
  regs.xor(regs.a); // A = 0
  mem.write8(0x62af, regs.a); // work-RAM cutscene bookkeeping = 0

  regs.hl = 0x38b4;
  mem.write16(0x63c2, regs.hl); // seed loc_0b06's walk pointer
  regs.hl = 0x38cb;
  mem.write16(0x63c4, regs.hl); // seed loc_0b68's walk pointer

  regs.a = 0x40;
  mem.write8(SUBSTATE_TIMER, regs.a); // arm the 64-frame phase countdown
  regs.hl = INTRO_STEP; // 0x6385
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance the cutscene step; sets final F

  // ld a,0x10 (7) + ld(76a3) (13) + ld(7663) (13) + ld a,0xd4 (7) + ld(75aa) (13)
  //   + xor a (4) + ld(62af) (13) + ld hl (10) + ld(63c2),hl (16) + ld hl (10)
  //   + ld(63c4),hl (16) + ld a,0x40 (7) + ld(6009),a (13) + ld hl (10)
  //   + inc(hl) (11) = 163t
  m.step(0x0abe, 163);
  m.ret(); // ret (0x0ABE) -- 10t; pops loc_0a8a's return
}
