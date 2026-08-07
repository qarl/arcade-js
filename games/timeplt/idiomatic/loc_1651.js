// SPDX-License-Identifier: GPL-3.0-only
/** loc_1651 — the second level of the two-level sequence machine, for one of the outer machine's
 * modes: look the inner step index up in a table of addresses that sits inline just after this
 * entry, run the arm it names, then run this mode's shared tail. The index is used RAW and the
 * doubling that turns it into an entry offset wraps at eight bits, so a large index folds back
 * onto the head of the table. The arm is reached by a jump with the tail parked as its return —
 * that park is load-bearing, because each arm ends by returning to it.
 * LIVE-OUT: memory and registers, all of them the arm's and the tail's. */

import { SEQUENCE_SUBSTEP } from "./names.js";
import { fetchTableWord } from "./fetchTableWord.js";

const ARM_TABLE = 0x1659;
const SHARED_TAIL = 0x167b;

export function loc_1651(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[SEQUENCE_SUBSTEP];
  regs.hl = ARM_TABLE;
  const arm = fetchTableWord(m);
  regs.de = regs.hl;
  regs.hl = arm;
  m.push16(SHARED_TAIL);
  m.call(arm);
  return m.call(SHARED_TAIL);
}
