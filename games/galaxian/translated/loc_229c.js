// SPDX-License-Identifier: GPL-3.0-only

// loc_229c  (ROM 0x229c-0x22b2) — one-shot per (0x400d): index a flag table at 0x40ad by (0x400d); if that
// slot's bit0 is already set, return. Otherwise set the flag, raise 0x41c7=1, bump the counter (0x421d) and
// load B=(0x421d), then fall through into loc_22b3 (the marker-row draw) — a genuine head, so delegate.
export function loc_229c(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x400d);
  m.step(0x229f, 13); // ld a,(0x400d)

  regs.hl = 0x40ad;
  m.step(0x22a2, 10); // ld hl,0x40ad -- flag-table base

  regs.add(regs.l);
  m.step(0x22a3, 4); // add a,l
  regs.l = regs.a;
  m.step(0x22a4, 4); // ld l,a -- HL = 0x40ad + (0x400d)

  regs.bit(0, mem.read8(regs.hl));
  m.step(0x22a6, 12); // bit 0,(hl) -- Z clear when already set

  if (regs.fNZ) {
    m.ret(11); // ret nz -- slot already flagged: nothing to do
    return;
  }
  m.step(0x22a7, 5); // ret nz (not taken)

  mem.write8(regs.hl, 0x01);
  m.step(0x22a9, 10); // ld (hl),0x01 -- mark this slot done

  regs.a = 0x01;
  m.step(0x22ab, 7);
  mem.write8(0x41c7, regs.a);
  m.step(0x22ae, 13); // ld (0x41c7),a <- 1

  regs.hl = 0x421d;
  m.step(0x22b1, 10); // ld hl,0x421d
  regs.incMem8(mem, regs.hl);
  m.step(0x22b2, 11); // inc (0x421d)
  regs.b = mem.read8(regs.hl);
  m.step(0x22b3, 7); // ld b,(0x421d) -- marker count

  // fall-through into loc_22b3 (genuine head, also entered by jp @0x24c5) -- delegate
  return m.call(0x22b3);
}
