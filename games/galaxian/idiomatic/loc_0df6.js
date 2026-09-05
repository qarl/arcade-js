// SPDX-License-Identifier: GPL-3.0-only
// Commits an object to a new horizontal target: stashes the target X into the record, stores the
// signed move delta (current X minus target), zeroes the move accumulator, and bumps the sub-state
// counter to advance the planner one step. Writes only the record.

// Bytes in the move/sub-pixel accumulator, reset at the start of every fresh move.
const ACCUM_BYTES = 3;

// A is the chosen target X; IX is the object record; both default to the live registers.
export function loc_0df6(m, targetX = m.regs.a, record = m.regs.ix) {
  const { mem8 } = m;

  // Stash the chosen target X so subsequent frames steer toward it.
  mem8[record + 0x19] = targetX;

  // Signed move delta = current X minus target X (byte store wraps mod 256).
  mem8[record + 0x09] = mem8[record + 0x04] - targetX;

  // Zero the accumulator so the new move accumulates from scratch.
  for (let i = 0; i < ACCUM_BYTES; i++) mem8[record + 0x1a + i] = 0;

  // Advance the planner's sub-state counter.
  mem8[record + 0x02] = mem8[record + 0x02] + 1;
}
