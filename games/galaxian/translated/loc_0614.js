// SPDX-License-Identifier: GPL-3.0-only

// loc_0614  (ROM 0x0614-0x0645) — state-timer handler: dec the counter at 0x4009; while nonzero just ret.
// On zero-cross reload 0x4009=0x0a, bump the state cell 0x400a, seed 0x4200=0x0001 / 0x4202=0x80, copy a
// 16-byte block from 0x15e3 to 0x424a, clear 0x4058/0x405a, fire cue 0x0703 then tail-jump loc_08f2 with
// cue 0x0200. Dispatch target (state jump-table).
export function loc_0614(m) {
  const { regs, mem } = m;

  regs.hl = 0x4009;
  m.step(0x0617, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x0618, 11); // dec (0x4009) -- state timer

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- still counting down
  m.step(0x0619, 5);

  mem.write8(regs.hl, 0x0a);
  m.step(0x061b, 10); // (0x4009) <- 0x0a reload

  regs.l = regs.inc8(regs.l);
  m.step(0x061c, 4); // HL -> 0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x061d, 11); // inc (0x400a) -- advance state

  regs.hl = 0x0001;
  m.step(0x0620, 10);

  mem.write16(0x4200, regs.hl);
  m.step(0x0623, 16); // (0x4200/01) <- 0x0001

  regs.a = 0x80;
  m.step(0x0625, 7);

  mem.write8(0x4202, regs.a);
  m.step(0x0628, 13); // (0x4202) <- 0x80

  regs.hl = 0x15e3;
  m.step(0x062b, 10);

  regs.de = 0x424a;
  m.step(0x062e, 10);

  regs.bc = 0x0010;
  m.step(0x0631, 10);

  m.ldirAt(0x0631, 0x0633); // ldir 0x15e3->0x424a, 16 bytes

  regs.xor(regs.a);
  m.step(0x0634, 4);

  mem.write8(0x4058, regs.a);
  m.step(0x0637, 13); // (0x4058) <- 0

  mem.write8(0x405a, regs.a);
  m.step(0x063a, 13); // (0x405a) <- 0

  regs.de = 0x0703;
  m.step(0x063d, 10);

  m.push16(0x0640);
  m.step(0x08f2, 17); // call 0x08f2 -- cue 0x0703
  m.call(0x08f2);

  regs.de = 0x0200;
  m.step(0x0643, 10);

  m.step(0x08f2, 10); // jp 0x08f2 -- cue 0x0200
  return m.call(0x08f2);
}
