// SPDX-License-Identifier: GPL-3.0-only

// loc_194f  (ROM 0x194f-0x1960) — clamp/advance the 0x40xx counter at HL toward a 0x63 ceiling. If (hl)==0x63
// return; if (hl)>0x63 clamp to 0x63 via loc_1961; else bump (hl), raise the 0x41c9 flag, and tail into the
// loc_08f2 command-queue enqueue with the 0x0701 command word.
export function loc_194f(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.hl);
  m.step(0x1950, 7); // ld a,(hl)

  regs.cp(0x63);
  m.step(0x1952, 7); // cp 0x63 -- C set when (hl)<0x63

  if (regs.fZ) { m.ret(11); return; } // ret z -- already at the 0x63 ceiling
  m.step(0x1953, 5);

  if (regs.fNC) {
    // jr nc,0x1961 (taken) -- (hl)>0x63: clamp down to 0x63 (separate head)
    m.step(0x1961, 12);
    return m.call(0x1961);
  }
  m.step(0x1955, 7); // jr nc (not taken)

  regs.incMem8(mem, regs.hl);
  m.step(0x1956, 11); // inc (hl)

  regs.a = 0x01;
  m.step(0x1958, 7); // ld a,0x01

  mem.write8(0x41c9, regs.a);
  m.step(0x195b, 13); // ld (0x41c9),a -- raise 0x41c9 = 1

  regs.de = 0x0701;
  m.step(0x195e, 10); // ld de,0x0701 -- command word to enqueue

  // jp 0x08f2 -- tail into the command-queue enqueue
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}
