// SPDX-License-Identifier: GPL-3.0-only
/** loc_46ba — run the arm the era index selects, then run the block just past the table of arms.
 * The mask admits eight indices where the table defines five, so an index past the end reads the
 * first bytes of that block as though they were an entry; reading the word through the same
 * arithmetic the machine uses keeps that case honest rather than assuming it away. Every arm
 * leaves through a stack slot, so the slot is laid down for it first. LIVE-OUT: memory. */

import { ERA_INDEX } from "./names.js";
import { loc_46ce } from "./loc_46ce.js";

const ARM_TABLE = 0x46c4;
const ARM_MASK = 0x07;
const AFTER_ARM = 0x46ce;

export function loc_46ba(m) {
  const arm = m.mem16[ARM_TABLE + 2 * (m.mem8[ERA_INDEX] & ARM_MASK)];
  m.push16(AFTER_ARM);
  m.call(arm);
  loc_46ce(m);
}
