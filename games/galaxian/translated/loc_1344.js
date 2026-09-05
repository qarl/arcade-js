// SPDX-License-Identifier: GPL-3.0-only

// loc_1344  (ROM 0x1344-0x13e0) — gated by (0x4228) bit0 (consumed) and (0x4220) bit0. Derives a slot count
// from (0x421a) [(h+l)>>1, capped 3, +1] into B, then scans the object table at 0x4391 downward (stride
// -0x1f) for an empty pair -> IX. Writes (0x4215) to (ix+6). Depending on (0x4215)==0 it searches one of two
// 10-byte flag rows (0x41fc desc / 0x41f3 asc, value 0x01) for a match, then walks the 0x41xx grid (bit0
// tests, columns -0x10) for a free cell; on a hit it clears the cell, seeds the object struct and tail-jumps
// to the spawn routine 0x08f2. Many early exits (nothing to place). Interior labels 135e/1366/136f/138a/
// 139a/139b/13ab/13bd/13ce inlined.
export function loc_1344(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4228);
  m.step(0x1347, 13); // (0x4228) trigger flag
  regs.rrca();
  m.step(0x1348, 4);
  if (regs.fNC) { m.ret(11); return; } // ret nc -- flag clear
  m.step(0x1349, 5);
  regs.xor(regs.a);
  m.step(0x134a, 4);
  mem.write8(0x4228, regs.a);
  m.step(0x134d, 13); // consume the trigger
  regs.a = mem.read8(0x4220);
  m.step(0x1350, 13);
  regs.rrca();
  m.step(0x1351, 4);
  if (regs.fC) { m.ret(11); return; } // ret c -- (0x4220) bit0 set
  m.step(0x1352, 5);
  regs.hl = mem.read16(0x421a);
  m.step(0x1355, 16);
  regs.a = regs.h;
  m.step(0x1356, 4);
  regs.add(regs.l);
  m.step(0x1357, 4);
  regs.rra();
  m.step(0x1358, 4); // A = (h+l)>>1
  regs.cp(0x04);
  m.step(0x135a, 7);
  if (regs.fC) {
    m.step(0x135e, 12); // jr c,0x135e
  } else {
    m.step(0x135c, 7);
    regs.a = 0x03;
    m.step(0x135e, 7); // cap at 3
  }

  // loc_135e:
  regs.a = regs.inc8(regs.a);
  m.step(0x135f, 4);
  regs.b = regs.a;
  m.step(0x1360, 4); // B = slot count
  regs.hl = 0x4391;
  m.step(0x1363, 10);
  regs.de = 0xffe1;
  m.step(0x1366, 10); // DE = -0x1f (table stride)

  // loc_1366: scan object table for an empty (zero) pair
  let found = false;
  for (;;) {
    regs.a = mem.read8(regs.hl);
    m.step(0x1367, 7);
    regs.hl = (regs.hl - 1) & 0xffff;
    m.step(0x1368, 6);
    regs.or(mem.read8(regs.hl));
    m.step(0x1369, 7);
    if (regs.fZ) { m.step(0x136f, 12); found = true; break; } // empty slot
    m.step(0x136b, 7);
    regs.addHl(regs.de);
    m.step(0x136c, 11);
    if (regs.djnz() !== 0) { m.step(0x1366, 13); continue; }
    m.step(0x136e, 8);
    break;
  }
  if (!found) { m.ret(); return; } // ret 0x136e -- no free slot

  // loc_136f:
  m.push16(regs.hl);
  m.step(0x1370, 11);
  regs.ix = m.pop16();
  m.step(0x1372, 14); // IX = slot address
  regs.a = mem.read8(0x4215);
  m.step(0x1375, 13);
  mem.write8(regs.ix + 0x06, regs.a);
  m.step(0x1378, 19); // (ix+6) = (0x4215)
  regs.and(regs.a);
  m.step(0x1379, 4);

  let state;
  if (regs.fNZ) {
    m.step(0x13ab, 12); // jr nz,0x13ab
    state = "13ab";
  } else {
    m.step(0x137b, 7);
    regs.hl = 0x41fc;
    m.step(0x137e, 10);
    regs.bc = 0x000a;
    m.step(0x1381, 10);
    regs.a = 0x01;
    m.step(0x1383, 7);
    // cpdr @0x1383: A=0x01 searched descending; C kept, PV=BC!=0, N set (no regs.cpdr helper)
    let n = 0;
    for (;;) {
      const a = regs.a;
      const v = mem.read8(regs.hl);
      const res = (a - v) & 0xff;
      const h = (a ^ v ^ res) & 0x10;
      regs.hl = (regs.hl - 1) & 0xffff;
      regs.bc = (regs.bc - 1) & 0xffff;
      const yx = h ? (res - 1) & 0xff : res;
      regs.f =
        (regs.f & 0x01) |
        (res & 0x80 ? 0x80 : 0) |
        (res === 0 ? 0x40 : 0) |
        h |
        (regs.bc !== 0 ? 0x04 : 0) |
        0x02 |
        (((yx << 4) | (yx & 0x0f)) & 0x28);
      n++;
      if (regs.bc === 0 || res === 0) break;
    }
    m.step(0x1385, 21 * (n - 1) + 16);
    if (regs.fNZ) { m.ret(11); return; } // ret nz -- not found
    m.step(0x1386, 5);
    if (regs.fPO) { m.ret(11); return; } // ret po -- exhausted the row
    m.step(0x1387, 5);
    regs.e = 0x3f;
    m.step(0x1389, 7);
    regs.l = regs.inc8(regs.l);
    m.step(0x138a, 4);
    state = "138a";
  }

  for (;;) {
    if (state === "13ab") {
      // loc_13ab:
      regs.hl = 0x41f3;
      m.step(0x13ae, 10);
      regs.bc = 0x000a;
      m.step(0x13b1, 10);
      regs.a = 0x01;
      m.step(0x13b3, 7);
      const n = regs.cpir(mem); // A=0x01 searched ascending
      m.step(0x13b5, 21 * (n - 1) + 16);
      if (regs.fNZ) { m.ret(11); return; } // ret nz
      m.step(0x13b6, 5);
      if (regs.fPO) { m.ret(11); return; } // ret po
      m.step(0x13b7, 5);
      regs.e = 0x41;
      m.step(0x13b9, 7);
      regs.l = regs.dec8(regs.l);
      m.step(0x13ba, 4);
      m.step(0x138a, 10); // jp 0x138a
      state = "138a";
      continue;
    }

    if (state === "138a") {
      // loc_138a:
      regs.a = mem.read8(0x41ef);
      m.step(0x138d, 13);
      regs.rrca();
      m.step(0x138e, 4);
      if (regs.fNC) {
        m.step(0x13bd, 12); // jr nc,0x13bd
        state = "13bd";
        continue;
      }
      m.step(0x1390, 7);
      regs.d = 0x04;
      m.step(0x1392, 7);
      regs.h = 0x41;
      m.step(0x1394, 7);
      regs.a = regs.l;
      m.step(0x1395, 4);
      regs.and(0x0f);
      m.step(0x1397, 7);
      regs.add(0x50);
      m.step(0x1399, 7);
      regs.l = regs.a;
      m.step(0x139a, 4);
      state = "139a";
      continue;
    }

    if (state === "13bd") {
      // loc_13bd:
      regs.d = 0x05;
      m.step(0x13bf, 7);
      regs.h = 0x41;
      m.step(0x13c1, 7);
      regs.a = regs.l;
      m.step(0x13c2, 4);
      regs.and(0x0f);
      m.step(0x13c4, 7);
      regs.add(0x60);
      m.step(0x13c6, 7);
      regs.l = regs.a;
      m.step(0x13c7, 4);
      regs.a = regs.e;
      m.step(0x13c8, 4);
      regs.add(0x10);
      m.step(0x13ca, 7);
      regs.e = regs.a;
      m.step(0x13cb, 4);
      m.step(0x139a, 10); // jp 0x139a
      state = "139a";
      continue;
    }

    // state === "139a"  (loc_139a + inner loc_139b column loop)
    regs.b = regs.d;
    m.step(0x139b, 4);
    let hitCell = false;
    for (;;) {
      // loc_139b:
      regs.bit(0, mem.read8(regs.hl));
      m.step(0x139d, 12);
      if (regs.fNZ) { m.step(0x13ce, 12); hitCell = true; break; } // occupied? jr nz,0x13ce
      m.step(0x139f, 7);
      regs.a = regs.l;
      m.step(0x13a0, 4);
      regs.sub(0x10);
      m.step(0x13a2, 7);
      regs.l = regs.a;
      m.step(0x13a3, 4); // step up one grid row
      if (regs.djnz() !== 0) { m.step(0x139b, 13); continue; }
      m.step(0x13a5, 8);
      break;
    }
    if (hitCell) {
      // loc_13ce: seed the object struct and spawn
      mem.write8(regs.hl, 0x00);
      m.step(0x13d0, 10); // clear the grid cell
      mem.write8(regs.ix + 0x07, regs.l);
      m.step(0x13d3, 19); // (ix+7) = cell
      mem.write8(regs.ix + 0x00, 0x01);
      m.step(0x13d7, 19); // (ix+0) = active
      mem.write8(regs.ix + 0x02, 0x00);
      m.step(0x13db, 19); // (ix+2) = state 0
      regs.d = 0x01;
      m.step(0x13dd, 7);
      regs.e = regs.l;
      m.step(0x13de, 4);
      m.step(0x08f2, 10); // jp 0x08f2 -- spawn (tail)
      return m.call(0x08f2);
    }
    regs.add(regs.e);
    m.step(0x13a6, 4);
    regs.l = regs.a;
    m.step(0x13a7, 4); // advance to next grid column base
    regs.c = regs.dec8(regs.c);
    m.step(0x13a8, 4);
    if (regs.fNZ) { m.step(0x139a, 12); state = "139a"; continue; } // jr nz,0x139a
    m.step(0x13aa, 7);
    m.ret(); // 0x13aa -- no free cell
    return;
  }
}
