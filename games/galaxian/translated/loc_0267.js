// SPDX-License-Identifier: GPL-3.0-only

// loc_0267  (ROM 0x0267-0x028d) — a state handler: runs the four per-frame updates (0x0363, 0x0bbe,
// 0x0cc3, 0x0367), then counts down (0x4009). While nonzero it returns; on expiry it advances the
// paired byte (0x400a), clears (0x4058), sets pointer (0x4008)=0x1140, bumps (0x4241), then tail-jumps
// to 0x08f2 with DE=0x060f.
export function loc_0267(m) {
  const { regs, mem } = m;

  m.push16(0x026a);
  m.step(0x0363, 17); // call 0x0363
  m.call(0x0363);

  m.push16(0x026d);
  m.step(0x0bbe, 17); // call 0x0bbe
  m.call(0x0bbe);

  m.push16(0x0270);
  m.step(0x0cc3, 17); // call 0x0cc3
  m.call(0x0cc3);

  m.push16(0x0273);
  m.step(0x0367, 17); // call 0x0367
  m.call(0x0367);

  regs.hl = 0x4009;
  m.step(0x0276, 10); // ld hl,0x4009

  regs.decMem8(mem, regs.hl);
  m.step(0x0277, 11); // dec (hl) -- countdown

  if (regs.fNZ) {
    m.ret(11); // ret nz -- still counting
    return;
  }
  m.step(0x0278, 5); // ret nz (not taken)

  regs.l = regs.inc8(regs.l);
  m.step(0x0279, 4); // inc l -- HL -> 0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x027a, 11); // inc (hl) -- advance paired byte (0x400a)

  regs.xor(regs.a);
  m.step(0x027b, 4); // xor a -- A=0

  mem.write8(0x4058, regs.a);
  m.step(0x027e, 13); // ld (0x4058),a

  regs.hl = 0x1140;
  m.step(0x0281, 10); // ld hl,0x1140

  mem.write16(0x4008, regs.hl);
  m.step(0x0284, 16); // ld (0x4008),hl -- pointer word 0x4008 = 0x1140

  regs.hl = 0x4241;
  m.step(0x0287, 10); // ld hl,0x4241

  regs.incMem8(mem, regs.hl);
  m.step(0x0288, 11); // inc (hl) -- bump (0x4241)

  regs.de = 0x060f;
  m.step(0x028b, 10); // ld de,0x060f

  // jp 0x08f2 -- tail-jump with DE=0x060f
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}
