// SPDX-License-Identifier: GPL-3.0-only

// loc_1515  (ROM 0x1515-0x1554) — guarded WRAM updater, call target from the 0x0697 handler chain.
// Bails unless (0x4200) bit0 set and (0x4220)/(0x422b) bit0 clear. Builds B = ((clamp(H)+L)&0x0f)+1 from
// (0x421a) [H forced to 0 when <2], counts down (0x424a): while non-zero clears flag (0x4228) and rets;
// on the zero tick it seeds (0x424a) from ROM data table @0x15e3 and runs a B-length dec/refresh loop over
// (0x424b..), calling 0x15df to reload each entry that decs to 0, then sets (0x4228)=1 iff any refreshed.
export function loc_1515(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4200);
  m.step(0x1518, 13);

  regs.rrca();
  m.step(0x1519, 4);

  if (regs.fNC) { m.ret(11); return; } // ret nc -- (0x4200) bit0 clear
  m.step(0x151a, 5);

  regs.a = mem.read8(0x4220);
  m.step(0x151d, 13);

  regs.rrca();
  m.step(0x151e, 4);

  if (regs.fC) { m.ret(11); return; } // ret c -- (0x4220) bit0 set
  m.step(0x151f, 5);

  regs.a = mem.read8(0x422b);
  m.step(0x1522, 13);

  regs.rrca();
  m.step(0x1523, 4);

  if (regs.fC) { m.ret(11); return; } // ret c -- (0x422b) bit0 set
  m.step(0x1524, 5);

  regs.hl = mem.read16(0x421a);
  m.step(0x1527, 16);

  regs.a = regs.h;
  m.step(0x1528, 4);

  regs.cp(0x02);
  m.step(0x152a, 7);

  if (regs.fNC) {
    m.step(0x152d, 12); // jr nc,0x152d -- H>=2, keep A=H
  } else {
    m.step(0x152c, 7);
    regs.xor(regs.a);
    m.step(0x152d, 4); // xor a -- H<2, A=0
  }

  // loc_152d:
  regs.add(regs.l);
  m.step(0x152e, 4); // add a,l

  regs.and(0x0f);
  m.step(0x1530, 7);

  regs.a = regs.inc8(regs.a);
  m.step(0x1531, 4);

  regs.b = regs.a;
  m.step(0x1532, 4); // B = index+1 = loop count

  regs.hl = 0x424a;
  m.step(0x1535, 10);

  regs.de = 0x15e3;
  m.step(0x1538, 10); // DE -> ROM data table @0x15e3 (DATA, not code)

  regs.decMem8(mem, regs.hl);
  m.step(0x1539, 11); // dec (0x424a)

  if (regs.fNZ) {
    m.step(0x153b, 7); // jr z,0x1540 (not taken)
    regs.xor(regs.a);
    m.step(0x153c, 4);
    mem.write8(0x4228, regs.a);
    m.step(0x153f, 13); // (0x4228) <- 0
    m.ret();
    return;
  }
  m.step(0x1540, 12); // jr z,0x1540 (taken)

  // loc_1540:
  regs.c = 0x00;
  m.step(0x1542, 7);

  regs.a = mem.read8(regs.de);
  m.step(0x1543, 7); // A = (0x15e3), first table byte

  mem.write8(regs.hl, regs.a);
  m.step(0x1544, 7); // (0x424a) <- A

  for (;;) {
    // loc_1544:
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1545, 6);

    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x1546, 6);

    regs.decMem8(mem, regs.hl);
    m.step(0x1547, 11); // dec (hl)

    if (regs.fZ) {
      m.push16(0x154a);
      m.step(0x15df, 17); // call z,0x15df (taken) -- refresh this entry, inc C
      m.call(0x15df);
    } else {
      m.step(0x154a, 10); // call z,0x15df (not taken)
    }

    if (regs.djnz() !== 0) {
      m.step(0x1544, 13);
      continue;
    }
    m.step(0x154c, 8);
    break;
  }

  regs.a = regs.c;
  m.step(0x154d, 4);

  regs.and(regs.a); // and a -- C==0?
  m.step(0x154e, 4);

  if (regs.fZ) { m.ret(11); return; } // ret z -- nothing refreshed
  m.step(0x154f, 5);

  regs.a = 0x01;
  m.step(0x1551, 7);

  mem.write8(0x4228, regs.a);
  m.step(0x1554, 13); // (0x4228) <- 1

  m.ret();
}
