// SPDX-License-Identifier: GPL-3.0-only
/**
 * initColdStartRamThenSeedConfig — memory-equivalent to the frozen oracle at ROM 0x2511. Cold-boot init that paints a
 * work-RAM block, seeds/loads/empties via three dissolved callees kicking the watchdog after each,
 * and tail-jumps into the settings and cold-start chain, which hands off to the foreground loop as a
 * COROUTINE and never returns. Both arms run with that loop (0x0B93) SEVERED to an empty coroutine,
 * so the live-out is the machine at the handover: RAM minus the stack scratch below the entry SP (the
 * frozen side nests calls and leaves dead return bytes there, the rewrite does not), the LS259 latch, the
 * sound latch, the watchdog kicks, and the register/kick pair captured where control reaches the
 * loop. The raw return is that coroutine, not a value to compare. Boot runs the routine once, so the
 * paint region's prior is crafted to prove the repaint is no accidental match.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2511.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { initColdStartRamThenSeedConfig as candidate } from "../initColdStartRamThenSeedConfig.js";
import { loc_2511 as oracle } from "../../translated/loc_2511.js";
import { seedRandomRegister } from "../seedRandomRegister.js";
import { loadDefaultHighScores } from "../loadDefaultHighScores.js";
import { emptyBothDeferredCellLists } from "../emptyBothDeferredCellLists.js";
import { seedGameConfigFromDipSwitches } from "../seedGameConfigFromDipSwitches.js";
import manifest from "../../manifest.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { COMMAND_READ_CURSOR } from "../names.js";
import { Severed, severAtDirectCall } from "./_spineSever.js";

const TARGET = 0x2511;
const DRAIN = 0x0b93; // the foreground loop, severed so both arms stop at the same handover
const DRAIN_NAME = "runCommandRingDrainLoop";
const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;
const STACK_WINDOW = { lo: STACK_LO, hi: STACK_HI };

const FILL_BASE = 0xac00;
const FILL_BYTES = 64;
const WATCHDOG = 0xc200;
const HIGH_SCORE_DEST = 0xab08;
const SOUND_SEED = 0x5a;
const FILL_PRIORS = [0x00, 0x5a, 0xfe, 0xff];
const EXPECTED_DISPATCHES = 1; // boot-time; it runs once under any tape

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? d.k : "identical");
/** Stack scratch below the entry SP `floor` is dead; every cell from the floor up is compared. */
const deadStack = (floor) => deadStackBelow(STACK_WINDOW, floor);

// ── the rig: capture the boot entry, sever the foreground, drive the coroutine ────────────

let entry = null;
let dispatches = 0;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      dispatches++;
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    const frames = m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
    assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  }
  return entry;
}

/** A clone with initColdStartRamThenSeedConfig's paint region pre-loaded to a prior; everything it writes overwrites it. */
function craftFill(prior) {
  const m = entryState().clone();
  for (let i = 0; i < FILL_BYTES; i++) m.mem8[FILL_BASE + i] = prior;
  return m;
}

/** A clone whose foreground loop is a recorder returning an empty iterable, reached by the frozen
 *  side's plain call and the rewrite's transfer alike. */
// The frozen side reaches the loop through the routine map; the rewritten spine enters it by `yield*`
// into a direct import, which _spineSever.js catches at the loop's first act (reading its cursor) from
// inside the loop's own frame. Both record the same hand-over. The accumulator is not part of it: the
// loop loads A from its cursor before anything reads it.
function severed(machine, log) {
  const c = machine.clone();
  const record = (mm) => log.push({ kicks: mm.io.watchdogKicks });
  c.routines = new Map(c.routines);
  c.routines.set(DRAIN, (mm) => {
    record(mm);
    return { [Symbol.iterator]: function* () {} };
  });
  return severAtDirectCall(c, DRAIN_NAME, { reads: [COMMAND_READ_CURSOR] }, record);
}

function drive(fn, m) {
  try {
    const r = fn(m);
    if (!r || typeof r.next !== "function") return r;
    for (let i = 0; i <= 64; i++) {
      const step = r.next();
      if (step.done) return step.value;
    }
  } catch (e) {
    if (e instanceof Severed) return undefined;
    throw e;
  }
  throw new Error("still yielding after the budget");
}

/** The frozen side run to the severed handover, returned for inspection. */
function runOracle(machine) {
  const c = severed(machine, []);
  c.io.soundData = SOUND_SEED;
  drive(oracle, c);
  return c;
}

/** The live-out at the severed handover. */
function diff(cand, machine) {
  const logA = [];
  const logB = [];
  const a = severed(machine, logA);
  const b = severed(machine, logB);
  a.io.soundData = SOUND_SEED;
  b.io.soundData = SOUND_SEED;
  drive(oracle, a);
  try {
    drive(cand, b);
  } catch (e) {
    return { k: "threw:" + String(e).slice(0, 40) };
  }
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off),
    deadStack(machine.regs.sp));
  if (ram) return { k: "ram@" + hex4(ram.addr) };
  for (let i = 0; i < a.io.latch.length; i++) {
    if (a.io.latch[i] !== b.io.latch[i]) return { k: "latch" + i };
  }
  if (a.io.soundData !== b.io.soundData) return { k: "sound" };
  if (a.io.watchdogKicks !== b.io.watchdogKicks) return { k: "kicks" };
  if (logA.length !== logB.length) return { k: "handovers" };
  for (const [i, x] of logA.entries()) {
    if (x.kicks !== logB[i].kicks) return { k: "handover" };
  }
  return null;
}

// ── broken twins: the rewrite with one deliberate defect each ────────────────────────────────

function twin({ fill = true, fillVal = 0xff, seed = true, scores = true, lists = true, handoff = true }) {
  return (m) => {
    const { mem8, regs } = m;
    if (fill) for (let i = 0; i < FILL_BYTES; i++) mem8[FILL_BASE + i] = fillVal;
    if (seed) seedRandomRegister(m);
    mem8[WATCHDOG] = regs.a;
    if (scores) loadDefaultHighScores(m);
    mem8[WATCHDOG] = regs.a;
    if (lists) emptyBothDeferredCellLists(m);
    mem8[WATCHDOG] = regs.a;
    if (handoff) return seedGameConfigFromDipSwitches(m);
    return undefined;
  };
}

const TWINS = [
  ["no-op", () => {}],
  ["skip-fill", twin({ fill: false })],
  ["wrong-fill-value", twin({ fillVal: 0xfe })],
  ["skip-seed", twin({ seed: false })],
  ["skip-high-scores", twin({ scores: false })],
  ["skip-empty-lists", twin({ lists: false })],
  ["skip-handoff", twin({ handoff: false })],
];

/** The boot entry plus the paint region pre-loaded to each prior. */
function states() {
  return [entryState(), ...FILL_PRIORS.map(craftFill)];
}

function caughtOver(cand) {
  let caught = 0;
  for (const s of states()) if (diff(cand, s)) caught++;
  return caught;
}

// ── the gate ─────────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: boot reaches the routine once under both tapes, and both replay", { skip }, () => {
  entryState();
  assert.equal(dispatches, EXPECTED_DISPATCHES, "the dispatch count moved");
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    let seen = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => {
      seen++;
      assert.equal(show(diff(candidate, mm)), "identical", `${label}: a real dispatch diverged`);
      return oracle(mm);
    }]]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    assert.equal(seen, EXPECTED_DISPATCHES, `${label} dispatch count moved`);
    console.log(`  DISPATCHED: ${label} — ${seen} dispatch, replayed identical`);
  }
});

test("EQUAL at the real dispatch: RAM minus stack scratch below the entry SP, latch, sound, kicks and handover", { skip }, () => {
  assert.equal(show(diff(candidate, entryState())), "identical");
  console.log("  EQUAL: the boot entry replays identically to the severed handover");
});

test("WRITES: the routine really paints the block and loads the scores, not a no-change", { skip }, () => {
  const before = entryState();
  const after = runOracle(entryState());
  for (let i = 0; i < FILL_BYTES; i++) {
    assert.equal(after.mem8[FILL_BASE + i], 0xff, `fill byte ${i} is not all-ones`);
  }
  let scoresMoved = 0;
  for (let i = 0; i < 40; i++) {
    if (after.mem8[HIGH_SCORE_DEST + i] !== before.mem8[HIGH_SCORE_DEST + i]) scoresMoved++;
  }
  // ★ vacuity: if nothing changed, EQUAL would pass a rewrite that did nothing.
  assert.ok(scoresMoved > 0, "the high-score block never moved; the comparison agrees on a no-change");
  console.log(`  WRITES: ${FILL_BYTES} fill bytes all-ones, ${scoresMoved} high-score bytes moved`);
});

test("FILL PRIORS: the paint overwrites any prior, so EQUAL is no accidental match", { skip }, () => {
  for (const prior of FILL_PRIORS) {
    assert.equal(show(diff(candidate, craftFill(prior))), "identical", `prior ${hex4(prior)} diverged`);
    const after = runOracle(craftFill(prior));
    for (let i = 0; i < FILL_BYTES; i++) {
      assert.equal(after.mem8[FILL_BASE + i], 0xff, `prior ${hex4(prior)}: byte ${i} not repainted`);
    }
  }
  console.log(`  FILL PRIORS: ${FILL_PRIORS.length} priors repainted all-ones, candidate identical`);
});

for (const [label, brokenTwin] of TWINS) {
  test(`TEETH: the ${label} twin is caught`, { skip }, () => {
    const caught = caughtOver(brokenTwin);
    assert.ok(caught > 0, `every state PASSED the ${label} twin`);
    console.log(`  TEETH/${label}: caught on ${caught}/${states().length} states`);
  });
}
