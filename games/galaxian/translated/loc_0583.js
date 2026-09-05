// SPDX-License-Identifier: GPL-3.0-only

// loc_0583  (ROM 0x0583-0x0592) — advance the running clear pointer at 0x400b: block-fill 0x20 bytes at it
// with 0x10 (rst 0x10), store the advanced pointer back, then dec the phase counter 0x4009. ret unless the
// counter hit 0, in which case fall through to loc_0593. Dispatch-table target.
export function loc_0583(m) {
  const { regs, mem } = m;

  regs.hl = mem.read16(0x400b);
  m.step(0x0586, 16); // HL = running fill pointer

  regs.b = 0x20;
  m.step(0x0588, 7);

  regs.a = 0x10;
  m.step(0x058a, 7); // fill byte

  m.push16(0x058b);
  m.step(0x0010, 11); // rst 0x10 -- fill B bytes at HL <- A
  m.call(0x0010);

  mem.write16(0x400b, regs.hl);
  m.step(0x058e, 16); // store the advanced pointer

  regs.hl = 0x4009;
  m.step(0x0591, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x0592, 11); // dec (0x4009) phase counter

  if (regs.fNZ) {
    m.ret(11); // ret nz -- more phases left
    return;
  }
  m.step(0x0593, 5); // ret nz not-taken: fall into loc_0593
  return m.call(0x0593);
}
