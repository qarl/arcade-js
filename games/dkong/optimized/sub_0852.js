// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0852 — hand-optimized rewrite of the translated routine at ROM 0x0852,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. This is a LEAF (it calls nothing), so it reaches no
 * other routine through the registry; only the RAM name SPRITE_BUFFER is imported
 * from ram.js. The `../translated/` copy stays the frozen oracle.
 */

import { SPRITE_BUFFER } from "./ram.js";

// Tilemap video RAM: the 32×32 name table the video hardware scans. It is a
// HARDWARE region (0x7400-0x77FF), not work RAM, so it is NOT in ram.js (which
// covers work RAM 0x6000-0x6BFF only) — it lives here as a local const. 0x10 is
// the blank/space tile the screen is cleared to (same value sub_0874 uses).
const VRAM_TILEMAP = 0x7400;
const VRAM_TILEMAP_END = 0x7800; // exclusive: fills 0x7400..0x77FF = 0x400 bytes
const BLANK_TILE = 0x10;

// The sprite shadow buffer is cleared for 0x180 = 384 bytes (96 sprite records ×
// 4). ram.js documents SPRITE_BUFFER = 0x6900 as exactly this 384-byte span.
const SPRITE_BUFFER_LEN = 0x180;

/**
 * sub_0852 -- CLEAR SCREEN: blank the tilemap and zero the sprite buffer.
 * [ROM 0x0852-0x0873]
 *
 *   0852  ld hl,0x7400 / ld c,0x04              ; block 1 setup
 *   0857  ld b,0x00 / ld a,0x10                 ; B=0 => 256 iterations, tile 0x10
 *   085b  ld (hl),a / inc hl / djnz 0x085b      ; inner: write 256 cells
 *   085f  dec c / jp nz,0x0857                  ; outer ×4 -- HL is NOT reloaded,
 *                                               ;   so it walks 0x7400 -> 0x7800
 *   0863  ld hl,0x6900 / ld c,0x02              ; block 2 setup
 *   0868  ld b,0xc0 / xor a                     ; B=192, value 0
 *   086b  ld (hl),a / inc hl / djnz 0x086b      ; inner: zero 192 bytes
 *   086f  dec c / jp nz,0x0868                  ; outer ×2 -> 0x6900 -> 0x6A80
 *   0873  ret
 *
 * WHAT IT DOES. Two straight memory fills, each a nested (outer C, inner B=256/192)
 * djnz loop whose HL is loaded ONCE and walked continuously across the outer
 * passes (the outer loop never reloads HL — the `256×4` / `192×2` split is only
 * because a single 8-bit djnz caps at 256):
 *   1. VRAM tilemap  0x7400-0x77FF (1024 bytes) := 0x10  -- blank the screen.
 *   2. sprite buffer 0x6900-0x6A7F  (384 bytes) := 0x00  -- clear all sprites.
 * It is the "wipe everything visible" primitive the two board-setup phase
 * handlers run before drawing a fresh screen (see CALL PATHS below).
 *
 * INPUTS   none — every loop bound is an immediate constant, so there is exactly
 *          ONE execution path (no data-dependent branch). Reads no RAM/registers.
 * OUTPUTS  RAM: 0x7400-0x77FF = 0x10, 0x6900-0x6A7F = 0x00 (nothing else).
 *          Registers at ret (block 2 reloads every register block 1 set, so only
 *          block 2's exit state is observable): A=0, B=0, C=0, HL=0x6A80
 *          (0x6900+0x180). DE / IX / IY / the alternates are NEVER touched — the
 *          oracle enters here with DE=0x0703 and leaves it 0x0703; the unit gate
 *          compares the whole register file, so DE (and everything else) is left
 *          untouched here too.
 *
 * FLAGS. The last flag-writer of the whole routine is block 2's final `dec c`
 * (C: 1->0), preceded by that pass's `xor a` (which clears carry). Nothing
 * downstream consumes these flags — the callers (loc_0986 / loc_196b) branch on
 * their OWN later reads, not on sub_0852's F — but the unit gate compares F, so
 * the exit F (= 0x42: Z set, N set, carry 0) is reproduced by replaying that exact
 * `xor a` + two `dec c` tail rather than hardcoding the bits (see below).
 *
 * ATOMIC — cycles collapsed to ONE total, distribution dropped, TOTAL preserved.
 * sub_0852 runs INSIDE the vblank NMI on BOTH of its call paths, which clears the
 * NMI mask in its prologue (0x7D84:=0) and re-enables it only in its epilogue,
 * AFTER the game-state dispatch. So the NMI can never re-fire inside sub_0852 and
 * no frame boundary is crossed mid-fill: it is un-interruptible and its internal
 * cycle DISTRIBUTION is entirely unobservable to the RAM+regs gate. This is not a
 * guess — both callers measured it: loc_0986.js recorded its whole dispatch (own
 * cost 37339t, almost all of it THIS clear) with the NMI landing inside it ZERO
 * times, and loc_196b.js documents the same cleared-mask atomicity. And it writes
 * NO hardware latch (0x7Dxx) — only tilemap VRAM and the sprite buffer, both plain
 * memory — so there is no bus-cycle-positioned write to preserve and the collapse
 * can be TOTAL (unlike loc_0986/loc_0a8a, which keep partial granularity around a
 * 0x7D82 write). The TOTAL is still load-bearing: as part of the NMI's total cost
 * it sets the main-loop vblank-spin count -> the PRNG at 0x6019 (README §2), so
 * the exact per-instruction sum (36784t incl. the ret) is preserved — charged as
 * the body sum (36774t) in one m.step, plus the ret's 10t. Harness-verified EQUAL
 * whole-machine + unit; the total is pinned by an explicit cycle assertion in the
 * test.
 *
 * CALL PATHS (why it is atomic on ALL of them — atomicity is per-call-path):
 *   - loc_0986 (ROM 0x0986): board-setup arm 0 of the 0x0702 table (GAME_STATE 3,
 *     GAME_SUBSTATE 0), reached via dispatchGameState in the NMI.
 *   - loc_196b (ROM 0x196B): 0x0702 table arm 0x17 (a computed phase transition),
 *     also reached via dispatchGameState in the NMI.
 *   Both run under the cleared NMI mask; there is no main-loop-task or
 *   interruptible-cascade caller (the only two `m.call(0x0852)` sites in the ROM).
 */
export function sub_0852(m) {
  const { regs, mem } = m;

  // Block 1: blank the tilemap -- VRAM 0x7400..0x77FF := 0x10 (1024 bytes).
  for (let a = VRAM_TILEMAP; a < VRAM_TILEMAP_END; a++) mem.write8(a, BLANK_TILE);

  // Block 2: clear the sprite buffer -- 0x6900..0x6A7F := 0 (384 bytes).
  for (let a = SPRITE_BUFFER; a < SPRITE_BUFFER + SPRITE_BUFFER_LEN; a++) mem.write8(a, 0x00);

  // Reproduce the oracle's exit register file. Block 2 reloads HL/B/C/A and runs
  // last, so ONLY its exit state is observable; DE and all others are untouched.
  regs.hl = SPRITE_BUFFER + SPRITE_BUFFER_LEN; // 0x6A80: HL walked past the buffer
  regs.b = 0x00;                               // both inner djnz loops exit with B=0
  regs.xor(regs.a);                            // block-2 `xor a`: A=0, carry cleared
  regs.c = 0x02;                               // block-2's outer count...
  regs.c = regs.dec8(regs.c);                  // dec c (2->1)
  regs.c = regs.dec8(regs.c);                  // dec c (1->0): the routine's last flag-writer -> F=0x42

  // Cycles: the atomic single-path body sum (see ATOMIC above), charged once, then
  // the ret's own 10t. 36774 + 10 = 36784 = the oracle's exact per-instruction sum.
  m.step(0x0873, 36774); // whole body, PC landing on the ret instruction at 0x0873
  m.ret(10);             // ret @0x0873 -- pops the caller's continuation
}
