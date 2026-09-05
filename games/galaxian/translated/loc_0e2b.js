// SPDX-License-Identifier: GPL-3.0-only

// loc_0e2b  (ROM 0x0e2b-0x0e6a) — object state handler, slot 3 of the rst-28 table at 0x0ce6 dispatched on
// (ix+0x02). Computes target Y = (ix+0x09)+(ix+0x19) into (ix+0x04) and range-checks it; too-low bumps the
// state (ix+0x02) by +2 (loc_0e64) and too-high by +1 (loc_0e67). Otherwise, gated by 0x4200/0x422b bit0,
// walks the per-object table at (0x4213) looking for a row matching (ix+0x03) -> tail-jump loc_11e0.
export function loc_0e2b(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.incMem8(mem, R(0x03));
  m.step(0x0e2e, 23); // inc (ix+0x03)

  m.push16(0x0e31); m.step(0x116b, 17); m.call(0x116b); // call 0x116b

  regs.a = mem.read8(R(0x09));
  m.step(0x0e34, 19); // ld a,(ix+0x09)

  regs.add(mem.read8(R(0x19)));
  m.step(0x0e37, 19); // add a,(ix+0x19)

  mem.write8(R(0x04), regs.a);
  m.step(0x0e3a, 19); // ld (ix+0x04),a -- target Y

  regs.add(0x07);
  m.step(0x0e3c, 7); // add a,0x07

  regs.cp(0x0e);
  m.step(0x0e3e, 7); // cp 0x0e

  if (regs.fC) {
    // jr c,0x0e64 -- loc_0e64: state += 2 (two inc (ix+0x02)), ret
    m.step(0x0e64, 12);
    regs.incMem8(mem, R(0x02));
    m.step(0x0e67, 23); // inc (ix+0x02)
    regs.incMem8(mem, R(0x02));
    m.step(0x0e6a, 23); // inc (ix+0x02)
    m.ret();
    return;
  }
  m.step(0x0e40, 7); // jr c,0x0e64 (not taken)

  regs.a = mem.read8(R(0x03));
  m.step(0x0e43, 19); // ld a,(ix+0x03)

  regs.add(0x48);
  m.step(0x0e45, 7); // add a,0x48

  if (regs.fC) {
    // jr c,0x0e67 -- loc_0e67: state += 1 (one inc (ix+0x02)), ret
    m.step(0x0e67, 12);
    regs.incMem8(mem, R(0x02));
    m.step(0x0e6a, 23); // inc (ix+0x02)
    m.ret();
    return;
  }
  m.step(0x0e47, 7); // jr c,0x0e67 (not taken)

  regs.a = mem.read8(0x4200);
  m.step(0x0e4a, 13); // ld a,(0x4200) -- global flags

  regs.rrca();
  m.step(0x0e4b, 4); // rrca -- bit0 -> carry

  if (regs.fNC) { m.ret(11); return; } // ret nc
  m.step(0x0e4c, 5); // ret nc (not taken)

  m.push16(0x0e4f); m.step(0x11b0, 17); m.call(0x11b0); // call 0x11b0

  regs.a = mem.read8(0x422b);
  m.step(0x0e52, 13); // ld a,(0x422b)

  regs.rrca();
  m.step(0x0e53, 4); // rrca -- bit0 -> carry

  if (regs.fC) { m.ret(11); return; } // ret c
  m.step(0x0e54, 5); // ret c (not taken)

  regs.hl = mem.read16(0x4213);
  m.step(0x0e57, 16); // ld hl,(0x4213) -- L=count, H=match value

  regs.a = mem.read8(R(0x03));
  m.step(0x0e5a, 19); // ld a,(ix+0x03)

  for (;;) {
    // loc_0e5a:
    regs.cp(regs.h);
    m.step(0x0e5b, 4); // cp h

    if (regs.fZ) { m.step(0x11e0, 10); return m.call(0x11e0); } // jp z,0x11e0 -- row matched
    m.step(0x0e5e, 10); // jp z,0x11e0 (not taken)

    regs.add(0x19);
    m.step(0x0e60, 7); // add a,0x19 -- next row stride

    regs.l = regs.dec8(regs.l);
    m.step(0x0e61, 4); // dec l

    if (regs.fNZ) { m.step(0x0e5a, 12); continue; } // jr nz,0x0e5a
    m.step(0x0e63, 7); // jr nz,0x0e5a (not taken)
    break;
  }

  m.ret();
}
