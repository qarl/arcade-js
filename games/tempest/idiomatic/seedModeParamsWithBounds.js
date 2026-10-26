// SPDX-License-Identifier: GPL-3.0-only
import { GAME_MODE, MODE_DISPATCH_SEL, GAME_MODE_PENDING, MODE_DELAY_TIMER, loc_14d, loc_14e } from "./names.js";

/**
 * seedModeParamsWithBounds -- alternate state-entry seeder that also seeds a cursor-span pair. ROM 0xb0e7.
 *
 * Role in the machine: one of the mode-entry seeders reachable from the main-loop trampoline. Besides the
 * four-cell mode/timing block it seeds the near/far cursor pair (loc_14d/loc_14e) that the span animations
 * later drive -- advanceSpreadingSpanAnimation spreads them apart and advancePinchingSpanAnimation squeezes
 * them together via emitSegmentedSpanBetweenCursors. So this seeder sets up a state whose visual is an
 * animated segmented span between two cursors. Takes no inputs; writes constants only.
 *
 * Behavior: GAME_MODE (loc_0) = 0x0a (live mode), GAME_MODE_PENDING (loc_2) = 0x00 (no mode pending),
 * MODE_DELAY_TIMER (loc_4) = 0xdf (promotion countdown), MODE_DISPATCH_SEL (loc_1) = 0x12 (the pre-doubled
 * trampoline selector). Then the two span bounds: far cursor loc_14e = 0x19 and near cursor loc_14d = 0x18,
 * starting them one step apart.
 *
 * Live-out: GAME_MODE, GAME_MODE_PENDING, MODE_DELAY_TIMER, MODE_DISPATCH_SEL, and the cursor-span pair
 * loc_14e/loc_14d.
 *
 * y and x are the Y and X the ROM enters with; it loads neither, so it returns them unchanged as its exit
 * [X, Y]. Grounding: [seen].
 */
export function seedModeParamsWithBounds(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;
  mem8[GAME_MODE] = 0x0a;            // live mode
  mem8[GAME_MODE_PENDING] = 0x00;   // no mode pending
  mem8[MODE_DELAY_TIMER] = 0xdf;    // promotion countdown
  mem8[MODE_DISPATCH_SEL] = 0x12;   // pre-doubled trampoline selector
  mem8[loc_14e] = 0x19;             // far cursor of the animated span
  mem8[loc_14d] = 0x18;             // near cursor of the animated span
  return [x, y];
}
