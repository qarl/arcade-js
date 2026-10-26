// SPDX-License-Identifier: GPL-3.0-only
/**
 * moveLaneObjectsAndCarryFrog — memory-equivalent to the frozen oracle at ROM 0x14B7.
 *
 * GATE: captured-entry + crafted variants. The lane-object mover runs only during GAMEPLAY (attract
 * never dispatches 0x14B7), so a coin/start tape drives the translated machine into play and a hook on
 * 0x14B7 clones the real top-level entry state on the first few gameplay frames, then throws to unwind
 * before the recursive translated engine's NMI re-entrancy overflows the JS stack. Each captured clone
 * has its frame/NMI boundaries at Infinity, so running the mover on it is bounded (no nested NMI).
 * The real entries populate the 11 lanes' control bytes, phase countdowns, sprite runs and lead
 * sprites from live play; crafted variants derived from a real base drive the frog-carry, ride-off,
 * mid-loop-entry, phase-countdown and 256-byte-run paths the stationary-frog captures do not reach.
 * Live-out is memory-only: the oracle's only stack use is one net `ret` (a pop, no write), the rewrite
 * is a for-loop, so RAM is byte-identical; the dead stack below the entry SP is masked anyway.
 * Teeth: three broken RAM twins, plus a positive control that the carry path actually fires.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { moveLaneObjectsAndCarryFrog } from "../moveLaneObjectsAndCarryFrog.js";
import { loc_14b7 as oracle } from "../../translated/loc_14b7.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const INDEX = 0x80ff, FROG_X = 0x8044, FROG_Y = 0x8047, HOLD = 0x8004;
const COIN_FRAME = 150, START_FRAME = 210, PLAY_FLAG = 0x83fe;

class StopCapture extends Error {}

// Drive attract -> gameplay and clone the first few real top-level (index 0) entries at 0x14B7.
let cached = null;
function realEntries() {
  if (cached) return cached;
  const caps = [];
  const overrides = new Map();
  overrides.set(0x14b7, function hook(m) {
    if (m.mem8[INDEX] === 0 && m.mem8[PLAY_FLAG] === 1) {
      caps.push(m.clone());
      if (caps.length >= 5) throw new StopCapture();
    }
    return oracle(m);
  });
  const m = makeMachine(overrides);
  m.inputTape = [
    { port: 0xe000, bits: 0x80, frame: COIN_FRAME, dur: 8 },
    { port: 0xe002, bits: 0x80, frame: START_FRAME, dur: 8 },
  ];
  try {
    m.runFrames(700);
  } catch (e) {
    if (!(e instanceof StopCapture)) throw e;
  }
  cached = caps;
  return caps;
}

// null == RAM-equivalent. Memory-only live-out: compare RAM, mask the dead stack scratch.
function ramDiff(cand, entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  cand(b);
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

// Crafted variants from a real base — each pokes RAM to reach a path the stationary-frog captures do
// not: frog riding in a lane (carry), riding off an edge, a mid-loop start index, phase countdowns,
// a bit4 "phase set" control, and a zero run count (the 256-byte djnz wrap).
const CRAFTS = [
  ["right-carry-low", (mm) => (mm[FROG_Y] = 0x52)],
  ["right-carry-high", (mm) => (mm[FROG_Y] = 0x5d)],
  ["left-carry-low", (mm) => (mm[FROG_Y] = 0x42)],
  ["left-carry-high", (mm) => (mm[FROG_Y] = 0x4d)],
  ["ride-off-right", (mm) => ((mm[FROG_Y] = 0x52), (mm[FROG_X] = 0xfe))],
  ["ride-off-left", (mm) => ((mm[FROG_Y] = 0x42), (mm[FROG_X] = 0x02))],
  ["mid-loop-7", (mm) => (mm[INDEX] = 7)],
  ["mid-loop-10", (mm) => (mm[INDEX] = 10)],
  ["phase-do-move", (mm) => (mm[0x81a6] = 1)],
  ["phase-countdown", (mm) => (mm[0x81a6] = 5)],
  ["control-idle", (mm) => (mm[0x819b] = 0x00)],
  ["control-bit4-set", (mm) => (mm[0x819b] = 0x25)],
  ["run-count-zero", (mm) => (mm[0x8100] = 0x00)],
  ["row-below-band", (mm) => (mm[FROG_Y] = 0x2f)],
  ["row-top-of-band", (mm) => (mm[FROG_Y] = 0x72)],
];

function craft(base, mut) {
  const e = base.clone();
  mut(e.mem8);
  return e;
}

test("EQUAL: moveLaneObjectsAndCarryFrog == oracle on real gameplay entries", { skip }, () => {
  const entries = realEntries();
  assert.ok(entries.length > 0, "vacuous: no gameplay entry was captured (never reached play?)");
  for (const e of entries) {
    assert.equal(e.mem8[PLAY_FLAG], 1, "a captured entry was not in gameplay");
    assert.equal(ramDiff(moveLaneObjectsAndCarryFrog, e), null, "a real entry diverged");
  }
  console.log(`  EQUAL: ${entries.length} real gameplay entries, rewrite == oracle`);
});

test("EQUAL: crafted variants reach the carry/ride-off/phase/wrap paths", { skip }, () => {
  const base = realEntries()[0];
  for (const [label, mut] of CRAFTS) {
    assert.equal(ramDiff(moveLaneObjectsAndCarryFrog, craft(base, mut)), null, `crafted "${label}" diverged`);
  }
  // Positive control: the carry path is live, not a vacuous match — the oracle moves the frog X.
  const carry = craft(base, (mm) => (mm[FROG_Y] = 0x52));
  const before = carry.mem8[FROG_X];
  const after = carry.clone();
  oracle(after);
  assert.notEqual(after.mem8[FROG_X], before, "the carry entry never moved the frog: path not exercised");
  console.log(`  EQUAL: ${CRAFTS.length} crafted variants; carry control moved frog X ${before}->${after.mem8[FROG_X]}`);
});

test("TEETH: broken twins are caught on a real entry", { skip }, () => {
  const base = realEntries()[0];
  const noOp = () => {};
  const wrongShift = (m) => {
    moveLaneObjectsAndCarryFrog(m);
    m.mem8[0x800c] = (m.mem8[0x800c] + 2) & 0xff; // one extra pixel on object 0's lead sprite
  };
  const skipAdvance = (m) => {
    moveLaneObjectsAndCarryFrog(m);
    m.mem8[INDEX] = 5; // leaves the walk index unwrapped
  };
  assert.ok(ramDiff(noOp, base), "the no-op twin escaped");
  assert.ok(ramDiff(wrongShift, base), "the wrong-shift twin escaped");
  assert.ok(ramDiff(skipAdvance, base), "the skip-advance twin escaped");
  console.log("  TEETH: no-op, wrong-shift, skip-advance all caught");
});
