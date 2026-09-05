// SPDX-License-Identifier: GPL-3.0-only

// loc_176c  (ROM 0x176c-0x17a8) — one sound/animation channel step for the descriptor pointed by HL.
// (HL)==0 -> inactive, return. Otherwise stage two params (0x41c0=2, 0x41c1=(0x41d5)) and count down the
// duration timer 0x41d6; while it stays nonzero just store it back (loc_17a2). When it expires, read the
// next command byte from the sequence pointer 0x41d3: 0xe0 terminates (clear the descriptor via (DE)=0 at
// loc_17a6); else split the byte -- low 5 bits index table 0x17a9 -> 0x41d5, high 3 bits index table 0x17c8
// -> new duration 0x41d6 -- both via rst 0x20 (byte-table lookup, loc_0020).
export function loc_176c(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.hl);
  m.step(0x176d, 7); // (HL) = descriptor's active/command byte

  regs.and(regs.a);
  m.step(0x176e, 4);

  if (regs.fZ) {
    m.ret(11); // ret z -- descriptor inactive
    return;
  }
  m.step(0x176f, 5);

  regs.exDeHl();
  m.step(0x1770, 4); // DE = descriptor ptr (kept for the 0x17a6 clear path)

  regs.a = 0x02;
  m.step(0x1772, 7);

  mem.write8(0x41c0, regs.a); // 0x41c0 = 2
  m.step(0x1775, 13);

  regs.a = mem.read8(0x41d5);
  m.step(0x1778, 13);

  mem.write8(0x41c1, regs.a); // 0x41c1 = current 0x41d5
  m.step(0x177b, 13);

  regs.a = mem.read8(0x41d6);
  m.step(0x177e, 13);

  regs.a = regs.dec8(regs.a);
  m.step(0x177f, 4); // 0x41d6 duration timer - 1

  if (regs.fNZ) {
    // jp nz,loc_17a2 -- timer still running: store the decremented value back
    m.step(0x17a2, 10);
    mem.write8(0x41d6, regs.a); // 0x41d6 = decremented duration
    m.step(0x17a5, 13);
    m.ret();
    return;
  }
  m.step(0x1782, 10);

  regs.hl = mem.read16(0x41d3);
  m.step(0x1785, 16); // HL = sequence data pointer (from 0x41d3)

  regs.a = mem.read8(regs.hl);
  m.step(0x1786, 7); // next command byte

  regs.cp(0xe0);
  m.step(0x1788, 7);

  if (regs.fZ) {
    // jr z,loc_17a6 -- 0xe0 terminator
    m.step(0x17a6, 12);
    regs.xor(regs.a);
    m.step(0x17a7, 4);
    mem.write8(regs.de, regs.a); // (DE)=0 -- deactivate the descriptor
    m.step(0x17a8, 7);
    m.ret();
    return;
  }
  m.step(0x178a, 7);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x178b, 6);

  mem.write16(0x41d3, regs.hl); // advance the sequence pointer
  m.step(0x178e, 16);

  regs.b = regs.a; // B = whole command byte
  m.step(0x178f, 4);

  regs.and(0x1f);
  m.step(0x1791, 7); // low 5 bits = table-0x17a9 index

  regs.hl = 0x17a9;
  m.step(0x1794, 10);

  m.push16(0x1795);
  m.step(0x0020, 11); // rst 0x20 -> A = (0x17a9 + A)
  m.call(0x0020);

  mem.write8(0x41d5, regs.a); // 0x41d5 = table-0x17a9 lookup
  m.step(0x1798, 13);

  regs.a = regs.b;
  m.step(0x1799, 4);

  regs.and(0xe0);
  m.step(0x179b, 7);

  regs.rlca();
  m.step(0x179c, 4);

  regs.rlca();
  m.step(0x179d, 4);

  regs.rlca();
  m.step(0x179e, 4); // A = high 3 bits of B (>>5) = table-0x17c8 index

  regs.hl = 0x17c8;
  m.step(0x17a1, 10);

  m.push16(0x17a2);
  m.step(0x0020, 11); // rst 0x20 -> A = (0x17c8 + A); returns into loc_17a2
  m.call(0x0020);

  // loc_17a2: store the new duration and return
  mem.write8(0x41d6, regs.a); // 0x41d6 = table-0x17c8 lookup (new duration)
  m.step(0x17a5, 13);
  m.ret();
}
