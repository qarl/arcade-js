// SPDX-License-Identifier: GPL-3.0-only

// loc_1555  (ROM 0x1555-0x15c2) — guarded timer/state updater, call target from the 0x0697 handler chain.
// Bails unless (0x4200) bit0 set, (0x41ef) bit0 set, (0x422b) bit0 clear. Branches on (0x4006) bit0:
//   clear -> loc_15a7 arm: counts down (0x4245); on 0 reloads it to 0x3c, counts down (0x4246); on 0 reloads
//     (0x4246)=5 and writes fixed cells (0x422f)=0x5a,(0x424a)=0x2d,(0x422e)=1.
//   set   -> counts down (0x4245); on 0 reloads to 0x3c, then on (0x4221) bit0: set -> A=2 into loc_1594;
//     clear -> counts down (0x4246) (restored via inc), derives A from (0x4177)&(0x421a) sums, into loc_1594.
//   loc_1594: rlca-fans A into (0x422f)/(0x424a), then (0x422e)=1.
export function loc_1555(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4200);
  m.step(0x1558, 13);
  regs.rrca();
  m.step(0x1559, 4);
  if (regs.fNC) { m.ret(11); return; } // ret nc -- (0x4200) bit0 clear
  m.step(0x155a, 5);

  regs.a = mem.read8(0x41ef);
  m.step(0x155d, 13);
  regs.rrca();
  m.step(0x155e, 4);
  if (regs.fNC) { m.ret(11); return; } // ret nc -- (0x41ef) bit0 clear
  m.step(0x155f, 5);

  regs.a = mem.read8(0x422b);
  m.step(0x1562, 13);
  regs.rrca();
  m.step(0x1563, 4);
  if (regs.fC) { m.ret(11); return; } // ret c -- (0x422b) bit0 set
  m.step(0x1564, 5);

  regs.a = mem.read8(0x4006);
  m.step(0x1567, 13);
  regs.rrca();
  m.step(0x1568, 4);

  if (regs.fNC) {
    // jr nc,0x15a7 (taken) -- (0x4006) bit0 clear arm
    m.step(0x15a7, 12);

    regs.hl = 0x4245;
    m.step(0x15aa, 10);
    regs.decMem8(mem, regs.hl);
    m.step(0x15ab, 11); // dec (0x4245)
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x15ac, 5);
    mem.write8(regs.hl, 0x3c);
    m.step(0x15ae, 10); // (0x4245) <- 0x3c
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x15af, 6); // HL=0x4246
    regs.decMem8(mem, regs.hl);
    m.step(0x15b0, 11); // dec (0x4246)
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x15b1, 5);
    mem.write8(regs.hl, 0x05);
    m.step(0x15b3, 10); // (0x4246) <- 5
    regs.a = 0x5a;
    m.step(0x15b5, 7);
    mem.write8(0x422f, regs.a);
    m.step(0x15b8, 13); // (0x422f) <- 0x5a
    regs.a = 0x2d;
    m.step(0x15ba, 7);
    mem.write8(0x424a, regs.a);
    m.step(0x15bd, 13); // (0x424a) <- 0x2d
    regs.a = 0x01;
    m.step(0x15bf, 7);
    mem.write8(0x422e, regs.a);
    m.step(0x15c2, 13); // (0x422e) <- 1
    m.ret();
    return;
  }
  m.step(0x156a, 7); // jr nc,0x15a7 (not taken)

  regs.hl = 0x4245;
  m.step(0x156d, 10);
  regs.decMem8(mem, regs.hl);
  m.step(0x156e, 11); // dec (0x4245)
  if (regs.fNZ) { m.ret(11); return; }
  m.step(0x156f, 5);
  mem.write8(regs.hl, 0x3c);
  m.step(0x1571, 10); // (0x4245) <- 0x3c

  regs.a = mem.read8(0x4221);
  m.step(0x1574, 13);
  regs.rrca();
  m.step(0x1575, 4);

  if (regs.fC) {
    // jr c,0x15a3 (taken) -- (0x4221) bit0 set
    m.step(0x15a3, 12);
    regs.a = 0x02;
    m.step(0x15a5, 7);
    m.step(0x1594, 12); // jr 0x1594
  } else {
    m.step(0x1577, 7); // jr c,0x15a3 (not taken)
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1578, 6); // HL=0x4246
    regs.decMem8(mem, regs.hl);
    m.step(0x1579, 11); // dec (0x4246)
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x157a, 5);
    regs.incMem8(mem, regs.hl);
    m.step(0x157b, 11); // inc (0x4246) -- restore to 1
    regs.hl = mem.read16(0x4177);
    m.step(0x157e, 16);
    regs.a = regs.h;
    m.step(0x157f, 4);
    regs.add(regs.l);
    m.step(0x1580, 4); // add a,l
    regs.and(0x03);
    m.step(0x1582, 7);
    regs.c = regs.a;
    m.step(0x1583, 4);
    regs.hl = mem.read16(0x421a);
    m.step(0x1586, 16);
    regs.a = regs.h;
    m.step(0x1587, 4);
    regs.add(regs.l);
    m.step(0x1588, 4); // add a,l
    if (regs.fZ) { m.ret(11); return; } // ret z -- (0x421a) H+L == 0
    m.step(0x1589, 5);
    regs.rrca();
    m.step(0x158a, 4);
    regs.rrca();
    m.step(0x158b, 4);
    regs.and(0x03);
    m.step(0x158d, 7);
    regs.cpl();
    m.step(0x158e, 4);
    regs.add(0x0a);
    m.step(0x1590, 7); // add a,0x0a
    regs.sub(regs.c);
    m.step(0x1591, 4); // sub c
    mem.write8(0x4246, regs.a);
    m.step(0x1594, 13); // (0x4246) <- A
  }

  // loc_1594: (fall-through and loc_15a3 converge)
  regs.rlca();
  m.step(0x1595, 4);
  regs.rlca();
  m.step(0x1596, 4);
  mem.write8(0x422f, regs.a);
  m.step(0x1599, 13); // (0x422f) <- A
  regs.rlca();
  m.step(0x159a, 4);
  mem.write8(0x424a, regs.a);
  m.step(0x159d, 13); // (0x424a) <- A
  regs.a = 0x01;
  m.step(0x159f, 7);
  mem.write8(0x422e, regs.a);
  m.step(0x15a2, 13); // (0x422e) <- 1
  m.ret();
}
