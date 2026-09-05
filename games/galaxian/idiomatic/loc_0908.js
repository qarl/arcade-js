// SPDX-License-Identifier: GPL-3.0-only
// Commit the queue write-head, then restore the caller's saved HL through the stack epilogue.
import { loc_090b } from "./loc_090b.js";
import { loc_40a0 } from "./names.js";

export function loc_0908(m, head = m.regs.a) {
  const { mem8 } = m;
  mem8[loc_40a0] = head;
  return loc_090b(m);
}
