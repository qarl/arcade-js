// SPDX-License-Identifier: GPL-3.0-only
/**
 * driveDiveAnimByLevel — memory-equivalent to the frozen oracle at ROM 0x27EA.
 * GATE: crafted-entry. Attract never dispatches this dive-animation driver (probe: 0 dispatches over
 * ENTRY_FRAMES; its caller is the in-play collision orchestrator attract does not reach), so a
 * post-boot attract machine is cloned and the dive-phase cell (0x83B7) plus its supporting counters
 * are poked to drive each arm — the below-2 idle arm, the at-or-above-5 arm, and the middle band with
 * the secondary counter both zero (the reset arm runs) and non-zero. Each side runs the real
 * still-frozen callees on its own clone, so the callee writes are part of the compared live-out.
 * Live-out is memory-only, so RAM is compared and registers/SP are not; the dissolved dispatcher
 * issues direct JS calls where the frozen oracle still pushes, so the dead stack scratch
 * below the entry SP is masked from the diff. Teeth: three twins — no-op, a wrong-branch
 * twin (always the idle arm), and a skip-a-call twin (omits the reset call the middle band makes).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { driveDiveAnimByLevel } from "../driveDiveAnimByLevel.js";
import { loc_27ea as oracle } from "../../translated/loc_27ea.js";

const DIVE_PHASE = 0x83b7;
const SECONDARY = 0x8101;
const BUSY_LATCH = 0x814f;
const IDLE_ARM = 0x2873;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

let seed = null;
function seedMachine() {
  if (seed) return seed;
  const m = makeMachine();
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the seed run stopped early: ${m.stoppedBy}`);
  seed = m.clone();
  return seed;
}

// A post-boot machine with the listed cells forced; a valid entry, the driver reads only from RAM.
function craft(pokes) {
  const e = seedMachine().clone();
  for (const [addr, val] of pokes) e.mem8[addr] = val;
  return e;
}

// null == RAM-equivalent (dead stack scratch masked). Memory-only live-out: compare RAM, not
// registers or SP; the dissolved direct calls leave unpushed the stack below the entry SP that the
// oracle scribbles.
function ramDiff(cand, machine) {
  const dead = deadStackBelow(STACK_SCRATCH, machine.regs.sp);
  const a = machine.clone(); oracle(a);
  const b = machine.clone(); cand(b);
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

// middle band, secondary counter 0 -> the reset arm runs then the shared step; writes memory.
const MID = [[DIVE_PHASE, 3], [SECONDARY, 0], [BUSY_LATCH, 0], [0x8145, 0], [0x814e, 0], [0x819b, 5], [0x8150, 0]];
const HIGH = [[DIVE_PHASE, 5], [SECONDARY, 0], [BUSY_LATCH, 0], [0x8145, 0], [0x814e, 0], [0x819b, 5], [0x8150, 0]];
const LOW = [[DIVE_PHASE, 1]];
const MIDB = [[DIVE_PHASE, 3], [SECONDARY, 1], [BUSY_LATCH, 1], [0x8146, 64], [0x8147, 0], [0x8145, 0], [0x814e, 0], [0x8150, 1]];

// broken twins.
function brokenNoOp() {}
function brokenWrongBranch(m) { return m.call(IDLE_ARM); } // always the idle arm, whatever the phase
function brokenSkipReset(m) { // omits the middle band's reset call
  const { mem8 } = m;
  const phase = mem8[DIVE_PHASE];
  if (phase < 2) return m.call(0x2873);
  if (phase >= 5) return m.call(0x2874);
  return m.call(0x27fe);
}

test("EQUAL (crafted): driveDiveAnimByLevel == oracle on every dive-phase arm", { skip }, () => {
  const entries = [MID, HIGH, LOW, MIDB].map(craft);
  assert.ok(entries.length > 0, "vacuous: no crafted entries");
  for (const e of entries) assert.equal(ramDiff(driveDiveAnimByLevel, e), null, "a crafted arm diverged");
  assert.ok(ramDiff(brokenNoOp, craft(MID)), "vacuous: oracle wrote nothing on the middle arm");
  console.log(`  EQUAL: ${entries.length} crafted dive-phase arms, driveDiveAnimByLevel == oracle`);
});

test("TEETH: broken twins are caught on the middle arm", { skip }, () => {
  const e = craft(MID);
  assert.ok(ramDiff(brokenNoOp, e), "the no-op twin escaped");
  assert.ok(ramDiff(brokenWrongBranch, e), "the wrong-branch twin escaped");
  assert.ok(ramDiff(brokenSkipReset, e), "the skip-reset twin escaped");
  console.log("  TEETH: no-op, wrong-branch, skip-reset all caught");
});
