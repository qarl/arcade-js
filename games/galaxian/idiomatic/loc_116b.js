// SPDX-License-Identifier: GPL-3.0-only
// Cross-coupled fixed-point rotation: runs ((seed&3)+1) integration steps over two 16-bit
// accumulators held in the object record. Each step adds twice the OTHER accumulator's high byte
// (sign-extended) into this one; a resulting high byte of exactly 128 is treated as overflow and
// reverts that step's high byte to its pre-step value.

// Object-record layout: the step-count seed and two 16-bit accumulators, each as (hi, lo).
const STEP_SEED = 24;
const ACC1_HI = 25, ACC1_LO = 27;
const ACC2_HI = 26, ACC2_LO = 28;

// One step: add sign-extended 2*srcHi into the hi:lo accumulator, with the high-byte==128 overflow guard.
function integrate(hi, lo, srcHi) {
  const doubled = (srcHi << 1) & 0xff;      // low byte of 2*srcHi
  const borrow = srcHi & 0x80 ? 1 : 0;      // 2*srcHi negative -> its high byte is -1
  const sum = doubled + lo;
  const loNext = sum & 0xff;
  const carry = sum > 0xff ? 1 : 0;
  const hiNext = (hi - borrow + carry) & 0xff;
  return { hi: hiNext === 128 ? hi : hiNext, lo: loNext };
}

export function loc_116b(m, obj = m.regs.ix) {
  const { mem8 } = m;

  const steps = (mem8[obj + STEP_SEED] & 3) + 1;

  let hi1 = mem8[obj + ACC1_HI], lo1 = mem8[obj + ACC1_LO];
  let hi2 = mem8[obj + ACC2_HI], lo2 = mem8[obj + ACC2_LO];

  for (let i = 0; i < steps; i++) {
    ({ hi: hi1, lo: lo1 } = integrate(hi1, lo1, hi2));           // acc1 += 2 * acc2 high byte
    ({ hi: hi2, lo: lo2 } = integrate(hi2, lo2, -hi1 & 0xff));   // acc2 -= 2 * acc1 high byte
  }

  mem8[obj + ACC1_HI] = hi1;
  mem8[obj + ACC2_HI] = hi2;
  mem8[obj + ACC1_LO] = lo1;
  mem8[obj + ACC2_LO] = lo2;
}
