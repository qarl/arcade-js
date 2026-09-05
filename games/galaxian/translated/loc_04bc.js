// SPDX-License-Identifier: GPL-3.0-only

// loc_04bc  (ROM 0x04bc-0x04f1) — start/spawn setup. Stores HL into 0x400d, blits the 0x20-byte row template
// @0x051b -> 0x4180, optionally calls loc_0515 on (0x401f) bit0, seeds work-RAM state (0x400a=0, 0x4005=3,
// 0x4006=1, 0x41d1=1), then queues three loc_08f2 requests (DE=0x0604, 0x0400, then E++ =0x0401 via tail-jp).
// Entered by fall-through from loc_0492 and by jp 0x04bc from loc_04f2.
export function loc_04bc(m) {
  const { regs, mem } = m;

  mem.write16(0x400d, regs.hl);
  m.step(0x04bf, 16); // ld (0x400d),hl

  regs.hl = 0x051b;
  m.step(0x04c2, 10); // ld hl,0x051b -- ROM row template (data table)

  regs.de = 0x4180;
  m.step(0x04c5, 10); // ld de,0x4180 -- work-RAM row buffer

  regs.bc = 0x0020;
  m.step(0x04c8, 10); // ld bc,0x0020

  // ldir 0x051b->0x4180, 0x20 bytes
  m.ldirAt(0x04c8, 0x04ca);

  regs.a = mem.read8(0x401f);
  m.step(0x04cd, 13); // ld a,(0x401f)

  regs.rrca();
  m.step(0x04ce, 4); // rrca -- carry = bit0 of (0x401f)

  if (regs.fC) {
    m.push16(0x04d1);
    m.step(0x0515, 17); // call c,0x0515 (taken)
    m.call(0x0515);
  } else {
    m.step(0x04d1, 10); // call c,0x0515 (not taken)
  }

  regs.xor(regs.a);
  m.step(0x04d2, 4); // xor a -- A=0

  mem.write8(0x400a, regs.a);
  m.step(0x04d5, 13); // ld (0x400a),a -- state index <- 0

  regs.a = 0x03;
  m.step(0x04d7, 7); // ld a,0x03

  mem.write8(0x4005, regs.a);
  m.step(0x04da, 13); // ld (0x4005),a

  regs.a = 0x01;
  m.step(0x04dc, 7); // ld a,0x01

  mem.write8(0x4006, regs.a);
  m.step(0x04df, 13); // ld (0x4006),a

  mem.write8(0x41d1, regs.a);
  m.step(0x04e2, 13); // ld (0x41d1),a

  regs.de = 0x0604;
  m.step(0x04e5, 10); // ld de,0x0604 -- request word

  m.push16(0x04e8);
  m.step(0x08f2, 17); // call 0x08f2 -- queue request
  m.call(0x08f2);

  regs.de = 0x0400;
  m.step(0x04eb, 10); // ld de,0x0400

  m.push16(0x04ee);
  m.step(0x08f2, 17); // call 0x08f2 -- queue request
  m.call(0x08f2);

  regs.e = regs.inc8(regs.e);
  m.step(0x04ef, 4); // inc e -- DE = 0x0401

  // jp 0x08f2 -- tail-jump: queue the third request
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}
