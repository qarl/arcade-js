// SPDX-License-Identifier: GPL-3.0-only

// loc_0661  (ROM 0x0661-0x06c9) — a play-state handler (rst-0x28 dispatch target, dw @0x0182/0x054a/0x078f):
// the per-frame update pipeline. Runs 27 subsystem update calls in order, then a guard: if (0x4208)|HL(0x4200)
// has bit0 set -> ret; else if (0x4225) bit0 clear -> ret; otherwise set up HL=0x4260/DE=5/B=0x0e/A=0 and
// fall through into loc_06ca.
export function loc_0661(m) {
  const { regs, mem } = m;

  m.push16(0x0664); m.step(0x0837, 17); m.call(0x0837);
  m.push16(0x0667); m.step(0x0898, 17); m.call(0x0898);
  m.push16(0x066a); m.step(0x0a74, 17); m.call(0x0a74);
  m.push16(0x066d); m.step(0x0cc3, 17); m.call(0x0cc3);
  m.push16(0x0670); m.step(0x0bbe, 17); m.call(0x0bbe);
  m.push16(0x0673); m.step(0x0a32, 17); m.call(0x0a32);
  m.push16(0x0676); m.step(0x0b0b, 17); m.call(0x0b0b);
  m.push16(0x0679); m.step(0x0b77, 17); m.call(0x0b77);
  m.push16(0x067c); m.step(0x1227, 17); m.call(0x1227);
  m.push16(0x067f); m.step(0x129e, 17); m.call(0x129e);
  m.push16(0x0682); m.step(0x08e5, 17); m.call(0x08e5);
  m.push16(0x0685); m.step(0x140c, 17); m.call(0x140c);
  m.push16(0x0688); m.step(0x1344, 17); m.call(0x1344);
  m.push16(0x068b); m.step(0x13e1, 17); m.call(0x13e1);
  m.push16(0x068e); m.step(0x14f3, 17); m.call(0x14f3);
  m.push16(0x0691); m.step(0x12ed, 17); m.call(0x12ed);
  m.push16(0x0694); m.step(0x1327, 17); m.call(0x1327);
  m.push16(0x0697); m.step(0x16a6, 17); m.call(0x16a6);
  m.push16(0x069a); m.step(0x1515, 17); m.call(0x1515);
  m.push16(0x069d); m.step(0x1555, 17); m.call(0x1555);
  m.push16(0x06a0); m.step(0x15c3, 17); m.call(0x15c3);
  m.push16(0x06a3); m.step(0x15f4, 17); m.call(0x15f4);
  m.push16(0x06a6); m.step(0x1621, 17); m.call(0x1621);
  m.push16(0x06a9); m.step(0x1637, 17); m.call(0x1637);
  m.push16(0x06ac); m.step(0x16b8, 17); m.call(0x16b8);
  m.push16(0x06af); m.step(0x1688, 17); m.call(0x1688);
  m.push16(0x06b2); m.step(0x198e, 17); m.call(0x198e);

  regs.a = mem.read8(0x4208);
  m.step(0x06b5, 13); // ld a,(0x4208)

  regs.hl = mem.read16(0x4200);
  m.step(0x06b8, 16); // ld hl,(0x4200)

  regs.or(regs.h);
  m.step(0x06b9, 4); // or h

  regs.or(regs.l);
  m.step(0x06ba, 4); // or l -- A = (0x4208)|H|L

  regs.rrca();
  m.step(0x06bb, 4); // rrca -- old bit0 -> carry

  if (regs.fC) { m.ret(11); return; } // ret c
  m.step(0x06bc, 5); // ret c (not taken)

  regs.a = mem.read8(0x4225);
  m.step(0x06bf, 13); // ld a,(0x4225)

  regs.rrca();
  m.step(0x06c0, 4); // rrca -- old bit0 -> carry

  if (regs.fNC) { m.ret(11); return; } // ret nc
  m.step(0x06c1, 5); // ret nc (not taken)

  regs.hl = 0x4260;
  m.step(0x06c4, 10); // ld hl,0x4260

  regs.de = 0x0005;
  m.step(0x06c7, 10); // ld de,0x0005

  regs.b = 0x0e;
  m.step(0x06c9, 7); // ld b,0x0e

  regs.xor(regs.a);
  m.step(0x06ca, 4); // xor a -- A=0

  // loc_06ca (inlined -- interior: djnz self-loop + fall-through from here):
  // OR-accumulate B bytes at HL (stride DE), then an rrca-gated 0x4009 timer tail.
  for (;;) {
    regs.or(mem.read8(regs.hl));
    m.step(0x06cb, 7); // or (hl)

    regs.addHl(regs.de);
    m.step(0x06cc, 11); // add hl,de

    if (regs.djnz() !== 0) {
      m.step(0x06ca, 13); // djnz 0x06ca (taken)
      continue;
    }
    m.step(0x06ce, 8); // djnz (not taken)
    break;
  }

  regs.rrca();
  m.step(0x06cf, 4); // rrca -- bit0 of the OR into carry

  if (regs.fC) { m.ret(11); return; } // ret c
  m.step(0x06d0, 5); // ret c (not taken)

  regs.hl = 0x4009;
  m.step(0x06d3, 10); // ld hl,0x4009

  regs.decMem8(mem, regs.hl);
  m.step(0x06d4, 11); // dec (0x4009)

  if (regs.fNZ) { m.ret(11); return; } // ret nz
  m.step(0x06d5, 5); // ret nz (not taken)

  regs.l = regs.inc8(regs.l);
  m.step(0x06d6, 4); // inc l -- HL=0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x06d7, 11); // inc (0x400a)

  m.ret();
}
