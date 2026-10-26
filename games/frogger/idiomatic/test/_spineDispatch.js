// SPDX-License-Identifier: GPL-3.0-only
/**
 * Shared capture + diff for the foreground/play SPINE DISPATCHERS (0x040b, 0x0d11, 0x230f). Each keeps
 * m.call for the un-lifted dispatch targets, so a crafted post-attract clone drives each branch and RAM
 * is compared minus the stack scratch below the seated SP, [0x87e0,0x8800). STUBS severs the non-returning
 * transfer points (0x0368/0x0567/0x0faf) as empty generators so both sides stop together, while
 * the returning calls (e.g. 0x0942) and the direct-called lifted blitMode3FinalStrip (0x0c17) run for
 * real. SEAM_STUBS instead models the live SP -- coroutine tails hand back an iterator, returning sinks ret.
 */
import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { buildRoutines } from "../../routines.js";

export { romsPresent };


// EQUAL/teeth: the non-returning transfer points severed; returning callees (0x0942, the direct-called
// blitMode3FinalStrip at 0x0c17) run for real.
export const STUBS = buildRoutines();
for (const a of [0x0368, 0x0567, 0x0faf]) STUBS.set(a, function* () {});

// SEAM: live-faithful SP -- coroutine tails hand back an iterator, returning sinks ret.
export const SEAM_STUBS = buildRoutines();
for (const a of [0x0368, 0x0567]) SEAM_STUBS.set(a, function* () {});
for (const a of [0x0faf, 0x0942]) SEAM_STUBS.set(a, (mm) => mm.ret());

let seed = null;
function seedMachine() {
  if (seed) return seed;
  const m = makeMachine();
  m.runFrames(ENTRY_FRAMES);
  if (m.stoppedBy !== null) throw new Error(`the seed run stopped early: ${m.stoppedBy}`);
  seed = m.clone();
  return seed;
}

// A fresh post-attract clone with `routines` wired and SP seated, then mutated by `mut(mem8, machine)`.
export function craft(mut, routines = STUBS) {
  const e = seedMachine().clone();
  e.routines = routines;
  e.regs.sp = STACK_SCRATCH.hi;
  if (mut) mut(e.mem8, e);
  return e;
}

// null == RAM-equivalent (dead stack scratch masked); else a string naming the first differing address.
export function ramDiff(oracle, cand, entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const a = entry.clone(); oracle(a);
  const b = entry.clone(); cand(b);
  const A = a.dumpState(), B = b.dumpState();
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    if (A[i] === B[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return `0x${(addr ?? 0).toString(16)}: ${A[i]} vs ${B[i]}`;
  }
  return null;
}
