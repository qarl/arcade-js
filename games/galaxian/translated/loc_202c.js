// SPDX-License-Identifier: GPL-3.0-only

// loc_202c  (ROM 0x202c-0x203c) — store the advanced pointer to 0x40a1, then dispatch: look up the handler
// word in the table at 0x203d indexed by BC, push 0x200a as the return, and jp (hl) to the handler (it rets
// back into the dispatch loop). Table 0x203d-0x204c words: 2055,205e,215f,21a6,21fe,2231,22f1,24b7.
export function loc_202c(m) {
  const { regs, mem } = m;

  mem.write8(0x40a1, regs.a);
  m.step(0x202f, 13); // ld (0x40a1),a -- save new slot pointer

  regs.a = regs.e;
  m.step(0x2030, 4); // ld a,e

  regs.hl = 0x203d;
  m.step(0x2033, 10); // ld hl,0x203d -- handler jump-table base (ROM data)

  regs.addHl(regs.bc);
  m.step(0x2034, 11); // add hl,bc -- HL = table + index

  regs.e = mem.read8(regs.hl);
  m.step(0x2035, 7); // ld e,(hl) -- target low

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2036, 6); // inc hl

  regs.d = mem.read8(regs.hl);
  m.step(0x2037, 7); // ld d,(hl) -- target high

  regs.hl = 0x200a;
  m.step(0x203a, 10); // ld hl,0x200a -- handlers ret into the dispatch loop

  m.push16(regs.hl);
  m.step(0x203b, 11); // push hl

  regs.exDeHl();
  m.step(0x203c, 4); // ex de,hl -- HL = handler target

  // jp (hl) -- computed dispatch to the table target (data-driven, read at run time)
  const target = regs.hl;
  m.step(target, 4);
  return m.call(target);
}
