// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0689 — hand-optimized rewrite of the translated routine at ROM 0x0689,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. loc_0689 is a LEAF: it calls nothing, so there is no
 * `m.call` here and nothing is imported from translated/. It writes two video-RAM
 * cells, which are hex here (VRAM tile cells, not work RAM) — ram.js names only
 * work RAM 0x6000-0x6BFF, so these stay hex with a comment, exactly as the other
 * optimized routines leave their VRAM stores (e.g. loc_0a8a's 0x76A3/0x7663).
 */

/**
 * loc_0689 -- the shared two-digit STAMP tail of loc_066a. [ROM 0x0689-0x0690]
 *
 *   0689  32 e6 74   ld (0x74e6),a   ; VRAM cell <- A (the high-digit tile)
 *   068c  78         ld a,b          ; A <- B (the low-digit tile loc_066a staged)
 *   068d  32 c6 74   ld (0x74c6),a   ; VRAM cell <- B
 *   0690  c9         ret
 *
 * WHAT IT DOES. loc_066a splits the packed two-nibble BCD byte at 0x638C into two
 * character tiles and hands loc_0689 the pair in A and B; loc_0689 stamps them
 * into the two video-RAM cells of that display field: A -> 0x74E6, then B ->
 * 0x74C6 (0x74E6 written FIRST, matching the oracle's order and the loc_066a note;
 * the two cells are 0x20 apart = one screen column on the rotated tilemap). No
 * data-dependent branch — a single straight-line path — so both loc_066a arms
 * (the jp-nz "high nibble nonzero" arm and the leading-zero-suppress fall-through
 * arm, which enters with A = 0x10) run these same four instructions; only the
 * register VALUES they bring differ.
 *
 * INPUTS: A = first tile, B = second tile (from loc_066a). No RAM read.
 * OUTPUTS: video RAM 0x74E6 <- (incoming A) and 0x74C6 <- B; register A ends = B
 *   (the `ld a,b`). Nothing downstream reads A after the return (loc_066a's caller
 *   proceeds to the task loop), but the unit gate compares the whole register file,
 *   so `A := B` is reproduced exactly.
 *
 * FLAGS: loc_0689 contains NO flag-affecting instruction — two `ld (nn),a`, one
 *   `ld a,b`, and `ret` all leave F untouched. The F handed back by the 0x0690 ret
 *   is therefore the flags loc_066a's arm left (`add a,b` @0x0685 on the suppress
 *   arm, `and 0x0f` @0x0673 on the jp-nz arm — see the loc_066a header). This
 *   rewrite performs no flag op, so that incoming F passes through byte-identical
 *   to the oracle; the unit gate's F comparison confirms it.
 *
 * CYCLES — PER-INSTRUCTION (not collapsed), which is the always-correct choice for
 *   this leaf. loc_0689 is reached ONLY via loc_066a, and loc_066a is reached only
 *   from entry_062a — a MAIN-LOOP task (task-table entry 10, dispatched by
 *   dispatchTask with the NMI mask ENABLED). The brief's ATOMICITY-IS-PER-CALL-PATH
 *   rule says a leaf reached via m.call on a main-loop path keeps per-instruction
 *   granularity unless a collapse is HARNESS-PROVEN safe, and even then it is only
 *   worth doing for a real readability win. Here the win is nil (three m.step
 *   charges), and per-instruction is guaranteed correct, so the charges stay one
 *   per instruction — 13 + 4 + 13, then the 10t ret. The TOTAL is preserved either
 *   way (per-instruction preserves everything); whole-machine EQUAL over 700 frames
 *   (3 dispatches) and the unit gate both confirm it. The two stores are VIDEO RAM,
 *   not 0x7Dxx hardware latches, so they carry no write-trace bus-cycle constraint
 *   (per loc_0a8a: video + work RAM collapse with no trace consequence); keeping
 *   per-instruction lands each at its exact oracle cycle regardless.
 */
export function loc_0689(m) {
  const { regs, mem } = m;

  // ld (0x74e6),a -- stamp the first tile (A) into its VRAM cell. 0x74E6 is a
  // video-RAM tile cell (0x7400-0x77FF), written BEFORE 0x74C6 per the oracle.
  mem.write8(0x74e6, regs.a);
  m.step(0x068c, 13);

  // ld a,b -- bring the second tile into A (does not touch flags).
  regs.a = regs.b;
  m.step(0x068d, 4);

  // ld (0x74c6),a -- stamp the second tile (now in A) into the adjacent VRAM cell.
  mem.write8(0x74c6, regs.a);
  m.step(0x0690, 13);

  m.ret(); // 0690 -- 10t; F is loc_066a's arm flags, passed through untouched.
}
