// SPDX-License-Identifier: GPL-3.0-only
/** loc_0f1f — run the arm that the low nibble of the inner sequence index selects, then run one
 * fixed block. The arm address is read out of a sixteen-entry word table laid down inline just
 * after this entry, so nothing here decides anything but which entry to take. An arm leaves
 * through a stack slot, so the slot is laid down for it first. LIVE-OUT: memory. */

import { SEQUENCE_SUBSTEP } from "./names.js";

const ARM_TABLE = 0x0f29;
const ARM_MASK = 0x0f;
const AFTER_ARM = 0x0f54;

export function loc_0f1f(m) {
  const arm = m.mem16[ARM_TABLE + 2 * (m.mem8[SEQUENCE_SUBSTEP] & ARM_MASK)];
  m.push16(AFTER_ARM);
  m.call(arm);
  m.call(AFTER_ARM);
}
