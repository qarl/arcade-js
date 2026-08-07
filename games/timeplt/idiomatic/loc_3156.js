// SPDX-License-Identifier: GPL-3.0-only
/** loc_3156 — fix the fill byte, then hand control on. Choosing that one constant is the entire
 * content of this entry, so whatever the caller carried in its place is discarded; control then
 * leaves for a fixed address and does not come back. LIVE-OUT: memory, through the destination. */

const FILL_BYTE = 40;
const DESTINATION = 0x30d1;

export function loc_3156(m) {
  m.regs.a = FILL_BYTE;
  return m.call(DESTINATION);
}
