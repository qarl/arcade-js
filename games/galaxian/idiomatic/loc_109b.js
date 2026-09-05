// SPDX-License-Identifier: GPL-3.0-only
// Per-object phase entry: derives a step count n = (~seed)&3 from the record, records n+1 and a
// derived code byte, arms the phase timer, advances the sub-state counter, and clears the ready
// flag -- then re-arms the ready flag only when n is zero.

// Object-record field offsets.
const PHASE_SEED = 7;   // low 2 bits (inverted) give the step count n
const STEP_COUNT = 22;  // <- n+1
const CODE_BYTE = 3;    // <- (n+1)<<4 + CODE_BASE
const PHASE_TIMER = 16; // <- ARM_VALUE
const SUB_STATE = 2;    // advanced by one
const READY_FLAG = 15;  // cleared, then set to ARM_VALUE only when n==0

const CODE_BASE = 140; // added after shifting n+1 into the high nibble
const ARM_VALUE = 24;  // phase timer, and the ready-flag value when n==0

export function loc_109b(m, obj = m.regs.ix) {
  const { mem8 } = m;

  const n = ~mem8[obj + PHASE_SEED] & 3;

  mem8[obj + STEP_COUNT] = n + 1;
  mem8[obj + CODE_BYTE] = ((n + 1) << 4) + CODE_BASE;
  mem8[obj + PHASE_TIMER] = ARM_VALUE;
  mem8[obj + SUB_STATE] = mem8[obj + SUB_STATE] + 1;
  mem8[obj + READY_FLAG] = 0;

  // n != 0 leaves the ready flag clear; n == 0 arms it.
  if (n !== 0) return;
  mem8[obj + READY_FLAG] = ARM_VALUE;
}
