// SPDX-License-Identifier: GPL-3.0-only

// loc_116b  (ROM 0x116b-0x11af) — 16-bit fixed-point vector integrator for an object (IX = struct in WRAM).
// Runs ((ix+0x18)&3)+1 iterations of a rotate/step on the two 16-bit accumulators H:D and L:E, using C as a
// wrap temp; writes them back to (ix+0x19..0x1c). Interior labels loc_117e/1184/118e/1196/11a0 inlined.
export function loc_116b(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.ix + 0x18);
  m.step(0x116e, 19);

  regs.and(0x03);
  m.step(0x1170, 7);

  regs.a = regs.inc8(regs.a);
  m.step(0x1171, 4);

  regs.b = regs.a; // B = ((ix+0x18)&3)+1 -- iteration count
  m.step(0x1172, 4);

  regs.h = mem.read8(regs.ix + 0x19);
  m.step(0x1175, 19);

  regs.l = mem.read8(regs.ix + 0x1a);
  m.step(0x1178, 19);

  regs.d = mem.read8(regs.ix + 0x1b);
  m.step(0x117b, 19);

  regs.e = mem.read8(regs.ix + 0x1c);
  m.step(0x117e, 19);

  for (;;) {
    // loc_117e:
    regs.a = regs.l;
    m.step(0x117f, 4);

    regs.c = regs.h;
    m.step(0x1180, 4);

    regs.add(regs.a); // add a,a -- carry = bit7 of L
    m.step(0x1181, 4);

    if (regs.fNC) {
      m.step(0x1184, 12); // jr nc,0x1184 (taken)
    } else {
      m.step(0x1183, 7); // jr nc (not taken)
      regs.h = regs.dec8(regs.h);
      m.step(0x1184, 4);
    }

    // loc_1184:
    regs.add(regs.d);
    m.step(0x1185, 4);

    regs.d = regs.a;
    m.step(0x1186, 4);

    regs.a = 0x00;
    m.step(0x1188, 7);

    regs.adc(regs.h); // A = H + carry (high byte of H:D sum)
    m.step(0x1189, 4);

    regs.cp(0x80);
    m.step(0x118b, 7);

    if (regs.fNZ) {
      m.step(0x118e, 12); // jr nz,0x118e (taken)
    } else {
      m.step(0x118d, 7); // jr nz (not taken)
      regs.a = regs.c; // wrap: restore old H
      m.step(0x118e, 4);
    }

    // loc_118e:
    regs.h = regs.a;
    m.step(0x118f, 4);

    regs.c = regs.l;
    m.step(0x1190, 4);

    regs.neg();
    m.step(0x1192, 8);

    regs.add(regs.a); // add a,a
    m.step(0x1193, 4);

    if (regs.fNC) {
      m.step(0x1196, 12); // jr nc,0x1196 (taken)
    } else {
      m.step(0x1195, 7); // jr nc (not taken)
      regs.l = regs.dec8(regs.l);
      m.step(0x1196, 4);
    }

    // loc_1196:
    regs.add(regs.e);
    m.step(0x1197, 4);

    regs.e = regs.a;
    m.step(0x1198, 4);

    regs.a = 0x00;
    m.step(0x119a, 7);

    regs.adc(regs.l); // A = L + carry (high byte of L:E sum)
    m.step(0x119b, 4);

    regs.cp(0x80);
    m.step(0x119d, 7);

    if (regs.fNZ) {
      m.step(0x11a0, 12); // jr nz,0x11a0 (taken)
    } else {
      m.step(0x119f, 7); // jr nz (not taken)
      regs.a = regs.c; // wrap: restore old L
      m.step(0x11a0, 4);
    }

    // loc_11a0:
    regs.l = regs.a;
    m.step(0x11a1, 4);

    if (regs.djnz() !== 0) {
      m.step(0x117e, 13); // djnz 0x117e (taken)
      continue;
    }
    m.step(0x11a3, 8); // djnz (not taken)
    break;
  }

  mem.write8(regs.ix + 0x19, regs.h);
  m.step(0x11a6, 19);

  mem.write8(regs.ix + 0x1a, regs.l);
  m.step(0x11a9, 19);

  mem.write8(regs.ix + 0x1b, regs.d);
  m.step(0x11ac, 19);

  mem.write8(regs.ix + 0x1c, regs.e);
  m.step(0x11af, 19);

  m.ret();
}
