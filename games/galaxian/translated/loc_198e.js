// SPDX-License-Identifier: GPL-3.0-only

// loc_198e  (ROM 0x198e-0x1a11) — runs on one phase every 32 frames (gate on (0x425f)+9 & 0x1f) and only
// when bit0 of (0x4007) and (0x4200) are set. Walks two object tables via 0x1a12 (IX=0x42d0 stride 0x20 x7,
// then IX=0x4260 stride 5 x7) inside an exx swap so the callee sums into the main-bank B. Then derives a
// value from (0x420e)-(0x4202), calls 0x003c, and stores a 0/4/8 selector to 0x423f. Interior labels
// 19ac/19c7 (loops), 19fb, 1a06, 1a0a, 1a0e all inlined.
export function loc_198e(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x425f);
  m.step(0x1991, 13); // A = (0x425f) frame/phase counter

  regs.add(0x09);
  m.step(0x1993, 7);

  regs.and(0x1f);
  m.step(0x1995, 7); // phase select: act only when (counter+9) mod 32 == 0

  if (regs.fNZ) {
    m.ret(11); // ret nz -- wrong phase this frame
    return;
  }
  m.step(0x1996, 5);

  regs.a = mem.read8(0x4007);
  m.step(0x1999, 13); // A = (0x4007)

  regs.rrca();
  m.step(0x199a, 4); // carry = bit0

  if (regs.fNC) {
    m.ret(11); // ret nc -- disabled
    return;
  }
  m.step(0x199b, 5);

  regs.a = mem.read8(0x4200);
  m.step(0x199e, 13); // A = (0x4200)

  regs.rrca();
  m.step(0x199f, 4); // carry = bit0

  if (regs.fNC) {
    m.ret(11); // ret nc -- disabled
    return;
  }
  m.step(0x19a0, 5);

  regs.ix = 0x42d0;
  m.step(0x19a4, 14); // object table A base

  regs.b = 0x00;
  m.step(0x19a6, 7); // main-bank B = accumulator seed

  regs.exx();
  m.step(0x19a7, 4); // to alt bank (holds the loop counter + stride)

  regs.de = 0x0020;
  m.step(0x19aa, 10); // stride 0x20

  regs.b = 0x07;
  m.step(0x19ac, 7); // 7 entries

  for (;;) {
    // loc_19ac:
    regs.exx();
    m.step(0x19ad, 4); // to main bank for the callee

    regs.h = mem.read8((regs.ix + 0x03) & 0xffff);
    m.step(0x19b0, 19); // H = (ix+3)

    regs.l = mem.read8((regs.ix + 0x04) & 0xffff);
    m.step(0x19b3, 19); // L = (ix+4)

    regs.c = mem.read8((regs.ix + 0x1a) & 0xffff);
    m.step(0x19b6, 19); // C = (ix+0x1a)

    m.push16(0x19b9);
    m.step(0x1a12, 17); // call 0x1a12 -- adds into main B
    m.call(0x1a12);

    regs.exx();
    m.step(0x19ba, 4); // back to alt (loop counter)

    regs.addIx(regs.de);
    m.step(0x19bc, 15); // next entry

    if (regs.djnz() !== 0) {
      m.step(0x19ac, 13);
      continue;
    }
    m.step(0x19be, 8);
    break;
  }

  regs.ix = 0x4260;
  m.step(0x19c2, 14); // object table B base

  regs.de = 0x0005;
  m.step(0x19c5, 10); // stride 5

  regs.b = 0x07;
  m.step(0x19c7, 7); // 7 entries

  for (;;) {
    // loc_19c7:
    regs.exx();
    m.step(0x19c8, 4); // to main bank for the callee

    regs.h = mem.read8((regs.ix + 0x01) & 0xffff);
    m.step(0x19cb, 19); // H = (ix+1)

    regs.l = mem.read8((regs.ix + 0x03) & 0xffff);
    m.step(0x19ce, 19); // L = (ix+3)

    regs.c = mem.read8((regs.ix + 0x04) & 0xffff);
    m.step(0x19d1, 19); // C = (ix+4)

    m.push16(0x19d4);
    m.step(0x1a12, 17); // call 0x1a12 -- adds into main B
    m.call(0x1a12);

    regs.exx();
    m.step(0x19d5, 4); // back to alt (loop counter)

    regs.addIx(regs.de);
    m.step(0x19d7, 15); // next entry

    if (regs.djnz() !== 0) {
      m.step(0x19c7, 13);
      continue;
    }
    m.step(0x19d9, 8);
    break;
  }

  regs.exx();
  m.step(0x19da, 4); // to main bank (B now holds the accumulated sum)

  regs.a = mem.read8(0x4202);
  m.step(0x19dd, 13); // A = (0x4202)

  regs.c = regs.a;
  m.step(0x19de, 4);

  regs.a = mem.read8(0x420e);
  m.step(0x19e1, 13); // A = (0x420e)

  regs.add(0x80);
  m.step(0x19e3, 7);

  regs.sub(regs.c);
  m.step(0x19e4, 4); // A = (0x420e)+0x80-(0x4202)

  regs.a = regs.sra(regs.a);
  m.step(0x19e6, 8);

  regs.a = regs.sra(regs.a);
  m.step(0x19e8, 8);

  regs.a = regs.sra(regs.a);
  m.step(0x19ea, 8);

  regs.a = regs.sra(regs.a);
  m.step(0x19ec, 8);

  regs.a = regs.sra(regs.a);
  m.step(0x19ee, 8); // A >>= 5 (arithmetic)

  regs.add(regs.b);
  m.step(0x19ef, 4); // + accumulated sum

  regs.a = regs.sra(regs.a);
  m.step(0x19f1, 8);

  regs.c = regs.a;
  m.step(0x19f2, 4);

  m.push16(0x19f5);
  m.step(0x003c, 17); // call 0x003c
  m.call(0x003c);

  regs.b = regs.c;
  m.step(0x19f6, 4);

  regs.add(regs.a);
  m.step(0x19f7, 4); // add a,a -- sets carry from bit7

  regs.sbc(regs.a);
  m.step(0x19f8, 4); // A = 0x00 or 0xFF (sign-extend of the carry)

  if (regs.fNZ) {
    m.step(0x19fb, 12); // jr nz taken
  } else {
    m.step(0x19fa, 7);
    regs.a = regs.inc8(regs.a);
    m.step(0x19fb, 4); // inc a
  }

  // loc_19fb:
  regs.add(regs.b);
  m.step(0x19fc, 4);

  regs.add(0x01);
  m.step(0x19fe, 7);

  if (regs.fM) {
    m.step(0x1a0e, 10); // jp m,0x1a0e -- negative
    // loc_1a0e:
    regs.a = 0x08;
    m.step(0x1a10, 7);
    m.step(0x1a06, 12); // jr 0x1a06
  } else {
    m.step(0x1a01, 10);
    regs.cp(0x02);
    m.step(0x1a03, 7);
    if (regs.fNC) {
      m.step(0x1a0a, 12); // jr nc,0x1a0a
      // loc_1a0a:
      regs.a = 0x04;
      m.step(0x1a0c, 7);
      m.step(0x1a06, 12); // jr 0x1a06
    } else {
      m.step(0x1a05, 7);
      regs.xor(regs.a);
      m.step(0x1a06, 4); // A = 0
    }
  }

  // loc_1a06:
  mem.write8(0x423f, regs.a);
  m.step(0x1a09, 13); // (0x423f) = 0 / 4 / 8 selector

  m.ret();
}
