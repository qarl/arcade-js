// SPDX-License-Identifier: GPL-3.0-only

// loc_0156  (ROM 0x0156-0x0163) — a state handler: the (0x400a)-indexed rst-0x28 dispatcher. Runs 0x090d
// and 0x098e, pushes 0x03d7 as the continuation the dispatched sub-state routine rets to, then rst-0x28
// dispatches on (0x400a) through the inline word table at 0x0164. Reached as rst-0x28 target @0x00d0.
export function loc_0156(m) {
  const { regs, mem } = m;

  m.push16(0x0159);
  m.step(0x090d, 17);
  m.call(0x090d);

  m.push16(0x015c);
  m.step(0x098e, 17);
  m.call(0x098e);

  regs.hl = 0x03d7;
  m.step(0x015f, 10);

  m.push16(regs.hl);
  m.step(0x0160, 11); // push 0x03d7 -- the dispatched sub-state routine rets here

  regs.a = mem.read8(0x400a);
  m.step(0x0163, 13); // A = sub-state index

  // rst 0x28 -- dispatch on A via the inline word table at 0x0164 {0x018c,0x01be,0x01c6,0x01e1,0x0218,...}
  m.push16(0x0164);
  m.step(0x0028, 11);
  m.call(0x0028);

  // the dispatched routine returned to 0x03d7 -- continue there
  return m.call(0x03d7);
}
