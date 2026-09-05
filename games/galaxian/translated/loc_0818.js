// SPDX-License-Identifier: GPL-3.0-only

// loc_0818  (ROM 0x0818-0x0836) — dispatch-table state handler (entry via dw 0x0818 @0x0793). Counts down
// timer (0x4009); until it hits 0 it just rets. On expiry: clear 0x400a and 0x400d, set game-state
// (0x4005)=3, build the packed bitfield into 0x41a0 via loc_0764 (leaves DE at 0x41b0), then ldir 8 bytes
// 0x4218->DE; ret.
export function loc_0818(m) {
  const { regs, mem } = m;

  regs.hl = 0x4009;
  m.step(0x081b, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x081c, 11); // dec (0x4009) -- countdown timer

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- still counting
  m.step(0x081d, 5);

  regs.l = regs.inc8(regs.l);
  m.step(0x081e, 4); // HL = 0x400a

  regs.xor(regs.a);
  m.step(0x081f, 4); // A = 0

  mem.write8(regs.hl, regs.a);
  m.step(0x0820, 7); // (0x400a) <- 0

  mem.write8(0x400d, regs.a);
  m.step(0x0823, 13); // (0x400d) <- 0

  regs.a = 0x03;
  m.step(0x0825, 7);

  mem.write8(0x4005, regs.a);
  m.step(0x0828, 13); // (0x4005) <- 3 -- next game-state index

  regs.de = 0x41a0;
  m.step(0x082b, 10); // DE = pack-table dest for loc_0764

  m.push16(0x082e);
  m.step(0x0764, 17); // call 0x0764 -- pack 0x4100.. into 0x41a0.., leaves DE at 0x41b0
  m.call(0x0764);

  regs.hl = 0x4218;
  m.step(0x0831, 10); // ldir source

  regs.bc = 0x0008;
  m.step(0x0834, 10);

  m.ldirAt(0x0834, 0x0836); // ldir 8 bytes (0x4218)->(DE)

  return m.ret();
}
