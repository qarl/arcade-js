// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_16a3 — hand-optimized rewrite of the translated routine at ROM 0x16A3,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its three callees (0x1708, 0x004E, 0x0038) are reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to a future optimized rewrite — never a copy. No
 * RAM name from ram.js applies here (every address this routine touches —
 * 0x6910, 0x6908, 0x6388 — is on ram.js's deliberately-unnamed list, and 0x385C
 * is a ROM table, not RAM), so nothing is imported: names are only claimed where
 * evidenced (README §4).
 */

/**
 * loc_16a3 -- BOARD-ADVANCE object-block load, selector entry 0. [ROM 0x16A3-
 * 0x16BA. Dispatched from INSIDE the vblank NMI during board-advance:
 * dispatchGameState(GAME_STATE(0x6005)==3) -> loc_06fe -> loc_1615
 * (GAME_SUBSTATE(0x600A)==0x16) -> rst 0x28 on the 0x6388 selector via the table
 * at 0x1637 ([16a3,16bb,1732,1757,178e]) when BOARD(0x6227) has bit0 clear/bit1
 * set (e.g. 0x02=50m) -> this routine when the selector 0x6388==0. The exact
 * sibling of loc_17b6, which is entry 0 of the neighbouring 0x1648 table.]
 *
 * WHAT IT DOES. Straight-line, one path (no data-dependent branch):
 *   - call 0x1708 (sub_1708): the spawn/setup helper -- runs the sound driver
 *     (0x011C), stamps a 4-byte object record 80 76 09 20 at 0x6A20, writes
 *     0x6905<-0x13, paints a colour column (0x0514), and arms the sound-priority
 *     pair 0x608A/0x608B. (Its hardware writes are discussed under ATOMIC below.)
 *   - ld a,(0x6910) / sub 0x3B: read the object-block descriptor byte at 0x6910
 *     and bias it by -0x3B to form the record count/index passed on in C.
 *   - ld hl,0x385C / call 0x004E (sub_004E): block-copy 0x28 bytes from the ROM
 *     template at 0x385C into the object block at 0x6908..0x692F (sub_004E's
 *     ldir has DE=0x6908, BC=0x28 hard-wired; HL is the source we set here).
 *   - ld hl,0x6908 / ld c,a / rst 0x38 (loc_0038): walk the freshly-copied block
 *     (HL=0x6908, C=the biased count) through the rst-0x38 record filler.
 *   - ld hl,0x6388 / inc (0x6388): advance the sequence selector so the NEXT
 *     board-advance NMI dispatches the following entry instead of re-running this.
 *
 * INPUTS (read): 0x6910 (object-block descriptor byte); the ROM template at
 *   0x385C; plus whatever sub_1708 / sub_004E / loc_0038 read. OUTPUTS (written):
 *   everything the three callees write (0x6A20.. record, 0x6905, the 0x0514
 *   colour column in video RAM, 0x608A/0x608B, the sound latches via 0x011C, and
 *   the 0x6908.. object block), plus this routine's own single store `inc
 *   (0x6388)`. On exit A = loc_0038's result, C = the same, HL = 0x6388, F =
 *   `inc (0x6388)`'s flags.
 *
 * FLAGS. Nothing downstream consumes loc_16a3's flags -- its caller is the rst
 *   0x28 dispatch tail (loc_1615), which makes no `ret cc` and branches on no
 *   flag this routine sets. But the unit gate compares the whole register file,
 *   F included, so every value-and-flag op is kept verbatim: `sub 0x3B` (sets A
 *   AND F, and A feeds C -> rst 0x38, so it is load-bearing for VALUE regardless)
 *   and the final `inc (0x6388)` (sets the observable exit F: for 0->1 that is
 *   0x00, with carry whatever the last callee (rst 0x38 -> sub_003d) left, since
 *   `inc` preserves it). The register loads (HL) and `ld c,a` set no flags. The
 *   callees' flag effects arrive identically because they run via m.call, unchanged.
 *
 * ATOMIC -- cycles collapsed, TOTAL preserved (own total 120t = 17 + 13+7+10+17
 *   + 10+4+11 + 10+11 + 10). loc_16a3 runs INSIDE the vblank NMI
 *   (dispatchGameState), where the NMI mask is held, so the NMI can never land
 *   inside it OR inside any of its three callees -- they all execute with
 *   interrupts disabled. So its internal cycle DISTRIBUTION is unobservable and
 *   the ~11 per-instruction m.step charges collapse to ONE per call-segment
 *   (17 / 47 / 25) plus one call-free epilogue (21), each charge placed
 *   IMMEDIATELY BEFORE its m.call so every callee still starts at the oracle's
 *   exact cumulative cycle. The TOTAL stays load-bearing -- as part of the NMI's
 *   cost it sets the main-loop vblank-spin count (README §2, SPIN_COUNT) and
 *   where a LATER frame's NMI lands in diffed stack RAM -- so the sum is
 *   preserved exactly; whole-machine EQUAL confirms it and a wrong total is
 *   caught (see the test).
 *
 *   HARDWARE WRITES belong to a CALLEE, not to loc_16a3. sub_1708's first act is
 *   call 0x011C, the sound driver, which latches 0x7C00 / 0x7D00-0x7D07 / 0x7D80
 *   -- real hardware writes with a bus-cycle position in the emit.js --writes
 *   trace. loc_16a3 itself writes NO hardware register (its own stores are
 *   0x6388 only). Because the charge for the call that CONTAINS them (seg A) is
 *   exactly 17t and sits immediately before m.call(0x1708) -- there are no
 *   instructions before it to lump in -- 0x1708 (hence 0x011C) starts at the
 *   oracle's exact +17t, so those hardware writes keep their bus cycle. The
 *   write-trace test proves this and shows a fully-collapsed prologue (starting
 *   the call early) would shift them (teeth). Like loc_0a8a's worked pattern,
 *   except here the writes are one call deep rather than loc_16a3's own.
 */
export function loc_16a3(m) {
  const { regs, mem } = m;

  // call 0x1708 -- spawn/setup helper (runs the sound driver 0x011C, stamps the
  // 0x6A20 object record + 0x6905, paints a colour column, arms 0x608A/B).
  // seg-A total 17t = just the `call` itself; placed here so 0x1708 (and its
  // 0x011C hardware writes) start at the oracle's exact +17t.
  m.push16(0x16a6);
  m.step(0x1708, 17);
  m.call(0x1708);

  // ld a,(0x6910) / sub 0x3B -- object-block descriptor byte, biased by -0x3B to
  // the record count carried on to rst 0x38 in C. (sets A and F.)
  regs.a = mem.read8(0x6910);
  regs.sub(0x3b);

  // ld hl,0x385C / call 0x004E -- block-copy the 0x28-byte ROM template at 0x385C
  // into the object block at 0x6908.. (sub_004E hard-wires DE=0x6908, BC=0x28).
  // seg-B total 47t = ld a(13) + sub(7) + ld hl(10) + call(17).
  regs.hl = 0x385c;
  m.push16(0x16b1);
  m.step(0x004e, 47);
  m.call(0x004e);

  // ld hl,0x6908 / ld c,a / rst 0x38 -- walk the copied object block (HL=0x6908,
  // C=the biased count) through the rst-0x38 record filler (loc_0038).
  // seg-C total 25t = ld hl(10) + ld c,a(4) + rst(11).
  regs.hl = 0x6908;
  regs.c = regs.a;
  m.push16(0x16b6);
  m.step(0x0038, 25);
  m.call(0x0038);

  // ld hl,0x6388 / inc (0x6388) -- advance the board-advance sequence selector so
  // the next NMI dispatches the following entry. Sets the observable exit F.
  // epilogue total 21t = ld hl(10) + inc(hl)(11); then ret (10t).
  regs.hl = 0x6388;
  regs.incMem8(mem, regs.hl);
  m.step(0x16ba, 21);
  m.ret(10);
}
