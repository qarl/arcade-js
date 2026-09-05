// SPDX-License-Identifier: GPL-3.0-only

// loc_0f66  (ROM 0x0f66-0x0f7a) — object AI state handler (entry from the 0x0ce6 state table @0x0cf6).
// Waits for the (ix+3) counter AND the (ix+4) position to both fall inside [0x60,0xA0); until then it hands
// off to loc_0f7b. Once in-window it runs the interior loc_0f87 setup (advance state (ix+2) by 2, seed the
// (ix+0x10)/(ix+0x11) timers, clear (ix+5)/(ix+0x13)) and sets the (ix+6) direction from a target compare
// (interior loc_0faa = target below). ix = the object struct in work RAM.
export function loc_0f66(m) {
  const { regs, mem } = m;

  regs.incMem8(mem, (regs.ix + 0x03) & 0xffff);
  m.step(0x0f69, 23); // inc (ix+3)

  regs.a = mem.read8((regs.ix + 0x03) & 0xffff);
  m.step(0x0f6c, 19);

  regs.sub(0x60);
  m.step(0x0f6e, 7);

  regs.cp(0x40);
  m.step(0x0f70, 7); // (ix+3)-0x60 vs 0x40

  if (regs.fNC) {
    m.step(0x0f7b, 12); // jr nc,0x0f7b -- counter out of window (tail to loc_0f7b)
    return m.call(0x0f7b);
  }
  m.step(0x0f72, 7);

  regs.a = mem.read8((regs.ix + 0x04) & 0xffff);
  m.step(0x0f75, 19);

  regs.sub(0x60);
  m.step(0x0f77, 7);

  regs.cp(0x40);
  m.step(0x0f79, 7); // (ix+4)-0x60 vs 0x40

  if (regs.fC) {
    m.step(0x0f87, 12); // jr c,0x0f87 -- position in window: loc_0f87 (interior)

    regs.incMem8(mem, (regs.ix + 0x02) & 0xffff);
    m.step(0x0f8a, 23); // inc (ix+2)

    regs.incMem8(mem, (regs.ix + 0x02) & 0xffff);
    m.step(0x0f8d, 23); // inc (ix+2) -- advance state by 2

    mem.write8((regs.ix + 0x10) & 0xffff, 0x03);
    m.step(0x0f91, 19); // (ix+0x10) <- 3

    mem.write8((regs.ix + 0x11) & 0xffff, 0x0c);
    m.step(0x0f95, 19); // (ix+0x11) <- 0x0c

    mem.write8((regs.ix + 0x05) & 0xffff, 0x00);
    m.step(0x0f99, 19); // (ix+5) <- 0

    mem.write8((regs.ix + 0x13) & 0xffff, 0x00);
    m.step(0x0f9d, 19); // (ix+0x13) <- 0

    regs.a = mem.read8(0x4202);
    m.step(0x0fa0, 13); // A = target

    regs.sub(mem.read8((regs.ix + 0x04) & 0xffff));
    m.step(0x0fa3, 19); // A = target - (ix+4)

    if (regs.fC) {
      m.step(0x0faa, 12); // jr c,0x0faa -- target below pos: loc_0faa (interior)
      mem.write8((regs.ix + 0x06) & 0xffff, 0x01);
      m.step(0x0fae, 19); // (ix+6) <- 1
      m.ret();
      return;
    }
    m.step(0x0fa5, 7);

    mem.write8((regs.ix + 0x06) & 0xffff, 0x00);
    m.step(0x0fa9, 19); // (ix+6) <- 0
    m.ret();
    return;
  }
  m.step(0x0f7b, 7); // jr c not taken -> fall through to loc_0f7b (genuine)
  return m.call(0x0f7b);
}
