// SPDX-License-Identifier: GPL-3.0-only
// §4 decompile equivalence-test fixtures (galaxian). A shared bounded-attract seed (ENTRY_FRAMES) is cloned
// per test, its stack pointer seated at the reset top, and cells poked by the test; the idiomatic candidate
// and the frozen translated oracle run from that identical entry and their work/VRAM/OBJRAM is compared
// (return-stack window masked). Memory-equivalence only -- never registers/cycles.
import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { buildRoutines } from "../../routines.js";

export { romsPresent };

const STACK_HI = 0x4400; // reset seats SP here; return-stack grows down into 0x43xx
const STACK_LO = 0x43e0;

// Full translated oracle table for the in-isolation runs (leaves reach no born-live sink).
export const STUBS = buildRoutines();

let seed = null;
function seedMachine() {
  if (seed) return seed;
  const m = makeMachine();
  m.runFrames(ENTRY_FRAMES);
  if (m.stoppedBy !== null) throw new Error(`the seed run stopped early: ${m.stoppedBy}`);
  seed = m.clone();
  return seed;
}

// A fresh attract-seed clone with SP seated and cells mutated by `mut(mem8, machine)`.
export function craft(mut) {
  const e = seedMachine().clone();
  e.routines = STUBS;
  e.regs.sp = STACK_HI;
  if (mut) mut(e.mem8, e);
  return e;
}

// Run oracle and candidate from the same entry; return the first non-stack RAM divergence, or null.
export function ramDiff(oracle, cand, entry) {
  const a = entry.clone(); a.routines = STUBS; oracle(a);
  const b = entry.clone(); b.routines = STUBS; cand(b);
  const A = a.dumpState(), B = b.dumpState();
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    if (A[i] === B[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= STACK_LO && addr < STACK_HI) continue;
    return `0x${(addr ?? 0).toString(16)}: ${A[i]} vs ${B[i]}`;
  }
  return null;
}
