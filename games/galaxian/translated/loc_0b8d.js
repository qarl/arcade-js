// SPDX-License-Identifier: GPL-3.0-only

// loc_0b8d  (ROM 0x0b8d-0x0bbd) — per-entry overlap/hit test on the object at IX (bit0 of (ix+0) = active).
// Compares the entry's Y (ix+1) and X (ix+3) against player Y=E and X=(0x4202) with two bounding checks; a
// hit falls into the writer loc_0bb4 which clears the entry (ix+0)=0 and sets (0x4204)=1. Interior branch
// targets loc_0baa and loc_0bb4 inlined.
export function loc_0b8d(m) {
  const { regs, mem } = m;

  regs.bit(0, mem.read8(regs.ix), (regs.ix >> 8) & 0xff);
  m.step(0x0b91, 20); // bit 0,(ix+0) -- active flag

  if (regs.fZ) {
    m.ret(11); // ret z -- inactive entry
    return;
  }
  m.step(0x0b92, 5); // ret z (not taken)

  regs.a = mem.read8((regs.ix + 1) & 0xffff);
  m.step(0x0b95, 19); // A = entry Y (ix+1)

  regs.add(0x1f);
  m.step(0x0b97, 7);

  regs.sub(regs.e);
  m.step(0x0b98, 4); // A = Y+0x1f - playerY(E)

  if (regs.fC) {
    m.step(0x0baa, 12); // jr c,0x0baa (taken)

    // loc_0baa: below-band check
    regs.a = mem.read8(0x4202);
    m.step(0x0bad, 13); // A = player X

    regs.sub(mem.read8((regs.ix + 3) & 0xffff));
    m.step(0x0bb0, 19); // A -= entry X (ix+3)

    regs.add(0x02);
    m.step(0x0bb2, 7);

    regs.cp(regs.e);
    m.step(0x0bb3, 4);

    if (regs.fNC) {
      m.ret(11); // ret nc -- no overlap
      return;
    }
    m.step(0x0bb4, 5); // ret nc (not taken) -> fall into loc_0bb4
  } else {
    m.step(0x0b9a, 7); // jr c (not taken)

    regs.sub(0x09);
    m.step(0x0b9c, 7);

    if (regs.fNC) {
      m.ret(11); // ret nc -- outside Y band
      return;
    }
    m.step(0x0b9d, 5); // ret nc (not taken)

    regs.a = mem.read8(0x4202);
    m.step(0x0ba0, 13); // A = player X

    regs.sub(mem.read8((regs.ix + 3) & 0xffff));
    m.step(0x0ba3, 19); // A -= entry X (ix+3)

    regs.add(regs.e);
    m.step(0x0ba4, 4);

    regs.cp(0x0b);
    m.step(0x0ba6, 7);

    if (regs.fNC) {
      m.ret(11); // ret nc -- no overlap
      return;
    }
    m.step(0x0ba7, 5); // ret nc (not taken)

    m.step(0x0bb4, 10); // jp 0x0bb4
  }

  // loc_0bb4: hit -- clear the entry and raise the hit flag
  mem.write8(regs.ix, 0x00);
  m.step(0x0bb8, 19); // (ix+0) = 0 -- deactivate entry

  regs.a = 0x01;
  m.step(0x0bba, 7);

  mem.write8(0x4204, regs.a);
  m.step(0x0bbd, 13); // (0x4204) = 1 -- hit flag

  m.ret();
}
