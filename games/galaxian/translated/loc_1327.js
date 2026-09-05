// SPDX-License-Identifier: GPL-3.0-only

// loc_1327  (ROM 0x1327-0x1343) — per-frame sound/animation ticker gated by (0x4201) bit0; called from
// 0x0691. If (0x4201) bit0 clear -> ret. Else count down (0x4205); while nonzero -> ret. On reload set
// (0x4205)=0x0a, then enqueue sound command D=0x02 / E=(0x4206) via loc_08f2 (which preserves HL), decrement
// (0x4206); while it is nonzero -> ret. When (0x4206) hits 0, clear (0x4201)=0 and sound_w reg3 (0x6803)=0.
export function loc_1327(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4201);
  m.step(0x132a, 13);

  regs.rrca();
  m.step(0x132b, 4); // carry = (0x4201) bit0

  if (regs.fNC) { m.ret(11); return; } // ret nc -- disabled
  m.step(0x132c, 5);

  regs.hl = 0x4205;
  m.step(0x132f, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x1330, 11); // dec (0x4205)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- still counting
  m.step(0x1331, 5);

  mem.write8(regs.hl, 0x0a);
  m.step(0x1333, 10); // reload (0x4205) <- 0x0a

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1334, 6); // HL = 0x4206

  regs.d = 0x02;
  m.step(0x1336, 7);

  regs.e = mem.read8(regs.hl);
  m.step(0x1337, 7); // E = (0x4206)

  m.push16(0x133a);
  m.step(0x08f2, 17);
  m.call(0x08f2); // enqueue sound command DE (HL preserved across the call)

  regs.decMem8(mem, regs.hl);
  m.step(0x133b, 11); // dec (0x4206)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- more steps to go
  m.step(0x133c, 5);

  regs.xor(regs.a);
  m.step(0x133d, 4); // A = 0

  mem.write8(0x4201, regs.a);
  m.step(0x1340, 13); // (0x4201) <- 0 (disable)

  mem.write8(0x6803, regs.a, 10);
  m.step(0x1343, 13); // sound_w reg3 (0x6803) <- 0

  m.ret();
}
