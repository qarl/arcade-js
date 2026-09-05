// SPDX-License-Identifier: GPL-3.0-only

// loc_1b70  (ROM 0x1B70-0x1B78) — the ROM-checksum PREAMBLE: call the VRAM-fill helper 0x1b5d, then set
// up the checksum accumulator (HL=0x0000 ROM start, B=0x28 = 40 pages, A=0) and FALL THROUGH into the
// summing loop at loc_1b79. Reached by jp 0x1b70 from 0x1af8.
//   1b70  cd 5d 1b  call 0x1b5d
//   1b73  21 00 00  ld hl,0x0000
//   1b76  06 28     ld b,0x28
//   1b78  af        xor a
export function loc_1b70(m) {
  const { regs, mem } = m;

  m.push16(0x1b73);
  m.step(0x1b5d, 17); // call 0x1b5d -- clear VRAM
  m.call(0x1b5d);

  regs.hl = 0x0000;
  m.step(0x1b76, 10); // ld hl,0x0000 -- checksum reads from ROM start

  regs.b = 0x28;
  m.step(0x1b78, 7); // ld b,0x28 -- 0x28 pages of 0x100 bytes

  regs.xor(regs.a);
  m.step(0x1b79, 4); // xor a -- A=0 running sum

  // fall-through into loc_1b79 (the checksum summing loop) -- delegate, do not inline
  return m.call(0x1b79);
}
