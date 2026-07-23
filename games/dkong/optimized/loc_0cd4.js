// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0cd4 — hand-optimized rewrite of the translated routine at ROM 0x0CD4,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0cc6) is reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so it resolves to the oracle or to
 * a future optimized rewrite — never a copy. Only the RAM name SND_BGM is
 * imported (from ram.js).
 */

import { SND_BGM } from "./ram.js";

/**
 * loc_0cd4 -- 25m (board 1) girder-board setup arm.  [ROM 0x0CD4-0x0CDE]
 *
 *   0cd4  11 e4 3a     ld   de,0x3ae4   ; DE = 25m board-layout table pointer
 *   0cd7  3e 08        ld   a,0x08      ; A  = 25m background-tune index
 *   0cd9  32 89 60     ld   (0x6089),a  ; SND_BGM = 0x08  (queue the 25m theme)
 *   0cdc  c3 c6 0c     jp   0x0cc6      ; TAIL jump into the shared board-draw tail
 *
 * WHAT IT DOES. This is the board-1 arm of the four-way board-setup dispatch in
 * loc_0c92 (`ld a,(0x6227) / dec a / jp z,0x0cd4 ...`), entered when BOARD
 * (0x6227) == 1. It does exactly two things before the tail jump:
 *   - loads DE with the ROM address 0x3AE4 of the 25m layout table. DE is
 *     LIVE-OUT: the shared tail loc_0cc6 hands it to 0x0DA7, which walks the
 *     table with `ld a,(de)` (terminating on 0xAA). So this arm selects WHICH
 *     table the shared draw tail renders.
 *   - queues the 25m background tune by storing 0x08 into SND_BGM (0x6089), the
 *     source the per-NMI sound driver copies to the ls175.3d latch 0x7C00 while
 *     SND_PRIORITY_FRAMES is 0 (ROM 0x0102). Each of the four board arms queues a
 *     different tune (0x08/0x09/0x0A/0x0B). This is WORK RAM, not a hardware
 *     latch — so there is no bus-cycle-positioned write here (contrast the
 *     sibling arms 0x0CDF/0x0CB6, which DO write the 0x7D86/0x7D87 palette
 *     latches; this arm deliberately touches neither).
 * Then it tail-jumps to loc_0cc6 (no return address pushed): 0x0cc6's downstream
 * `ret` returns to loc_0cd4's caller (loc_0c92's caller), not to loc_0cd4.
 *
 * INPUTS  : none read from RAM/regs by this arm itself (its caller has already
 *           selected it on BOARD==1); F carries the Z from the caller's `dec a`.
 * OUTPUTS : DE = 0x3AE4 (live-out into 0x0cc6), A = 0x08, SND_BGM (0x6089) = 0x08.
 *           F is UNCHANGED (none of ld de,nn / ld a,n / ld (nn),a / jp affect
 *           flags), so the caller-set Z survives into loc_0cc6 exactly as the
 *           oracle leaves it — the unit gate compares the whole register file, F
 *           included, so A and F are kept verbatim rather than "known-dead".
 *
 * LADDER STATUS -- idiomatic, cycles collapsed to ONE total charge.
 * loc_0cd4 is ATOMIC: it is only ever entered inside the vblank NMI dispatch
 * (loc_0c92 <- handler_0763, the game-state-1 sub-state handler, and the rst 0x18
 * tail into loc_0c92 — both run with the NMI mask CLEARED; the probe confirmed
 * nmiMask==0 throughout). The mask is the hardware's own mutual-exclusion gate
 * (machine.fireNmi), so the vblank NMI structurally CANNOT fire inside this
 * routine on any call path — its internal cycle DISTRIBUTION is therefore free.
 * The per-instruction charges (10+7+13+10) collapse to one m.step(0x0cc6, 40).
 * The TOTAL is still load-bearing (README §2): a wrong total shifts the NMI's
 * cost, moving the main-loop spin count and where the next frame boundary falls
 * inside the heavy 0x0cc6 board-setup chain — which is why the 40 T is preserved,
 * just as one charge instead of four. Collapse verified EQUAL whole-machine over
 * a 560-frame run (loc_0cd4 first fires at frame 518; a 42-frame tail exercises
 * the downstream sensitivity to the total), and by an explicit cycle-total test.
 */
export function loc_0cd4(m) {
  const { regs, mem } = m;

  regs.de = 0x3ae4;              // 25m layout-table pointer, live-out into loc_0cc6 -> 0x0da7
  regs.a = 0x08;                 // 25m background-tune index
  mem.write8(SND_BGM, regs.a);   // 0x6089 = 0x08 -- queue the 25m theme (work RAM)

  // jp 0x0cc6 -- TAIL jump into the shared board-draw tail. Cycles collapsed to
  // one total (10+7+13+10 = 40 T); ATOMIC, so the distribution is free.
  m.step(0x0cc6, 40);
  return m.call(0x0cc6);
}
