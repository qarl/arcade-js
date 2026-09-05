// SPDX-License-Identifier: GPL-3.0-only

// loc_211d  (ROM 0x211d-0x2130) — folds B toward a 2-bit value. Saves AF; if B >= 0x70 tail-jumps to the
// clamp at 0x210a (B=0x80). Otherwise B = (swap-nibbles(work-RAM 0x425f) + B + C) & 0x03, restores AF,
// returns. The `pop af` at 0x210a balances this routine's `push af` on the taken path.
export function loc_211d(m) {
  const { regs, mem } = m;

  m.push16(regs.af);
  m.step(0x211e, 11);

  regs.a = regs.b;
  m.step(0x211f, 4);

  regs.cp(0x70); // C set when B < 0x70
  m.step(0x2121, 7);

  if (regs.fNC) {
    m.step(0x210a, 12); // jr nc,0x210a -- B >= 0x70: clamp tail
    return m.call(0x210a);
  }
  m.step(0x2123, 7);

  regs.a = mem.read8(0x425f);
  m.step(0x2126, 13);

  regs.rrca();
  m.step(0x2127, 4);
  regs.rrca();
  m.step(0x2128, 4);
  regs.rrca();
  m.step(0x2129, 4);
  regs.rrca();
  m.step(0x212a, 4);

  regs.add(regs.b);
  m.step(0x212b, 4);

  regs.add(regs.c);
  m.step(0x212c, 4);

  regs.and(0x03);
  m.step(0x212e, 7);

  regs.b = regs.a; // folded 2-bit result
  m.step(0x212f, 4);

  regs.af = m.pop16();
  m.step(0x2130, 10);

  m.ret();
}
