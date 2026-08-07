// SPDX-License-Identifier: GPL-3.0-only
/** loc_315b — a bare transfer: control leaves for one fixed address chosen here and does not come
 * back. No cell is read or written, no register moves. LIVE-OUT: whatever the destination leaves. */

const DESTINATION = 0x3176;

export function loc_315b(m) {
  return m.call(DESTINATION);
}
