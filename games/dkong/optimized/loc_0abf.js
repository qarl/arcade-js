// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0abf — hand-optimized rewrite of the translated routine at ROM 0x0ABF,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0018, 0x004E, 0x0038) is reached through
 * `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copy. Only RAM *names* are imported (from ram.js).
 */

import { INTRO_STEP, SND_PRIORITY, SND_PRIORITY_FRAMES } from "./ram.js";

/**
 * loc_0abf -- INTRO_STEP 1: the second phase of the opening Kong-climb cutscene.
 * [ROM 0x0ABF-0x0AE7; entry 1 of loc_0a76's 0x0A7A rst-0x28 table, reached via
 * dispatchGameState while GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)==1.]
 *
 * WHAT IT DOES. This phase is TIMER-GATED: loc_0a8a (INTRO_STEP 0) armed
 * SUBSTATE_TIMER (0x6009) to 0x40, and this routine runs on every NMI while
 * INTRO_STEP==1, ticking that countdown down by one each frame and doing its real
 * work only on the frame it reaches zero:
 *   - `rst 0x18` (sub_0018) decrements SUBSTATE_TIMER. Unless it hit 0, sub_0018
 *     discards this routine's remainder and returns to loc_0a76's caller — the
 *     ABORT branch (~63 frames). When it DOES hit 0, control falls through into
 *     the body — the WORK branch (exactly one frame).
 *   - Body: copy the 0x28-byte cutscene record block from ROM 0x388C to 0x6908
 *     (sub_004e; HL is its source, set here); run two add-passes over the copied
 *     block (loc_0038 alias `rst 0x38` — adds C to 10 bytes from HL, stride 4):
 *     HL=0x6908 C=0x30, then HL=0x690B C=0x99; seed two bytes (0x638E<-0x1F,
 *     0x690C<-0); queue the intro tune (SND_PRIORITY<-1, SND_PRIORITY_FRAMES<-3 —
 *     a 3-frame priority-sound pulse); and `inc (INTRO_STEP)` so the NEXT NMI
 *     dispatches the following cutscene phase instead of re-running this one.
 *
 * INPUTS: SUBSTATE_TIMER (0x6009, via sub_0018) and INTRO_STEP (read by the final
 *   inc); the source table ROM 0x388C is an immediate. OUTPUTS (work branch):
 *   0x6908.. record block (sub_004e + two loc_0038 passes), 0x638E, 0x690C,
 *   SND_PRIORITY, SND_PRIORITY_FRAMES, INTRO_STEP (incremented), and SUBSTATE_TIMER
 *   (decremented, both branches, via sub_0018). No HARDWARE (0x7Dxx) writes at all
 *   — every store is work RAM — so there is no write-bus-cycle trace to preserve and
 *   no write-trace test (unlike loc_0a8a's palette latches).
 *
 * FLAGS: nothing downstream consumes loc_0abf's flags — its caller (loc_0a76's
 *   rst-0x28 tail) makes no `ret cc` and branches on no flag it sets, and the abort
 *   is effected by sub_0018's STACK manipulation (a boolean return, kept), not by a
 *   condition flag. But the unit gate compares the whole register file incl. F, so
 *   the flag-writers are reproduced verbatim with the same primitives: the final
 *   observable F on the work branch is `inc (INTRO_STEP)`'s (1->2: S/Z/H/PV/N clear,
 *   C preserved 0 from the preceding `xor a`) = 0x00, and A ends 0. On the abort
 *   branch loc_0abf sets no flags of its own (only sub_0018 runs).
 *
 * ATOMIC — cycles collapsed, TOTAL preserved per branch. loc_0abf runs INSIDE the
 *   vblank NMI (dispatchGameState), which does not re-enter, and every callee
 *   (sub_0018/sub_004e/loc_0038) is a leaf helper that runs to completion within the
 *   same NMI — none spans a frame or is interruptible — so the NMI never lands
 *   inside loc_0abf and its internal cycle DISTRIBUTION is unobservable. The
 *   per-instruction charges therefore collapse to ONE total per executed segment
 *   (a segment ends at each `m.call`, whose preceding `m.step` must also position PC
 *   at the callee, so a call boundary is where a lump necessarily breaks):
 *     - ABORT branch: the single rst-0x18 charge, 11t (+ sub_0018's own charges).
 *     - WORK branch: 11 (rst 0x18) + 27 (ld hl + call 0x004e) + 28 (ld hl + ld c +
 *       rst 0x38) + 28 (ld hl + ld c + rst 0x38) + 94 (epilogue) = 188t of loc_0abf
 *       proper, + ret 10t = 198t; plus each callee's identical charges via m.call.
 *   The TOTAL stays load-bearing — as part of the NMI's cost it sets the main-loop
 *   spin count (README §2, SPIN_COUNT) — so each branch's sum is preserved exactly;
 *   the harness confirms it (whole-machine EQUAL, and a per-branch cycle-total
 *   assertion in the synthesised branch tests, where a wrong lump total is caught).
 */
export function loc_0abf(m) {
  const { regs, mem } = m;

  // rst 0x18 -- substate-timer gate. sub_0018 decrements SUBSTATE_TIMER (0x6009)
  // and returns true only when it reaches 0; otherwise it discards this routine's
  // remainder (pops loc_0abf's return address) and hands control to loc_0a76's
  // caller, which the boolean models -- so this `return` is the abort branch.
  m.push16(0x0ac0);
  m.step(0x0018, 11); // rst 0x18
  if (!m.call(0x0018)) return; // timer not expired -- aborted to caller

  // Copy the 0x28-byte cutscene record block ROM 0x388C -> 0x6908. sub_004e reads
  // HL as its source (it sets only DE/BC), so HL must be live before the call.
  regs.hl = 0x388c;
  m.push16(0x0ac6);
  m.step(0x004e, 27); // ld hl,0x388c (10) + call 0x004e (17)
  m.call(0x004e);

  // Two add-passes over the copied block. loc_0038 (`rst 0x38`) adds C to 10 bytes
  // from HL, stride 4; both HL and C are its inputs and are set before each call.
  regs.hl = 0x6908;
  regs.c = 0x30;
  m.push16(0x0acc);
  m.step(0x0038, 28); // ld hl,0x6908 (10) + ld c,0x30 (7) + rst 0x38 (11)
  m.call(0x0038);

  regs.hl = 0x690b;
  regs.c = 0x99;
  m.push16(0x0ad2);
  m.step(0x0038, 28); // ld hl,0x690b (10) + ld c,0x99 (7) + rst 0x38 (11)
  m.call(0x0038);

  // Epilogue: seed two record bytes, queue the intro tune, advance INTRO_STEP.
  // Atomic + no hardware writes, so the 10 per-instruction charges collapse to one.
  regs.a = 0x1f;
  mem.write8(0x638e, regs.a); // 0x638E = 0x1F
  regs.xor(regs.a); // A = 0
  mem.write8(0x690c, regs.a); // 0x690C = 0

  regs.hl = SND_PRIORITY; // 0x608A
  mem.write8(regs.hl, 0x01); // priority tune index = 1 (intro)
  regs.hl = (regs.hl + 1) & 0xffff; // 0x608B = SND_PRIORITY_FRAMES
  mem.write8(regs.hl, 0x03); // 3-frame priority-sound pulse

  regs.hl = INTRO_STEP; // 0x6385
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance the cutscene step; sets final F

  // ld a,0x1f (7) + ld(638e) (13) + xor a (4) + ld(690c) (13) + ld hl (10)
  //   + ld(hl),01 (10) + inc hl (6) + ld(hl),03 (10) + ld hl (10) + inc(hl) (11) = 94t
  m.step(0x0ae7, 94);
  m.ret(); // ret (0x0AE7) -- 10t; pops loc_0abf's return
}
