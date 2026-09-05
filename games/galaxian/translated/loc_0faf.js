// SPDX-License-Identifier: GPL-3.0-only

// loc_0faf  (ROM 0x0faf-0x101e) — object state handler (dispatch-table entry @0x0cf8). Bumps the frame
// counter (ix+0x03), runs the per-frame sub 0x116b, then per the mode byte (ix+0x17) picks a column
// chase (0x100b/0x1019 adjust ix+0x09) or the pass-through, and finally the shared body at 0x0fbe which
// derives screen-Y into (ix+0x04), guards the edges, and either advances state or scans a row table.
// Inlines the interior labels 0x0fbe, 0x0fec, 0x0ff6, 0x0ffb, 0x1000, 0x1004, 0x100b, 0x1019.
export function loc_0faf(m) {
  const { regs, mem } = m;

  regs.incMem8(mem, regs.ix + 0x03);
  m.step(0x0fb2, 23); // inc (ix+0x03) -- per-object frame counter

  m.push16(0x0fb5);
  m.step(0x116b, 17); // call 0x116b
  m.call(0x116b);

  regs.a = mem.read8(regs.ix + 0x17);
  m.step(0x0fb8, 19); // ld a,(ix+0x17) -- mode selector

  regs.cp(0x04);
  m.step(0x0fba, 7);

  // 0x0fbe is the shared sink; the pre-blocks (0x1004/0x100b/0x1019) route here.
  let at;
  if (regs.fZ) {
    m.step(0x1004, 12); // jr z,0x1004 (mode == 4)
    at = 0x1004;
  } else {
    m.step(0x0fbc, 7);
    if (regs.fNC) {
      m.step(0x100b, 12); // jr nc,0x100b (mode > 4)
      at = 0x100b;
    } else {
      m.step(0x0fbe, 7); // fall through (mode < 4)
      at = 0x0fbe;
    }
  }

  if (at === 0x1004) {
    regs.a = mem.read8(0x425f);
    m.step(0x1007, 13); // ld a,(0x425f)
    regs.and(0x01);
    m.step(0x1009, 7);
    if (regs.fZ) {
      m.step(0x0fbe, 12); // jr z,0x0fbe
      at = 0x0fbe;
    } else {
      m.step(0x100b, 7);
      at = 0x100b;
    }
  }

  if (at === 0x100b) {
    regs.a = mem.read8(0x4202);
    m.step(0x100e, 13); // ld a,(0x4202) -- target column
    regs.sub(mem.read8(regs.ix + 0x09));
    m.step(0x1011, 19); // sub (ix+0x09) -- current column
    if (regs.fC) {
      m.step(0x1019, 12); // jr c,0x1019 -- past target: step down
      regs.decMem8(mem, regs.ix + 0x09);
      m.step(0x101c, 23); // dec (ix+0x09)
      m.step(0x0fbe, 10); // jp 0x0fbe
    } else {
      m.step(0x1013, 7);
      regs.incMem8(mem, regs.ix + 0x09);
      m.step(0x1016, 23); // inc (ix+0x09) -- step up toward target
      m.step(0x0fbe, 10); // jp 0x0fbe
    }
  }

  // loc_0fbe: screen-Y = (ix+0x09)+(ix+0x19) into (ix+0x04), then edge guards + move throttle.
  regs.a = mem.read8(regs.ix + 0x09);
  m.step(0x0fc1, 19); // ld a,(ix+0x09)
  regs.add(mem.read8(regs.ix + 0x19));
  m.step(0x0fc4, 19); // add a,(ix+0x19)
  mem.write8(regs.ix + 0x04, regs.a);
  m.step(0x0fc7, 19); // (ix+0x04) = screen Y
  regs.add(0x07);
  m.step(0x0fc9, 7);
  regs.cp(0x0e);
  m.step(0x0fcb, 7);
  if (regs.fC) {
    m.step(0x0ff6, 12); // jr c,0x0ff6 -- top edge
    mem.write8(regs.ix + 0x02, 0x05);
    m.step(0x0ffa, 19); // (ix+0x02) = state 5
    m.ret();
    return;
  }
  m.step(0x0fcd, 7);

  regs.a = mem.read8(regs.ix + 0x03);
  m.step(0x0fd0, 19); // ld a,(ix+0x03)
  regs.add(0x40);
  m.step(0x0fd2, 7);
  if (regs.fC) {
    m.step(0x0ffb, 12); // jr c,0x0ffb -- counter wrapped
    mem.write8(regs.ix + 0x02, 0x04);
    m.step(0x0fff, 19); // (ix+0x02) = state 4
    m.ret();
    return;
  }
  m.step(0x0fd4, 7);

  regs.decMem8(mem, regs.ix + 0x10);
  m.step(0x0fd7, 23); // dec (ix+0x10) -- move-throttle countdown
  if (regs.fZ) {
    m.step(0x1000, 12); // jr z,0x1000
    regs.decMem8(mem, regs.ix + 0x02);
    m.step(0x1003, 23); // dec (ix+0x02) -- advance state
    m.ret();
    return;
  }
  m.step(0x0fd9, 7);

  regs.a = mem.read8(0x4200);
  m.step(0x0fdc, 13); // ld a,(0x4200)
  regs.rrca();
  m.step(0x0fdd, 4);
  if (regs.fNC) {
    m.ret(11); // ret nc -- (0x4200) bit0 clear
    return;
  }
  m.step(0x0fde, 5);

  m.push16(0x0fe1);
  m.step(0x11b0, 17); // call 0x11b0
  m.call(0x11b0);

  regs.a = mem.read8(0x422b);
  m.step(0x0fe4, 13); // ld a,(0x422b)
  regs.rrca();
  m.step(0x0fe5, 4);
  if (regs.fC) {
    m.ret(11); // ret c -- (0x422b) bit0 set
    return;
  }
  m.step(0x0fe6, 5);

  regs.hl = mem.read16(0x4213);
  m.step(0x0fe9, 16); // HL <- (0x4213): L=row count, H=match value
  regs.a = mem.read8(regs.ix + 0x03);
  m.step(0x0fec, 19); // ld a,(ix+0x03)

  // loc_0fec: scan up to L rows, +0x19 per step, for A == H.
  for (;;) {
    regs.cp(regs.h);
    m.step(0x0fed, 4);
    if (regs.fZ) {
      m.step(0x11e0, 10); // jp z,0x11e0 -- row matched: hand off
      return m.call(0x11e0);
    }
    m.step(0x0ff0, 10);
    regs.add(0x19);
    m.step(0x0ff2, 7);
    regs.l = regs.dec8(regs.l);
    m.step(0x0ff3, 4);
    if (regs.fNZ) {
      m.step(0x0fec, 12); // jr nz,0x0fec
      continue;
    }
    m.step(0x0ff5, 7);
    break;
  }
  m.ret();
}
