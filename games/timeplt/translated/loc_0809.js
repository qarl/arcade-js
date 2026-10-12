// SPDX-License-Identifier: GPL-3.0-only

// loc_0809  (ROM 0x0809-0x083D, Time Pilot)
export function loc_0809(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0xad04);
  m.step(0x080c, 13); // ld a,(0xad04)
  regs.add(regs.a);
  m.step(0x080d, 4); // add a,a -- A*2
  regs.b = regs.a;
  m.step(0x080e, 4); // ld b,a -- B = A*2
  regs.add(regs.a);
  m.step(0x080f, 4); // add a,a -- A*4
  regs.add(regs.a);
  m.step(0x0810, 4); // add a,a -- A*8
  regs.add(regs.b);
  m.step(0x0811, 4); // add a,b -- A*10, the table stride
  regs.hl = 0x087c;
  m.step(0x0814, 10); // ld hl,0x087c

  m.push16(0x0815);
  m.step(0x0018, 11); // rst 0x18 -- HL += A, carrying into H
  m.call(0x0018);

  regs.b = mem.read8(regs.hl);
  m.step(0x0816, 7); // ld b,(hl) -- first tile code
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0817, 6); // inc hl
  regs.c = mem.read8(regs.hl);
  m.step(0x0818, 7); // ld c,(hl) -- second tile code
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0819, 6); // inc hl
  regs.a = mem.read8(0xad02);
  m.step(0x081c, 13); // ld a,(0xad02)
  regs.e = regs.a;
  m.step(0x081d, 4); // ld e,a -- E keeps the whole byte
  regs.and(0x07);
  m.step(0x081f, 7); // and 0x07 -- low 3 bits index the third table column

  m.push16(0x0820);
  m.step(0x0008, 11); // rst 0x08 -- A = (HL + A), HL advanced by A
  m.call(0x0008);

  regs.exAf();
  m.step(0x0821, 4); // ex af,af' -- park the fetched tile in A'
  regs.a = regs.e;
  m.step(0x0822, 4); // ld a,e -- back to the raw (0xAD02)
  regs.hl = 0xa79f;
  m.step(0x0825, 10); // ld hl,0xa79f -- the meter's fixed start cell
  regs.de = 0xffe0;
  m.step(0x0828, 10); // ld de,0xffe0 -- -0x20: one native row back per store
  regs.rrca();
  m.step(0x0829, 4); // rrca
  regs.rrca();
  m.step(0x082a, 4); // rrca
  regs.and(0x1f);
  m.step(0x082c, 7); // and 0x1f -- A = run length

  if (regs.fZ) {
    m.step(0x0838, 12); // jr z,0x0838 taken -- empty run
  } else {
    m.step(0x082e, 7); // jr z NOT taken
    for (;;) {
      mem.write8(regs.hl, regs.b);
      m.step(0x082f, 7); // ld (hl),b
      regs.addHl(regs.de);
      m.step(0x0830, 11); // add hl,de -- one native row back
      regs.a = regs.dec8(regs.a);
      m.step(0x0831, 4); // dec a
      if (regs.fZ) {
        m.step(0x0838, 12); // jr z,0x0838 taken
        break;
      }
      m.step(0x0833, 7); // jr z NOT taken

      mem.write8(regs.hl, regs.c);
      m.step(0x0834, 7); // ld (hl),c
      regs.addHl(regs.de);
      m.step(0x0835, 11); // add hl,de
      regs.a = regs.dec8(regs.a);
      m.step(0x0836, 4); // dec a
      if (regs.fNZ) {
        m.step(0x082e, 12); // jr nz,0x082e taken -- round again
        continue;
      }
      m.step(0x0838, 7); // jr nz NOT taken -- fall into 0x0838
      break;
    }
  }

  regs.exAf();
  m.step(0x0839, 4); // ex af,af' -- recover the rst-0x08 tile
  mem.write8(regs.hl, regs.a);
  m.step(0x083a, 7); // ld (hl),a
  regs.addHl(regs.de);
  m.step(0x083b, 11); // add hl,de
  mem.write8(regs.hl, 0xf1);
  m.step(0x083d, 10); // ld (hl),0xf1 -- cap the run
  m.ret(10); // ret
}
