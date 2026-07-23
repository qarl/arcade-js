// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0874 — hand-optimized rewrite of the translated routine at ROM 0x0874,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It calls nothing (a pure leaf), so there are no
 * `m.call` callees here; the only import is the RAM *name* SPRITE_BUFFER from
 * ram.js. `translated/` stays the frozen oracle and is never edited or copied.
 */

import { SPRITE_BUFFER } from "./ram.js";

/**
 * sub_0874 -- screen + sprite-buffer CLEAR for board/power-on setup.
 *   [ROM 0x0874-0x08B1, 62 bytes; the largest fill routine in the state-0 file.]
 *
 * WHAT IT DOES. Takes no inputs and calls nothing; it stamps three fixed fills
 * and returns. Three blocks (see the oracle's disassembly header):
 *
 *   1. PLAYFIELD FILL. Writes tile 0x10 to the central 28 columns of every one
 *      of the 32 rows of the video-RAM tilemap, starting at VRAM 0x7404. The
 *      tilemap is 32 cells wide but the playfield is only the middle 28, so
 *      after each 28-cell row it steps +4 to the next row's start (28 written +
 *      4 skipped = a 0x20 stride). 896 cells.
 *   2. TWO SIDE COLUMNS. Writes tile 0x10 down two 14-cell vertical columns at
 *      VRAM 0x7522 and 0x7523, stepping one whole tilemap row (0x20) per cell.
 *      28 cells.
 *   3. SPRITE-BUFFER CLEAR. Zeroes the 384-byte sprite shadow buffer
 *      SPRITE_BUFFER (0x6900-0x6A7F) = 96 hardware sprite records x 4 bytes. The
 *      oracle does it as two djnz runs (256 then 128, `ld b,0`==256); one span
 *      here. This is the i8257 channel-0 DMA SOURCE (blitted to 0x7000 each
 *      vblank), which is the corroboration that 0x6900 is the CPU-filled buffer.
 *
 * INPUTS: none (every operand is an immediate; no register or RAM is read).
 * OUTPUTS: VRAM 0x7404.. playfield + 0x7522/0x7523 columns (tile 0x10), and
 *   SPRITE_BUFFER..+0x17F cleared to 0. Final register file (verified against the
 *   oracle, measured): A=0x00, BC=0x0000, DE=0x0020, HL=0x6A80 (=0x6900+0x180),
 *   F=0x42. HL/B/A are block 3's; DE and C are block 2's; blocks are all
 *   overwritten so block 1 leaves no observable register.
 *
 * FLAGS. The routine ends `ret` (no `ret cc`) and every caller either overwrites
 *   flags immediately (e.g. loc_08ba `xor a`) or does a flag-neutral load
 *   (handler_01c3 `ld hl`), so no caller consumes sub_0874's flags. The unit gate
 *   compares F regardless, so the terminal flags are kept EXACT: block 3 sets no
 *   flags (its `ld (hl),a`/`inc hl`/`djnz` are all flag-neutral), so the returned
 *   F is whatever block 2's final `dec c` (0x089D, c: 1->0) left. That DEC entered
 *   with carry clear (the preceding `add hl,de` at 0x0897 did not overflow) and
 *   yields Z,N set -> F=0x42. Block 2 is therefore rendered through the real regs
 *   helpers (regs.addHl / regs.djnz / regs.dec8) so the flag byte is the CPU's
 *   own, computed exactly as the oracle does it -- not a hand-coded literal.
 *
 * ATOMIC on EVERY call path -> cycles COLLAPSED (per-block totals), TOTAL
 *   preserved (measured 35690t = 35680 of m.step + 10 of ret). sub_0874 is a leaf
 *   reached only via `m.call`; grepping every m.call(0x0874) shows all 9 call
 *   sites are game-state / sub-state SETUP handlers (handler_01c3, loc_08ba/08f8,
 *   loc_0bda, loc_141e, loc_0a63, loc_07c3, handler_0779, loc_0c92) -- every one
 *   dispatched only through dispatchGameState, which runs INSIDE the vblank NMI
 *   (entry_0066). The NMI clears its own mask (0x7D84) on entry and cannot
 *   re-enter until its epilogue, so no NMI can land inside sub_0874 on any of its
 *   paths (the main-loop task table -- the only mask-ENABLED dispatch -- is the
 *   disjoint set {0x05e9,0x05c6,0x0611,0x051c,0x062a,0x06b8,0x059b} and reaches
 *   this setup routine on none of them). So its internal cycle DISTRIBUTION is
 *   unobservable and the ~2000 per-instruction m.step charges collapse to three.
 *   The TOTAL stays load-bearing -- as part of the NMI's cost it sets the
 *   main-loop spin count (README §2, SPIN_COUNT/0x6019) -- so the sum is preserved
 *   exactly and whole-machine EQUAL confirms it (a wrong total diverges at 0x6019).
 *   NO hardware-latch (0x7Dxx) writes here: blocks 1-2 are video RAM and block 3 is
 *   work RAM, both of which collapse with no write-trace consequence (cf. loc_0a8a's
 *   video/work-RAM epilogue), so a full per-block collapse is safe.
 */
export function sub_0874(m) {
  const { regs, mem } = m;

  // ---- Block 1: fill the central 28 columns of 32 tilemap rows with tile 0x10
  // [ROM 0x0874-0x0889]. No register survives (block 2 reloads them all), so the
  // oracle's per-row b/c/a/de churn is dropped -- this is a pure memory fill.
  let cell = 0x7404;
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 28; col++) {
      mem.write8(cell, 0x10);
      cell = (cell + 1) & 0xffff;
    }
    cell = (cell + 4) & 0xffff; // skip the 4 non-playfield cells to the next row
  }
  m.step(0x0889, 24721); // ROM 0x0874..0x0886 executed 32x28; total of the block's m.step charges

  // ---- Block 2: two 14-cell vertical columns at VRAM 0x7522 / 0x7523 (tile 0x10)
  // [ROM 0x0889-0x08A0]. Rendered faithfully through the regs helpers: this block's
  // terminal `dec c` fixes the flags the routine returns with (F=0x42), and its
  // DE=0x0020 and C=0 survive to the end. (`ld a,0x10` is loaded ONCE before the
  // loop -- the `jp nz,0x0893` re-enters at `ld b`, not at the load -- so it is not
  // re-charged; the collapsed total already accounts for that.)
  regs.hl = 0x7522;
  regs.de = 0x0020; // one whole tilemap row between cells of a column
  regs.c = 0x02; // two columns
  regs.a = 0x10; // tile
  do {
    regs.b = 0x0e; // 14 cells per column
    do {
      mem.write8(regs.hl, regs.a);
      regs.addHl(regs.de);
    } while (regs.djnz() !== 0);
    regs.hl = 0x7523; // second column base
    regs.c = regs.dec8(regs.c);
  } while (regs.fNZ);
  m.step(0x08a0, 954); // total of block 2's m.step charges

  // ---- Block 3: clear the 384-byte sprite shadow buffer 0x6900-0x6A7F
  // [ROM 0x08A0-0x08B1]. The oracle clears it in two djnz runs (256 + 128);
  // idiomatically it is one span. These loop instructions set NO flags, so F is
  // left as block 2's. HL/B/A here are the routine's final register values.
  for (let addr = SPRITE_BUFFER; addr < SPRITE_BUFFER + 0x180; addr++) {
    mem.write8(addr, 0x00);
  }
  regs.hl = 0x6a80; // SPRITE_BUFFER + 0x180, where the two djnz runs leave HL
  regs.b = 0x00; // both djnz runs decremented B to 0
  regs.a = 0x00; // the fill value
  m.step(0x08b1, 10005); // total of block 3's m.step charges

  m.ret(); // ret (0x08B1) -- 10t; pops the caller's return address
}
