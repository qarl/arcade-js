// SPDX-License-Identifier: GPL-3.0-only
import { STATUS_FLAGS, ACTIVE_SLOT_COUNT, GAME_MODE_PENDING, GAME_MODE, MODE_DELAY_TIMER, MODE_DELAY_GUARD, MODE_DISPATCH_SEL } from "./names.js";

/**
 * seedModeParamsFromMaskedFlags -- alternate state-entry seeder that first trims the status flags. ROM 0xca18.
 *
 * Role in the machine: one of several mode-entry seeders the main-loop trampoline can jump to. It arms the
 * mode/timing block for the next game state, but unlike the plain seeders it first strips the top two bits
 * of the status byte -- clearing the play/active-state flag (bit7) and its neighbour -- so the new state
 * starts from a clean status while its low six gating bits survive. Takes no inputs beyond the current
 * STATUS_FLAGS value it masks.
 *
 * Behavior: STATUS_FLAGS (loc_5) &= 0x3f keeps only the low six bits. Then it writes the fixed mode block:
 * ACTIVE_SLOT_COUNT (loc_3e) = 0x00, GAME_MODE_PENDING (loc_2) = 0x1a (the mode to promote once the delay
 * expires), GAME_MODE (loc_0) = 0x0a (the live mode), MODE_DELAY_TIMER (loc_4) = 0xa0 (the promotion
 * countdown), MODE_DELAY_GUARD (loc_16b) = 0x01, and MODE_DISPATCH_SEL (loc_1) = 0x0a (the pre-doubled
 * trampoline selector paired with the mode byte).
 *
 * Live-out: STATUS_FLAGS (top two bits cleared), ACTIVE_SLOT_COUNT, GAME_MODE_PENDING, GAME_MODE,
 * MODE_DELAY_TIMER, MODE_DELAY_GUARD, MODE_DISPATCH_SEL.
 *
 * y and x are the Y and X the ROM enters with; it loads neither, so it returns them unchanged as its exit
 * [X, Y]. Grounding: [seen].
 */
export function seedModeParamsFromMaskedFlags(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;
  mem8[STATUS_FLAGS] = mem8[STATUS_FLAGS] & 0x3f; // keep only the low six bits (clear play/active flags)
  mem8[ACTIVE_SLOT_COUNT] = 0x00;                 // no active slots
  mem8[GAME_MODE_PENDING] = 0x1a;                 // mode to promote when the delay expires
  mem8[GAME_MODE] = 0x0a;                          // live mode
  mem8[MODE_DELAY_TIMER] = 0xa0;                   // promotion countdown
  mem8[MODE_DELAY_GUARD] = 0x01;                   // guard holding the pending transition
  mem8[MODE_DISPATCH_SEL] = 0x0a;                  // pre-doubled trampoline selector
  return [x, y];
}
