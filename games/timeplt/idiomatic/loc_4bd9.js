// SPDX-License-Identifier: GPL-3.0-only
/** loc_4bd9 — a bare transfer: control leaves for one fixed destination and does not come back.
 * No cell is read or written, no register moves. LIVE-OUT: whatever the destination leaves. */

import { selectFoldBlock } from "./selectFoldBlock.js";

export function loc_4bd9(m) {
  return selectFoldBlock(m);
}
