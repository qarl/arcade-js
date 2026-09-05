// SPDX-License-Identifier: GPL-3.0-only

// loc_0605  (ROM 0x0605-0x0613) — state-timer handler: dec the counter at 0x4009; while nonzero just ret.
// On zero-cross reload 0x4009=0x14, bump the state cell 0x400a (advance state), then tail-jump loc_08f2
// with cue D:E=0x0682. Dispatch target (state jump-table).
export function loc_0605(m) {
  const { regs, mem } = m;

  regs.hl = 0x4009;
  m.step(0x0608, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x0609, 11); // dec (0x4009) -- state timer

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- still counting down
  m.step(0x060a, 5);

  mem.write8(regs.hl, 0x14);
  m.step(0x060c, 10); // (0x4009) <- 0x14 reload

  regs.l = regs.inc8(regs.l);
  m.step(0x060d, 4); // HL -> 0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x060e, 11); // inc (0x400a) -- advance state

  regs.de = 0x0682;
  m.step(0x0611, 10);

  m.step(0x08f2, 10); // jp 0x08f2 -- cue 0x0682
  return m.call(0x08f2);
}
