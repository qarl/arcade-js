// SPDX-License-Identifier: GPL-3.0-only
// Selects a player's status-column VRAM base: player one -> PLAYER1_STATUS_VRAM, else PLAYER2_STATUS_VRAM.
// Returns the pointer in HL; touches no memory.
import { PLAYER1_STATUS_VRAM, PLAYER2_STATUS_VRAM } from "./names.js";

export function selectPlayerStatusVram(m, playerIndex = m.regs.a) {
  return (m.regs.hl = playerIndex === 0 ? PLAYER1_STATUS_VRAM : PLAYER2_STATUS_VRAM);
}
