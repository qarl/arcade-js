// SPDX-License-Identifier: GPL-3.0-only

// loc_0df6  (ROM 0x0df6-0x0e0e) — store the chosen target X (A) into (ix+0x19), compute the signed move
// delta = target - current X (ix+0x04), negated, into (ix+0x09); zero the sub-pixel/accumulator cells
// (ix+0x1a..0x1c); bump the sub-state (ix+0x02); ret. Reached by fall-through from loc_0ddd and by tail-jump
// from loc_0e20.
export function loc_0df6(m) {
  const { regs, mem } = m;

  mem.write8((regs.ix + 0x19) & 0xffff, regs.a); // (ix+0x19) <- target X
  m.step(0x0df9, 19);

  regs.sub(mem.read8((regs.ix + 0x04) & 0xffff)); // A = target - current X
  m.step(0x0dfc, 19);

  regs.neg(); // A = current - target (signed move toward target)
  m.step(0x0dfe, 8);

  mem.write8((regs.ix + 0x09) & 0xffff, regs.a); // (ix+0x09) <- move delta
  m.step(0x0e01, 19);

  regs.xor(regs.a);
  m.step(0x0e02, 4);

  mem.write8((regs.ix + 0x1a) & 0xffff, regs.a); // (ix+0x1a) <- 0
  m.step(0x0e05, 19);

  mem.write8((regs.ix + 0x1b) & 0xffff, regs.a); // (ix+0x1b) <- 0
  m.step(0x0e08, 19);

  mem.write8((regs.ix + 0x1c) & 0xffff, regs.a); // (ix+0x1c) <- 0
  m.step(0x0e0b, 19); // ld (ix+d),a = 19 T

  regs.incMem8(mem, (regs.ix + 0x02) & 0xffff); // inc (ix+0x02) -- advance sub-state
  m.step(0x0e0e, 23); // inc (ix+d) = 23 T

  m.ret();
}
