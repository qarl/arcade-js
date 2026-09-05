// SPDX-License-Identifier: GPL-3.0-only

// loc_1218  (ROM 0x1218-0x1226) — RNG-based scaler: step the LFSR (0x0048), read a random byte (0x003c),
// mask to 0..31, add C and 6. Returns A if the sum stays positive (S clear), else clamps to 0x7f.
export function loc_1218(m) {
  const { regs } = m;

  m.push16(0x121b);
  m.step(0x0048, 17); // call 0x0048 -- advance RNG
  m.call(0x0048);

  m.push16(0x121e);
  m.step(0x003c, 17); // call 0x003c -- A = random byte
  m.call(0x003c);

  regs.and(0x1f);
  m.step(0x1220, 7); // A &= 0x1f

  regs.add(regs.c);
  m.step(0x1221, 4);

  regs.add(0x06);
  m.step(0x1223, 7);

  if (regs.fP) {
    m.ret(11); // ret p (taken) -- sum positive, return it
    return;
  }
  m.step(0x1224, 5); // ret p (not taken)

  regs.a = 0x7f;
  m.step(0x1226, 7); // clamp

  m.ret();
}
