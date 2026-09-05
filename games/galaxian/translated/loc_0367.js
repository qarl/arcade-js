// SPDX-License-Identifier: GPL-3.0-only

// loc_0367  (ROM 0x0367-0x0399) — periodic VRAM draw gated by the 0x4241 count and the 0x425f frame
// counter. B=(0x4241); return if <2. C=(0x425f); if low6==0 branch to loc_03c0, if low6!=0x20 return.
// Else bits6-7 pick a 3-byte row of table 0x039a; draw it to VRAM 0x5193 via 0x03af; then fall through
// into loc_0394 to draw B-1 more rows from table 0x03a6. Called from 0x0248/0x0270/0x0297.
export function loc_0367(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4241);
  m.step(0x036a, 13); // 0x4241 = active count

  regs.and(regs.a);
  m.step(0x036b, 4);

  if (regs.fZ) { m.ret(11); return; } // ret z -- count 0
  m.step(0x036c, 5);

  regs.a = regs.dec8(regs.a);
  m.step(0x036d, 4);

  if (regs.fZ) { m.ret(11); return; } // ret z -- count 1
  m.step(0x036e, 5);

  regs.b = regs.a;
  m.step(0x036f, 4); // B = count-1

  regs.a = mem.read8(0x425f);
  m.step(0x0372, 13); // 0x425f = frame counter

  regs.c = regs.a;
  m.step(0x0373, 4);

  regs.and(0x3f);
  m.step(0x0375, 7); // low 6 bits

  if (regs.fZ) {
    // jr z,0x03c0 (separate routine, delegate)
    m.step(0x03c0, 12);
    return m.call(0x03c0);
  }
  m.step(0x0377, 7);

  regs.cp(0x20);
  m.step(0x0379, 7);

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- only act on the 0x20 phase
  m.step(0x037a, 5);

  regs.a = regs.c;
  m.step(0x037b, 4);

  regs.rlca();
  m.step(0x037c, 4);

  regs.rlca();
  m.step(0x037d, 4); // A = counter rotated left 2

  regs.and(0x03);
  m.step(0x037f, 7); // A = bits 6-7 of the counter (0..3)

  regs.c = regs.a;
  m.step(0x0380, 4);

  regs.add(regs.a);
  m.step(0x0381, 4); // A*2

  regs.add(regs.c);
  m.step(0x0382, 4); // A = 3*row -> byte offset

  regs.e = regs.a;
  m.step(0x0383, 4);

  regs.d = 0x00;
  m.step(0x0385, 7);

  regs.hl = 0x039a;
  m.step(0x0388, 10); // table base (3-byte rows, DATA at 0x039a-0x03a5)

  regs.addHl(regs.de);
  m.step(0x0389, 11); // HL = &table row

  regs.de = 0x5193;
  m.step(0x038c, 10); // VRAM dest

  m.push16(0x038f);
  m.step(0x03af, 17); // call 0x03af -- draw one row
  m.call(0x03af);

  regs.b = regs.dec8(regs.b);
  m.step(0x0390, 4);

  if (regs.fZ) { m.ret(11); return; } // ret z -- only one row to draw
  m.step(0x0391, 5);

  regs.hl = 0x03a6;
  m.step(0x0394, 10); // ld hl,0x03a6 -- table base (DATA); fall into the draw loop

  // loc_0394 loop (inlined -- interior tail, reached only by this fall-through + its own djnz):
  // call 0x03af, djnz 0x0394 -- draw the remaining B rows, then ret
  for (;;) {
    m.push16(0x0397);
    m.step(0x03af, 17); // call 0x03af -- draw one row
    m.call(0x03af);

    regs.b = (regs.b - 1) & 0xff; // djnz decrements B, affects no flags
    if (regs.b !== 0) { m.step(0x0394, 13); continue; } // djnz 0x0394 (taken)
    m.step(0x0399, 8); // djnz (not taken)
    break;
  }
  m.ret(); // ret at 0x0399
}
