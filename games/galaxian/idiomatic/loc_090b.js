// SPDX-License-Identifier: GPL-3.0-only
// Stack epilogue: pop the caller's saved HL and return it. Writes no RAM.

// HL is restored from the stack, so it is a genuine pop, not a load from a named cell.
export function loc_090b(m) {
  return (m.regs.hl = m.pop16());
}
