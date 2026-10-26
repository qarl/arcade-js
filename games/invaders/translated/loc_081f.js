// SPDX-License-Identifier: GPL-3.0-only
// loc_081f  (ROM 0x081f-0x0848) -- main frame-loop body; loc_0849's `jmp 0x081f` returns here to loop. 0x2082==0
// delegates to loc_09ef; the 0x0a59 result gates the extra B=0x04 call, then falls through into loc_0849.
export function loc_081f(m) {
  const { regs, mem } = m;

  for (;;) {
    m.push16(0x0822); m.step(0x1618, 17); m.call(0x1618); // 081f  call 0x1618
    m.push16(0x0825); m.step(0x190a, 17); m.call(0x190a); // 0822  call 0x190a
    m.push16(0x0828); m.step(0x15f3, 17); m.call(0x15f3); // 0825  call 0x15f3
    m.push16(0x082b); m.step(0x0988, 17); m.call(0x0988); // 0828  call 0x0988
    regs.a = mem.read8(0x2082); m.step(0x082e, 13); // 082b  lda 0x2082
    regs.and(regs.a); m.step(0x082f, 4); // 082e  ana a
    if (regs.fZ) { m.step(0x09ef, 10); return m.call(0x09ef); } // 082f  jz 0x09ef
    m.step(0x0832, 10);
    m.push16(0x0835); m.step(0x170e, 17); m.call(0x170e); // 0832  call 0x170e
    m.push16(0x0838); m.step(0x0935, 17); m.call(0x0935); // 0835  call 0x0935
    m.push16(0x083b); m.step(0x08d8, 17); m.call(0x08d8); // 0838  call 0x08d8
    m.push16(0x083e); m.step(0x172c, 17); m.call(0x172c); // 083b  call 0x172c
    m.push16(0x0841); m.step(0x0a59, 17); m.call(0x0a59); // 083e  call 0x0a59
    if (regs.fZ) { m.step(0x0849, 10); m.call(0x0849); continue; } // 0841  jz 0x0849
    m.step(0x0844, 10);
    regs.b = 0x04; m.step(0x0846, 7); // 0844  mvi b,0x04
    m.push16(0x0849); m.step(0x18fa, 17); m.call(0x18fa); // 0846  call 0x18fa
    m.call(0x0849); // fall through into loc_0849
  }
}
