// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_17b6 — hand-optimized rewrite of the translated routine at ROM 0x17B6,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x011C, 0x0514, 0x1826, 0x0DA7, 0x004E,
 * 0x0038) is reached through `m.call(0xADDR)`, the routine registry
 * (games/dkong/routines.js), so each resolves to the oracle — or to that
 * callee's own optimized rewrite once one exists — never a copy. Only RAM
 * *names* are imported (from ram.js).
 */

import { SND_PRIORITY, SND_PRIORITY_FRAMES, SUBSTATE_TIMER } from "./ram.js";

/**
 * loc_17b6 -- 0x1644 idx 0: the 0x6388-sequence SETUP arm.  [ROM 0x17B6-0x1825]
 *
 * Reached during BOARD-ADVANCE (game sub-state GAME_SUBSTATE(0x600A)==0x16) for a
 * board whose low two bits of BOARD(0x6227) are clear (100m, 0x6227==4): the
 * dispatch chain is dispatchGameState(0x6005==3) -> loc_06fe -> loc_1615 ->
 * sub_1641 -> `rst 0x28` on the 0x6388 selector via the 6-entry table at 0x1648,
 * whose entry 0 (selector 0x6388==0) is this routine. It is the one-time SETUP
 * step of that sequence: it lays down the four "how-high" glyphs, arms the phase
 * countdown, repoints the shared rate-limiter, and advances the selector so the
 * NEXT frame dispatches the following arm (0x1839/0x186f/... never re-runs setup).
 *
 * WHAT IT DOES (straight-line; no data-dependent branch — one path):
 *   - call 0x011C  (unconditional prologue helper).
 *   - SND_PRIORITY(0x608A) <- 0x0E, SND_PRIORITY_FRAMES(0x608B) <- 3: queue a
 *     3-frame priority tune for the board-advance moment.
 *   - Two descending 3-cell VRAM fills via sub_0514 (A=0x10, DE=0x0020 live-in),
 *     at HL=0x7623 then HL=0x7583 (sub_0514 preserves A/DE between them).
 *   - Four render pairs: for each item, `ld hl,vram / call 0x1826` (place) then
 *     `ld de,romrec / call 0x0DA7` (unpack the record). Items 0x76DA/0x76D5/
 *     0x76D0/0x76CB from ROM records 0x3A47/0x3A4D/0x3A53/0x3A59.
 *   - call 0x004E (HL=0x385C: draw a fixed string).
 *   - rst 0x38 add-loop over HL=0x6908 with C=0x44.
 *   - 0x6905 <- 0x13 (object/record scratch), SUBSTATE_TIMER(0x6009) <- 0x20
 *     (arm a 32-frame phase countdown), 0x6390 <- 0x80 (engine scratch flag).
 *   - inc (0x6388): advance the sequence selector 0->1 (HL stays 0x6388).
 *   - (0x63C0) <- 0x6388: REPOINT the shared rate-limiter loc_3069 at the selector.
 *
 * INPUTS: none read from RAM — every value is an immediate or a ROM table walked
 *   by a callee. OUTPUTS (RAM written by THIS routine's body): SND_PRIORITY,
 *   SND_PRIORITY_FRAMES, 0x6905, SUBSTATE_TIMER, 0x6390, 0x6388 (inc'd), and the
 *   16-bit 0x63C0 pointer; plus whatever the six callees write (VRAM glyphs, the
 *   0x63xx record region). Registers left: A=0x80, HL=0x6388, C=0x44; DE and the
 *   rest are whatever the last callees leave (the epilogue does not touch them)
 *   and are not read downstream.
 *
 * FLAGS: the routine ends in an UNCONDITIONAL `ret`; its caller (sub_0028's
 *   rst-0x28 tail up through sub_1641/loc_1615/loc_06fe/the NMI) makes no `ret cc`
 *   and branches on no flag it sets. But the unit gate compares F, so the only
 *   flag-writer on the path — the final `inc (0x6388)` — is kept verbatim via
 *   `regs.incMem8`, giving F == the oracle's (0->1: S/Z/H/PV/N clear, C preserved).
 *   Every register load the oracle makes is a live-in to a callee, so all are kept
 *   verbatim too; only the per-instruction m.step cycle charges are collapsed.
 *
 * ATOMIC — cycles collapsed, TOTAL preserved (own charge = 506t: 21+80+27 +
 *   4*(27+27) + 27+28+97 + 10 ret). loc_17b6 runs INSIDE the vblank NMI
 *   (dispatchGameState enters with the NMI mask cleared and does not re-enter), so
 *   the NMI can never land inside it OR any of its callees — the whole subtree runs
 *   with interrupts disabled. Its internal cycle DISTRIBUTION is therefore
 *   unobservable and the ~35 per-instruction m.step charges collapse to one per
 *   call-segment (the preceding straight-line run + that call's cost) plus one for
 *   the call-free epilogue. Each collapsed charge is placed in the m.step
 *   IMMEDIATELY before its call, so every callee still starts at the oracle's exact
 *   cumulative cycle. The TOTAL stays load-bearing — as part of the NMI's cost it
 *   sets the main-loop vblank-spin count (README §2, SPIN_COUNT) — so the sum is
 *   preserved exactly; whole-machine EQUAL and the wrong-total teeth confirm it.
 *   NO hardware writes in this routine's own body (all stores are work/video RAM,
 *   never a 0x7Dxx latch), so the collapse has no write-trace consequence and none
 *   is needed.
 */
export function loc_17b6(m) {
  const { regs, mem } = m;

  // nop (4) + call 0x011c (17) = 21t
  m.push16(0x17ba); m.step(0x011c, 21); m.call(0x011c);

  // Queue the 3-frame priority tune for the board-advance moment.
  mem.write8(SND_PRIORITY, 0x0e);
  mem.write8(SND_PRIORITY_FRAMES, 0x03);

  // Two descending 3-cell VRAM fills (sub_0514: A/DE live-in, preserved between).
  regs.a = 0x10;
  regs.de = 0x0020;
  regs.hl = 0x7623;
  // ld hl,608a (10)+ld(hl)(10)+inc hl(6)+ld(hl)(10)+ld a(7)+ld de(10)+ld hl(10)+call(17)=80t
  m.push16(0x17cd); m.step(0x0514, 80); m.call(0x0514);
  regs.hl = 0x7583;
  // ld hl,7583 (10) + call (17) = 27t
  m.push16(0x17d3); m.step(0x0514, 27); m.call(0x0514);

  // Four render pairs: place the item glyph (0x1826), then unpack its ROM record
  // (0x0DA7). Each half is ld reg,imm (10) + call (17) = 27t.
  for (const [vhl, rde, retA, retB] of [
    [0x76da, 0x3a47, 0x17d9, 0x17df],
    [0x76d5, 0x3a4d, 0x17e5, 0x17eb],
    [0x76d0, 0x3a53, 0x17f1, 0x17f7],
    [0x76cb, 0x3a59, 0x17fd, 0x1803],
  ]) {
    regs.hl = vhl;
    m.push16(retA); m.step(0x1826, 27); m.call(0x1826);
    regs.de = rde;
    m.push16(retB); m.step(0x0da7, 27); m.call(0x0da7);
  }

  // Draw the fixed string at HL=0x385C.
  regs.hl = 0x385c;
  m.push16(0x1809); m.step(0x004e, 27); m.call(0x004e); // ld hl (10) + call (17)

  // rst 0x38 add-loop over 0x6908 with C=0x44.
  regs.hl = 0x6908;
  regs.c = 0x44;
  // ld hl (10) + ld c (7) + rst 0x38 (11) = 28t
  m.push16(0x180f); m.step(0x0038, 28); m.call(0x0038);

  // ---- Epilogue: object scratch, arm the phase timer, advance the selector,
  //      repoint the rate-limiter. Call-free + atomic, so 9 charges collapse to
  //      one 97t total (ret adds 10t). ----
  mem.write8(0x6905, 0x13);
  regs.a = 0x20;
  mem.write8(SUBSTATE_TIMER, regs.a); // arm the 32-frame phase countdown
  regs.a = 0x80;
  mem.write8(0x6390, regs.a);
  regs.hl = 0x6388;
  regs.incMem8(mem, regs.hl); // inc (0x6388) -- advance selector; HL stays 0x6388; sets final F
  mem.write16(0x63c0, regs.hl); // REPOINT loc_3069 at the 0x6388 selector

  // ld hl,6905 (10) + ld(hl) (10) + ld a (7) + ld(6009) (13) + ld a (7)
  //   + ld(6390) (13) + ld hl (10) + inc(hl) (11) + ld(63c0),hl (16) = 97t
  m.step(0x1825, 97);
  m.ret(); // ret (0x1825) -- 10t; pops loc_17b6's return
}
