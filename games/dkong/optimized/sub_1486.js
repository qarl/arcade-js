// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_1486 — hand-optimized rewrite of the translated routine at ROM 0x1486,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0616 the frame-interrupt helper, 0x15fa the
 * item renderer, 0x057c the 6-digit renderer, 0x309f the task enqueuer) is reached
 * through `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to its own optimized rewrite once one exists — never a
 * copy. Only RAM *names* are imported (from ram.js); code is never imported.
 */

import { SUBSTATE_TIMER, P1_INPUT } from "./ram.js";

// The two-bit palette-bank select latch (ls259.6h at 0x7D86/0x7D87) — a board
// control OUTPUT, not work RAM, so it lives in the board (io.js writePaletteBank),
// not ram.js. sub_1486's init clears both bits to 0 (bank %00). Same two addresses
// loc_0a8a names PALETTE_BANK_LO/HI.
const PALETTE_BANK_LO = 0x7d86;
const PALETTE_BANK_HI = 0x7d87;

/**
 * sub_1486 -- the on-board BONUS-ITEM mover + value-digit display, the GAME_SUBSTATE
 * (0x600A) phase-21 handler. [ROM 0x1486-0x15F9, 372 bytes; entry 21 (0x15) of
 * loc_06fe's 0x0702 rst-0x28 sub-state table, reached via dispatchGameState -> loc_06fe
 * while GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==21. Dispatched from INSIDE the
 * vblank NMI, mask-cleared.]
 *
 * WHAT IT DOES. Drives the collectible bonus item (parasol/hat/bag) that appears on a
 * board: its position walk, its animated sprite, and the countdown value shown beside
 * it. Three top-level modes, selected by the handler's own latch SUBSTATE_TIMER(0x6009)
 * -- reused HERE not as the rst-0x18 countdown but as an init/running/done flag:
 *
 *   INIT (0x6009 == 0), the one-shot setup [0x1494-0x14DB]:
 *     - Clear both palette-bank latches (PALETTE_BANK_LO/HI := 0).  [HARDWARE writes]
 *     - Mark running: SUBSTATE_TIMER(0x6009) := 1.
 *     - Seed the item-state block: (0x6030):=0x0A (position reload), (0x6031):=0
 *       (sprite toggle), (0x6032):=0x10 (anim timer), (0x6033):=0x1E (value=30),
 *       (0x6034):=0x3E (display timer), (0x6035):=0 (position index).
 *     - Set the video pointer (0x6036) := 0x75E8.
 *     - Locate the item's video slot: scan the 0x611C table (stride 0x22, 4 rows) for
 *       the key C = 2*(0x600E)+1; store the matched row ptr at (0x6038) and row-0x0D at
 *       (0x603A). (No match leaves HL at the 4th row, B=0 -- the ROM does not guard it.)
 *     - Render once via sub_15fa (B=0, C=(0x6035)), then FALL INTO the main loop.
 *
 *   MAIN LOOP (0x6009 != 0), every frame [0x14DC-0x15F8], three stages:
 *     1. DISPLAY TIMER [0x14DF]: dec (0x6034); on wrap reload 0x3E and dec the value
 *        (0x6033). Value hitting 0 jumps to EXIT. Otherwise BCD-split the value into
 *        ones/tens and write them to the two on-screen digit cells 0x7552 / 0x7572.
 *     2. POSITION STEP [0x14FF]: reload (0x6030):=0x0A; read P1_INPUT(0x6010). Bit 7
 *        set -> the 0x1546 video-COLUMN walk (0x7588/0x7608 sentinels, wraps the video
 *        ptr 0x6036, and value 0x1D there EXITs). Bit 7 clear -> the low-2-bit step
 *        (0x1514): dec the frame divider (0x6030) and, on its expiry, inc/dec the
 *        position index (0x6035) with wrap across 0..0x1D, re-rendering via sub_15fa.
 *     3. SPRITE ANIMATE [0x158A]: dec the anim timer (0x6032); only on expiry toggle
 *        (0x6031) and redraw the 6-digit sprite -- IX taken from (iy+4/5) with
 *        iy=(0x6038), rendered by sub_057c -- then reload (0x6032):=0x10. Converges on
 *        the single ret at 0x15F9.
 *
 *   EXIT / cleanup (value==0 or the column walk hit 0x1D) [0x15C6]:
 *     - Clear the item slot ((0x6038) -> 0).
 *     - SUBSTATE_TIMER(0x6009) := 0x80 (done).
 *     - dec GAME_SUBSTATE(0x600A) -- the phase STEP-BACK to the previous sub-state (do
 *       NOT fold or drop this; it is how the phase machine advances past this handler).
 *     - Copy the 0x0C-cell video column (0x75E8 walking up by 0x20) into iy=(0x603A).
 *     - Enqueue follow-up tasks 0x0314..0x0318 (5x, DE++ each) then 0x031A, via sub_309f.
 *
 * INPUTS (RAM read): SUBSTATE_TIMER(0x6009) mode latch; 0x600E slot key; the item-state
 *   block 0x6030-0x6036/0x6038/0x603A; P1_INPUT(0x6010); the 0x611C slot table; plus the
 *   task-ring pointers (via sub_309f). OUTPUTS (RAM written): the item-state block; the
 *   on-screen digit cells 0x7552/0x7572; video RAM (via the column walk / sub_15fa /
 *   sub_057c / the exit copy); SUBSTATE_TIMER; GAME_SUBSTATE (decremented at exit); the
 *   task queue; and the two palette-bank HARDWARE latches (init only).
 *
 * IRREDUCIBLE CFG. The ROM has backward cross-jumps (0x1543->0x152D, 0x1587->0x1580,
 *   0x15C3->0x15A0) and multiple fall-throughs, so it does NOT reduce to structured
 *   if/for. It is transcribed as a label-dispatch loop: each ROM label is a switch
 *   case, each `jp` is `label = X; continue`, and ROM fall-through is switch
 *   fall-through -- the same idiom the oracle uses (all paths converge on the single
 *   `ret` at 0x15F9). Named RAM, local hardware-latch constants and section comments
 *   are the readability win; the branch topology is the ROM's.
 *
 * FLAGS. The routine ends in a plain `ret` (not `ret cc`), and its caller (loc_06fe's
 *   rst-0x28 `jp (hl)` tail) consumes no flag it sets -- so no flag is load-bearing to
 *   the CALLER. But the unit gate compares the WHOLE register file (F included) at the
 *   ret, and several in-routine branches DO read the flags of the instruction just
 *   before them (`dec (hl)`/`jp nz`/`jp z` on 0x6034/0x6033/0x6032; `bit 7`/`bit 1`;
 *   `jp p` on the SIGNED `sub 0x01` at 0x153E; the `sbc hl,bc` compares each preceded by
 *   `and a` to clear carry). Every flag-affecting op is therefore kept VERBATIM
 *   (regs.decMem8 / regs.bit / regs.sub / regs.cp / regs.sbcHl / regs.and, etc.), so both
 *   the in-routine branch decisions and the final observable F match the oracle exactly.
 *
 * CYCLES -- PER-INSTRUCTION (not collapsed), the byte-identical low-risk choice; the
 *   TOTAL of every path is preserved because every path is preserved instruction for
 *   instruction. Reasoning, and why NOT collapsed:
 *     - sub_1486 IS atomic in the usual sense (it runs inside the vblank NMI, entered
 *       mask-cleared, so no second NMI lands inside it or its callees), so a per-SEGMENT
 *       collapse (à la loc_1839) would very probably also read EQUAL. It is deliberately
 *       NOT taken here, matching the choice loc_06fe -- this routine's OWN in-game
 *       dispatcher -- documents for the state-3 family: the marginal win (fewer m.step
 *       lines) is not worth departing from a byte-identical transcription on a routine
 *       this large with this branch density.
 *     - Two concrete complications reinforce that: (a) the INIT branch makes real
 *       HARDWARE writes to PALETTE_BANK_LO/HI, and (b) every m.call site pushes a return
 *       address into diffed stack RAM straddling the cycle charges (same shape as
 *       loc_06fe's rst push). Per-instruction keeps every hardware write and every stack
 *       write at the oracle's exact cumulative cycle for free.
 *     - HARDWARE-WRITE NOTE: unlike loc_0a8a's palette writes, the ORACLE leaves these
 *       two writes UNTAGGED (no write-bus-cycle offset). So under the emit `--writes`
 *       trace BOTH the oracle and this routine THROW identically (memory.js refuses an
 *       untagged hardware write) -- there is no numeric bus cycle to preserve, and the
 *       write-trace test pins exactly that equivalence (and that a busOffset-adding
 *       variant, which would NOT throw, is caught). Reproducing the oracle means writing
 *       PALETTE_BANK_LO/HI with NO busOffset here too; "fixing" them would DIVERGE.
 *
 * REGISTERS. IX/IY/HL/DE/BC/A/F on exit are whatever the last executed instruction (or
 *   the last callee -- sub_309f at exit, sub_057c/sub_15fa mid-loop) leaves; the ROM's
 *   register walks (HL down the state block, the 0x611C search, the iy digit walk) are
 *   kept verbatim so the unit gate's full register-file compare matches on every path.
 */
export function sub_1486(m) {
  const { regs, mem } = m;
  let label = 0x1486;
  for (;;) {
    switch (label) {
      case 0x1486:
        // call 0x0616 -- the shared frame-interrupt/enable helper (interruptible).
        m.push16(0x1489);
        m.step(0x0616, 17); // call 0x0616 (INT)
        m.call(0x0616);

        // ld a,(SUBSTATE_TIMER) / and a -- the handler's mode latch: 0 => INIT below,
        // nonzero => already running, jump straight to the MAIN LOOP.
        regs.hl = SUBSTATE_TIMER; // 0x6009
        m.step(0x148c, 10); // ld hl,0x6009
        regs.a = mem.read8(regs.hl);
        m.step(0x148d, 7); // ld a,(hl)
        regs.and(regs.a);
        m.step(0x148e, 4); // and a
        if (regs.fNZ) { label = 0x14dc; continue; } // jp nz,0x14dc -- already running
        m.step(0x1491, 10); // jp nz NOT taken

        // ---- INIT (SUBSTATE_TIMER == 0, so A == 0) --------------------------------
        // Clear both palette-bank latches (bank %00). HARDWARE writes, kept UNTAGGED to
        // match the oracle byte-for-byte (see the CYCLES/HARDWARE-WRITE note above).
        mem.write8(PALETTE_BANK_LO, regs.a);
        m.step(0x1494, 13); // ld (0x7d86),a -- clear latch
        mem.write8(PALETTE_BANK_HI, regs.a);
        m.step(0x1497, 13); // ld (0x7d87),a
        mem.write8(regs.hl, 0x01);
        m.step(0x1499, 10); // ld (hl),0x01 -- SUBSTATE_TIMER := 1 (running)

        // Seed the item-state block 0x6030..0x6035 by walking HL (kept as the ROM does).
        regs.hl = 0x6030;
        m.step(0x149c, 10); // ld hl,0x6030
        mem.write8(regs.hl, 0x0a);
        m.step(0x149e, 10); // (0x6030) := 0x0A  position reload
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x149f, 6); // inc hl
        mem.write8(regs.hl, 0x00);
        m.step(0x14a1, 10); // (0x6031) := 0     sprite toggle
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x14a2, 6); // inc hl
        mem.write8(regs.hl, 0x10);
        m.step(0x14a4, 10); // (0x6032) := 0x10  anim timer
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x14a5, 6); // inc hl
        mem.write8(regs.hl, 0x1e);
        m.step(0x14a7, 10); // (0x6033) := 0x1E  value = 30
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x14a8, 6); // inc hl
        mem.write8(regs.hl, 0x3e);
        m.step(0x14aa, 10); // (0x6034) := 0x3E  display timer
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x14ab, 6); // inc hl
        mem.write8(regs.hl, 0x00);
        m.step(0x14ad, 10); // (0x6035) := 0     position index

        // Video pointer (0x6036) := 0x75E8.
        regs.hl = 0x75e8;
        m.step(0x14b0, 10); // ld hl,0x75e8
        mem.write16(0x6036, regs.hl);
        m.step(0x14b3, 16); // ld (0x6036),hl

        // Locate the item slot: scan the 0x611C table (stride 0x22, B=4 rows) for the
        // key C = 2*(0x600E)+1.
        regs.hl = 0x611c;
        m.step(0x14b6, 10); // ld hl,0x611c -- slot table
        regs.a = mem.read8(0x600e);
        m.step(0x14b9, 13); // ld a,(0x600e)
        regs.rlca();
        m.step(0x14ba, 4); // rlca            -- A = 2*(0x600E)
        regs.a = regs.inc8(regs.a);
        m.step(0x14bb, 4); // inc a           -- A = 2*(0x600E)+1
        regs.c = regs.a;
        m.step(0x14bc, 4); // ld c,a          -- C = search key
        regs.de = 0x0022;
        m.step(0x14bf, 10); // ld de,0x0022   -- stride
        regs.b = 0x04;
        m.step(0x14c1, 7); // ld b,0x04       -- 4 entries
      // fall into the search loop
      case 0x14c1:
        regs.a = mem.read8(regs.hl);
        m.step(0x14c2, 7); // ld a,(hl)
        regs.cp(regs.c);
        m.step(0x14c3, 4); // cp c
        if (regs.fZ) { label = 0x14c9; continue; } // jp z,0x14c9 -- match
        m.step(0x14c6, 10); // jp z NOT taken
        regs.addHl(regs.de);
        m.step(0x14c7, 11); // add hl,de -- next row
        regs.djnz();
        m.step(regs.b ? 0x14c1 : 0x14c9, regs.b ? 13 : 8); // djnz 0x14c1
        if (regs.b) { label = 0x14c1; continue; }
      // fall into 0x14c9 (no match -> HL at 4th row, B=0; the ROM does not guard this)
      case 0x14c9:
        mem.write16(0x6038, regs.hl);
        m.step(0x14cc, 16); // ld (0x6038),hl -- slot ptr
        regs.de = 0xfff3;
        m.step(0x14cf, 10); // ld de,0xfff3   (= -0x0D)
        regs.addHl(regs.de);
        m.step(0x14d0, 11); // add hl,de      -- HL -= 0x0D
        mem.write16(0x603a, regs.hl);
        m.step(0x14d3, 16); // ld (0x603a),hl -- slot - 0x0D
        // First render: B=0, C=(0x6035).
        regs.b = 0x00;
        m.step(0x14d5, 7); // ld b,0x00
        regs.a = mem.read8(0x6035);
        m.step(0x14d8, 13); // ld a,(0x6035)
        regs.c = regs.a;
        m.step(0x14d9, 4); // ld c,a
        m.push16(0x14dc);
        m.step(0x15fa, 17); // call 0x15fa -- render (INT)
        m.call(0x15fa);
      // fall into the MAIN LOOP

      // ==== MAIN LOOP stage 1: DISPLAY TIMER + value countdown ====================
      case 0x14dc:
        regs.hl = 0x6034;
        m.step(0x14df, 10); // ld hl,0x6034 -- display timer
        regs.decMem8(mem, regs.hl);
        m.step(0x14e0, 11); // dec (hl)
        if (regs.fNZ) { label = 0x14fc; continue; } // jp nz,0x14fc -- still counting
        m.step(0x14e3, 10); // jp nz NOT taken
        mem.write8(regs.hl, 0x3e);
        m.step(0x14e5, 10); // ld (hl),0x3e -- reload display timer
        regs.hl = (regs.hl - 1) & 0xffff;
        m.step(0x14e6, 6); // dec hl -> 0x6033 (value)
        regs.decMem8(mem, regs.hl);
        m.step(0x14e7, 11); // dec (hl) -- value--
        if (regs.fZ) { label = 0x15c6; continue; } // jp z,0x15c6 -- value == 0 EXIT
        m.step(0x14ea, 10); // jp z NOT taken
        regs.a = mem.read8(regs.hl);
        m.step(0x14eb, 7); // ld a,(hl) -- the value
        regs.b = 0xff;
        m.step(0x14ed, 7); // ld b,0xff -- tens accumulator (pre-inc)
      // fall into the BCD split loop
      case 0x14ed:
        regs.b = regs.inc8(regs.b);
        m.step(0x14ee, 4); // inc b
        regs.sub(0x0a);
        m.step(0x14f0, 7); // sub 0x0a
        if (regs.fNC) { label = 0x14ed; continue; } // jp nc,0x14ed -- keep subtracting
        m.step(0x14f3, 10); // jp nc NOT taken
        regs.add(0x0a);
        m.step(0x14f5, 7); // add a,0x0a -- A = ones digit, B = tens digit
        mem.write8(0x7552, regs.a);
        m.step(0x14f8, 13); // ld (0x7552),a -- ones -> video
        regs.a = regs.b;
        m.step(0x14f9, 4); // ld a,b
        mem.write8(0x7572, regs.a);
        m.step(0x14fc, 13); // ld (0x7572),a -- tens -> video
      // fall into stage 2

      // ==== MAIN LOOP stage 2: POSITION STEP ======================================
      case 0x14fc:
        regs.hl = 0x6030;
        m.step(0x14ff, 10); // ld hl,0x6030 -- frame divider
        regs.b = mem.read8(regs.hl);
        m.step(0x1500, 7); // ld b,(hl)
        mem.write8(regs.hl, 0x0a);
        m.step(0x1502, 10); // ld (hl),0x0a -- reload divider
        regs.a = mem.read8(P1_INPUT);
        m.step(0x1505, 13); // ld a,(0x6010) -- cooked control word
        regs.bit(7, regs.a);
        m.step(0x1507, 8); // bit 7,a
        if (regs.fNZ) { label = 0x1546; continue; } // jp nz,0x1546 -- bit7: column walk
        m.step(0x150a, 10); // jp nz NOT taken
        regs.and(0x03);
        m.step(0x150c, 7); // and 0x03
        if (regs.fNZ) { label = 0x1514; continue; } // jp nz,0x1514 -- low bits set
        m.step(0x150f, 10); // jp nz NOT taken
        regs.a = regs.inc8(regs.a);
        m.step(0x1510, 4); // inc a -- A := 1
        mem.write8(regs.hl, regs.a);
        m.step(0x1511, 7); // ld (hl),a -- (0x6030) := 1
        label = 0x158a;
        continue; // jp 0x158a -- straight to sprite animate
      case 0x1514:
        regs.b = regs.dec8(regs.b);
        m.step(0x1515, 4); // dec b -- frame divider
        if (regs.fZ) { label = 0x151d; continue; } // jp z,0x151d -- divider expired
        m.step(0x1518, 10); // jp z NOT taken
        regs.a = regs.b;
        m.step(0x1519, 4); // ld a,b
        mem.write8(regs.hl, regs.a);
        m.step(0x151a, 7); // ld (hl),a -- (0x6030) := B (store the decremented divider)
        label = 0x158a;
        continue; // jp 0x158a
      case 0x151d:
        // Divider expired: step the position index (0x6035) in the direction from bit 1.
        regs.bit(1, regs.a);
        m.step(0x151f, 8); // bit 1,a
        if (regs.fNZ) { label = 0x1539; continue; } // jp nz,0x1539 -- decrement path
        m.step(0x1522, 10); // jp nz NOT taken
        regs.a = mem.read8(0x6035);
        m.step(0x1525, 13); // ld a,(0x6035)
        regs.a = regs.inc8(regs.a);
        m.step(0x1526, 4); // inc a
        regs.cp(0x1e);
        m.step(0x1528, 7); // cp 0x1e
        if (regs.fNZ) { label = 0x152d; continue; } // jp nz,0x152d -- no wrap
        m.step(0x152b, 10); // jp nz NOT taken
        regs.a = 0x00;
        m.step(0x152d, 7); // ld a,0x00 -- wrap 0x1E -> 0
      // fall into store-and-render
      case 0x152d:
        mem.write8(0x6035, regs.a);
        m.step(0x1530, 13); // ld (0x6035),a
        regs.c = regs.a;
        m.step(0x1531, 4); // ld c,a
        regs.b = 0x00;
        m.step(0x1533, 7); // ld b,0x00
        m.push16(0x1536);
        m.step(0x15fa, 17); // call 0x15fa -- render (INT)
        m.call(0x15fa);
        label = 0x158a;
        continue; // jp 0x158a
      case 0x1539:
        regs.a = mem.read8(0x6035);
        m.step(0x153c, 13); // ld a,(0x6035)
        regs.sub(0x01);
        m.step(0x153e, 7); // sub 0x01
        if (regs.fP) { label = 0x152d; continue; } // jp p,0x152d -- SIGNED: >=0 keep it
        m.step(0x1541, 10); // jp p NOT taken
        regs.a = 0x1d;
        m.step(0x1543, 7); // ld a,0x1d -- underflow -> 0x1D
        label = 0x152d;
        continue; // jp 0x152d

      // ---- bit 7 set: the video-COLUMN walk [0x1546] ----------------------------
      case 0x1546:
        regs.a = mem.read8(0x6035);
        m.step(0x1549, 13); // ld a,(0x6035)
        regs.cp(0x1c);
        m.step(0x154b, 7); // cp 0x1c
        if (regs.fZ) { label = 0x156d; continue; } // jp z,0x156d
        m.step(0x154e, 10); // jp z NOT taken
        regs.cp(0x1d);
        m.step(0x1550, 7); // cp 0x1d
        if (regs.fZ) { label = 0x15c6; continue; } // jp z,0x15c6 -- 0x1D EXITs
        m.step(0x1553, 10); // jp z NOT taken
        regs.hl = mem.read16(0x6036);
        m.step(0x1556, 16); // ld hl,(0x6036) -- video ptr
        regs.bc = 0x7588;
        m.step(0x1559, 10); // ld bc,0x7588 -- upper sentinel
        regs.and(regs.a);
        m.step(0x155a, 4); // and a -- clear carry for sbc
        regs.sbcHl(regs.bc);
        m.step(0x155c, 15); // sbc hl,bc
        if (regs.fZ) { label = 0x158a; continue; } // jp z,0x158a -- at sentinel, no move
        m.step(0x155f, 10); // jp z NOT taken
        regs.addHl(regs.bc);
        m.step(0x1560, 11); // add hl,bc -- restore HL
        regs.add(0x11);
        m.step(0x1562, 7); // add a,0x11
        mem.write8(regs.hl, regs.a);
        m.step(0x1563, 7); // ld (hl),a -- stamp the cell
        regs.bc = 0xffe0;
        m.step(0x1566, 10); // ld bc,0xffe0 (= -0x20, up one row)
        regs.addHl(regs.bc);
        m.step(0x1567, 11); // add hl,bc
      // fall into store-video-ptr
      case 0x1567:
        mem.write16(0x6036, regs.hl);
        m.step(0x156a, 16); // ld (0x6036),hl
        label = 0x158a;
        continue; // jp 0x158a
      case 0x156d:
        regs.hl = mem.read16(0x6036);
        m.step(0x1570, 16); // ld hl,(0x6036)
        regs.bc = 0x0020;
        m.step(0x1573, 10); // ld bc,0x0020
        regs.addHl(regs.bc);
        m.step(0x1574, 11); // add hl,bc -- down one row
        regs.and(regs.a);
        m.step(0x1575, 4); // and a -- clear carry for sbc
        regs.bc = 0x7608;
        m.step(0x1578, 10); // ld bc,0x7608 -- lower sentinel
        regs.sbcHl(regs.bc);
        m.step(0x157a, 15); // sbc hl,bc
        if (regs.fNZ) { label = 0x1586; continue; } // jp nz,0x1586
        m.step(0x157d, 10); // jp nz NOT taken
        regs.hl = 0x75e8;
        m.step(0x1580, 10); // ld hl,0x75e8 -- wrap the video ptr to the top
      // fall into 0x1580
      case 0x1580:
        regs.a = 0x10;
        m.step(0x1582, 7); // ld a,0x10
        mem.write8(regs.hl, regs.a);
        m.step(0x1583, 7); // ld (hl),a
        label = 0x1567;
        continue; // jp 0x1567 -- store video ptr, then animate
      case 0x1586:
        regs.addHl(regs.bc);
        m.step(0x1587, 11); // add hl,bc -- restore HL (undo the sbc)
        label = 0x1580;
        continue; // jp 0x1580

      // ==== MAIN LOOP stage 3: SPRITE ANIMATE =====================================
      case 0x158a:
        regs.hl = 0x6032;
        m.step(0x158d, 10); // ld hl,0x6032 -- anim timer
        regs.decMem8(mem, regs.hl);
        m.step(0x158e, 11); // dec (hl)
        if (regs.fNZ) { label = 0x15f9; continue; } // jp nz,0x15f9 -- not this frame
        m.step(0x1591, 10); // jp nz NOT taken
        regs.a = mem.read8(0x6031);
        m.step(0x1594, 13); // ld a,(0x6031) -- sprite toggle
        regs.and(regs.a);
        m.step(0x1595, 4); // and a
        if (regs.fNZ) { label = 0x15b8; continue; } // jp nz,0x15b8 -- toggle set path
        m.step(0x1598, 10); // jp nz NOT taken
        regs.a = 0x01;
        m.step(0x159a, 7); // ld a,0x01
        mem.write8(0x6031, regs.a);
        m.step(0x159d, 13); // ld (0x6031),a -- toggle := 1
        regs.de = 0x01bf;
        m.step(0x15a0, 10); // ld de,0x01bf -- digit source ptr
      // fall into the shared render tail
      case 0x15a0:
        regs.iy = mem.read16(0x6038);
        m.step(0x15a4, 20); // ld iy,(0x6038)
        regs.l = mem.read8((regs.iy + 0x04) & 0xffff);
        m.step(0x15a7, 19); // ld l,(iy+0x04)
        regs.h = mem.read8((regs.iy + 0x05) & 0xffff);
        m.step(0x15aa, 19); // ld h,(iy+0x05)
        m.push16(regs.hl);
        m.step(0x15ab, 11); // push hl
        regs.ix = m.pop16();
        m.step(0x15ad, 14); // pop ix -- IX := sprite ptr from (iy+4/5)
        m.push16(0x15b0);
        m.step(0x057c, 17); // call 0x057c -- render the 6 digits
        m.call(0x057c);
        regs.a = 0x10;
        m.step(0x15b2, 7); // ld a,0x10
        mem.write8(0x6032, regs.a);
        m.step(0x15b5, 13); // ld (0x6032),a -- reload anim timer
        label = 0x15f9;
        continue; // jp 0x15f9
      case 0x15b8:
        regs.xor(regs.a);
        m.step(0x15b9, 4); // xor a
        mem.write8(0x6031, regs.a);
        m.step(0x15bc, 13); // ld (0x6031),a -- toggle := 0
        regs.de = mem.read16(0x6038);
        m.step(0x15c0, 20); // ld de,(0x6038)
        regs.de = (regs.de + 1) & 0xffff;
        m.step(0x15c1, 6); // inc de
        regs.de = (regs.de + 1) & 0xffff;
        m.step(0x15c2, 6); // inc de
        regs.de = (regs.de + 1) & 0xffff;
        m.step(0x15c3, 6); // inc de -- DE := (0x6038)+3
        label = 0x15a0;
        continue; // jp 0x15a0 -- shared render tail

      // ==== EXIT / cleanup =========================================================
      case 0x15c6:
        regs.de = mem.read16(0x6038);
        m.step(0x15ca, 20); // ld de,(0x6038)
        regs.xor(regs.a);
        m.step(0x15cb, 4); // xor a
        mem.write8(regs.de, regs.a);
        m.step(0x15cc, 7); // ld (de),a -- clear the item slot
        regs.hl = SUBSTATE_TIMER; // 0x6009
        m.step(0x15cf, 10); // ld hl,0x6009
        mem.write8(regs.hl, 0x80);
        m.step(0x15d1, 10); // ld (hl),0x80 -- SUBSTATE_TIMER := 0x80 (done)
        regs.hl = (regs.hl + 1) & 0xffff;
        m.step(0x15d2, 6); // inc hl -> GAME_SUBSTATE (0x600A)
        regs.decMem8(mem, regs.hl);
        m.step(0x15d3, 11); // dec (hl) -- GAME_SUBSTATE-- : the PHASE STEP-BACK
        regs.b = 0x0c;
        m.step(0x15d5, 7); // ld b,0x0c -- 0x0C cells to copy
        regs.hl = 0x75e8;
        m.step(0x15d8, 10); // ld hl,0x75e8 -- video source
        regs.iy = mem.read16(0x603a);
        m.step(0x15dc, 20); // ld iy,(0x603a) -- destination
        regs.de = 0xffe0;
        m.step(0x15df, 10); // ld de,0xffe0 (= -0x20, up one row)
      // fall into the column-copy loop
      case 0x15df:
        regs.a = mem.read8(regs.hl);
        m.step(0x15e0, 7); // ld a,(hl) -- copy 0x0C cells (video -> iy)
        mem.write8((regs.iy + 0x00) & 0xffff, regs.a);
        m.step(0x15e3, 19); // ld (iy+0x00),a
        regs.iy = (regs.iy + 1) & 0xffff;
        m.step(0x15e5, 10); // inc iy
        regs.addHl(regs.de);
        m.step(0x15e6, 11); // add hl,de -- up one row
        regs.djnz();
        m.step(regs.b ? 0x15df : 0x15e8, regs.b ? 13 : 8); // djnz 0x15df
        if (regs.b) { label = 0x15df; continue; }
        // Enqueue tasks 0x0314..0x0318 (5x, DE++ each).
        regs.b = 0x05;
        m.step(0x15ea, 7); // ld b,0x05
        regs.de = 0x0314;
        m.step(0x15ed, 10); // ld de,0x0314
      // fall into the enqueue loop
      case 0x15ed:
        m.push16(0x15f0);
        m.step(0x309f, 17); // call 0x309f
        m.call(0x309f);
        regs.de = (regs.de + 1) & 0xffff;
        m.step(0x15f1, 6); // inc de
        regs.djnz();
        m.step(regs.b ? 0x15ed : 0x15f3, regs.b ? 13 : 8); // djnz 0x15ed
        if (regs.b) { label = 0x15ed; continue; }
        // Enqueue the final task 0x031A.
        regs.de = 0x031a;
        m.step(0x15f6, 10); // ld de,0x031a
        m.push16(0x15f9);
        m.step(0x309f, 17); // call 0x309f
        m.call(0x309f);
      // fall into the single ret
      case 0x15f9:
        m.ret(10); // ret @0x15F9 -- the single ret; all paths converge here
        return;
      default:
        throw new Error(`sub_1486: unreachable label 0x${label.toString(16)}`);
    }
  }
}
