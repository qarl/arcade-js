// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_037f — hand-optimized rewrite of the translated routine at ROM 0x037F,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. sub_037f has NO callees — it is a pure work-RAM leaf, so
 * nothing here goes through `m.call`; only RAM *names* are imported (from ram.js).
 */

import { DIFFICULTY, DIFFICULTY_CLOCK, DIFFICULTY_PRESCALER, LEVEL } from "./ram.js";

/**
 * sub_037f -- per-frame DIFFICULTY recompute behind two nested rate dividers.
 * [ROM 0x037F-0x03A1, called ONCE PER SERVICED FRAME from mainLoop @ ROM 0x02DB]
 *
 *   037f  ld   hl,0x6384      ; DIFFICULTY_PRESCALER
 *   0382  ld   a,(hl)         ; A = OLD prescaler (read BEFORE the inc)
 *   0383  inc  (hl)           ; prescaler++
 *   0384  and  a             ; Z <- (old prescaler == 0)
 *   0385  ret  nz            ; -- divider 1: body runs 1 frame in 256
 *   0386  ld   hl,0x6381      ; DIFFICULTY_CLOCK
 *   0389  ld   a,(hl)         ; A = OLD clock
 *   038a  ld   b,a            ; B = OLD clock (kept for the shift below)
 *   038b  inc  (hl)           ; clock++
 *   038c  and  0x07           ; Z <- (old clock % 8 == 0)
 *   038e  ret  nz            ; -- divider 2: body runs every 8th tick
 *   038f  ld   a,b            ; A = old clock
 *   0390  rrca / rrca / rrca  ; A = old clock >> 3  (low 3 bits are 0 here)
 *   0393  ld   b,a            ; B = clock >> 3
 *   0394  ld   a,(0x6229)     ; A = LEVEL
 *   0397  add  a,b            ; A = LEVEL + (clock >> 3)
 *   0398  cp   0x05
 *   039a  jr   c,0x039e       ; keep if < 5 ...
 *   039c  ld   a,0x05         ; ... else clamp to 5
 *   039e  ld   (0x6380),a     ; DIFFICULTY
 *   03a1  ret
 *
 * WHAT IT DOES. Two nested rate dividers throttle a difficulty recompute. The
 * outer divider (DIFFICULTY_PRESCALER, 0x6384) increments every serviced frame
 * and, because the value is read BEFORE the `inc`, passes only the frame it is 0
 * -- i.e. once every 256 frames. The inner divider (DIFFICULTY_CLOCK, 0x6381)
 * then increments and passes only every 8th time (`and 0x07`). When both pass,
 * DIFFICULTY (0x6380) := min(LEVEL + (DIFFICULTY_CLOCK >> 3), 5): difficulty
 * ramps with the level number AND with time on the board, clamped to 5. The `>>3`
 * is exact via three `rrca` because the inner gate guarantees the low 3 bits are 0.
 *
 * INPUTS  (RAM read):  0x6384 prescaler, 0x6381 clock, 0x6229 LEVEL.
 * OUTPUTS (RAM writ.): 0x6384 (always +1), 0x6381 (+1 on the every-256 frame),
 *                      0x6380 DIFFICULTY (only on the every-256-and-8th frame).
 * No hardware latch is touched -- every store is work RAM.
 *
 * CYCLE / ATOMICITY DECISION -- KEPT PER-INSTRUCTION (not collapsed).
 * The ONLY caller is mainLoop (ROM 0x02DB `call 0x037f`), which runs with the
 * vblank NMI mask ENABLED, so the NMI CAN land inside this routine on its one
 * call path -- it is NOT atomic (the brief's ATOMICITY-IS-PER-CALL-PATH rule).
 * A cycle collapse would move where a mid-routine NMI lands (its pushed PC / the
 * F it stacks would then diverge in work RAM), so the per-instruction `m.step`
 * charges are preserved verbatim -- each branch's TOTAL and its internal
 * distribution both match the oracle. A short whole-machine run happening not to
 * land an NMI inside these ~43-162 T-states would NOT prove a collapse safe, so
 * per-instruction is the correct, unconditional choice here.
 *
 * FLAGS / REGISTERS. No caller consumes a flag (mainLoop's next act is an
 * unconditional `call 0x03a2`), but the unit gate compares the WHOLE register
 * file (incl. F) and -- because the NMI can stack F mid-routine -- the flag state
 * must match at EVERY instruction boundary, not merely at exit. So every register
 * write and flag-setting helper (`inc8`, `and`, `rrca`, `add`, `cp`) is kept at
 * its oracle position and value; there is no dead register churn to drop (the
 * routine's whole output IS the register/RAM arithmetic). The win here is names,
 * structure, and documentation -- the handler_01c3 rung, correct for a non-atomic
 * main-loop routine.
 */
export function sub_037f(m) {
  const { regs, mem } = m;

  // ── Divider 1: DIFFICULTY_PRESCALER -- one tick per serviced frame ──────────
  regs.hl = DIFFICULTY_PRESCALER;
  m.step(0x0382, 10);
  regs.a = mem.read8(regs.hl); // OLD prescaler
  m.step(0x0383, 7);
  mem.write8(regs.hl, regs.inc8(regs.a)); // inc (hl); inc8's flags are dead (overwritten by `and a`)
  m.step(0x0384, 11);
  regs.and(regs.a); // and a -- Z iff old prescaler was 0
  m.step(0x0385, 4);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- not the 1-in-256 frame
    return;
  }
  m.step(0x0386, 5);

  // ── Divider 2: DIFFICULTY_CLOCK -- one tick per 256 frames, passes every 8th ─
  regs.hl = DIFFICULTY_CLOCK;
  m.step(0x0389, 10);
  regs.a = mem.read8(regs.hl); // OLD clock
  m.step(0x038a, 7);
  regs.b = regs.a; // ld b,a -- keep the old clock for the shift
  m.step(0x038b, 4);
  mem.write8(regs.hl, regs.inc8(regs.a)); // inc (hl); flags dead (overwritten by `and 0x07`)
  m.step(0x038c, 11);
  regs.and(0x07); // and 0x07 -- Z iff old clock % 8 == 0
  m.step(0x038e, 7);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- not an 8th tick
    return;
  }
  m.step(0x038f, 5);

  // ── Recompute DIFFICULTY = min(LEVEL + (clock >> 3), 5) ─────────────────────
  regs.a = regs.b; // ld a,b -- A = old clock
  m.step(0x0390, 4);
  for (const nxt of [0x0391, 0x0392, 0x0393]) {
    regs.rrca(); // >> 1 each; low 3 bits are 0 so 3x == an exact >> 3 (carry/flags dead, add overwrites)
    m.step(nxt, 4);
  }
  regs.b = regs.a; // ld b,a -- B = clock >> 3
  m.step(0x0394, 4);
  regs.a = mem.read8(LEVEL); // ld a,(0x6229)
  m.step(0x0397, 13);
  regs.add(regs.b); // add a,b -- A = LEVEL + (clock >> 3)
  m.step(0x0398, 4);
  regs.cp(0x05); // cp 0x05 -- sets carry consumed by the jr AND left as the exit F
  m.step(0x039a, 7);
  if (regs.fC) {
    m.step(0x039e, 12); // jr c taken -- A < 5, keep it
  } else {
    m.step(0x039c, 7); // jr c not taken
    regs.a = 0x05; // ld a,0x05 -- clamp (no flag change)
    m.step(0x039e, 7);
  }
  mem.write8(DIFFICULTY, regs.a); // ld (0x6380),a
  m.step(0x03a1, 13);
  m.ret();
}
