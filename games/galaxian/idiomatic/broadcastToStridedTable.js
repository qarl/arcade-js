// SPDX-License-Identifier: GPL-3.0-only
// Broadcast the byte in A across nine work-RAM cells at stride 2.
import { loc_4028 } from "./names.js";

// Nine cells at stride 2.
const CELL_COUNT = 9;
const STRIDE = 2;

export function broadcastToStridedTable(m, value = m.regs.a) {
  const { mem8 } = m;

  // Broadcast the byte across the strided table.
  for (let i = 0; i < CELL_COUNT; i++) mem8[loc_4028 + i * STRIDE] = value;
}
