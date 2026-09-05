// SPDX-License-Identifier: GPL-3.0-only

// loc_029d  (ROM 0x029d-0x02d0) — a state handler: runs update 0x0363, then rst-0x10 fills 0x1c bytes at
// the pointer (0x400b) with 0x10 and advances that pointer by 0x20. Counts down (0x4009); while nonzero
// returns. On expiry it advances the paired byte (0x400a), clears 0x100 bytes at 0x42b0 and 0x40 bytes at
// 0x4060, sets pointer (0x4008)=0x0440, calls 0x0595, then tail-jumps to 0x08f2 with DE=0x0600.
export function loc_029d(m) {
  const { regs, mem } = m;

  m.push16(0x02a0);
  m.step(0x0363, 17); // call 0x0363
  m.call(0x0363);

  regs.hl = mem.read16(0x400b);
  m.step(0x02a3, 16); // ld hl,(0x400b) -- fill pointer

  regs.b = 0x1c;
  m.step(0x02a5, 7); // ld b,0x1c -- fill count

  regs.a = 0x10;
  m.step(0x02a7, 7); // ld a,0x10 -- fill byte

  m.push16(0x02a8);
  m.step(0x0010, 11); // rst 0x10 -- block-fill 0x1c bytes <- 0x10 (HL advances by B)
  m.call(0x0010);

  regs.de = 0x0004;
  m.step(0x02ab, 10); // ld de,0x0004

  regs.addHl(regs.de);
  m.step(0x02ac, 11); // add hl,de -- pointer now advanced by 0x1c+4 = 0x20

  mem.write16(0x400b, regs.hl);
  m.step(0x02af, 16); // ld (0x400b),hl

  regs.hl = 0x4009;
  m.step(0x02b2, 10); // ld hl,0x4009

  regs.decMem8(mem, regs.hl);
  m.step(0x02b3, 11); // dec (hl) -- countdown

  if (regs.fNZ) {
    m.ret(11); // ret nz -- still counting
    return;
  }
  m.step(0x02b4, 5); // ret nz (not taken)

  regs.l = regs.inc8(regs.l);
  m.step(0x02b5, 4); // inc l -- HL -> 0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x02b6, 11); // inc (hl) -- advance paired byte (0x400a)

  regs.hl = 0x42b0;
  m.step(0x02b9, 10); // ld hl,0x42b0

  regs.xor(regs.a);
  m.step(0x02ba, 4); // xor a -- A=0 (fill byte)

  regs.b = regs.a;
  m.step(0x02bb, 4); // ld b,a -- B=0 => 0x100-byte fill

  m.push16(0x02bc);
  m.step(0x0010, 11); // rst 0x10 -- clear 0x100 bytes at 0x42b0 <- 0
  m.call(0x0010);

  regs.hl = 0x4060;
  m.step(0x02bf, 10); // ld hl,0x4060

  regs.b = 0x40;
  m.step(0x02c1, 7); // ld b,0x40

  m.push16(0x02c2);
  m.step(0x0010, 11); // rst 0x10 -- clear 0x40 bytes at 0x4060 <- 0
  m.call(0x0010);

  regs.hl = 0x0440;
  m.step(0x02c5, 10); // ld hl,0x0440

  mem.write16(0x4008, regs.hl);
  m.step(0x02c8, 16); // ld (0x4008),hl -- pointer word 0x4008 = 0x0440

  m.push16(0x02cb);
  m.step(0x0595, 17); // call 0x0595
  m.call(0x0595);

  regs.de = 0x0600;
  m.step(0x02ce, 10); // ld de,0x0600

  // jp 0x08f2 -- tail-jump with DE=0x0600
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}
