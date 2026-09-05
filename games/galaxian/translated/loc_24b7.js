// SPDX-License-Identifier: GPL-3.0-only

// loc_24b7  (ROM 0x24b7-0x2568) — HUD/score sub-dispatch on A: 0 -> credits+coin line (loc_2520),
// 1 -> 1P score (loc_24eb), 2 -> convoy/level readout (loc_24c8), else -> rst 0x08 caller-skip then a
// jump into the shared draw at 0x22b3. Each arm renders BCD digits via loc_2569/loc_22f1/loc_2585.
export function loc_24b7(m) {
  const { regs, mem } = m;

  regs.and(regs.a);
  m.step(0x24b8, 4);

  if (regs.fZ) {
    // ── A==0: loc_2520 — coin/credits line ────────────────────────────────────────────
    m.step(0x2520, 12);

    m.push16(0x2521);
    m.step(0x0008, 11); // rst 0x08 -- caller-skip if (0x4007) bit0 set
    m.call(0x0008);
    if (m.pc !== 0x2521) return; // took the double-return: rest of this routine is skipped

    regs.a = mem.read8(0x4220);
    m.step(0x2524, 13);
    regs.and(regs.a);
    m.step(0x2525, 4);
    if (regs.fNZ) {
      m.step(0x2527, 7);
      regs.a = 0x01;
      m.step(0x2529, 7);
      mem.write8(0x41d0, regs.a);
      m.step(0x252c, 13); // 0x41d0 <- 1 (free-play/credit flag)
    } else {
      m.step(0x252c, 12); // jr z,0x252c
    }

    // loc_252c -- credit count, clamped to 0x30
    regs.a = mem.read8(0x421c);
    m.step(0x252f, 13);
    regs.a = regs.inc8(regs.a);
    m.step(0x2530, 4);
    regs.cp(0x30);
    m.step(0x2532, 7);
    if (regs.fC) {
      m.step(0x2536, 12); // jr c,0x2536
    } else {
      m.step(0x2534, 7);
      regs.a = 0x30;
      m.step(0x2536, 7);
    }

    // loc_2536
    m.push16(0x2539);
    m.step(0x2569, 17);
    m.call(0x2569); // A = BCD(credits)
    m.push16(regs.af);
    m.step(0x253a, 11); // push af -- keep BCD across the tens loop
    regs.hl = 0x507e;
    m.step(0x253d, 10);
    regs.and(0xf0);
    m.step(0x253f, 7);
    if (regs.fNZ) {
      m.step(0x2541, 7);
      regs.rrca(); m.step(0x2542, 4);
      regs.rrca(); m.step(0x2543, 4);
      regs.rrca(); m.step(0x2544, 4);
      regs.rrca(); m.step(0x2545, 4);
      regs.b = regs.a;
      m.step(0x2546, 4); // B = tens digit
      regs.c = 0x10;
      m.step(0x2548, 7);
      for (;;) {
        // loc_2548
        regs.a = 0x68;
        m.step(0x254a, 7);
        m.push16(0x254d);
        m.step(0x2585, 17);
        m.call(0x2585);
        regs.c = regs.dec8(regs.c);
        m.step(0x254e, 4);
        regs.c = regs.dec8(regs.c);
        m.step(0x254f, 4);
        if (regs.djnz() !== 0) { m.step(0x2548, 13); continue; }
        m.step(0x2551, 8);
        break;
      }
    } else {
      m.step(0x2551, 12); // jr z,0x2551
    }

    // loc_2551
    regs.af = m.pop16();
    m.step(0x2552, 10);
    regs.and(0x0f);
    m.step(0x2554, 7);
    regs.b = regs.a;
    m.step(0x2555, 4); // B = units digit
    regs.de = 0x001f;
    m.step(0x2558, 10);
    if (regs.fNZ) {
      m.step(0x255a, 7);
      for (;;) {
        // loc_255a
        regs.a = 0x6c;
        m.step(0x255c, 7);
        m.push16(0x255f);
        m.step(0x25a0, 17);
        m.call(0x25a0);
        regs.c = regs.dec8(regs.c);
        m.step(0x2560, 4);
        if (regs.djnz() !== 0) { m.step(0x255a, 13); continue; }
        m.step(0x2562, 8);
        break;
      }
    } else {
      m.step(0x2562, 12); // jr z,0x2562
    }

    for (;;) {
      // loc_2562 -- drain remaining coin cells until C goes negative
      regs.c = regs.dec8(regs.c);
      m.step(0x2563, 4);
      if (regs.fM) { m.ret(11); return; } // ret m
      m.step(0x2564, 5);
      m.push16(0x2567);
      m.step(0x259e, 17);
      m.call(0x259e);
      m.step(0x2562, 12);
    }
  }
  m.step(0x24ba, 7);

  regs.a = regs.dec8(regs.a);
  m.step(0x24bb, 4);

  if (regs.fZ) {
    // ── A==1: loc_24eb — 1P score line ────────────────────────────────────────────────
    m.step(0x24eb, 12);

    regs.a = mem.read8(0x4006);
    m.step(0x24ee, 13);
    regs.rrca();
    m.step(0x24ef, 4);
    if (regs.fC) { m.ret(11); return; } // ret c -- bit0 of (0x4006) set: skip
    m.step(0x24f0, 5);

    regs.a = mem.read8(0x4011);
    m.step(0x24f3, 13);
    regs.and(0xc0);
    m.step(0x24f5, 7);
    regs.cp(0xc0);
    m.step(0x24f7, 7);
    regs.a = 0x10;
    m.step(0x24f9, 7);
    if (regs.fZ) {
      m.step(0x22f1, 10); // jp z,0x22f1 -- both dip bits set: paint message 0x10
      return m.call(0x22f1);
    }
    m.step(0x24fc, 10);

    regs.a = 0x05;
    m.step(0x24fe, 7);
    m.push16(0x2501);
    m.step(0x22f1, 17);
    m.call(0x22f1); // paint message 0x05

    regs.a = mem.read8(0x4002);
    m.step(0x2504, 13);
    regs.cp(0x63);
    m.step(0x2506, 7);
    if (regs.fC) {
      m.step(0x250a, 12); // jr c,0x250a
    } else {
      m.step(0x2508, 7);
      regs.a = 0x63;
      m.step(0x250a, 7); // clamp to 0x63
    }

    // loc_250a
    m.push16(0x250d);
    m.step(0x2569, 17);
    m.call(0x2569); // A = BCD value
    regs.b = regs.a;
    m.step(0x250e, 4);
    regs.and(0xf0);
    m.step(0x2510, 7);
    if (regs.fNZ) {
      m.step(0x2512, 7);
      regs.rrca(); m.step(0x2513, 4);
      regs.rrca(); m.step(0x2514, 4);
      regs.rrca(); m.step(0x2515, 4);
      regs.rrca(); m.step(0x2516, 4);
      mem.write8(0x529f, regs.a);
      m.step(0x2519, 13); // tens digit -> 0x529f
    } else {
      m.step(0x2519, 12); // jr z,0x2519
    }

    // loc_2519
    regs.a = regs.b;
    m.step(0x251a, 4);
    regs.and(0x0f);
    m.step(0x251c, 7);
    mem.write8(0x527f, regs.a);
    m.step(0x251f, 13); // units digit -> 0x527f
    m.ret();
    return;
  }
  m.step(0x24bd, 7);

  regs.a = regs.dec8(regs.a);
  m.step(0x24be, 4);

  if (regs.fZ) {
    // ── A==2: loc_24c8 — convoy/level nibble readout ─────────────────────────────────
    m.step(0x24c8, 12);

    regs.a = mem.read8(0x40ac);
    m.step(0x24cb, 13);
    regs.cp(0xff);
    m.step(0x24cd, 7);
    if (regs.fZ) { m.ret(11); return; } // ret z -- 0x40ac==0xff: nothing to show
    m.step(0x24ce, 5);

    regs.a = 0x06;
    m.step(0x24d0, 7);
    m.push16(0x24d3);
    m.step(0x22f1, 17);
    m.call(0x22f1); // paint message 0x06

    regs.a = mem.read8(0x40ac);
    m.step(0x24d6, 13);
    regs.and(0x0f);
    m.step(0x24d8, 7);
    mem.write8(0x5138, regs.a);
    m.step(0x24db, 13); // low nibble -> 0x5138

    regs.a = mem.read8(0x40ac);
    m.step(0x24de, 13);
    regs.and(0xf0);
    m.step(0x24e0, 7);
    if (regs.fNZ) {
      m.step(0x24e3, 12); // jr nz,0x24e3
    } else {
      m.step(0x24e2, 7);
      regs.a = regs.inc8(regs.a);
      m.step(0x24e3, 4); // high nibble 0 -> 1 so it renders a tile
    }

    // loc_24e3
    regs.rrca(); m.step(0x24e4, 4);
    regs.rrca(); m.step(0x24e5, 4);
    regs.rrca(); m.step(0x24e6, 4);
    regs.rrca(); m.step(0x24e7, 4);
    mem.write8(0x5158, regs.a);
    m.step(0x24ea, 13); // high nibble -> 0x5158
    m.ret();
    return;
  }
  m.step(0x24c0, 7);

  // ── default (A>=3): read pending value, caller-skip, then jump to the shared draw ──
  regs.a = mem.read8(0x421d);
  m.step(0x24c3, 13);
  regs.b = regs.a;
  m.step(0x24c4, 4);

  m.push16(0x24c5);
  m.step(0x0008, 11); // rst 0x08 -- caller-skip if (0x4007) bit0 set
  m.call(0x0008);
  if (m.pc !== 0x24c5) return; // took the double-return

  m.step(0x22b3, 10); // jp 0x22b3 -- tail into the shared draw (earlier batch)
  return m.call(0x22b3);
}
