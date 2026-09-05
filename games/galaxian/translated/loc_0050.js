// SPDX-License-Identifier: GPL-3.0-only

// loc_0050  (ROM 0x0050-0x0057) — the shift/loop-tail of the 8-bit divide helper (A / D), and the
// `jr c` re-entry target from loc_004c. Complements the borrow (ccf) into this step's quotient bit,
// shifts it into the quotient C (rl c) and shifts the divisor down (rr d), then djnz's back to the
// compare body at loc_004c (a separate routine, NOT in this batch) for the next of B iterations;
// when B hits 0 it rets with the quotient in C.
//   0050  3f        ccf
//   0051  cb 11     rl c
//   0053  cb 1a     rr d
//   0055  10 f5     djnz 0x004c
//   0057  c9        ret
export function loc_0050(m) {
  const { regs } = m;

  regs.ccf();
  m.step(0x0051, 4); // ccf -- carry = complemented borrow (this iteration's quotient bit)

  regs.c = regs.rl(regs.c);
  m.step(0x0053, 8); // rl c -- shift the quotient bit into C (CB rl = 8 T)

  regs.d = regs.rr(regs.d);
  m.step(0x0055, 8); // rr d -- shift the divisor down for the next compare (CB rr = 8 T)

  if (m.regs.djnz() !== 0) {
    m.step(0x004c, 13); // djnz 0x004c (taken) -> loc_004c for the next iteration
    return m.call(0x004c);
  }
  m.step(0x0057, 8); // djnz 0x004c (not taken) -- all iterations done

  m.ret();
}
