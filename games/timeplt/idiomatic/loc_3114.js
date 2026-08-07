// SPDX-License-Identifier: GPL-3.0-only
/** loc_3114 — a bare transfer: control leaves for one fixed address chosen here and does not come
 * back. No cell is read or written, no register moves. LIVE-OUT: whatever the destination leaves. */

const DESTINATION = 0x307f;

export function loc_3114(m) {
  return m.call(DESTINATION);
}
