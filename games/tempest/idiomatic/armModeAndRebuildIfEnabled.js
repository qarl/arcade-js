// SPDX-License-Identifier: GPL-3.0-only
import { GAME_MODE, MODE_DISPATCH_SEL, STATUS_FLAGS, PENDING_WORK_FLAGS, EAROM_MODE, IN0_PORT } from "./names.js";
import { rebuildControlBlocksFromTemplate } from "./rebuildControlBlocksFromTemplate.js";

/**
 * armModeAndRebuildIfEnabled — arm the dispatch mode, then rebuild control blocks if conditions allow.
 * ROM 0xd7e1.
 *
 * Role in the machine: this is a mode-transition gate. It unconditionally arms two mode selectors, then
 * decides — from the EAROM busy flag, an operator/enable input, and a pending-work request — whether to
 * regenerate the game's control blocks from their template. The rebuild is expensive and must only run
 * when the machine is idle, the feature is enabled, and there is actually pending work to service.
 *
 * Behavior: clear the status/flags byte $5 (STATUS_FLAGS) and set the dispatch selector $1 to 0x02
 * (MODE_DISPATCH_SEL). Then bail early on any guard: if $1ca (EAROM_MODE) is nonzero the EAROM is busy, so
 * return; if bit 4 of the option port $c00 (IN0_PORT) is clear the feature is disabled, so return.
 * Otherwise write $0 = 0x00 (GAME_MODE, idle) and check the pending-work word $1c9 (PENDING_WORK_FLAGS):
 * only when its low two bits show a queued request does it call rebuildControlBlocksFromTemplate.
 *
 * Live-out: $5 = 0, $1 = 0x02, and (when it does not bail) $0 = 0x00; on the full path the control blocks
 * are rebuilt.
 *
 * y and x are the Y and X the ROM enters with. Returns the exit [X, Y] the ROM leaves: the rebuild's when
 * it runs, else the incoming x and y (nothing else here loads either). Grounding: [seen].
 */
export function armModeAndRebuildIfEnabled(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;
  mem8[STATUS_FLAGS] = 0x00;         // clear status/flags
  mem8[MODE_DISPATCH_SEL] = 0x02;    // arm the dispatch selector
  if (mem8[EAROM_MODE] !== 0) return [x, y];         // EAROM busy -> bail
  if ((mem8[IN0_PORT] & 0x10) === 0) return [x, y];  // feature disabled -> bail
  mem8[GAME_MODE] = 0x00;                      // idle mode
  if ((mem8[PENDING_WORK_FLAGS] & 0x03) === 0) return [x, y]; // nothing queued -> bail
  return rebuildControlBlocksFromTemplate(m);
}
