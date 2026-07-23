// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0a1b — hand-optimized rewrite of the translated routine at ROM 0x0A1B,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x309f, 0x09ee) is reached through
 * `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copy. Only the RAM name GAME_SUBSTATE is imported (from ram.js);
 * the two 0x7D8x targets are board control latches, named locally like FLIPSCREEN
 * in handler_01c3.
 */

import { GAME_SUBSTATE } from "./ram.js";

// ls259.6h control latches, decoded by boards/dkong/memory.js (case 0x7d86/0x7d87
// -> io.writePaletteBank(addr-0x7d86, value&1)): the two-bit PALETTE BANK select.
// Board hardware, not work RAM, so they are not in ram.js. Writing 0 to both
// selects palette bank 0. (Confirms the oracle docstring's "clear palette latches".)
const PALETTE_BANK_LO = 0x7d86; // palette bank bit 0
const PALETTE_BANK_HI = 0x7d87; // palette bank bit 1

/**
 * sub_0a1b -- board-setup step (0x0702 substate table index 4).  [ROM 0x0A1B-0x0A36]
 *
 *   0a1b  af           xor  a               ; A = 0
 *   0a1c  32 86 7d     ld   (0x7d86),a      ; palette bank bit 0 = 0
 *   0a1f  32 87 7d     ld   (0x7d87),a      ; palette bank bit 1 = 0
 *   0a22  11 03 03     ld   de,0x0303       ; task [handler 3, arg 3]
 *   0a25  cd 9f 30     call 0x309f          ; enqueue it
 *   0a28  11 01 02     ld   de,0x0201       ; task [handler 2, arg 1]
 *   0a2b  cd 9f 30     call 0x309f          ; enqueue it
 *   0a2e  cd ee 09     call 0x09ee          ; shared 3-cell VRAM draw fragment
 *   0a31  3e 05        ld   a,0x05          ;
 *   0a33  32 0a 60     ld   (0x600a),a      ; GAME_SUBSTATE = 5 (chain to index 5, sub_0a37)
 *   0a36  c9           ret
 *
 * WHAT IT DOES: one step of the TWO-PLAYER board-setup chain. loc_0986 sends
 * 0x600A -> 3 (sub_09fe restores P2 context) -> 4 (this) -> 5 (sub_0a37). This step
 * clears the palette bank to 0, queues two draw tasks (0x0303 then 0x0201, via the
 * enqueue routine sub_309f), runs the shared VRAM fragment sub_09ee (draws one
 * three-cell tilemap column), and advances the sub-state selector to 5 so the next
 * NMI dispatches the following setup step. It is the near-twin of sub_09d6 (the
 * 25m/single-player step): sub_09d6 queues 0x0302 and does NOT run sub_09ee; both
 * end GAME_SUBSTATE = 5.
 *
 * INPUTS: none data-dependent -- A is discarded (xor a), DE is loaded with
 * constants. Reads no work RAM of its own; the enqueue/draw callees read the task
 * ring / write VRAM. STRAIGHT-LINE: exactly ONE path, no data-dependent branch of
 * its own (any variation -- e.g. sub_309f dropping a task when the ring is full --
 * lives inside the callee, identical on both sides through m.call).
 * OUTPUTS: PALETTE_BANK_LO/HI = 0; two tasks enqueued; three VRAM cells drawn (by
 * 0x09ee); GAME_SUBSTATE (0x600A) = 5; A = 0x05, DE = 0x0201 on exit.
 *
 * FLAGS: this routine sets none that anything reads. `xor a` sets F (Z etc.) but
 * the first sub_309f overwrites it before any read; nothing in the tail (ld a / ld
 * (nn),a / ret) touches F, so the exit F is whatever the SECOND sub_309f left --
 * identical on both sides because both m.call the same oracle. The unit gate (which
 * compares the whole register file incl. F) confirms it. `xor a` is kept verbatim
 * so A (=0 for the two latch writes) and any intermediate F match the oracle exactly.
 *
 * LADDER STATUS -- idiomatic, cycles COLLAPSED to one charge per call segment.
 * sub_0a1b is ATOMIC: it is dispatched INSIDE the vblank NMI (via dispatchGameState,
 * the rst 0x28 table at 0x00CA), whose hardware mask blocks re-entry, and its only
 * callees (sub_309f, sub_09ee) are leaf routines that call nothing interruptible --
 * so no NMI can land inside it and its internal cycle DISTRIBUTION is unobservable.
 * The TOTAL is still load-bearing (README §2: a cheaper NMI reaches the main-loop
 * vblank spin sooner and reseeds the PRNG via SPIN_COUNT), so each segment's total
 * is preserved exactly: pre-call#1 4+13+13+10+17 = 57, pre-call#2 10+17 = 27,
 * call#3 17, tail 7+13+10 = 30 -- sum 131, byte-for-byte the oracle's own per-
 * instruction total. Collapse verified EQUAL whole-machine (equivalence-0a1b.test.js);
 * the driven two-player run reaches this branch and a wrong total would shift the
 * spin count and diverge, so the single branch carries cycle teeth. The push16 for
 * each call stays (calling convention: the callee's ret pops it), and the exact
 * oracle return addresses (0x0a28/0x0a2e/0x0a31) are pushed so the residual stack
 * bytes in diffed work RAM match.
 */
export function sub_0a1b(m) {
  const { regs, mem } = m;

  // xor a -> A = 0; clear both palette-bank latches to select bank 0.
  regs.xor(regs.a);
  mem.write8(PALETTE_BANK_LO, regs.a); // 0x7d86 = 0
  mem.write8(PALETTE_BANK_HI, regs.a); // 0x7d87 = 0

  // Enqueue task [03,03]. Segment total 4+13+13+10 + call 17 = 57 t.
  regs.de = 0x0303;
  m.push16(0x0a28);
  m.step(0x309f, 57);
  m.call(0x309f);

  // Enqueue task [02,01]. Segment total 10 + call 17 = 27 t.
  regs.de = 0x0201;
  m.push16(0x0a2e);
  m.step(0x309f, 27);
  m.call(0x309f);

  // Shared 3-cell VRAM draw fragment. Call 17 t.
  m.push16(0x0a31);
  m.step(0x09ee, 17);
  m.call(0x09ee);

  // GAME_SUBSTATE = 5 -> next NMI dispatches setup step 5 (sub_0a37).
  // Tail total 7 (ld a) + 13 (ld (nn),a) + 10 (ret) = 30 t, folded into the ret.
  regs.a = 0x05;
  mem.write8(GAME_SUBSTATE, regs.a);
  m.ret(30);
}
