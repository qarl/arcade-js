// SPDX-License-Identifier: GPL-3.0-only

// loc_148e  (ROM 0x148e-0x149a) — per-secondary-slot step, called from loc_1472's loop. Spawns into the
// current IY slot (loc_149b), advances IY by 0x20 to the next slot, decrements the C budget; while C!=0 just
// rets, and on C==0 forces B=1 so the caller's djnz ends the walk after this iteration.
export function loc_148e(m) {
  const { regs } = m;

  m.push16(0x1491);
  m.step(0x149b, 17); // call 0x149b -- spawn into (iy) if free
  m.call(0x149b);

  regs.de = 0x0020;
  m.step(0x1494, 10);

  regs.addIy(regs.de);
  m.step(0x1496, 15); // IY += 0x20 -- next secondary slot

  regs.c = regs.dec8(regs.c);
  m.step(0x1497, 4); // dec C -- secondary-slot budget

  if (regs.fNZ) {
    m.ret(11); // ret nz -- budget remains
    return;
  }
  m.step(0x1498, 5); // ret nz (not taken)

  regs.b = 0x01;
  m.step(0x149a, 7); // B=1 -- caller's djnz stops after this iteration

  m.ret();
}
