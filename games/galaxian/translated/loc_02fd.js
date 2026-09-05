// SPDX-License-Identifier: GPL-3.0-only

// loc_02fd  (ROM 0x02fd-0x0321) — rst-28 state handler: resolve a table entry (loc_0646 with DE=0x051b),
// ldir 8 bytes of it into 0x4218, clear 0x425F, set 0x421D=1, bump state counter (0x400a) and set the
// next cell (0x400b)=0x96, then store 0x0640 into the 0x4245 pointer; ret.
export function loc_02fd(m) {
  const { regs, mem } = m;

  regs.de = 0x051b;
  m.step(0x0300, 10);

  m.push16(0x0303);
  m.step(0x0646, 17); // call 0x0646 -- leaves the source pointer in DE
  m.call(0x0646);

  regs.exDeHl();
  m.step(0x0304, 4); // ex de,hl -- HL = ldir source

  regs.de = 0x4218;
  m.step(0x0307, 10); // DE = ldir dest

  regs.bc = 0x0008;
  m.step(0x030a, 10);

  m.ldirAt(0x030a, 0x030c); // ldir -- copy 8 bytes (HL)->(0x4218)

  regs.xor(regs.a);
  m.step(0x030d, 4);

  mem.write8(0x425f, regs.a);
  m.step(0x0310, 13); // 0x425F <- 0

  regs.a = regs.inc8(regs.a); // A=1
  m.step(0x0311, 4);

  mem.write8(0x421d, regs.a);
  m.step(0x0314, 13); // 0x421D <- 1

  regs.hl = 0x400a;
  m.step(0x0317, 10);

  regs.incMem8(mem, regs.hl);
  m.step(0x0318, 11); // inc (0x400a) -- state counter

  regs.l = regs.inc8(regs.l);
  m.step(0x0319, 4); // HL = 0x400b

  mem.write8(regs.hl, 0x96);
  m.step(0x031b, 10); // ld (0x400b),0x96 -- timer

  regs.hl = 0x0640;
  m.step(0x031e, 10);

  mem.write16(0x4245, regs.hl);
  m.step(0x0321, 16); // ld (0x4245),hl -- pointer <- 0x0640

  return m.ret();
}
