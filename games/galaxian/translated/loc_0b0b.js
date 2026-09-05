// SPDX-License-Identifier: GPL-3.0-only

// loc_0b0b  (ROM 0x0b0b-0x0b76) — called from 0x0673. If (0x4208) bit0 clear, ret. Takes the position byte
// (0x4209); if >=0x68 or <0x1e, ret. Bands the value: subtract 0x1e then repeatedly -7/-5 (up to B=6 rounds)
// to derive a row index B; -7 underflow -> ret, -5 underflow -> loc_0b25 (column stage). loc_0b25 reads
// (0x420a), forms neg diff vs (0x420e), rejects if (diff&0x0f)-2 in [0..0x0a] window is out of range, then
// indexes grid 0x4100 by ((diff&0xf0)+B)>>4. If that cell bit0 set: clear it, call 0x08f2 (d=1,e=cell-lo),
// stash the returned D at (0x420b)/(0x42b1), (0x42b2)<-0, (0x42b3/4)<-(0x4209/a), then tail-jp 0x08f2 with a
// derived E (0 when cell-lo<0x50).
export function loc_0b0b(m) {
  const { regs, mem } = m;

  regs.hl = 0x4208;
  m.step(0x0b0e, 10);
  regs.bit(0, mem.read8(regs.hl));
  m.step(0x0b10, 12); // (0x4208) bit0
  if (regs.fZ) { m.ret(11); return; } // ret z
  m.step(0x0b11, 5);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0b12, 6); // inc hl (16-bit, no flags) -> 0x4209
  regs.a = mem.read8(regs.hl);
  m.step(0x0b13, 7);
  regs.cp(0x68);
  m.step(0x0b15, 7);
  if (regs.fNC) { m.ret(11); return; } // ret nc -- >= 0x68
  m.step(0x0b16, 5);
  regs.sub(0x1e);
  m.step(0x0b18, 7);
  if (regs.fC) { m.ret(11); return; } // ret c -- < 0x1e
  m.step(0x0b19, 5);
  regs.b = 0x06;
  m.step(0x0b1b, 7);

  for (;;) {
    // loc_0b1b loop top
    regs.sub(0x07);
    m.step(0x0b1d, 7);
    if (regs.fC) { m.ret(11); return; } // ret c
    m.step(0x0b1e, 5);
    regs.sub(0x05);
    m.step(0x0b20, 7);
    if (regs.fC) {
      m.step(0x0b25, 12); // jr c,0x0b25
      break;
    }
    m.step(0x0b22, 7);
    if (regs.djnz() !== 0) {
      m.step(0x0b1b, 13); // djnz 0x0b1b
      continue;
    }
    m.step(0x0b24, 8);
    m.ret();
    return;
  }

  // loc_0b25:
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0b26, 6); // inc hl (16-bit, no flags) -> 0x420a
  regs.a = mem.read8(0x420e);
  m.step(0x0b29, 13);
  regs.sub(mem.read8(regs.hl));
  m.step(0x0b2a, 7);
  regs.neg();
  m.step(0x0b2c, 8); // A = (0x420a) - (0x420e)
  regs.c = regs.a;
  m.step(0x0b2d, 4);
  regs.and(0x0f);
  m.step(0x0b2f, 7);
  regs.sub(0x02);
  m.step(0x0b31, 7);
  regs.cp(0x0b);
  m.step(0x0b33, 7);
  if (regs.fNC) { m.ret(11); return; } // ret nc -- column offset out of window
  m.step(0x0b34, 5);
  regs.b = regs.inc8(regs.b);
  m.step(0x0b35, 4);
  regs.a = regs.c;
  m.step(0x0b36, 4);
  regs.and(0xf0);
  m.step(0x0b38, 7);
  regs.add(regs.b);
  m.step(0x0b39, 4);
  regs.rrca();
  m.step(0x0b3a, 4);
  regs.rrca();
  m.step(0x0b3b, 4);
  regs.rrca();
  m.step(0x0b3c, 4);
  regs.rrca();
  m.step(0x0b3d, 4); // A = ((C&0xf0)+B) >> 4
  regs.e = regs.a;
  m.step(0x0b3e, 4);
  regs.d = 0x00;
  m.step(0x0b40, 7);
  regs.hl = 0x4100;
  m.step(0x0b43, 10);
  regs.addHl(regs.de);
  m.step(0x0b44, 11); // HL = grid cell
  regs.bit(0, mem.read8(regs.hl));
  m.step(0x0b46, 12);
  if (regs.fZ) { m.ret(11); return; } // ret z -- cell empty
  m.step(0x0b47, 5);
  mem.write8(regs.hl, regs.d);
  m.step(0x0b48, 7); // cell <- 0 (clear)
  regs.d = 0x01;
  m.step(0x0b4a, 7);
  regs.e = regs.l;
  m.step(0x0b4b, 4);
  m.push16(0x0b4e);
  m.step(0x08f2, 17); // call 0x08f2 (d=1, e=cell-lo)
  m.call(0x08f2);
  regs.a = regs.d;
  m.step(0x0b4f, 4);
  mem.write8(0x420b, regs.a);
  m.step(0x0b52, 13); // (0x420b) <- D
  mem.write8(0x42b1, regs.a);
  m.step(0x0b55, 13); // (0x42b1) <- D
  regs.xor(regs.a);
  m.step(0x0b56, 4);
  mem.write8(0x42b2, regs.a);
  m.step(0x0b59, 13); // (0x42b2) <- 0
  regs.hl = mem.read16(0x4209);
  m.step(0x0b5c, 16);
  mem.write16(0x42b3, regs.hl);
  m.step(0x0b5f, 16); // (0x42b3/4) <- (0x4209/a)
  regs.d = 0x03;
  m.step(0x0b61, 7);
  regs.a = regs.e;
  m.step(0x0b62, 4);
  regs.cp(0x50);
  m.step(0x0b64, 7);
  if (regs.fC) {
    m.step(0x0b72, 12); // jr c,0x0b72
    // loc_0b72:
    regs.e = 0x00;
    m.step(0x0b74, 7);
    m.step(0x08f2, 10); // jp 0x08f2
    return m.call(0x08f2);
  }
  m.step(0x0b66, 7);
  regs.and(0x70);
  m.step(0x0b68, 7);
  regs.rrca();
  m.step(0x0b69, 4);
  regs.rrca();
  m.step(0x0b6a, 4);
  regs.rrca();
  m.step(0x0b6b, 4);
  regs.rrca();
  m.step(0x0b6c, 4); // A = (E&0x70) >> 4
  regs.sub(0x04);
  m.step(0x0b6e, 7);
  regs.e = regs.a;
  m.step(0x0b6f, 4);
  m.step(0x08f2, 10); // jp 0x08f2
  return m.call(0x08f2);
}
