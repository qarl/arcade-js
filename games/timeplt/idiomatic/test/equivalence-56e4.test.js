// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_56e4 — memory-equivalent to the frozen oracle at ROM 0x56E4.
 *
 * WHAT IT IS. Two sound requests in a row, each with a code fetched from a byte of the program
 * image, each routed through the permission test at 0x5617 — WHICH IS ALREADY DECOMPILED, so the
 * rewrite calls loc_5617 directly twice and dissolving both transfers belongs to this caller's
 * unit. The second transfer is a tail jump in the image and a plain call here, which is the same
 * thing under memory-equivalence.
 *
 * ★ THE PERMISSION TEST IS WHAT MAKES THIS GATEABLE. Both requests are dropped unless one of two
 *   cells is set, so the crafted arms sweep those two cells against a range of queue lengths: with
 *   both clear NOTHING is written and every twin below is invisible, with either set both codes
 *   land. The test asserts the both-clear case explicitly rather than leaving it to chance, which
 *   is what stops the crafted sweep from silently becoming a sweep of nothing.
 *
 * GATE: strict unit-capture, three replayed sessions at every dispatch, a crafted cross over the
 *   two permission cells and the queue length, and a whole-machine replay. Holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM byte-identical.
 *   2. NOT VACUOUS — a no-op FAILS that same diff at that same dispatch.
 *   3. EXCLUDED — over the crafted cross the registers that move are exactly the scratch set.
 *   4. TAPE REACH / UNIFORM CORPUS — measured dispatch counts per session, and the permission
 *      state each dispatch arrives in. The corpus is TWO dispatches, which is why the crafted
 *      cross is the load-bearing arm here.
 *   5. CORPUS — every dispatch of three sessions.
 *   6. CRAFTED CROSS — the two permission cells x queue lengths, poked identically on both sides,
 *      including the length at which the queue's own count wraps.
 *   7. THE DROPPED CASE — with both permission cells clear, both sides write nothing at all.
 *   8. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame.
 *   9. TEETH — seven twins, each with an exact catch count over the cross and per session.
 *
 * HOLE: the two codes are constants of the image, so no arm here can vary them; what the twins do
 * instead is send the WRONG constants and measure that the cross catches it.
 * HOLE: nothing here reaches the far end of the sound queue — the crafted lengths include the wrap
 * of the count byte, but no session ever presents a long queue.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-56e4.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_56e4 } from "../loc_56e4.js";
import { loc_5617 } from "../loc_5617.js";
import { loc_562a } from "../loc_562a.js";
import { loc_56e4 as oracle } from "../../translated/loc_56e4.js";
import { PLAY_ACTIVE } from "../names.js";
import {
  firstStateDiff,
  unitEquivalence,
  wholeMachineEquivalence,
} from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x56e4;

/** The two cells that between them decide whether a request is heard at all. */
const DEMO_SOUNDS = 0xa9c6;
/** The queue this entry appends to: a count byte, then that many codes. */
const QUEUE_LENGTH = 0xac43;

/** The two program bytes the codes come from, and a third that is neither. */
const FIRST_CODE_CELL = 0x27cb;
const SECOND_CODE_CELL = 0x33a0;
const WRONG_CODE_CELL = 0x27cc;

/**
 * The oracle brackets each of its two transfers with a return address, and the routines it
 * transfers to bracket their own; the rewrite models no stack. Six bytes below the entry pointer
 * are therefore dead scratch, and every arm PINS the window so it cannot quietly widen.
 */
const SCRATCH_BYTES = 6;

const MOVED = ["a", "sp"];
const HELD = ["b", "c", "d", "e", "ix", "iy"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 1600;
const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (const bits of compass) {
    tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const sharedMachine = (overrides) => makeMachine(overrides);
const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const turningMachine = (overrides) => makeMachine(overrides, { tape: turnTape() });

const SESSIONS = [
  ["shared", sharedMachine],
  ["attract", attractMachine],
  ["turning", turningMachine],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { shared: 2, attract: 0, turning: 1 };

// ── the entry, and the comparison ───────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    sharedMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) gate(loc_56e4);
  return entry;
}

/** Every differing byte of two dumps, as {addr, a, b} — the scratch window included. */
function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The window the oracle's own call brackets dirty: the six bytes just below the entry pointer. */
function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

/** A real captured machine with the permission pair and the queue length forced. */
function craft(playing, demo, length) {
  const m = entryState().clone();
  m.mem8[PLAY_ACTIVE] = playing;
  m.mem8[DEMO_SOUNDS] = demo;
  m.mem8[QUEUE_LENGTH] = length;
  return m;
}

const PERMISSIONS = [[0, 0], [255, 0], [0, 255], [255, 255], [1, 0], [0, 1]];
const LENGTHS = [0, 1, 2, 7, 60, 61, 62, 126, 127, 128, 200, 253, 254, 255];

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const [playing, demo] of PERMISSIONS) for (const n of LENGTHS) out.push([playing, demo, n]);
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  let permitted = 0;
  const lengths = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      lengths.add(mm.mem8[QUEUE_LENGTH]);
      if (mm.mem8[PLAY_ACTIVE] !== 0 || mm.mem8[DEMO_SOUNDS] !== 0) permitted++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, permitted, lengths };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, loc_56e4) }));
  return sessionCache;
}

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

const replay = (candidate) =>
  wholeMachineEquivalence(sharedMachine, WHOLE_FRAMES, new Map([[TARGET, hosted(candidate)]]));

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: only the first of the two requests goes out. */
function brokenFirstOnly(m) {
  loc_5617(m, m.mem8[FIRST_CODE_CELL]);
}

/** BUG: only the second goes out. */
function brokenSecondOnly(m) {
  loc_5617(m, m.mem8[SECOND_CODE_CELL]);
}

/** BUG: the two requests go out in the other order, so the queue holds them reversed. */
function brokenOrderSwapped(m) {
  loc_5617(m, m.mem8[SECOND_CODE_CELL]);
  loc_5617(m, m.mem8[FIRST_CODE_CELL]);
}

/** BUG: the first code is fetched one byte along. */
function brokenWrongFirstCode(m) {
  loc_5617(m, m.mem8[WRONG_CODE_CELL]);
  loc_5617(m, m.mem8[SECOND_CODE_CELL]);
}

/** BUG: both requests carry the same code. */
function brokenSameCodeTwice(m) {
  loc_5617(m, m.mem8[FIRST_CODE_CELL]);
  loc_5617(m, m.mem8[FIRST_CODE_CELL]);
}

/** BUG: skips the permission test, so the attract loop makes sounds it must not. */
function brokenBypassesPermission(m) {
  loc_562a(m, m.mem8[FIRST_CODE_CELL]);
  loc_562a(m, m.mem8[SECOND_CODE_CELL]);
}

/** The fourteen crafted entries with both permission cells clear drop everything, so a twin that
 * only changes WHAT is queued is invisible on exactly those; the one that skips the permission
 * test is visible on exactly those and nowhere else. */
const PERMITTED_ENTRIES = 70;
const DROPPED_ENTRIES = 14;

const TWINS = [
  ["no-op", brokenNoOp, PERMITTED_ENTRIES, [2, 0, 1], true],
  ["first-only", brokenFirstOnly, PERMITTED_ENTRIES, [2, 0, 1], true],
  ["second-only", brokenSecondOnly, PERMITTED_ENTRIES, [2, 0, 1], true],
  ["order-swapped", brokenOrderSwapped, PERMITTED_ENTRIES, [2, 0, 1], true],
  ["wrong-first-code", brokenWrongFirstCode, PERMITTED_ENTRIES, [2, 0, 1], true],
  ["same-code-twice", brokenSameCodeTwice, PERMITTED_ENTRIES, [2, 0, 1], true],
  ["bypasses-permission", brokenBypassesPermission, DROPPED_ENTRIES, [0, 0, 0], false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: loc_56e4 == oracle outside the scratch window", { skip }, () => {
  gate(loc_56e4);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  loc_56e4(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: entry queue length ${e.mem8[QUEUE_LENGTH]}, permission ${e.mem8[PLAY_ACTIVE]}/` +
      `${e.mem8[DEMO_SOUNDS]}, sp ${hex4(sp)}; window holds ${all.length} of ${all.length} diffs`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(all.length, SCRATCH_BYTES, "the scratch window stopped being fully dirty, so its " +
    "width is no longer measured by this entry and must be re-derived");
});

test("NOT VACUOUS: a no-op candidate FAILS the RAM diff at the real dispatch", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the RAM diff passed a candidate that does nothing — either the real " +
    "dispatch arrives with both permission cells clear, or RAM is not this gate");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole cross", { skip }, () => {
  const moved = new Set();
  for (const [playing, demo, n] of cross()) {
    const a = craft(playing, demo, n);
    const b = a.clone();
    oracle(a);
    loc_56e4(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k)), MOVED, "the excluded set changed shape");
  for (const k of HELD) assert.ok(!moved.has(k), `a register a caller may rely on moved (${k})`);
});

test("UNIFORM CORPUS: how thin the real corpus is, measured", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.permitted} permitted / lengths ` +
      `[${[...s.lengths].join(",")}]`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const total = seen.reduce((n, s) => n + s.dispatches, 0);
  assert.ok(total > 0, "vacuous: no session reaches the routine at all");
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, RAM identical on each`);
});

test("CRAFTED: every permission x queue-length combination is identical", { skip }, () => {
  for (const [playing, demo, n] of cross()) {
    const d = unitDiff(loc_56e4, craft(playing, demo, n));
    assert.equal(d, null, `permission ${playing}/${demo} length ${n}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${cross().length} entries identical`);
});

test("THE DROPPED CASE: with both permission cells clear, nothing is written", { skip }, () => {
  let checked = 0;
  for (const n of LENGTHS) {
    const before = craft(0, 0, n);
    const after = before.clone();
    loc_56e4(after);
    const d = firstStateDiff(before.dumpState(), after.dumpState(), (o) => before.stateOffsetToAddr(o));
    assert.equal(d, null, `length ${n}: a dropped request still wrote ${show(d)}`);
    checked++;
  }
  // and the tooth on this arm: the twin that skips the test DOES write there.
  const bypass = craft(0, 0, 0);
  const after = bypass.clone();
  brokenBypassesPermission(after);
  assert.notEqual(
    firstStateDiff(bypass.dumpState(), after.dumpState(), (o) => bypass.stateOffsetToAddr(o)),
    null,
    "the permission-skipping twin wrote nothing either, so this arm proves nothing",
  );
  console.log(`  DROPPED: ${checked} lengths write nothing with both cells clear`);
});

test("WHOLE-MACHINE: a driven session is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(loc_56e4);
  assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the override never dispatched");
  assert.equal(w.framesCompared, WHOLE_FRAMES, "the replay ran short of the frames asked for");
  assert.equal(w.equal, true, `forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  console.log(`  WHOLE-MACHINE: ${w.framesCompared} frames, ${w.invocations.get(TARGET)} dispatches, identical`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([p, d, n]) => unitDiff(twin, craft(p, d, n)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, twin));
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
    for (const [i, r] of counts.entries()) {
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} count moved`);
    }
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const w = replay(twin);
    console.log(
      `  TEETH/${label}: whole machine ${w.equal ? "is BLIND, as recorded" : `forks at frame ${w.frame}`}`,
    );
    assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the twin never dispatched");
    assert.equal(w.equal, !wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}
