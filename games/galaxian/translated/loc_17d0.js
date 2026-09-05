// SPDX-License-Identifier: GPL-3.0-only

// loc_17d0  (ROM 0x17d0-0x17e4) — gated on (0x4006) bit0 (rrca->ret nc: return unless set). Decrements the
// counter (0x41c2); while it stays nonzero, tail-jumps to loc_17e5, else zeroes it, stores 0xa002 into the
// 16-bit cell 0x41c3/0x41c4, and returns.
export function loc_17d0(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4006); // per-frame gate flag
  m.step(0x17d3, 13);

  regs.rrca(); // bit0 -> carry
  m.step(0x17d4, 4);

  if (regs.fNC) {
    // ret nc (taken) -- gate bit0 clear: skip this frame
    m.ret(11);
    return;
  }
  m.step(0x17d5, 5); // ret nc (not taken)

  regs.hl = 0x41c2; // counter address
  m.step(0x17d8, 10);

  regs.a = mem.read8(regs.hl);
  m.step(0x17d9, 7);

  regs.a = regs.dec8(regs.a);
  m.step(0x17da, 4);

  if (regs.fNZ) {
    // jp nz,0x17e5 (taken) -- counter still nonzero: tail to loc_17e5
    m.step(0x17e5, 10);
    return m.call(0x17e5);
  }
  m.step(0x17dd, 10); // jp nz,0x17e5 (not taken)

  mem.write8(regs.hl, regs.a); // (0x41c2) = 0
  m.step(0x17de, 7);

  regs.hl = 0xa002;
  m.step(0x17e1, 10);

  mem.write16(0x41c3, regs.hl); // 0x41c3/0x41c4 = 0xa002
  m.step(0x17e4, 16);

  // ret
  m.ret();
}
