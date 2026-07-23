// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0d00 — hand-optimized rewrite of the translated routine at ROM 0x0D00,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. sub_0d00 is a LEAF: it makes no `m.call` of its own, and
 * it references no work-RAM address (its only inputs are ROM immediates and the
 * ROM table at 0x0D17), so this file imports no RAM names from ram.js.
 */

// ROM destination table: eight little-endian VIDEO-RAM pointers at 0x0D17-0x0D26
// (0x76CA/0x76CF/0x76D4/0x76D9 then 0x752A/0x752F/0x7534/0x7539). A ROM-code
// address, not work RAM, so it stays a bare hex constant.
const DEST_TABLE = 0x0d17;

/**
 * sub_0d00 -- stamp a fixed 2-tile motif into eight video-RAM cell pairs.
 * [ROM 0x0D00-0x0D16]
 *
 *   0d00  06 08        ld   b,0x08        ; 8 destinations
 *   0d02  21 17 0d     ld   hl,0x0d17     ; -> destination-pointer table
 *   0d05  3e b8        ld   a,0xb8        ; first tile code (per outer pass)
 *   0d07  0e 02        ld   c,0x02        ; 2 tiles per destination
 *   0d09  5e           ld   e,(hl) / inc hl
 *   0d0c  56           ld   d,(hl) / inc hl ; DE = next VRAM destination
 *   0d0d  12           ld   (de),a        ; write tile
 *   0d0f  3d           dec  a             ; 0xb8 -> 0xb7 (second tile)
 *   0d10  13           inc  de
 *   0d11  0d           dec  c / jp nz 0x0d0d
 *   0d05  10 ..        djnz 0x0d05
 *   0d16  c9           ret
 *
 * WHAT IT DOES. Called ONLY during 100m-rivet (board 4) setup, from loc_0cc6's
 * `call z,0x0D00` guarded by `BOARD(0x6227)==4`. It walks the 8-entry pointer
 * table at 0x0D17 and, into each destination, writes the two tile codes 0xB8 then
 * 0xB7 (A is loaded 0xB8 and `dec`-ed once between the two stores). The eight
 * destinations are two groups of four video-RAM cells (stride 5) — a fixed board-4
 * decoration. It is purely table+immediate driven: the output is CONSTANT and does
 * not depend on any entry register or work-RAM byte.
 *
 * INPUTS (read):  ROM table 0x0D17 and the immediates 0x08/0xB8/0x02. No RAM read;
 *                 no entry register survives (B,C,A,D,E,H,L are all reloaded before use).
 * OUTPUTS (write): 16 VIDEO-RAM bytes — 0xB8,0xB7 at each of the 8 table pointers.
 *                 No hardware latch is written (every destination is 0x74xx-0x77xx
 *                 video RAM, inside the compared state dump), so there is NO
 *                 --writes bus-cycle trace to preserve (contrast loc_0a8a's palette
 *                 latches; like loc_0a8a's video-RAM epilogue this collapses freely).
 * REGISTERS OUT (deterministic, entry-independent): A=0xB6 (0xB8 dec-ed twice on the
 *                 final pass), B=0, C=0, DE=lastDest+2=0x753B, HL=table+16=0x0D27.
 *                 F=0x42 (Z|N) from the last `dec c` (1->0). SP/IX/IY unchanged.
 *
 * FLAGS. Nothing downstream consumes them: loc_0cc6's next act after the call is
 *   `jp 0x3FA0`, no `ret cc`, no flag branch. But the unit gate compares the whole
 *   register file (F included), so the register arithmetic is KEPT VERBATIM (via the
 *   regs helpers) so A/F/BC/DE/HL land exactly the oracle's values — the same reason
 *   entry_0611 keeps its `rrca`. Only the per-instruction m.step SCAFFOLDING is dropped.
 *
 * ATOMIC — cycles collapsed, TOTAL preserved. sub_0d00 is reached by exactly ONE
 *   call path: loc_0cc6's `call z,0x0D00`, itself reachable only from the board-setup
 *   dispatch (loc_0c92's board-4 arm) run INSIDE the vblank NMI (dispatchGameState),
 *   where the NMI mask is held cleared and the handler cannot re-enter (perFrame's
 *   own "vblank cannot re-enter this handler until the epilogue re-enables it").
 *   And sub_0d00 makes no call, so nothing can span a frame. So the NMI can never land
 *   inside it: it is ATOMIC, and its loop counts are FIXED (B=8, C=2 -> one straight
 *   path, no data-dependent branch). Its internal cycle DISTRIBUTION is therefore
 *   unobservable and the ~90 per-instruction m.step charges collapse to ONE total.
 *   The TOTAL is still load-bearing — as part of the NMI's cost it sets the main-loop
 *   vblank-spin count (README §2, SPIN_COUNT 0x6019) — so it is preserved exactly:
 *   942 t (prologue 17 + 7 outer passes at 115 + a final pass at 110 + ret 10),
 *   charged once via m.ret. Whole-machine EQUAL confirms it; a wrong total would
 *   diverge at 0x6019.
 */
export function sub_0d00(m) {
  const { regs, mem } = m;

  regs.hl = DEST_TABLE; // ld hl,0x0d17
  regs.b = 0x08; // ld b,0x08 -- 8 destinations
  do {
    regs.a = 0xb8; // first tile code (reset each pass; second is 0xb7 via dec a)
    regs.c = 0x02; // 2 tiles written per destination
    regs.e = mem.read8(regs.hl); // ld e,(hl)
    regs.hl = (regs.hl + 1) & 0xffff; // inc hl
    regs.d = mem.read8(regs.hl); // ld d,(hl) -- DE = next VRAM destination
    regs.hl = (regs.hl + 1) & 0xffff; // inc hl
    do {
      mem.write8(regs.de, regs.a); // ld (de),a -- stamp the tile
      regs.a = regs.dec8(regs.a); // dec a -- 0xb8 -> 0xb7
      regs.de = (regs.de + 1) & 0xffff; // inc de
      regs.c = regs.dec8(regs.c); // dec c -- sets the final observable F on c: 1->0
    } while (regs.c !== 0); // jp nz,0x0d0d
    regs.djnz(); // djnz 0x0d05 -- next destination (no flag effect)
  } while (regs.b !== 0);

  // Atomic single path: charge the whole 942 t total in the ret (README §2 collapse).
  m.ret(942); // ret @0x0D16 -- pops loc_0cc6's return (0x0CD1)
}
