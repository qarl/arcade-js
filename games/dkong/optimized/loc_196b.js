// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_196b — hand-optimized rewrite of the translated routine at ROM 0x196B,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0852) is reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so it resolves to the oracle or a
 * future optimized rewrite. Only the RAM name GAME_SUBSTATE is imported (ram.js).
 */

import { GAME_SUBSTATE } from "./ram.js";

/**
 * loc_196b -- 0x0702 phase-table arm at index 23 (0x17): a computed phase
 * transition. [ROM 0x196B-0x1977]
 *
 *   196b  cd 52 08   call 0x0852       ; clear tile field (0x7400.. = 0x10) + 0x6900.. = 0
 *   196e  3a 0e 60   ld   a,(0x600e)   ; A = level/screen selector
 *   1971  c6 12      add  a,0x12       ; + 0x12 (phase-group base offset -- do NOT fold)
 *   1973  32 0a 60   ld   (0x600a),a   ; GAME_SUBSTATE := (0x600E) + 0x12
 *   1976  c9         ret
 *
 * Dispatched from the NMI game-state path (ROM 0x06FE does `ld a,(0x600a) /
 * rst 0x28` through the 0x0702 table) while GAME_SUBSTATE == 0x17. It wipes the
 * tile/object field via sub_0852, then JUMPS the master sub-state byte to
 * (0x600E)+0x12 -- a data-driven transition into the next phase group, with
 * 0x600E selecting which.
 *
 * INPUTS   0x600E (level/screen selector, read). sub_0852 needs no register input.
 * OUTPUTS  GAME_SUBSTATE (0x600A) := (0x600E)+0x12; A and F = that add's result;
 *          plus everything sub_0852 writes (VRAM 0x7400-0x77FF = 0x10, work
 *          0x6900-0x69FF = 0, and HL/BC/C left by its fills) -- unchanged, it
 *          runs verbatim via m.call.
 * 0x600E stays hex: ram.js has no evidenced name for it.
 *
 * FLAGS. `add a,0x12` is kept VERBATIM (regs.add) so BOTH A and F match the
 * oracle at the ret -- the unit gate compares the whole register file, F
 * included. (The NMI epilogue's `pop af` restores F before anything branches on
 * it, but the gate compares it regardless, so it is reproduced exactly.)
 *
 * CYCLES -- collapsed to one total on the (single) path. loc_196b runs INSIDE
 * the vblank NMI handler, which cleared the NMI mask in its prologue
 * (0x7D84 := 0 @ ROM 0x0072) and re-enables it only in its epilogue (0x00DB),
 * AFTER this dispatch. So the NMI cannot re-fire inside loc_196b or its callee,
 * and no frame boundary is crossed mid-handler: the routine is un-interruptible
 * and its internal cycle DISTRIBUTION is entirely free. Only the TOTAL is
 * load-bearing (it shifts mainLoop's downstream vblank-spin count -> the PRNG at
 * 0x6019, README §2), so every executed instruction's tstate SUM is preserved
 * but charged in as few m.step calls as the calling convention allows: the CALL
 * cost (17) stays at the call site (convention -- it models `call 0x0852`), and
 * the tail ld/add/ld/ret (13+7+13+10 = 43) folds into the single closing
 * m.ret(43). Harness-verified EQUAL whole-machine + unit; the total is pinned by
 * an explicit cycle assertion in the test.
 *
 * ATOMIC -- stronger than entry_0611 (which was atomic only in its prologue):
 * the ENTIRE routine, CALL included, is un-interruptible because it executes
 * under the cleared NMI mask. No hardware-register (0x7Dxx) write is made here,
 * so no bus-cycle-positioned latch write needs preserving.
 */
export function loc_196b(m) {
  const { regs, mem } = m;

  // call 0x0852 -- clear the tile field + object block. Charged at the call site
  // (17 t) per the calling convention; sub_0852 runs via m.call (the oracle, or
  // a future rewrite) with its own per-instruction charges.
  m.push16(0x196e);
  m.step(0x0852, 17);
  m.call(0x0852);

  // GAME_SUBSTATE := (0x600E) + 0x12 -- the computed phase-group jump. `add` is
  // kept verbatim so A and F match the oracle exactly.
  regs.a = mem.read8(0x600e);
  regs.add(0x12);
  mem.write8(GAME_SUBSTATE, regs.a);

  // tail ld/add/ld (13+7+13) + ret (10) = 43, collapsed into the ret (see CYCLES).
  m.ret(43);
}
