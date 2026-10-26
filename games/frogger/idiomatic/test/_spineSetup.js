// SPDX-License-Identifier: GPL-3.0-only
/**
 * Shared capture + diff for the new-game / continue / next-life spine routines (0x0457, 0x048f,
 * 0x04f3, 0x0547). The cold-start entry m.calls are now dissolved to direct idiomatic calls, so the
 * routines map routes the frozen oracle's 0x0547/0x0557/0x0567 m.calls to the SAME idiomatic cold-start
 * routines (they cancel); the pace tail (0x0368) is still severed with an empty generator so both sides
 * stop at the frame boundary rather than re-entering the main loop forever. The compared state is the
 * routine's own setup plus the shared, cancelling cold-start body. A post-attract seed is cloned, SP
 * seated at 0x8800, and the branch cells poked; live-out is memory-only, so RAM is compared with the
 * dead stack scratch below the seated SP, [0x87e0,0x8800), masked.
 */
import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { buildRoutines } from "../../routines.js";
import { coldStartClearSlotGates } from "../coldStartClearSlotGates.js";
import { coldStartClearAltSlotGates } from "../coldStartClearAltSlotGates.js";
import { coldStartClearPlayRamAndSetMode } from "../coldStartClearPlayRamAndSetMode.js";

export { romsPresent };

const PACE_TAIL = 0x0368;

// The routines map with the pace tail severed and the cold-start chain routed to the idiomatic layer.
export const STUBS = buildRoutines();
STUBS.set(PACE_TAIL, function* () {});
STUBS.set(0x0547, coldStartClearSlotGates);
STUBS.set(0x0557, coldStartClearAltSlotGates);
STUBS.set(0x0567, coldStartClearPlayRamAndSetMode);

let seed = null;
function seedMachine() {
  if (seed) return seed;
  const m = makeMachine();
  m.runFrames(ENTRY_FRAMES);
  if (m.stoppedBy !== null) throw new Error(`the seed run stopped early: ${m.stoppedBy}`);
  seed = m.clone();
  return seed;
}

// A fresh post-attract clone with the sinks severed and SP seated, then mutated by `mut(mem8, machine)`.
export function craft(mut) {
  const e = seedMachine().clone();
  e.routines = STUBS;
  e.regs.sp = STACK_SCRATCH.hi;
  if (mut) mut(e.mem8, e);
  return e;
}

// null == RAM-equivalent (dead stack scratch masked); else a string naming the first differing address.
export function ramDiff(oracle, cand, entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const a = entry.clone(); a.routines = STUBS; oracle(a);
  const b = entry.clone(); b.routines = STUBS; cand(b);
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
