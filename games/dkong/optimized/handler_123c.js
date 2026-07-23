// SPDX-License-Identifier: GPL-3.0-only
/**
 * handler_123c — hand-optimized rewrite of the translated routine at ROM 0x123C,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0018 the rst-0x18 skip helper, 0x309f the
 * task enqueuer) is reached through `m.call(0xADDR)`, the routine registry
 * (games/dkong/routines.js), so each resolves to the oracle — or to its own
 * optimized rewrite once one exists — never a copy. Only RAM *names* are imported
 * from ram.js.
 */

import {
  BOARD, GAME_SUBSTATE,
  MARIO_ACTIVE, MARIO_X, MARIO_Y, MARIO_SPRITE_CODE, MARIO_SPRITE_ATTR,
  MARIO_MOVE_STEP_TIMER, MARIO_SPRITE_RECORD,
} from "./ram.js";

/**
 * handler_123c -- game-state-1 sub-state 2: seed the attract-demo actor record.
 * [ROM 0x123C-0x127B; entry 2 of handler_073c's 0x0748 rst-0x28 sub-state table,
 * selected while GAME_STATE(0x6005)==1, CREDITS(0x6001)==0 and GAME_SUBSTATE
 * (0x600A)==2. Dispatched from INSIDE the vblank NMI.]
 *
 * WHAT IT DOES. A one-shot setup step of the attract demo, gated by a countdown so
 * it fires only on the frame the gate expires:
 *   - `rst 0x18` (sub_0018) decrements the sub-state countdown SUBSTATE_TIMER
 *     (0x6009). While it is still counting down, control returns to THIS handler's
 *     CALLER (the skip), so the body below runs only on the frame 0x6009 hits 0.
 *   - Pick a two-field constant from BOARD (0x6227): 0xE016 when BOARD==3 (75m),
 *     else 0xF03F. The two BYTES carry two INDEPENDENT field values — the LOW byte
 *     (C) is written to the actor's +03 field and its mirror, the HIGH byte (B) to
 *     the +05 field and its mirror. Naming BC by either field names it wrong for
 *     the other, so it is kept as a raw 16-bit constant. 0xE016 vs 0xF03F is a full
 *     byte swap on the BOARD==3 arm.
 *   - Seed the actor record at 0x6200 (MARIO_* fields; IX=0x6200 in the ROM) and its
 *     4-byte sprite-record mirror at 0x694C (MARIO_SPRITE_RECORD), IN ROM WRITE ORDER
 *     (0x6200, 0x6203, 0x694C, 0x6207, 0x694D, 0x6208, 0x694E, 0x6205, 0x694F,
 *     0x620F). The order is left as the ROM's, matching the oracle.
 *   - `inc (0x600A)` — advance GAME_SUBSTATE so the NEXT NMI dispatches the following
 *     sub-state (index 3, 0x1977) instead of re-running this one.
 *   - `call 0x309f` — enqueue task (D=0x06, E=0x01).
 *
 * INPUTS (RAM read): BOARD (0x6227); SUBSTATE_TIMER (0x6009, via the rst); the task
 *   ring pointers (via sub_309f). OUTPUTS (RAM written): the 0x6200 actor fields;
 *   the 0x694C sprite-record mirror; GAME_SUBSTATE (incremented); the task queue
 *   (via sub_309f); and SUBSTATE_TIMER (decremented, via the rst).
 *
 * REGISTERS. IX ends 0x6200 and HL ends 0x600A in the oracle (the ROM walks HL
 *   0x694C→0x694F then reloads 0x600A); both are set explicitly here so the unit
 *   gate's full register-file compare matches, even though the writes use absolute
 *   named addresses rather than an IX/HL walk and nothing downstream reads IX/HL.
 *   BC/DE are set to the oracle's values entering sub_309f; IY is untouched on both
 *   sides. The final A/F/other regs are whatever sub_309f leaves — it is the last
 *   register-toucher and is `m.call`'d identically on both sides.
 *
 * FLAGS. The ROM's `cp 0x03` sets F, but that F is DEAD: the following `inc l` /
 *   `inc (hl)` overwrite it before anything reads it, and nothing between the `cp`
 *   and them reads F (no NMI can land — see ATOMIC). So the `cp` is dropped and the
 *   branch is a plain `board === 3`. The routine's final observable F is sub_309f's
 *   (identical on both sides). No caller consumes a flag this routine sets (its
 *   rst-0x28 dispatch tail makes no `ret cc`); the unit gate confirms F regardless.
 *
 * ATOMIC — cycles collapsed, TOTAL preserved per branch. handler_123c runs INSIDE
 *   the vblank NMI, whose mask (0x7D84) is cleared for the whole handler, so a second
 *   NMI cannot land inside it OR inside its callees — its internal cycle DISTRIBUTION
 *   is unobservable. So the ~22 per-instruction m.step charges of the body collapse
 *   to ONE total per branch: 255t when BOARD==3, 265t otherwise (the extra 10t is the
 *   `ld bc,0xf03f` on the not-taken `jp z` arm). The TOTAL stays load-bearing — as
 *   part of the NMI's cost it sets the main-loop spin count (README §2, SPIN_COUNT),
 *   and sub_309f downstream is itself dispatched at the resulting clock — so each
 *   branch's sum is preserved exactly; whole-machine EQUAL confirms it. The rst-0x18
 *   scaffold (push/step/call) and the 0x309f call scaffold are the calling convention
 *   and stay verbatim; only the straight-line body between them is collapsed. No
 *   hardware (0x7Dxx) write occurs here, so there is no write-trace to preserve.
 */
export function handler_123c(m) {
  const { regs, mem } = m;

  // rst 0x18 -- decrement SUBSTATE_TIMER (0x6009); if it is still counting down,
  // sub_0018 returns to OUR caller and the body is skipped this frame.
  m.push16(0x123d);
  m.step(0x0018, 11); // rst 0x18
  if (!m.call(0x0018)) return; // gate still ticking -- skipped this frame

  // Two-field constant selected by BOARD: 0xE016 (75m) vs 0xF03F. A holds the BOARD
  // byte on exit (the ROM's `ld a,(0x6227)`), so keep it in regs.a.
  regs.a = mem.read8(BOARD);
  const board3 = regs.a === 0x03; // ROM `cp 0x03`; its flags are dead (see docstring)
  regs.bc = board3 ? 0xe016 : 0xf03f;

  // Seed the actor record at 0x6200 and its sprite-record mirror at 0x694C, in the
  // ROM's exact write order. IX=0x6200 in the ROM; set here for the register file.
  regs.ix = 0x6200;
  mem.write8(MARIO_ACTIVE, 0x01);                // ld (ix+0x00),0x01   0x6200
  mem.write8(MARIO_X, regs.c);                   // ld (ix+0x03),c      0x6203
  mem.write8(MARIO_SPRITE_RECORD + 0, regs.c);   // ld (hl),c           0x694C
  mem.write8(MARIO_SPRITE_CODE, 0x80);           // ld (ix+0x07),0x80   0x6207
  mem.write8(MARIO_SPRITE_RECORD + 1, 0x80);     // ld (hl),0x80        0x694D
  mem.write8(MARIO_SPRITE_ATTR, 0x02);           // ld (ix+0x08),0x02   0x6208
  mem.write8(MARIO_SPRITE_RECORD + 2, 0x02);     // ld (hl),0x02        0x694E
  mem.write8(MARIO_Y, regs.b);                   // ld (ix+0x05),b      0x6205
  mem.write8(MARIO_SPRITE_RECORD + 3, regs.b);   // ld (hl),b           0x694F
  mem.write8(MARIO_MOVE_STEP_TIMER, 0x01);       // ld (ix+0x0f),0x01   0x620F

  // Advance GAME_SUBSTATE (0x600A). HL ends here on both sides.
  regs.hl = GAME_SUBSTATE;
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)), 8); // inc (hl)
  regs.de = 0x0601;

  // Collapsed body total (ROM 0x1240..0x1278): 255t on BOARD==3, else 265t.
  m.step(0x1278, board3 ? 255 : 265);

  // call 0x309f -- enqueue task (D=0x06, E=0x01).
  m.push16(0x127b);
  m.step(0x309f, 17);
  m.call(0x309f);

  m.ret(); // 0x127B
}
