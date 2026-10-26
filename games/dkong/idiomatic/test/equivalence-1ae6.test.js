// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for walkRightWhileHeld (ROM 0x1AE6) — the RIGHT arm of Mario's on-foot movement
 * dispatch: ask the horizontal position gate for its (D,E) verdict, read the control word once,
 * and spend the frame on a rightward walk step only when E says the right-hand limit is clear
 * AND Right is held; otherwise hand the frame to the left/climb arm at 0x1AF5 (now idiomatic too).
 *
 * WHAT THIS FILE ACTUALLY RUNS (five tests, in order):
 *
 *   0. REACHABILITY — hook 0x1AE6 in a plain 3000-frame attract run (no coin, no pokes) and
 *      count the real dispatches and the arm each one takes. The numbers quoted in this header
 *      are produced by THIS test, not asserted from memory.
 *
 *   1. EQUAL (real dispatches) — replay every captured entry: oracle vs candidate on
 *      RAM − the stack scratch below the entry SP + pc + SP.
 *
 *   2. R IS DEAD ABI — the oracle takes a second argument (dispatchMarioMovement's IX-relative address
 *      helper) that the candidate drops. Run the oracle WITH and WITHOUT it on every captured
 *      entry and require the contract to be identical, which is what licenses the drop.
 *
 *   3. EQUAL (crafted) — the right-limit block. Attract never produces it: MARIO_X stays under
 *      0xEA for every captured dispatch, so E is 0 every time and the E == 1 arm has ZERO real
 *      captures — stated plainly because the "real dispatch" coverage above genuinely does not
 *      reach it. It is covered by poking MARIO_X on a real Right-held base, identically on both
 *      sides: 0xE9 still walks, 0xEA and 0xF0 do not. That pins the threshold, and the
 *      assertions check the ORACLE's own behaviour flips, so the case is not vacuous.
 *
 *   4. TEETH — three deliberately-broken twins the same contract must CATCH:
 *        (a) ignores the right-limit verdict (walks whenever Right is held);
 *        (b) tests control bit 1 (Left) instead of bit 0 (Right);
 *        (c) omits staging the control word in the accumulator before the 0x1AF5 hand-off,
 *            which is the one register genuinely live across that hand-off (walkLeftWhileHeld still
 *            takes both inputs in the register file, so the ABI survives the dissolve).
 *
 * THE STACK CONTRACT. Both oracle arms net exactly one caller return. The candidate is now
 * idiomatic END TO END on BOTH arms — 0x1AF5 landed in the same batch and is direct-called — so
 * neither arm touches the guest stack, and the harness applies one m.ret() to the candidate
 * exactly when its body left SP where it found it, the same rule the live seam uses. (Until
 * 0x1AF5 was wired, the hand-off arm ran the frozen oracle and had already performed that
 * return; the SP-based rule covers both eras without change, which is why it is written as a
 * condition rather than as an arm-specific constant.) The dissolved call bracket
 * and the tail chains churn only STACK_SCRATCH (real dispatches sit at SP ~0x6bea), which the
 * memory-equivalence contract excludes.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1ae6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1ae6 as oracle } from "../../translated/loc_1ae6.js";
import { walkRightWhileHeld } from "../walkRightWhileHeld.js";
import { walkLeftWhileHeld } from "../walkLeftWhileHeld.js";
import { limitMarioHorizontalTravel } from "../limitMarioHorizontalTravel.js";             // ROM 0x241F — used by the teeth twins
import { walkMarioRight } from "../walkMarioRight.js"; // ROM 0x1C8F — used by the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, P1_INPUT, MARIO_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1ae6;
const ATTRACT_FRAMES = 3000;
const CONTROL_RIGHT = 0x01; // P1_INPUT bit 0
const CONTROL_LEFT = 0x02;  // P1_INPUT bit 1
const RIGHT_EDGE_X = 0xea;  // the position gate's far-right threshold (X >= this -> E = 1)

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. `withHelper` supplies the IX-relative address helper the
 *  oracle declares as its second parameter, rebuilt against THIS clone's registers. */
function runOracle(entry, withHelper = true) {
  const c = entry.clone();
  const R = (d) => (c.regs.ix + d) & 0xffff;
  oracle(c, withHelper ? R : undefined);
  return c;
}

/** Run a candidate on a fresh clone. Both arms are idiomatic end to end and leave the guest
 *  stack alone, so the cascade's single net return is modelled here. The SP guard below is kept
 *  rather than simplified: it is what made this harness correct while 0x1AF5 was still the
 *  frozen oracle (which performed the return itself), and it costs nothing now. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const spEntry = c.regs.sp;
  fn(c);
  if (c.regs.sp === spEntry) c.ret();
  return c;
}

/** Compare two finished machines over the contract: RAM − the stack scratch below the entry SP, pc, SP. No registers —
 *  live-out is memory-only. */
function diffMachines(o, c, liveFloor) {
  const diffs = [];
  const ram = firstRamDiff(o, c, liveFloor);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

const contractDiffs = (entry, fn) => diffMachines(runOracle(entry), runCandidate(entry, fn), entry.regs.sp);

// -- capture (memoised — attract is deterministic) ----------------------------

let CAPS = null;
/** Hook 0x1AE6 in a real attract run and clone the machine at each real dispatch. The wrapper
 *  forwards the caller's arguments to the oracle so the host game proceeds undisturbed. */
function getCaps() {
  if (CAPS) return CAPS;
  const caps = [];
  const snapshot = new Map([[TARGET, (mm, ...args) => {
    if (caps.length < 2000) caps.push(mm.clone());
    return oracle(mm, ...args);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(ATTRACT_FRAMES);
  CAPS = caps;
  return caps;
}

/** Which arm an entry takes, from the registry's own translated position gate (non-destructive:
 *  it runs on a throwaway clone). */
function classify(entry) {
  const t = entry.clone();
  t.call(0x241f); // translated sub_241f through the registry
  if (t.regs.e === 1) return "right-limit-blocked";
  return entry.mem.read8(P1_INPUT) & CONTROL_RIGHT ? "walk-right" : "hand-off";
}

/** A real base with Right held, MARIO_X poked to `x` on both sides. */
function craftAtX(base, x) {
  const e = base.clone();
  e.mem.write8(MARIO_X, x);
  return e;
}

// -- teeth twins (the same shape as walkRightWhileHeld, one thing broken) ---------------

function twinBody(m, { ignoreLimit, controlBit, stageAccumulator }) {
  const { regs, mem } = m;
  const positionGate = limitMarioHorizontalTravel(m);
  const control = mem.read8(P1_INPUT);
  const clear = ignoreLimit ? true : positionGate.e !== 1;
  if (clear && (control & controlBit) !== 0) return walkMarioRight(m);
  if (stageAccumulator) regs.a = control;
  return walkLeftWhileHeld(m);
}
// (a) walks right at the far-right edge — the position gate's E verdict is never consulted.
const brokenIgnoresRightLimit = (m) =>
  twinBody(m, { ignoreLimit: true, controlBit: CONTROL_RIGHT, stageAccumulator: true });
// (b) reads the Left bit where the Right bit belongs.
const brokenWrongControlBit = (m) =>
  twinBody(m, { ignoreLimit: false, controlBit: CONTROL_LEFT, stageAccumulator: true });
// (c) hands off without staging the control word walkLeftWhileHeld reads from the accumulator.
const brokenNoAccumulatorStaging = (m) =>
  twinBody(m, { ignoreLimit: false, controlBit: CONTROL_RIGHT, stageAccumulator: false });

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x1AE6 dispatches in plain attract, covering both natural arms", () => {
  const caps = getCaps();
  const counts = {};
  const controls = {};
  let maxX = 0;
  for (const c of caps) {
    const arm = classify(c);
    counts[arm] = (counts[arm] || 0) + 1;
    if (arm === "hand-off") {
      const w = hx(c.mem.read8(P1_INPUT));
      controls[w] = (controls[w] || 0) + 1;
    }
    maxX = Math.max(maxX, c.mem.read8(MARIO_X));
  }
  assert.ok(caps.length >= 1000, `expected a heavily-exercised routine, got ${caps.length} dispatches`);
  assert.ok((counts["walk-right"] || 0) >= 1, "expected real walk-right dispatches");
  assert.ok((counts["hand-off"] || 0) >= 1, "expected real hand-off dispatches");
  // The honest hole, stated as an assertion so it cannot rot silently: attract never reaches the
  // right-limit arm, which is exactly why test 3 crafts it.
  assert.equal(counts["right-limit-blocked"] ?? 0, 0, "attract unexpectedly reached the right-limit arm");
  assert.ok(maxX < RIGHT_EDGE_X, `attract MARIO_X reached ${hx(maxX)}, at/past the 0xEA edge`);
  console.log(
    `  REACHABILITY: ${caps.length} dispatches in ${ATTRACT_FRAMES} attract frames — ` +
      `${JSON.stringify(counts)}; hand-off control words ${JSON.stringify(controls)}; ` +
      `max MARIO_X ${hx(maxX)} (right-limit arm never reached)`,
  );
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): walkRightWhileHeld == oracle on every captured 0x1AE6 entry", () => {
  const caps = getCaps();
  assert.ok(caps.length >= 1, "expected at least one real 0x1AE6 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, walkRightWhileHeld); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP`);
});

// -- 2. the dropped second argument is provably dead --------------------------

test("R IS DEAD ABI: the oracle behaves identically with and without the address helper", () => {
  const caps = getCaps();
  for (const cap of caps) {
    const diffs = diffMachines(runOracle(cap, true), runOracle(cap, false), cap.regs.sp);
    assert.equal(diffs.length, 0, `the helper is live after all: ${diffs.join("; ")}`);
  }
  console.log(`  R DEAD: ${caps.length} dispatches identical with the helper passed and omitted`);
});

// -- 3. EQUAL (the crafted right-limit arm attract never reaches) -------------

test("EQUAL (crafted): the right-limit block at MARIO_X >= 0xEA matches the oracle", () => {
  const caps = getCaps();
  const rightHeld = caps.find((c) => classify(c) === "walk-right");
  assert.ok(rightHeld, "need a real Right-held dispatch as the crafted base");
  const baseX = rightHeld.mem.read8(MARIO_X);

  for (const [x, expectArm] of [[RIGHT_EDGE_X - 1, "walk-right"], [RIGHT_EDGE_X, "right-limit-blocked"], [0xf0, "right-limit-blocked"]]) {
    const entry = craftAtX(rightHeld, x);
    assert.equal(classify(entry), expectArm, `MARIO_X ${hx(x)} should take the ${expectArm} arm`);
    const diffs = contractDiffs(entry, walkRightWhileHeld);
    assert.equal(diffs.length, 0, `crafted MARIO_X=${hx(x)} diverged: ${diffs.join("; ")}`);

    // Non-vacuity: the ORACLE itself must move Mario below the edge and refuse to at/past it,
    // with Right held identically in all three cases.
    const o = runOracle(entry);
    assert.equal(o.mem.read8(P1_INPUT) & CONTROL_RIGHT, CONTROL_RIGHT, "Right must be held throughout");
    if (expectArm === "walk-right") {
      assert.notEqual(o.mem.read8(MARIO_X), x, `oracle should have stepped right from ${hx(x)}`);
    } else {
      assert.equal(o.mem.read8(MARIO_X), x, `oracle must NOT step right at the ${hx(x)} edge`);
    }
  }
  console.log(
    `  EQUAL/crafted: base MARIO_X ${hx(baseX)} poked to 0xe9 (walks), 0xea and 0xf0 (blocked) — ` +
      "candidate matches the oracle on all three",
  );
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: ignored-limit, wrong-control-bit and unstaged-accumulator twins are CAUGHT", () => {
  const caps = getCaps();
  const rightHeld = caps.find((c) => classify(c) === "walk-right");
  assert.ok(rightHeld, "need a real Right-held dispatch");

  // (a) the right-limit verdict ignored — caught on the crafted far-right entry, where the
  //     oracle refuses the step and the twin takes it.
  const atEdge = craftAtX(rightHeld, 0xf0);
  const limitDiffs = contractDiffs(atEdge, brokenIgnoresRightLimit);
  assert.ok(limitDiffs.length > 0, "the ignored-right-limit twin escaped — the gate is worthless");

  // (b) the wrong control bit — caught on real dispatches (Right held but Left clear, or the
  //     reverse). Counted over every capture so this cannot pass on a lucky single entry.
  let bitCaught = 0;
  for (const cap of caps) if (contractDiffs(cap, brokenWrongControlBit).length > 0) bitCaught++;
  assert.ok(bitCaught > 0, "the wrong-control-bit twin escaped — the gate is worthless");

  // (c) the accumulator not staged across the 0x1AF5 hand-off — caught wherever the stale
  //     accumulator makes the oracle's Left test answer differently.
  let stagingCaught = 0;
  let stagingExample = null;
  for (const cap of caps) {
    const d = contractDiffs(cap, brokenNoAccumulatorStaging);
    if (d.length > 0) { stagingCaught++; stagingExample ??= d[0]; }
  }
  assert.ok(stagingCaught > 0, "the unstaged-accumulator twin escaped — the hand-off ABI is untested");

  console.log(
    `  TEETH: ignored-limit caught (${limitDiffs[0]}); wrong-control-bit caught on ` +
      `${bitCaught}/${caps.length} dispatches; unstaged-accumulator caught on ` +
      `${stagingCaught}/${caps.length} dispatches (${stagingExample})`,
  );
});
