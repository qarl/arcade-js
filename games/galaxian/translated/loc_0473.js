// SPDX-License-Identifier: GPL-3.0-only

// loc_0473  (ROM 0x0473-0x0491, incl. interior 0x048b) — rst-28 state routine (dispatch index 3): drive the
// two start-button lamp latches (0x6000/0x6001) from the credit/start count (0x4002), gated on (0x425f)
// bit5. bit5 clear -> clear both lamps (interior 0x048b) and ret. Else count 0 -> ret; count 1 -> lamp0 on;
// count >=2 -> both lamps on.
export function loc_0473(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x425f);
  m.step(0x0476, 13); // ld a,(0x425f) -- attract/enable flag byte

  regs.and(0x20);
  m.step(0x0478, 7); // and 0x20 -- test bit5 (A=0 when clear)

  if (regs.fZ) {
    // jr z,0x048b (taken) -- interior loc_048b: bit5 clear, A=0, clear both start lamps
    m.step(0x048b, 12);

    mem.write8(0x6000, regs.a, 10); // start_lamp0 latch <- 0
    m.step(0x048e, 13);

    mem.write8(0x6001, regs.a, 10); // start_lamp1 latch <- 0
    m.step(0x0491, 13);

    return m.ret();
  }
  m.step(0x047a, 7); // jr z,0x048b (not taken)

  regs.a = mem.read8(0x4002);
  m.step(0x047d, 13); // ld a,(0x4002) -- credit/start count

  regs.and(regs.a);
  m.step(0x047e, 4); // and a -- Z when count == 0

  if (regs.fZ) { m.ret(11); return; } // ret z -- no credits: leave lamps
  m.step(0x047f, 5); // ret z (not taken)

  regs.b = regs.a;
  m.step(0x0480, 4); // ld b,a -- B = count

  regs.a = 0x01;
  m.step(0x0482, 7); // ld a,0x01 -- lamp-on value

  mem.write8(0x6000, regs.a, 10); // start_lamp0 latch <- 1
  m.step(0x0485, 13);

  regs.b = regs.dec8(regs.b);
  m.step(0x0486, 4); // dec b -- Z when count was 1

  if (regs.fZ) { m.ret(11); return; } // ret z -- one credit: only lamp0
  m.step(0x0487, 5); // ret z (not taken)

  mem.write8(0x6001, regs.a, 10); // start_lamp1 latch <- 1
  m.step(0x048a, 13);

  return m.ret();
}
