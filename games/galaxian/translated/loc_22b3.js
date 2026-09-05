// SPDX-License-Identifier: GPL-3.0-only

// loc_22b3  (ROM 0x22b3-0x22cf) — draw the marker row at VRAM 0x539e across 5 slots. B = markers to draw
// (from loc_229c or jp @0x24c5). When (0x4200)!=0 one marker is dropped (dec b); if that empties B, skip
// straight to blanking. loc_22c1 writes B marker tiles (0x66) via 0x2593; loc_22c9 then blanks the rest via
// 0x2591 until the slot counter C goes negative (ret m). Interior labels 0x22c1, 0x22c9 inlined.
export function loc_22b3(m) {
  const { regs, mem } = m;

  regs.hl = 0x539e;
  m.step(0x22b6, 10); // ld hl,0x539e -- VRAM marker-row cell

  regs.c = 0x05;
  m.step(0x22b8, 7); // ld c,0x05 -- 5 slots

  regs.a = mem.read8(0x4200);
  m.step(0x22bb, 13); // ld a,(0x4200)
  regs.and(regs.a);
  m.step(0x22bc, 4); // and a

  let blankOnly = false;
  if (regs.fZ) {
    m.step(0x22c1, 12); // jr z,0x22c1 (taken) -- (0x4200)==0: draw all B markers
  } else {
    m.step(0x22be, 7); // jr z,0x22c1 (not taken)
    regs.b = regs.dec8(regs.b);
    m.step(0x22bf, 4); // dec b -- one marker dropped
    if (regs.fZ) {
      m.step(0x22c9, 12); // jr z,0x22c9 (taken) -- no markers left: blank all
      blankOnly = true;
    } else {
      m.step(0x22c1, 7); // jr z,0x22c9 (not taken) -- fall into the marker loop
    }
  }

  if (!blankOnly) {
    // loc_22c1: draw B marker tiles
    for (;;) {
      regs.a = 0x66;
      m.step(0x22c3, 7); // ld a,0x66 -- marker tile
      m.push16(0x22c6);
      m.step(0x2593, 17); // call 0x2593 -- write the tile pair at HL
      m.call(0x2593);
      regs.c = regs.dec8(regs.c);
      m.step(0x22c7, 4); // dec c -- slot consumed
      if (regs.djnz() !== 0) {
        m.step(0x22c1, 13); // djnz (taken)
        continue;
      }
      m.step(0x22c9, 8); // djnz (not taken) -- fall into the blank loop
      break;
    }
  }

  // loc_22c9: blank remaining slots until C < 0
  for (;;) {
    regs.c = regs.dec8(regs.c);
    m.step(0x22ca, 4); // dec c
    if (regs.fM) {
      m.ret(11); // ret m -- all slots done
      return;
    }
    m.step(0x22cb, 5); // ret m (not taken)
    m.push16(0x22ce);
    m.step(0x2591, 17); // call 0x2591 -- blank the tile pair at HL
    m.call(0x2591);
    m.step(0x22c9, 12); // jr 0x22c9
  }
}
