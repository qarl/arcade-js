// SPDX-License-Identifier: GPL-3.0-only

// loc_258c  (ROM 0x258c-0x2590) — shared two-cell-writer tail: write the second VRAM cell via loc_25a0,
// restore the DE saved by the caller, and return. Entered by fall-through from loc_2585 and by a jump
// from 0x259c (the parallel entry at 0x2591); both push DE before reaching here.
export function loc_258c(m) {
  const { regs } = m;

  m.push16(0x258f);
  m.step(0x25a0, 17);
  m.call(0x25a0); // second cell

  regs.de = m.pop16();
  m.step(0x2590, 10); // restore caller's DE

  m.ret();
}
