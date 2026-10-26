// SPDX-License-Identifier: GPL-3.0-only
import { GAME_MODE, MODE_DISPATCH_SEL, GAME_MODE_PENDING, MODE_DELAY_TIMER } from "./names.js";

/**
 * seedModeParamsMinimal -- the leanest alternate state-entry seeder. ROM 0xc97b.
 *
 * Role in the machine: one of the mode-entry seeders reachable from the main-loop trampoline. It arms the
 * next game state with only the four core mode/timing cells -- no status masking, no slot count, no bound
 * cells -- so it is the minimal transition into a mode 0x0a state that promotes pending mode 0x04 after a
 * short delay. Takes no inputs; writes constants only.
 *
 * Behavior: GAME_MODE_PENDING (loc_2) = 0x04 (the mode to promote), MODE_DISPATCH_SEL (loc_1) = 0x00 (the
 * pre-doubled trampoline selector paired with the mode byte), GAME_MODE (loc_0) = 0x0a (the live mode),
 * MODE_DELAY_TIMER (loc_4) = 0x14 (the promotion countdown).
 *
 * Live-out: GAME_MODE_PENDING, MODE_DISPATCH_SEL, GAME_MODE, MODE_DELAY_TIMER.
 *
 * y and x are the Y and X the ROM enters with; it loads neither, so it returns them unchanged as its exit
 * [X, Y]. Grounding: [seen].
 */
export function seedModeParamsMinimal(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;
  mem8[GAME_MODE_PENDING] = 0x04;   // mode to promote when the delay expires
  mem8[MODE_DISPATCH_SEL] = 0x00;   // pre-doubled trampoline selector
  mem8[GAME_MODE] = 0x0a;            // live mode
  mem8[MODE_DELAY_TIMER] = 0x14;    // promotion countdown
  return [x, y];
}
