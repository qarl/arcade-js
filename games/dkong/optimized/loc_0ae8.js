// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0ae8 — hand-optimized rewrite of the translated routine at ROM 0x0AE8,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its callees (0x306F, 0x304A) are reached through `m.call`,
 * the routine registry (games/dkong/routines.js), so each resolves to the oracle —
 * or to a future optimized rewrite — never a copy. Only RAM *names* are imported
 * (from ram.js).
 */

import { SUBSTATE_TIMER, INTRO_STEP } from "./ram.js";

/**
 * loc_0ae8 -- INTRO_STEP 2 of the opening Kong-climb cutscene: advance the climb
 * one tick and, when it reaches the top, move on to the next cutscene phase.
 * [ROM 0x0AE8-0x0B05; entry 2 of loc_0a76's 0x0A7A rst-0x28 table, reached via
 * dispatchGameState while GAME_STATE(0x6005)==3, GAME_SUBSTATE(0x600A)==7 and
 * INTRO_STEP(0x6385)==2 -- it runs every NMI while the step is 2.]
 *
 *   0ae8  cd 6f 30   call 0x306f      ; bump 0x62af, occasional RNG shuffle + PRNG mix
 *   0aeb  3a af 62   ld   a,(0x62af)  ; A = the tick counter sub_306f just incremented
 *   0aee  e6 0f      and  0x0f        ; Z iff (counter & 0x0f)==0 -- every 16th tick
 *   0af0  cc 4a 30   call z,0x304a    ; on that tick, scroll a climb cell up one row
 *   0af3  3a 0b 69   ld   a,(0x690b)  ; A = the climb position/counter
 *   0af6  fe 5d      cp   0x5d
 *   0af8  d0         ret  nc          ; 0x690B >= 0x5D -> still climbing, stay in step 2
 *   0af9  3e 20      ld   a,0x20      ; else reached the top:
 *   0afb  32 09 60   ld   (0x6009),a  ;   arm SUBSTATE_TIMER to 0x20 (32-frame phase)
 *   0afe  21 85 63   ld   hl,0x6385
 *   0b01  34         inc  (hl)        ;   advance INTRO_STEP 2 -> 3 (next cutscene phase)
 *   0b02  22 c0 63   ld   (0x63c0),hl ;   seed the 0x63C0 pointer with 0x6385
 *   0b05  c9         ret
 *
 * WHAT IT DOES. Each NMI while INTRO_STEP==2 it ticks the climb forward:
 *   - call 0x306f (sub_306f): increments the work-RAM tick counter 0x62AF and, on
 *     1 of every 8 calls, does an RNG-mixed shuffle of the 0x6909/0x691D animation
 *     records plus a PRNG update (sub_0057). Called unconditionally.
 *   - and 0x0F on that counter: every 16th tick the low nibble is 0, and the
 *     `call z,0x304a` copies two cells (0x7600+i, 0x75C0+i) one tilemap row up and
 *     decrements 0x638E -- the periodic scroll of the climb graphic.
 *   - 0x690B is the climb position, walked DOWN by sub_306f (values seen 0xD5..0x59
 *     in the coin+start run). While it is >= 0x5D the `ret nc` returns and step 2
 *     repeats next frame. When it finally drops below 0x5D the climb has reached the
 *     top: arm SUBSTATE_TIMER (0x6009) to 0x20 for the next phase, `inc (0x6385)` to
 *     advance INTRO_STEP to 3 so the NEXT NMI dispatches loc_3069 instead, and store
 *     the pointer 0x6385 into 0x63C0.
 *
 * INPUTS.  RAM: 0x62AF (read after sub_306f bumps it), 0x690B. Registers on entry:
 *   none consumed. OUTPUTS. RAM: 0x62AF/0x6909../0x6018.. (via sub_306f), video RAM
 *   + 0x638E (via sub_304a, only on the 16th-tick arm), and on the top-reached arm
 *   SUBSTATE_TIMER, INTRO_STEP (incremented) and 0x63C0. Register file on exit is
 *   whatever the callees + the final flag-writer leave (see FLAGS).
 *
 * BRANCHES. Two independent data-dependent branches:
 *   (1) call z,0x304a  -- taken when (0x62AF & 0x0F)==0, else skipped.
 *   (2) ret nc         -- taken (exit A, stay in step 2) when 0x690B >= 0x5D, else
 *                         falls through to the top-reached body (exit B, advance).
 *   The coin+start run exercises call-taken 15x, call-skipped 233x, ret-taken 247x
 *   (exit A) and ret-not-taken 1x (exit B, the frame the climb tops out). The fourth
 *   combination (call-taken AND exit-B in the same frame) never occurs naturally and
 *   is synthesised in the test, with its collapsed cycle total pinned.
 *
 * FLAGS. Nothing downstream consumes loc_0ae8's flags: its caller (dispatchGameState's
 *   rst-0x28 tail via loc_0a76/sub_0028) makes no `ret cc` and branches on no flag it
 *   sets -- same as the sibling cutscene arms loc_0a8a/loc_0a76. But the unit gate
 *   compares the whole register file incl. F, so the flag-writers are kept verbatim:
 *   `and 0x0f` (Z gates the call), `cp 0x5d` (C is the exit-A `ret nc` predicate and
 *   the observable F on exit A), `inc (hl)` (the observable F on exit B). A on exit A
 *   is (0x690B); A on exit B is 0x20; HL on exit B is 0x6385.
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles COLLAPSED to one total per straight-
 *   line run. loc_0ae8 runs INSIDE the vblank NMI (dispatchGameState, reached from
 *   the NMI handler which enters with the mask cleared), so no nested NMI fires while
 *   it executes; and like its siblings loc_0a8a/loc_0a76 its callees (sub_306f,
 *   sub_304a and everything THEY call -- sub_0057/sub_3096/sub_3064/rst helpers) are
 *   short cutscene/utility routines, never the interruptible per-frame gameplay loop,
 *   so no frame boundary falls inside it either. It is therefore ATOMIC and its
 *   internal cycle distribution is free -- harness-verified EQUAL whole-machine (248
 *   dispatches over frames covering nmi 157..404) AND unit. The collapse folds each
 *   straight-line run into the m.step that PRECEDES the next control transfer, so the
 *   cumulative cycle at every callee entry AND at each exit is byte-identical to the
 *   oracle -- stronger than merely preserving the per-branch total (which it also
 *   does). The TOTAL stays load-bearing as always: this frame's NMI cost sets the
 *   main-loop vblank-spin count = the PRNG's entropy (README §2, SPIN_COUNT 0x6019),
 *   and fixes where a LATER frame's NMI lands in the diffed stack RAM -- so a wrong
 *   total would diverge. Per-branch totals (each INCLUDING the unconditional 17t
 *   `call 0x306f` prologue) are 78 / 85 / 139 / 146t: call-skipped/exit-A 17+30+31;
 *   call-taken/exit-A 17+37+31; call-skipped/exit-B 17+30+82+10ret; call-taken/exit-B
 *   17+37+82+10ret. (These are the values the ARMS test pins.)
 *   The push16/step/call scaffolding of the calling convention stays -- each callee's
 *   `ret` pops the pushed return address (README §2 last bullet).
 *
 * NO HARDWARE WRITES of its own: loc_0ae8 writes only work RAM (0x6009/0x63C0) and,
 *   via callees (through m.call to the oracle), work + video RAM -- no 0x7Dxx latch.
 *   So there is no write-bus-cycle trace for THIS routine to preserve, and the
 *   straight-line runs collapse with no trace consequence.
 */
export function loc_0ae8(m) {
  const { regs, mem } = m;

  // call 0x306f -- bump the tick counter 0x62AF (+ occasional RNG shuffle / PRNG mix).
  // Reached via m.call so it resolves to the oracle (or a future optimized rewrite).
  m.push16(0x0aeb);
  m.step(0x306f, 17);
  m.call(0x306f);

  // ld a,(0x62af) / and 0x0f -- Z on every 16th tick gates the row scroll.
  regs.a = mem.read8(0x62af);
  regs.and(0x0f);
  if (regs.fZ) {
    // call z,0x304a taken -- scroll a climb cell one row up. Collapsed: seg
    // 0aeb..0aee (13+7) + call z taken (17) = 37 t before entering 0x304a.
    m.push16(0x0af3);
    m.step(0x304a, 37);
    m.call(0x304a);
  } else {
    // call z not taken. Collapsed: seg 0aeb..0aee (20) + call-z-not-taken (10) = 30 t.
    m.step(0x0af3, 30);
  }

  // ld a,(0x690b) / cp 0x5d / ret nc -- while the climb position is >= 0x5D, stay in
  // step 2 and return (exit A). F here is cp 0x5d's; A is (0x690B).
  regs.a = mem.read8(0x690b);
  regs.cp(0x5d);
  if (regs.fNC) {
    // ret nc taken (exit A). Collapsed: seg 0af3..0af6 (20) + ret nc taken (11) = 31 t.
    m.ret(31);
    return;
  }

  // ret nc not taken (exit B): the climb reached the top. Arm the next phase timer,
  // advance INTRO_STEP 2 -> 3, and seed the 0x63C0 pointer.
  regs.a = 0x20;
  mem.write8(SUBSTATE_TIMER, regs.a);   // 0x6009 -- arm the 32-frame phase countdown
  regs.hl = INTRO_STEP;                  // 0x6385
  regs.incMem8(mem, regs.hl);            // inc (hl) -- advance the cutscene step; sets final F
  mem.write16(0x63c0, regs.hl);          // seed the 0x63C0 pointer with 0x6385

  // Collapsed: seg 0af3..0af6 (20) + ret-nc-not-taken (5) + seg 0af9..0b02 (57) = 82 t
  // to reach the ret at 0x0b05; the ret itself charges its own 10 t.
  m.step(0x0b05, 82);
  m.ret();
}
