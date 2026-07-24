// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_30fa — hand-optimized rewrite of the translated routine at ROM 0x30FA,
 * proven equal to its oracle by the equivalence harness. A read-and-dispatch tail; it
 * writes no work RAM (only reads the 0x6380 animation index) and names none.
 */

/**
 * sub_30fa -- dispatch on the animation-phase index 0x6380 (clamped) via rst 0x28.  [ROM 0x30FA-0x3113]
 *
 * Four callers. It reads the phase index at 0x6380, clamps it to 5 (values >= 6 become 5),
 * then TAIL-dispatches through the inline rst-0x28 table at 0x3104 to the selected guard
 * (the guard_31xx family). The guard's skip-boolean (the sub_0008 convention) is returned
 * straight up to this routine's caller.
 *
 * The dispatcher is reached through m.call(0x0028) (the registry) with the table base
 * label, matching the translation; the rst pushes 0x3104 (the table base) which sub_0028's
 * `pop hl` consumes.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Four call paths, not all provably mask-cleared.
 */
export function sub_30fa(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6380);
  m.step(0x30fd, 13);
  regs.cp(0x06);
  m.step(0x30ff, 7);
  if (regs.fC) {
    m.step(0x3103, 12); // jr c taken (A < 6) -- 12 T
  } else {
    m.step(0x3101, 7); // jr c not taken -- 7 T
    regs.a = 0x05; // clamp
    m.step(0x3103, 7);
  }

  // rst 0x28 -- TAIL dispatch. Push the table base (0x3104); sub_0028 indexes it and
  // returns the selected guard's skip-boolean, which we pass straight up.
  m.push16(0x3104);
  m.step(0x0028, 11);
  return m.call(0x0028, "0x3104 (sub_30fa dispatch)");
}
