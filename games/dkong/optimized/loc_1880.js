// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1880 — hand-optimized rewrite of the translated routine at ROM 0x1880,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0038, 0x1826, 0x0DA7, 0x003D) is reached
 * through `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copy. This routine touches only UNNAMED object/scratch/sound
 * RAM (the 0x69xx object records, 0x62AF/0x6388 board scratch, the 0x6082 sound
 * latch), all of which ram.js leaves hex, so nothing is imported from it.
 */

/**
 * loc_1880 -- 0x1644-sequence idx 4: gated object spawn + selector advance.
 * [ROM 0x1880-0x18C5; entry 4 of loc_1644's 0x1648 rst-0x28 table, reached via
 * dispatchGameState -> loc_1615 (GAME_SUBSTATE 0x600A==0x16, board-advance) ->
 * sub_1641 when BOARD(0x6227) has bits 0 AND 1 clear (BOARD==4, the 100m rivets),
 * indexed by the sequence selector 0x6388==4.]
 *
 * WHAT IT DOES. One frame of the 100m board-advance object staging. Every frame it
 * ticks a 10-byte counter chain, then — only on the frame the trigger byte reaches
 * a set value — spawns one object record and steps the sequence forward:
 *
 *   1. rst 0x38 (sub_003d via loc_0038): add C=1 to each of 10 bytes at 0x690B
 *      stride 4 (0x690B, 0x690F, 0x6913, 0x6917, 0x691B, ...). This +1's the
 *      trigger byte 0x691B every frame.
 *   2. GUARD: read the just-incremented 0x691B; `cp 0xD0`. If it is NOT 0xD0 the
 *      frame's work is done — `ret nz`. (Branch A.)
 *   3. When 0x691B == 0xD0 (Branch B), spawn + advance:
 *        - 0x6919 <- 0x20
 *        - stamp the 4-byte object record 7F 39 01 D8 into 0x6A24..0x6A27
 *        - call 0x1826 with HL=0x76C6 (VRAM-cell setup)
 *        - call 0x0DA7 with DE=0x3A5F (walk the 0x3A5F ROM record table into RAM)
 *        - call 0x003D with DE=4 (stride), BC=0x0228 (B=2 records, C=0x28 addend),
 *          HL=0x6903 (a 2-record add-loop over 0x6903/0x6907)
 *        - 0x62AF <- 0 (board-object bookkeeping)
 *        - 0x6082 <- 3 (a 3-frame sound-trigger assert; byte within SND_TRIGGER[8],
 *          not individually named in ram.js so kept hex)
 *        - inc (0x6388) — advance the 0x1648 sequence selector to idx 5 (loc_18c6)
 *
 * INPUTS: the counter chain at 0x690B.. (bumped by the rst 0x38 add-loop) and the
 *   trigger byte 0x691B it drives; the register file on entry (A flows unchanged
 *   into the rst 0x38 add-loop, which does not read it). OUTPUTS — Branch A: only
 *   the +1 to the 10 counter bytes; A = the read 0x691B, F = the `cp 0xD0` result
 *   (NZ). Branch B: additionally 0x6919/0x6A24..27/0x62AF/0x6082, whatever the
 *   three callees write, and inc(0x6388); A ends 0x03, HL ends 0x6388, DE=0x0004,
 *   BC=0x0028 (what sub_003d leaves), F = the inc(0x6388) result.
 *
 * FLAGS. Nothing downstream consumes loc_1880's flags — it is a dispatch tail; its
 *   caller (the rst-0x28 jp (hl)) makes no `ret cc` on them. But the unit gate
 *   compares F, so the final flag-writer is kept verbatim: Branch A ends on
 *   `cp 0xD0` (the `ret nz` preserves it); Branch B ends on `inc (0x6388)`
 *   (incMem8), which is the last flag-affecting op — the callees' flags are all
 *   overwritten before the return. The dead `inc l` flags of the record-stamp
 *   block are dropped (overwritten by the record callees / the final inc), and the
 *   record is written to its absolute cells directly rather than via HL walk — a
 *   provably-equivalent simplification since intermediate HL/L is never observed
 *   (immediately overwritten by `ld hl,0x76C6`). Dropping the `inc l` flags is safe
 *   for the same reason at the callee boundary: the optimized enters `m.call(0x1826)`
 *   with F from `cp 0xd0` rather than `inc l`, but sub_1826's first acts are
 *   `ld de/ld c/ld a` — it sets its own registers and never reads incoming F before
 *   overwriting it, so the differing entry flag is never observed (and the branch-B
 *   test's full RAM+regs+cycle-total compare would break if it were).
 *
 * ATOMIC — cycles collapsed to one charge per inter-call segment, TOTAL preserved.
 *   loc_1880 is dispatched INSIDE the vblank NMI (dispatchGameState), where the NMI
 *   mask is held (entry_0066 clears 0x7D84), so the NMI can never land inside it OR
 *   any callee. Its internal cycle DISTRIBUTION is therefore unobservable and each
 *   branch's per-instruction m.step charges collapse to a single per-segment total.
 *   The TOTAL is still load-bearing (as part of the NMI's cost it sets mainLoop's
 *   vblank-spin count, README §2), so every segment sum is preserved exactly and
 *   the whole-machine gate confirms it. Segment totals (t-states):
 *     S0 entry->call 0x0038                  = 10+7+11                = 28
 *     Branch A: post-call ret nz             = 13+7+11                = 31  (m.ret)
 *     Branch B S1 call 0x0038->call 0x1826   = 13+7+5 + record + 17   = 134
 *     Branch B S2 call 0x1826->call 0x0DA7   = 10+17                  = 27
 *     Branch B S3 call 0x0DA7->call 0x003D   = 10+10+10+17            = 47
 *     Branch B S4 epilogue (excl. ret)       = 7+13+7+13+10+11        = 61  (+ret 10)
 *   No HARDWARE writes here (work/object/sound RAM only, all 0x60xx-0x6Bxx), so no
 *   write-bus-cycle trace to preserve — the collapse is unconditional.
 */
export function loc_1880(m) {
  const { regs, mem } = m;

  // ---- rst 0x38 add-loop: +1 to the 10-byte counter chain at 0x690B stride 4 ----
  regs.hl = 0x690b;
  regs.c = 0x01;
  m.push16(0x1886); // balances sub_003d's ret (the rst 0x38 push)
  m.step(0x0038, 28); // ld hl (10) + ld c (7) + rst 0x38 (11)
  m.call(0x0038); // loc_0038 -> sub_003d: (0x690B + 4k) += 1 for k in 0..9

  // ---- GUARD: has the +1'd trigger byte 0x691B reached 0xD0 this frame? ----
  regs.a = mem.read8(0x691b);
  regs.cp(0xd0);
  if (regs.fNZ) {
    // Branch A -- not the trigger value: nothing to spawn. ret nz.
    m.ret(31); // ld a (13) + cp (7) + ret nz taken (11)
    return;
  }

  // ---- Branch B: 0x691B == 0xD0 -> spawn one object record + advance selector ----
  regs.a = 0x20;
  mem.write8(0x6919, regs.a); // 0x6919 = 0x20

  // Stamp the 4-byte object record 7F 39 01 D8 into 0x6A24..0x6A27. (Oracle walks
  // it with HL/inc l; intermediate HL is dead — overwritten by ld hl,0x76C6 — so
  // the absolute cells are written directly.)
  mem.write8(0x6a24, 0x7f);
  mem.write8(0x6a25, 0x39);
  mem.write8(0x6a26, 0x01);
  mem.write8(0x6a27, 0xd8);

  regs.hl = 0x76c6;
  m.push16(0x18a5);
  m.step(0x1826, 134); // guard tail (13+7+5) + record block + ld hl,0x76C6 + call (17)
  m.call(0x1826);

  regs.de = 0x3a5f;
  m.push16(0x18ab);
  m.step(0x0da7, 27); // ld de,0x3A5F (10) + call (17)
  m.call(0x0da7);

  regs.de = 0x0004; // stride
  regs.bc = 0x0228; // B = 2 records, C = 0x28 addend
  regs.hl = 0x6903;
  m.push16(0x18b7);
  m.step(0x003d, 47); // ld de (10) + ld bc (10) + ld hl (10) + call (17)
  m.call(0x003d); // sub_003d add-loop body, direct entry (B=2)

  regs.a = 0x00;
  mem.write8(0x62af, regs.a); // 0x62AF = 0 (board-object bookkeeping)
  regs.a = 0x03;
  mem.write8(0x6082, regs.a); // sound-trigger latch = 3 (within SND_TRIGGER[8])
  regs.hl = 0x6388;
  regs.incMem8(mem, regs.hl); // inc (0x6388) -- advance the 0x1648 sequence selector

  m.step(0x18c5, 61); // ld a,0 (7)+ld (62af)(13)+ld a,3 (7)+ld (6082)(13)+ld hl (10)+inc(hl)(11)
  m.ret(); // ret (10)
}
