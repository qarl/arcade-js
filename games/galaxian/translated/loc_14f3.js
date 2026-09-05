// SPDX-License-Identifier: GPL-3.0-only

// loc_14f3  (ROM 0x14f3-0x1514) — gated prescaler cascade for the counter at 0x421a. Bail unless (0x4200)
// bit0 set and (0x422b) bit0 clear. Then dec (0x4218); on wrap reload 0x3c and dec (0x4219); on that wrap
// reload 0x14 and step (0x421a): ret if it is 7, clamp to 7 if above, else inc it. Interior loc_1512 inlined.
export function loc_14f3(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4200);
  m.step(0x14f6, 13); // ld a,(0x4200)

  regs.rrca();
  m.step(0x14f7, 4); // rrca -- carry = 0x4200 bit0
  if (regs.fNC) { m.ret(11); return; } // ret nc (taken) -- gate clear
  m.step(0x14f8, 5); // ret nc (not taken)

  regs.a = mem.read8(0x422b);
  m.step(0x14fb, 13); // ld a,(0x422b)

  regs.rrca();
  m.step(0x14fc, 4); // rrca -- carry = 0x422b bit0
  if (regs.fC) { m.ret(11); return; } // ret c (taken) -- inhibit flag set
  m.step(0x14fd, 5); // ret c (not taken)

  regs.hl = 0x4218;
  m.step(0x1500, 10); // ld hl,0x4218 -- outer prescaler

  regs.decMem8(mem, regs.hl);
  m.step(0x1501, 11); // dec (0x4218)
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- not yet wrapped
  m.step(0x1502, 5);

  mem.write8(regs.hl, 0x3c);
  m.step(0x1504, 10); // ld (0x4218),0x3c -- reload

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1505, 6); // inc hl -> 0x4219

  regs.decMem8(mem, regs.hl);
  m.step(0x1506, 11); // dec (0x4219)
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- not yet wrapped
  m.step(0x1507, 5);

  mem.write8(regs.hl, 0x14);
  m.step(0x1509, 10); // ld (0x4219),0x14 -- reload

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x150a, 6); // inc hl -> 0x421a

  regs.a = mem.read8(regs.hl);
  m.step(0x150b, 7); // ld a,(0x421a)

  regs.cp(0x07);
  m.step(0x150d, 7); // cp 0x07
  if (regs.fZ) { m.ret(11); return; } // ret z -- already at 7
  m.step(0x150e, 5);

  if (regs.fNC) {
    // loc_1512 (jr nc target, inlined) -- A > 7: clamp down to 7
    m.step(0x1512, 12); // jr nc,0x1512 (taken)
    mem.write8(regs.hl, 0x07);
    m.step(0x1514, 10); // ld (0x421a),0x07
    m.ret();
    return;
  }
  m.step(0x1510, 7); // jr nc (not taken) -- A < 7

  regs.incMem8(mem, regs.hl);
  m.step(0x1511, 11); // inc (0x421a)
  m.ret();
}
