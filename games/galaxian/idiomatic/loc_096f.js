// SPDX-License-Identifier: GPL-3.0-only
// Broadcast the two's-complement of L across the strided work-RAM table via the shared block writer.
import { broadcastToStridedTable as loc_0972 } from "./broadcastToStridedTable.js";

export function loc_096f(m, low = m.regs.l) {
  return loc_0972(m, (-low) & 0xff);
}
