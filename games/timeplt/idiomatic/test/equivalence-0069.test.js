// SPDX-License-Identifier: GPL-3.0-only
/**
 * clearWorkRamAndSpriteBank1ThenColdInit — memory-equivalent to the frozen oracle at ROM 0x0069.
 * GATE: crafted-boot-entry; the single boot dispatch replayed with the foreground loop (0x0B93)
 * severed to an empty coroutine so both arms stop at the same handover, comparing work + sprite RAM
 * outside the stack window, the LS259 latches, the sound latch and the watchdog kicks. Priors
 * pre-load the two cleared regions so EQUAL is no accidental match on already-zero RAM.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0069.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { clearWorkRamAndSpriteBank1ThenColdInit as candidate } from "../clearWorkRamAndSpriteBank1ThenColdInit.js";
import { loc_0069 as oracle } from "../../translated/loc_0069.js";
import { clearScreenRamAndVerifyImageThenColdInit } from "../clearScreenRamAndVerifyImageThenColdInit.js";
import { enterVerticalBlankService } from "../enterVerticalBlankService.js";
import manifest from "../../manifest.js";
import { u8 } from "../../../../core/int.js";
import { COMMAND_READ_CURSOR } from "../names.js";
import { Severed, severAtDirectCall } from "./_spineSever.js";

const TARGET = 0x0069;
const DRAIN = 0x0b93; // the foreground loop, severed so both arms stop at the same handover
const DRAIN_NAME = "runCommandRingDrainLoop";
const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;

const WATCHDOG = 0xc200;
const CLEARED = [[0xb411, 0x30], [0xb410, 0x30], [0xa800, 0x800]];
const CHECK_BLOCK = 0x00d8;
const CHECK_BYTES = 0x100;
const GENUINE_TOTAL = 0x87;
const BODY_KICKS = 4;
const PRIORS = [0x00, 0x5a, 0xff];
const EXPECTED_DISPATCHES = 1;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? d.k : "identical");
const outsideStack = (addr) => addr < STACK_LO || addr >= STACK_HI;

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

/** A clone with the two cleared regions pre-loaded to a prior; everything the routine clears overwrites it. */
function craftPrior(prior) {
  const m = entryState().clone();
  for (const [base, n] of CLEARED) for (let i = 0; i < n; i++) m.mem8[(base + i) & 0xffff] = prior;
  return m;
}

/** A clone whose foreground loop records the handover and returns an empty coroutine, reached by the
 *  frozen side's plain call and the rewrite's tail-import handover alike. */
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
    for (let i = 0; i <= 64; i++) if (r.next().done) return;
  } catch (e) {
    if (e instanceof Severed) return undefined;
    throw e;
  }
  throw new Error("still yielding after the budget");
}

/** First RAM byte that differs OUTSIDE the stack window, scanning the whole dump. */
function ramDiff(a, b) {
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (outsideStack(addr)) return addr;
  }
  return null;
}

/** The live-out at the severed handover: RAM outside the stack, the latches, the sound latch, the kicks. */
function diff(cand, machine) {
  const logA = [], logB = [];
  const a = severed(machine, logA);
  const b = severed(machine, logB);
  drive(oracle, a);
  try {
    drive(cand, b);
  } catch (e) {
    return { k: "threw:" + String(e).slice(0, 40) };
  }
  const bad = ramDiff(a, b);
  if (bad !== null) return { k: "ram@" + hex4(bad) };
  for (let i = 0; i < a.io.latch.length; i++) if (a.io.latch[i] !== b.io.latch[i]) return { k: "latch" + i };
  if (a.io.soundData !== b.io.soundData) return { k: "sound" };
  if (a.io.watchdogKicks !== b.io.watchdogKicks) return { k: "kicks" };
  if (logA.length !== logB.length) return { k: "handovers" };
  for (const [i, x] of logA.entries()) if (x.kicks !== logB[i].kicks) return { k: "handover" };
  return null;
}

// ── broken twins: a faithful body with one field flipped ──────────────────────────────────────

function body({ clearHigh = true, clearLow = true, clearWork = true, fillVal = 0,
  dropKick = 0, handoff = true } = {}) {
  return (m) => {
    const { mem8 } = m;
    let n = 0;
    const kick = () => { if (++n !== dropKick) mem8[WATCHDOG] = 0; };
    kick();
    if (clearHigh) for (let i = 0; i < 0x30; i++) mem8[(0xb411 + i) & 0xffff] = fillVal;
    kick();
    if (clearLow) for (let i = 0; i < 0x30; i++) mem8[(0xb410 + i) & 0xffff] = fillVal;
    kick();
    if (clearWork) for (let i = 0; i < 0x800; i++) mem8[(0xa800 + i) & 0xffff] = fillVal;
    kick();
    let total = 0;
    for (let i = 0; i < CHECK_BYTES; i++) total = u8(total + mem8[(CHECK_BLOCK + i) & 0xffff]);
    if (u8(total - GENUINE_TOTAL) !== 0) enterVerticalBlankService(m);
    if (handoff) return clearScreenRamAndVerifyImageThenColdInit(m);
  };
}

const TWINS = [
  ["no-op", () => {}],
  ["faithful-body", body()],
  ["skip-clear-work", body({ clearWork: false })],
  ["wrong-fill", body({ fillVal: 0xff })],
  ["skip-clear-sprite", body({ clearHigh: false, clearLow: false })],
  ["skip-kick", body({ dropKick: 2 })],
  ["no-handoff", body({ handoff: false })],
];

function states() {
  return [entryState(), ...PRIORS.map(craftPrior)];
}

function caughtOver(cand) {
  let caught = 0;
  for (const s of states()) if (diff(cand, s)) caught++;
  return caught;
}

// ── the gate ───────────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: boot reaches the routine once under both tapes, and both replay", { skip }, () => {
  entryState();
  assert.equal(dispatches, EXPECTED_DISPATCHES, "the capture dispatch count moved");
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

test("EQUAL at the boot dispatch: RAM outside stack, latches, sound, kicks and handover", { skip }, () => {
  assert.equal(show(diff(candidate, entryState())), "identical");
  console.log("  EQUAL: the boot entry replays identically to the severed handover");
});

test("WRITES: the body zeroes both cleared regions and kicks the watchdog four times", { skip }, () => {
  const before = craftPrior(0xff);
  const after = before.clone();
  body({ handoff: false })(after); // faithful body, validated by FAITHFUL BODY below, minus the tail
  for (const [base, n] of CLEARED) {
    for (let i = 0; i < n; i++) {
      assert.equal(after.mem8[(base + i) & 0xffff], 0, `${hex4(base + i)} was not cleared from its prior`);
    }
  }
  const kicks = after.io.watchdogKicks - before.io.watchdogKicks;
  assert.equal(kicks, BODY_KICKS, `expected ${BODY_KICKS} body kicks, saw ${kicks}`);
  console.log(`  WRITES: both regions zeroed from 0xff prior, ${kicks} body kicks`);
});

test("FILL PRIORS: the clears overwrite any prior, so EQUAL is no accidental match", { skip }, () => {
  for (const prior of PRIORS) {
    assert.equal(show(diff(candidate, craftPrior(prior))), "identical", `prior ${hex4(prior)} diverged`);
  }
  console.log(`  FILL PRIORS: ${PRIORS.length} priors replayed, candidate identical`);
});

test("FAITHFUL BODY: the reconstructed body matches, so the teeth measure real defects", { skip }, () => {
  assert.equal(caughtOver(body()), 0, "the faithful body diverged; a teeth catch below could be spurious");
  console.log("  FAITHFUL BODY: the reconstructed body is identical on every state");
});

for (const [label, twin] of TWINS) {
  if (label === "faithful-body") continue;
  test(`TEETH: the ${label} twin is caught`, { skip }, () => {
    const caught = caughtOver(twin);
    assert.ok(caught > 0, `every state PASSED the ${label} twin`);
    console.log(`  TEETH/${label}: caught on ${caught}/${states().length} states`);
  });
}
