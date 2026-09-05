// SPDX-License-Identifier: GPL-3.0-only

// loc_0ddd  (ROM 0x0ddd-0x0e0e) — pick a target position for the actor: compare its X (ix+0x04) against the
// reference at 0x4202, halve the signed gap and bias it, then clamp to a band (0x30..0x70 when the actor is
// left of the reference, 0x90..0xd0 when right). The chosen value lands in A; falls through into loc_0df6,
// which stores it and computes the move delta. Interior labels loc_0df0/loc_0e0f/loc_0e18 folded inline.
export function loc_0ddd(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4202); // reference X (e.g. hero position)
  m.step(0x0de0, 13);

  regs.b = regs.a;
  m.step(0x0de1, 4);

  regs.a = mem.read8((regs.ix + 0x04) & 0xffff); // (ix+0x04) -- this actor's X
  m.step(0x0de4, 19);

  regs.sub(regs.b);
  m.step(0x0de5, 4);

  if (regs.fC) {
    // jr c,0x0e0f (taken) -- actor is left of the reference (negative gap)
    m.step(0x0e0f, 12);

    regs.rra(); // halve the gap (carry from sub feeds bit7)
    m.step(0x0e10, 4);

    regs.sub(0x10);
    m.step(0x0e12, 7);

    regs.cp(0xd0);
    m.step(0x0e14, 7);

    if (regs.fNC) {
      // jr c,0x0e18 (not taken) -> clamp high to 0xd0
      m.step(0x0e16, 7);
      regs.a = 0xd0;
      m.step(0x0e18, 7);
    } else {
      m.step(0x0e18, 12); // jr c,0x0e18 (taken)
    }

    // loc_0e18:
    regs.cp(0x90);
    m.step(0x0e1a, 7);

    if (regs.fNC) {
      // jr nc,0x0df6 (taken) -- in band, deliver A
      m.step(0x0df6, 12);
      return m.call(0x0df6);
    }
    m.step(0x0e1c, 7); // jr nc,0x0df6 (not taken)

    regs.a = 0x90; // clamp low to 0x90
    m.step(0x0e1e, 7);

    m.step(0x0df6, 12); // jr 0x0df6
    return m.call(0x0df6);
  }
  m.step(0x0de7, 7); // jr c,0x0e0f (not taken) -- actor is right of the reference

  regs.rra(); // halve the gap (carry clear -> 0 into bit7)
  m.step(0x0de8, 4);

  regs.add(0x10);
  m.step(0x0dea, 7);

  regs.cp(0x30);
  m.step(0x0dec, 7);

  if (regs.fNC) {
    m.step(0x0df0, 12); // jr nc,0x0df0 (taken)
  } else {
    m.step(0x0dee, 7); // jr nc,0x0df0 (not taken) -> clamp low to 0x30
    regs.a = 0x30;
    m.step(0x0df0, 7);
  }

  // loc_0df0:
  regs.cp(0x70);
  m.step(0x0df2, 7);

  if (regs.fC) {
    // jr c,0x0df6 (taken) -- in band, deliver A
    m.step(0x0df6, 12);
    return m.call(0x0df6);
  }
  m.step(0x0df4, 7); // jr c,0x0df6 (not taken) -> clamp high to 0x70

  regs.a = 0x70;
  m.step(0x0df6, 7);

  return m.call(0x0df6); // fall into loc_0df6
}
