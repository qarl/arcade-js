// SPDX-License-Identifier: GPL-3.0-only

// loc_0218  (ROM 0x0218-0x023e) — a state handler (rst-0x28 dispatch-table target @0x016c, on the 0x400a
// state index). A two-phase countdown on the 0x4008/0x4009 timer pair: `ret nz` holds each phase until its
// timer expires; when 0x4009 hits 0 it advances the state index (0x400a), reloads the timers to 0x0420,
// zero-fills 0x42b0.. and clears 0x4241. Runs the shared per-state setup (0x0363) up front.
export function loc_0218(m) {
  const { regs, mem } = m;

  m.push16(0x021b);
  m.step(0x0363, 17);
  m.call(0x0363);

  regs.hl = 0x4008;
  m.step(0x021e, 10); // phase-1 countdown timer (0x4008/0x4009 pair)

  regs.decMem8(mem, regs.hl);
  m.step(0x021f, 11); // dec (0x4008)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- phase 1 still counting
  m.step(0x0220, 5);

  mem.write8(regs.hl, 0x50);
  m.step(0x0222, 10); // (0x4008) <- 0x50 reload

  regs.l = regs.inc8(regs.l);
  m.step(0x0223, 4); // HL=0x4009

  regs.d = 0x06;
  m.step(0x0225, 7);

  regs.a = mem.read8(regs.hl);
  m.step(0x0226, 7); // A = (0x4009)

  regs.add(regs.d);
  m.step(0x0227, 4);

  regs.e = regs.a;
  m.step(0x0228, 4); // E = (0x4009)+6, arg to 0x08f2

  m.push16(0x022b);
  m.step(0x08f2, 17);
  m.call(0x08f2);

  regs.decMem8(mem, regs.hl);
  m.step(0x022c, 11); // dec (0x4009)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- phase 2 still counting
  m.step(0x022d, 5);

  regs.l = regs.inc8(regs.l);
  m.step(0x022e, 4); // HL=0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x022f, 11); // inc (0x400a) -- advance the state index

  regs.hl = 0x0420;
  m.step(0x0232, 10);

  mem.write16(0x4008, regs.hl);
  m.step(0x0235, 16); // (0x4008)=0x20, (0x4009)=0x04 -- reload the timer pair

  regs.hl = 0x42b0;
  m.step(0x0238, 10);

  regs.xor(regs.a);
  m.step(0x0239, 4); // A=0

  regs.b = regs.a;
  m.step(0x023a, 4); // B=0 -> the rst-0x10 fill runs the full 256 bytes

  m.push16(0x023b);
  m.step(0x0010, 11); // rst 0x10 -- fill (0x42b0..0x43af) <- 0
  m.call(0x0010);

  mem.write8(0x4241, regs.a);
  m.step(0x023e, 13); // (0x4241) <- 0

  m.ret();
}
