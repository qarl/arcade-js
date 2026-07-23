// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0bda — hand-optimized rewrite of the translated routine at ROM 0x0BDA,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x011C, 0x0018, 0x0874, 0x309F) is reached
 * through `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copied implementation. Only RAM *names* are imported (ram.js);
 * the two palette-bank latch bits are board control (0x7Dxx), not work RAM, so —
 * exactly as handler_01c3/loc_08ba keep FLIPSCREEN/PALETTE_BANK — they are local
 * consts here.
 */

import {
  MARIO_ACTIVE,
  SUBSTATE_TIMER,
  GAME_SUBSTATE,
  HOW_HIGH_INDEX,
  HOW_HIGH_LAST_SEQ,
  BOARD_SEQ_PTR,
  SND_PRIORITY,
  SND_PRIORITY_FRAMES,
} from "./ram.js";

// ls259.6h palette-bank bits: 0x7D86 = bit 0, 0x7D87 = bit 1 (memory.js decodes
// both to io.writePaletteBank(addr-0x7D86)). Board latches, not work RAM, so —
// like handler_01c3's FLIPSCREEN — they live here rather than in ram.js. loc_0bda
// selects bank 1 (bit0=1, bit1=0) for the how-high screen's palette.
const PALETTE_BANK_0 = 0x7d86; // 0x7D87 (bit 1) is the next byte up.

/**
 * loc_0bda -- game state 3 (in-game), sub-state 8: build the "HOW HIGH CAN YOU
 * GET?" interlude screen.  [ROM 0x0BDA-0x0C90]
 *
 *   0bda  cd 1c 01   call 0x011C        ; silence the sound channels (unconditional)
 *   0bdd  df         rst  0x18          ; every-Nth-frame gate on SUBSTATE_TIMER
 *   0bde  cd 74 08   call 0x0874        ; clear playfield + sprite buffer
 *   0be1  16 06      ld   d,0x06        ; task opcode 6
 *   0be3  3a 00 62   ld   a,(MARIO_ACTIVE)
 *   0be6  5f         ld   e,a
 *   0be7  cd 9f 30   call 0x309F        ; enqueue task (6, MARIO_ACTIVE)
 *   0bea  ...        seed 0x7D86/0x7D87, SND_PRIORITY, 0x63A7/0x63A8
 *   0c05  ...        clamp HOW_HIGH_INDEX<=5; step it if the board pointer moved
 *   0c29  ...        outer loop: HOW_HIGH_INDEX rows of a 6-group girder fill,
 *                    each row also copying one climb-sprite record into VRAM
 *   0c82  11 07 03   ld   de,0x0307
 *   0c85  cd 9f 30   call 0x309F        ; enqueue task 0x0307
 *   0c88  ...        re-arm SUBSTATE_TIMER=0xA0, GAME_SUBSTATE += 2
 *   0c90  c9         ret
 *
 * WHAT IT DOES. The one-time setup for the "How High Can You Get?" screen shown
 * as you advance between boards. It: (1) silences sound (0x011C) and clears the
 * playfield (0x0874); (2) queues two draw tasks (0x309F); (3) seeds the how-high
 * palette bank (0x7D86=1/0x7D87=0), the level-start tune (SND_PRIORITY=2, held 3
 * frames), and the climb-sprite bookkeeping (0x63A7 index = 0, 0x63A8 VRAM walk
 * pointer = 0x76DC); (4) clamps HOW_HIGH_INDEX to <=5 and advances it by one when
 * the board-sequence pointer's low byte (BOARD_SEQ_PTR) differs from its saved
 * copy (HOW_HIGH_LAST_SEQ), then saves the new copy; (5) paints HOW_HIGH_INDEX
 * rows of the diagonal girder — each inner pass fills 6 groups of 4 tiles (values
 * 0x50..0x67) with a +0x23 stride, and each row also copies a 3-byte sprite record
 * from ROM 0x3CF0 into the next VRAM sprite slot (IX walks down 4 per row); and
 * (6) re-arms SUBSTATE_TIMER to 0xA0 and steps GAME_SUBSTATE by 2 so the next NMI
 * dispatches onward.
 *
 * INPUTS (RAM read): MARIO_ACTIVE (task arg), SUBSTATE_TIMER (the rst-0x18 gate),
 * HOW_HIGH_INDEX, BOARD_SEQ_PTR (low byte), HOW_HIGH_LAST_SEQ, 0x63A7/0x63A8, and
 * ROM sprite table 0x3CF0. OUTPUTS (RAM/latches written): 0x7D86=1/0x7D87=0,
 * SND_PRIORITY=2/SND_PRIORITY_FRAMES=3, 0x63A7 (index, ++ per row), 0x63A8 (walk
 * pointer, -4 per row), HOW_HIGH_INDEX (clamped/stepped), HOW_HIGH_LAST_SEQ, the
 * girder VRAM (0x75BC region) + sprite VRAM (IX slots), SUBSTATE_TIMER=0xA0,
 * GAME_SUBSTATE += 2; plus everything the four callees write (sound silence,
 * playfield/sprite clear, two task-ring entries).
 *
 * THE rst 0x18 GATE. sub_0018 decrements SUBSTATE_TIMER; on a NON-expiry it
 * discards loc_0bda's own return address and returns to loc_0bda's CALLER, so the
 * whole setup is skipped this frame. Modelled by the ROM's own convention
 * `if (!m.call(0x0018)) return;` — kept verbatim so the stack (and SP, which the
 * unit gate compares) matches. Note the FIRST call (0x011C) is UNCONDITIONAL: it
 * runs even on the skip branch, before the gate.
 *
 * FLAGS. loc_0bda ends in a plain `ret` (no `ret cc`), so it returns no flag to
 * dispatchGameState. But the unit gate compares the whole register file including
 * F, so the return state must match the oracle exactly: A is left by sub_309f (the
 * final call re-reads it), F by the final `inc (GAME_SUBSTATE)`, BC=(0,0x67) by the
 * loop (B counts to 0, C is the inner fill's last value 0x67, preserved across the
 * push/pop bc), DE=0x0307, HL=GAME_SUBSTATE, IX=the last-loaded 0x63A8 walk pointer.
 * Every register op that survives to the return is reproduced; the intermediate
 * churn that a later op overwrites (the `ld c,a / ld b,0 / add hl,bc` and the
 * `ld de,imm / add hl,de` address math, all clobbered by a following pop or the
 * epilogue) is folded into direct arithmetic — proven harmless by the unit gate.
 *
 * LADDER STATUS -- idiomatic, cycles collapsed to one total per call-boundary.
 * loc_0bda is ATOMIC: it runs INSIDE the vblank NMI (dispatched by dispatchGameState
 * off GAME_STATE==3, GAME_SUBSTATE==8 via the 0x0702 table), whose handler clears
 * the NMI mask, so the vblank NMI cannot re-fire anywhere inside loc_0bda or its
 * callees. And the NMI fires at cycle 0 of the frame with the full 50688-cycle
 * budget ahead of it, while the whole invocation is ~37863 cycles — so no frame
 * boundary is ever crossed mid-routine and the internal cycle DISTRIBUTION is
 * unobservable. Proven by the harness: charging each run-between-calls (17 / 11 /
 * 17 / 41 / the seed+clamp+compare+paint segment / 48) as a single m.step total
 * stays EQUAL whole-machine. The seed..paint segment's total is DATA-DEPENDENT
 * (clamp keep 32 vs set-5 47; step skip 59 vs take 75; +1006 per painted row) so it
 * is ACCUMULATED here from the oracle's exact per-instruction sums and charged once
 * at the trailing call 0x309F. The TOTAL is still load-bearing (like loc_08ba/
 * handler_01c3): a cheaper NMI reaches the main-loop vblank spin sooner and reseeds
 * the PRNG at SPIN_COUNT (0x6019), so each branch's total is preserved exactly.
 * (Same universal lesson as README §2.)
 *
 * ONE EXCEPTION to the collapse — the palette-bank HARDWARE writes. loc_0bda's only
 * hardware writes are 0x7D86/0x7D87 (the ls259.6h palette-bank latch). A hardware
 * write is recorded in the emit --writes trace at its write-bus cycle (clock() +
 * busOffset), a column the RAM+regs equivalence gate CANNOT see — so collapsing
 * across them (charging the seg total once) would shift and collide both writes
 * (SEG E +7t/+7t instead of +17t/+33t) undetected by the unit gate. So the seed's
 * prologue is only PARTIALLY collapsed: the two palette writes keep exact per-
 * instruction cycle granularity, landing 16t apart at the oracle's SEG E +17t/+33t.
 * A dedicated write-trace test proves this (with teeth: a fully-collapsed variant is
 * caught). Same case, same fix as loc_0a8a.
 */
export function loc_0bda(m) {
  const { regs, mem } = m;

  // 0x0BDA: call 0x011C -- silence sound channels. UNCONDITIONAL, before the gate.
  m.push16(0x0bdd);
  m.step(0x011c, 17);
  m.call(0x011c);

  // 0x0BDD: rst 0x18 -- the every-Nth-frame gate on SUBSTATE_TIMER. On non-expiry
  // sub_0018 discards our return and returns to our caller: the setup is skipped.
  m.push16(0x0bde);
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return;

  // 0x0BDE: call 0x0874 -- clear the playfield + sprite buffer.
  m.push16(0x0be1);
  m.step(0x0874, 17);
  m.call(0x0874);

  // 0x0BE1..0x0BE7: enqueue task DE=(0x06, MARIO_ACTIVE). run+call = 7+13+4+17 = 41.
  regs.d = 0x06;
  regs.a = mem.read8(MARIO_ACTIVE); // 0x6200
  regs.e = regs.a;
  m.push16(0x0bea);
  m.step(0x309f, 41);
  m.call(0x309f);

  // ===== SEG E [0x0BED-0x0C85]: seed how-high state, step the height index, paint
  // the girder. Atomic (see header): its cycle run is charged as one total at the
  // trailing call 0x309F, EXCEPT the two palette-bank HARDWARE writes below, whose
  // write-bus cycle is recorded in the emit --writes trace (invisible to the RAM+regs
  // gate) and so must land at the oracle's exact cumulative cycle. eCycles accumulates
  // the oracle's per-instruction sums for everything else.
  const INNER_CYCLES = 649; // 6 fill groups: 5×114 (loop) + 79 (exit iteration)
  const ROW_CYCLES = 1006; //  7 (ld c) + INNER_CYCLES + 340 (sprite copy) + 10 (jp nz)

  // -- seed [0x0BED-0x0C05]. The 0x7D86/0x7D87 palette latches (ls259.6h) are the only
  // HARDWARE writes loc_0bda makes, so the seed is only PARTIALLY collapsed: the two
  // palette writes keep exact per-instruction granularity (charge ld hl 10 before the
  // 0x7D86 write, then ld (hl) 10 + inc hl 6 before the 0x7D87 write, so they land
  // 16t apart at SEG E +17t / +33t, identical to the oracle), while the four work-RAM
  // writes after them -- whose bus cycle is NOT recorded -- fold into eCycles. Same
  // reference pattern as loc_0a8a. 36t charged here + eCycles's 82 = the seed's 118t. --
  regs.hl = PALETTE_BANK_0;
  m.step(0x0bed, 10);                       // ld hl,0x7d86
  mem.write8(regs.hl, 0x01, 7);             // ld (hl),0x01 -> 0x7D86 = 1  [HW write @ SEG E +17t]
  m.step(0x0bef, 10);                       // ld (hl),0x01
  regs.hl = (regs.hl + 1) & 0xffff;         // inc hl -> 0x7D87
  m.step(0x0bf0, 6);                        // inc hl
  mem.write8(regs.hl, 0x00, 7);             // ld (hl),0x00 -> 0x7D87 = 0  [HW write @ SEG E +33t]
  m.step(0x0bf2, 10);                       // ld (hl),0x00

  let eCycles = 82; // 0x0BF2..0x0C05 seed remainder, work RAM: 10+10+6+10+10+10+10+16
  mem.write8(SND_PRIORITY, 0x02);           // 0x608A = 2 (level-start tune)
  mem.write8(SND_PRIORITY_FRAMES, 0x03);    // 0x608B = 3 (held 3 frames)
  mem.write8(0x63a7, 0x00);                 // climb-sprite record index = 0
  mem.write16(0x63a8, 0x76dc);              // IX walk pointer -> VRAM 0x76DC

  // -- clamp HOW_HIGH_INDEX <= 5 [0x0C05-0x0C11] --
  if (mem.read8(HOW_HIGH_INDEX) < 6) {
    eCycles += 32; // ld a 13 + cp 7 + jr-c taken 12
  } else {
    eCycles += 47; // ld a 13 + cp 7 + jr-c nottaken 7 + ld a,5 7 + ld 13
    mem.write8(HOW_HIGH_INDEX, 0x05);
  }

  // -- step the height index when the board pointer moved [0x0C11-0x0C22] --
  const seqLo = mem.read8(BOARD_SEQ_PTR); // 0x622A low byte
  if (seqLo === mem.read8(HOW_HIGH_LAST_SEQ)) {
    eCycles += 59; // equal -> skip inc: ld a 13 + ld b 4 + ld a 13 + cp 4 + jr-z taken 12 + ld 13
  } else {
    eCycles += 75; // ld a 13 + ld b 4 + ld a 13 + cp 4 + jr-z nottaken 7 + ld hl 10 + inc 11 + ld 13
    regs.incMem8(mem, HOW_HIGH_INDEX); // 0x622E++
  }
  mem.write8(HOW_HIGH_LAST_SEQ, seqLo); // 0x622F = 0x622A

  // -- outer loop [0x0C22-0x0C82]: HOW_HIGH_INDEX rows. do-while (dec b / jp nz), so
  // a count of 0 wraps to 256; the inner fill is always exactly 6 groups. --
  regs.b = mem.read8(HOW_HIGH_INDEX); // row count
  regs.hl = 0x75bc;                   // VRAM girder-fill pointer
  let rows = 0;
  do {
    // ----- inner fill [0x0C2B-0x0C40]: 6 groups of 4 tiles (0x50..0x67), stride 0x23.
    regs.c = 0x50;
    for (;;) {
      mem.write8(regs.hl, regs.c); regs.c = (regs.c + 1) & 0xff;
      regs.hl = (regs.hl - 1) & 0xffff;
      mem.write8(regs.hl, regs.c); regs.c = (regs.c + 1) & 0xff;
      regs.hl = (regs.hl - 1) & 0xffff;
      mem.write8(regs.hl, regs.c); regs.c = (regs.c + 1) & 0xff;
      regs.hl = (regs.hl - 1) & 0xffff;
      mem.write8(regs.hl, regs.c); // 4th tile (C NOT incremented after)
      regs.a = regs.c;
      if (regs.a === 0x67) break; // cp 0x67 -> exit once the 4th tile is 0x67
      regs.c = (regs.c + 1) & 0xff;
      regs.hl = (regs.hl + 0x0023) & 0xffff; // stride to the next group
    }

    // ----- climb-sprite record [0x0C43-0x0C7E]: copy 3 ROM bytes into the IX slot.
    const oldIdx = mem.read8(0x63a7);
    mem.write8(0x63a7, (oldIdx + 1) & 0xff); // advance the record index
    regs.a = (oldIdx << 2) & 0xff;           // A = oldIdx * 4  (dec a / sla a / sla a)
    m.push16(regs.hl);                       // save the fill pointer
    m.push16(regs.bc);                       // save (rowCount, 0x67)
    regs.ix = mem.read16(0x63a8);            // INDIRECT VRAM walk pointer
    regs.hl = (0x3cf0 + regs.a) & 0xffff;    // ROM sprite record (ld c,a / ld b,0 / add hl,bc)
    regs.a = mem.read8(regs.hl);
    mem.write8((regs.ix + 0x60) & 0xffff, regs.a);
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.a = mem.read8(regs.hl);
    mem.write8((regs.ix + 0x40) & 0xffff, regs.a);
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.a = mem.read8(regs.hl);
    mem.write8((regs.ix + 0x20) & 0xffff, regs.a);
    mem.write8((regs.ix - 0x20) & 0xffff, 0x8b); // NEGATIVE displacement
    regs.bc = m.pop16();                     // restore (rowCount, 0x67)
    regs.hl = (regs.ix - 4) & 0xffff;        // push ix / pop hl / add hl,-4
    mem.write16(0x63a8, regs.hl);            // 0x63A8 = IX - 4 (next sprite slot)
    regs.hl = m.pop16();                     // restore the fill pointer
    regs.hl = (regs.hl + 0xff5f) & 0xffff;   // walk up one row (-0xA1)

    rows += 1;
    regs.b = (regs.b - 1) & 0xff;
  } while (regs.b !== 0);

  eCycles += 27 + rows * ROW_CYCLES; // loop-prep 27 (ld a 13 + ld b 4 + ld hl 10) + rows

  // -- trailing enqueue [0x0C82-0x0C85]: task 0x0307. The single m.step charges the
  // whole SEG E total (eCycles) + E-tail (ld de 10 + call 17 = 27). --
  regs.de = 0x0307;
  m.push16(0x0c88);
  m.step(0x309f, eCycles + 27);
  m.call(0x309f);

  // ===== epilogue [0x0C88-0x0C90]: re-arm the sub-state timer, step the selector.
  mem.write8(SUBSTATE_TIMER, 0xa0);          // 0x6009 = 0xA0
  regs.hl = GAME_SUBSTATE;                    // ld hl,0x6009 / inc hl -> 0x600A
  regs.incMem8(mem, regs.hl);                 // 0x600A += 1
  regs.incMem8(mem, regs.hl);                 // 0x600A += 2 total
  m.step(0x0c90, 48); // ld hl 10 + ld 10 + inc hl 6 + inc 11 + inc 11
  m.ret();
}
