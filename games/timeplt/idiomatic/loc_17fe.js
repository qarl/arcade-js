// SPDX-License-Identifier: GPL-3.0-only
/** loc_17fe — the second level of the two-level sequence machine, for one of the outer machine's
 * modes: look the inner step index up in a table of addresses that sits inline just after this
 * entry, run the arm it names, then run this mode's shared tail. The index is used RAW and the
 * doubling that turns it into an entry offset wraps at eight bits, so a large index folds back
 * onto the head of the table. The tail does nothing at all, which is why every arm here simply
 * ends. The lookup's by-products are left standing for the arm to read. Nothing is written.
 * LIVE-OUT: memory and registers, all of them the arm's. */

import { SEQUENCE_SUBSTEP } from "./names.js";
import { fetchTableWord } from "./fetchTableWord.js";
import { loc_181d } from "./loc_181d.js";

const ARM_TABLE = 0x1806;

export function loc_17fe(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[SEQUENCE_SUBSTEP];
  regs.hl = ARM_TABLE;
  const arm = fetchTableWord(m);
  regs.de = regs.hl;
  regs.hl = arm;
  m.call(arm);
  return loc_181d(m);
}
