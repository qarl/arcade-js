// SPDX-License-Identifier: GPL-3.0-only

// loc_0a32  (ROM 0x0a32-0x0a73) — called from 0x0670. Guarded by (0x4200) bit0 (ret nc) and (0x4208) bit0
// (ret c). Reads a control cell (0x4006) bit0 to pick a branch: bit0 set -> loc_0a68 checks (0x425f)&0x1f,
// arming (0x4208)=1 only when zero. Otherwise ANDs a pair of masked input cells (~(0x4013)&(0x4010) or, when
// (0x4018) bit0 set, ~(0x4014)&(0x4011)) with 0x10; a hit arms (0x4208)=1 and (0x41cc)=1.
export function loc_0a32(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4200);
  m.step(0x0a35, 13);
  regs.rrca();
  m.step(0x0a36, 4); // carry = (0x4200) bit0
  if (regs.fNC) { m.ret(11); return; } // ret nc
  m.step(0x0a37, 5);

  regs.a = mem.read8(0x4208);
  m.step(0x0a3a, 13);
  regs.rrca();
  m.step(0x0a3b, 4); // carry = (0x4208) bit0
  if (regs.fC) { m.ret(11); return; } // ret c -- already armed
  m.step(0x0a3c, 5);

  regs.a = mem.read8(0x4006);
  m.step(0x0a3f, 13);
  regs.rrca();
  m.step(0x0a40, 4);
  if (regs.fNC) {
    // jr nc,0x0a68
    m.step(0x0a68, 12);
    regs.a = mem.read8(0x425f);
    m.step(0x0a6b, 13);
    regs.and(0x1f);
    m.step(0x0a6d, 7);
    if (regs.fNZ) { m.ret(11); return; } // ret nz
    m.step(0x0a6e, 5);
    regs.a = 0x01;
    m.step(0x0a70, 7);
    mem.write8(0x4208, regs.a);
    m.step(0x0a73, 13); // (0x4208) <- 1
    m.ret();
    return;
  }
  m.step(0x0a42, 7);

  regs.a = mem.read8(0x4018);
  m.step(0x0a45, 13);
  regs.rrca();
  m.step(0x0a46, 4);
  if (regs.fC) {
    // jr c,0x0a5d -- alternate input pair
    m.step(0x0a5d, 12);
    regs.a = mem.read8(0x4014);
    m.step(0x0a60, 13);
    regs.cpl();
    m.step(0x0a61, 4);
    regs.b = regs.a;
    m.step(0x0a62, 4);
    regs.a = mem.read8(0x4011);
    m.step(0x0a65, 13);
    // jp 0x0a50
    m.step(0x0a50, 10);
  } else {
    m.step(0x0a48, 7);
    regs.a = mem.read8(0x4013);
    m.step(0x0a4b, 13);
    regs.cpl();
    m.step(0x0a4c, 4);
    regs.b = regs.a;
    m.step(0x0a4d, 4);
    regs.a = mem.read8(0x4010);
    m.step(0x0a50, 13);
  }

  // loc_0a50: A &= B, mask 0x10 -> ret if no hit, else arm both flags
  regs.and(regs.b);
  m.step(0x0a51, 4);
  regs.and(0x10);
  m.step(0x0a53, 7);
  if (regs.fZ) { m.ret(11); return; } // ret z
  m.step(0x0a54, 5);
  regs.a = 0x01;
  m.step(0x0a56, 7);
  mem.write8(0x4208, regs.a);
  m.step(0x0a59, 13); // (0x4208) <- 1
  mem.write8(0x41cc, regs.a);
  m.step(0x0a5c, 13); // (0x41cc) <- 1
  m.ret();
}
