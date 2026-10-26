// SPDX-License-Identifier: GPL-3.0-only
// loc_0010  (ROM 0x0010-0x0071) -- RST2 (vblank) interrupt vector: save PSW/BC/DE/HL, tick
// frame counter 0x20c0, sound tick 0x17cd, input pause/BCD timer, then per-frame dispatch.
export function loc_0010(m) {
  const { regs, mem } = m;

  m.push16(regs.af); m.step(0x0011, 11);
  m.push16(regs.bc); m.step(0x0012, 11);
  m.push16(regs.de); m.step(0x0013, 11); // 0012  push d
  m.push16(regs.hl); m.step(0x0014, 11); // 0013  push h
  regs.a = 0x80; m.step(0x0016, 7); // 0014  mvi a,0x80
  mem.write8(0x2072, regs.a); m.step(0x0019, 13); // 0016  sta 0x2072
  regs.hl = 0x20c0; m.step(0x001c, 10); // 0019  lxi h,0x20c0
  regs.decMem8(mem, regs.hl); m.step(0x001d, 10); // 001c  dcr m
  m.push16(0x0020); m.step(0x17cd, 17); m.call(0x17cd); // 001d  call 0x17cd
  regs.a = m.io.portIn(0x01); m.step(0x0022, 10); // 0020  in 0x01
  regs.rrca(); m.step(0x0023, 4); // 0022  rrc

  let toLoc0042 = false;
  if (regs.fC) {
    m.step(0x0067, 10);
    regs.a = 0x01; m.step(0x0069, 7); // 0067  mvi a,0x01
    mem.write8(0x20ea, regs.a); m.step(0x006c, 13); // 0069  sta 0x20ea
    m.step(0x003f, 10); // 006c  jmp 0x003f
  } else {
    m.step(0x0026, 10);
    regs.a = mem.read8(0x20ea); m.step(0x0029, 13); // 0026  lda 0x20ea
    regs.and(regs.a); m.step(0x002a, 4); // 0029  ana a
    if (regs.fZ) {
      m.step(0x0042, 10);
      toLoc0042 = true;
    } else {
      m.step(0x002d, 10);
      regs.a = mem.read8(0x20eb); m.step(0x0030, 13); // 002d  lda 0x20eb
      regs.cp(0x99); m.step(0x0032, 7); // 0030  cpi 0x99
      if (regs.fNZ) {
        m.step(0x0035, 10);
        regs.add(0x01); m.step(0x0037, 7); // 0035  adi 0x01
        regs.daa(); m.step(0x0038, 4); // 0037  daa
        mem.write8(0x20eb, regs.a); m.step(0x003b, 13); // 0038  sta 0x20eb
        m.push16(0x003e); m.step(0x1947, 17); m.call(0x1947); // 003b  call 0x1947
      } else {
        m.step(0x003e, 10);
      }
      regs.xor(regs.a); m.step(0x003f, 4); // 003e  xra a
    }
  }

  if (!toLoc0042) {
    mem.write8(0x20ea, regs.a); m.step(0x0042, 13); // 003f  sta 0x20ea
  }

  regs.a = mem.read8(0x20e9); m.step(0x0045, 13); // 0042  lda 0x20e9
  regs.and(regs.a); m.step(0x0046, 4); // 0045  ana a
  if (regs.fZ) { m.step(0x0082, 10); return m.call(0x0082); } // 0046  jz 0x0082
  m.step(0x0049, 10);
  regs.a = mem.read8(0x20ef); m.step(0x004c, 13); // 0049  lda 0x20ef
  regs.and(regs.a); m.step(0x004d, 4); // 004c  ana a
  if (regs.fNZ) {
    m.step(0x006f, 10); // 004d  jnz 0x006f (taken)
    m.push16(0x0072); m.step(0x1740, 17); m.call(0x1740); // 006f  call 0x1740
    return m.call(0x0072); // fall through into loc_0072 (its own head)
  }
  m.step(0x0050, 10);
  regs.a = mem.read8(0x20eb); m.step(0x0053, 13); // 0050  lda 0x20eb
  regs.and(regs.a); m.step(0x0054, 4); // 0053  ana a
  if (regs.fNZ) {
    m.step(0x005d, 10); // 0054  jnz 0x005d (taken)
    regs.a = mem.read8(0x2093); m.step(0x0060, 13); // 005d  lda 0x2093
    regs.and(regs.a); m.step(0x0061, 4); // 0060  ana a
    if (regs.fNZ) { m.step(0x0082, 10); return m.call(0x0082); } // 0061  jnz 0x0082
    m.step(0x0064, 10);
    m.step(0x0765, 10); return m.call(0x0765); // 0064  jmp 0x0765
  }
  m.step(0x0057, 10);
  m.push16(0x005a); m.step(0x0abf, 17); m.call(0x0abf); // 0057  call 0x0abf
  if (m.pc !== 0x005a) return; // the bit-0 arm (0x0abb) popped this return and finished the ISR itself
  m.step(0x0082, 10); return m.call(0x0082); // 005a  jmp 0x0082
}
