// SPDX-License-Identifier: GPL-3.0-only
// Zero the strided work-RAM block: broadcast 0 across it via the shared block writer.
import { broadcastToStridedTable as loc_0972 } from "./broadcastToStridedTable.js";

export function loc_0363(m) {
  return loc_0972(m, 0);
}
