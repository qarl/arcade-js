// SPDX-License-Identifier: GPL-3.0-only

// loc_0066  (ROM 0x0066-0x00cd) — the VBLANK-NMI handler. Saves all regs, clears the irq_enable latch,
// pushes the OBJRAM shadow (0x4020) to sprite/scroll hardware (0x5800), latches this frame's raw inputs
// with a shifted history, runs the per-frame subsystem calls, then state-dispatches on (0x4005) via rst 28
// (inline table 0x00ce-0x00d7) with 0x00d8 (the NMI tail: pop regs, re-arm irq, ret) as the return addr.
// Both dispatch paths (this rst-28 one and the 0x401a!=0 alternate via loc_1bcd) converge on loc_00d8.
export function loc_0066(m) {
  const { regs, mem } = m;

  m.push16(regs.af);
  m.step(0x0067, 11);

  m.push16(regs.bc);
  m.step(0x0068, 11);

  m.push16(regs.de);
  m.step(0x0069, 11);

  m.push16(regs.hl);
  m.step(0x006a, 11);

  m.push16(regs.ix);
  m.step(0x006c, 15); // push ix (DD-prefixed)

  m.push16(regs.iy);
  m.step(0x006e, 15); // push iy (FD-prefixed)

  regs.xor(regs.a);
  m.step(0x006f, 4);

  mem.write8(0x7001, regs.a, 10); // irq_enable latch <- 0 (ack NMI; loc_00d8 re-arms on exit)
  m.step(0x0072, 13);

  regs.a = mem.read8(0x401a);
  m.step(0x0075, 13); // A = mode flag

  regs.and(regs.a);
  m.step(0x0076, 4);

  if (regs.fNZ) {
    m.step(0x1bcd, 10); // jp nz,0x1bcd (taken) -- 0x401a set: alternate handler
    // loc_1bcd pushes 0x00d8 and dispatches a state handler that `ret`s into it -- the SAME NMI epilogue the
    // rst-28 path below converges on. Like that path, run 0x00d8 after the dispatch returns so irq_enable is
    // re-armed and the saved regs restored; without it the alternate path never re-arms and the NMI dies.
    m.call(0x1bcd);
    return m.call(0x00d8);
  }
  m.step(0x0079, 10);

  regs.hl = 0x4020;
  m.step(0x007c, 10);

  regs.de = 0x5800;
  m.step(0x007f, 10);

  regs.bc = 0x0080;
  m.step(0x0082, 10);

  // ldir 0x4020->0x5800, 0x80 bytes: OBJRAM shadow -> sprite/scroll+bullet hardware
  m.ldirAt(0x0082, 0x0084);

  regs.a = mem.read8(0x7800);
  m.step(0x0087, 13); // watchdog reset_r (pet the dog); value discarded

  regs.a = mem.read8(0x4015);
  m.step(0x008a, 13);

  mem.write8(0x4016, regs.a);
  m.step(0x008d, 13); // input history: 0x4016 <- 0x4015

  regs.a = mem.read8(0x4013);
  m.step(0x0090, 13);

  mem.write8(0x4015, regs.a);
  m.step(0x0093, 13); // 0x4015 <- 0x4013

  regs.hl = mem.read16(0x4010);
  m.step(0x0096, 16);

  mem.write16(0x4013, regs.hl);
  m.step(0x0099, 16); // 0x4013/14 <- prev raw IN0/IN1

  regs.a = mem.read8(0x7000);
  m.step(0x009c, 13); // IN2

  mem.write8(0x4012, regs.a);
  m.step(0x009f, 13); // 0x4012 = raw IN2 this frame

  regs.a = mem.read8(0x6800);
  m.step(0x00a2, 13); // IN1

  mem.write8(0x4011, regs.a);
  m.step(0x00a5, 13); // 0x4011 = raw IN1 this frame

  regs.a = mem.read8(0x6000);
  m.step(0x00a8, 13); // IN0

  mem.write8(0x4010, regs.a);
  m.step(0x00ab, 13); // 0x4010 = raw IN0 this frame

  regs.bit(6, regs.a);
  m.step(0x00ad, 8); // IN0 bit6 = service/test

  if (regs.fNZ) {
    m.step(0x0000, 10); // jp nz,0x0000 (taken) -- service switch: cold reset
    return m.call(0x0000);
  }
  m.step(0x00b0, 10);

  regs.hl = 0x425f;
  m.step(0x00b3, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x00b4, 11); // dec (0x425f) -- frame-timer countdown

  m.push16(0x00b7);
  m.step(0x18ef, 17);
  m.call(0x18ef);

  m.push16(0x00ba);
  m.step(0x1931, 17);
  m.call(0x1931);

  m.push16(0x00bd);
  m.step(0x197c, 17);
  m.call(0x197c);

  m.push16(0x00c0);
  m.step(0x16f5, 17);
  m.call(0x16f5);

  m.push16(0x00c3);
  m.step(0x1898, 17);
  m.call(0x1898);

  m.push16(0x00c6);
  m.step(0x18c0, 17);
  m.call(0x18c0);

  regs.hl = 0x00d8;
  m.step(0x00c9, 10);

  m.push16(regs.hl);
  m.step(0x00ca, 11); // push 0x00d8 -- the dispatched state routine rets here (the NMI tail)

  regs.a = mem.read8(0x4005);
  m.step(0x00cd, 13); // A = game-state index

  // rst 0x28 -- state dispatch on A via inline table 0x00ce-0x00d7 {0x00e6,0x0156,0x03f2,0x0536,0x077b}.
  // loc_0028 pops this pushed 0x00ce (table base) and jp(hl)s to the target; the target rets to 0x00d8.
  m.push16(0x00ce);
  m.step(0x0028, 11);
  m.call(0x0028);

  // The state routine returned to 0x00d8 (the NMI epilogue) -- continue there.
  return m.call(0x00d8);
}
