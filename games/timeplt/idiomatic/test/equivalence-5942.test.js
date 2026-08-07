// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_5942 — memory-equivalent to the frozen oracle at ROM 0x5942.
 *
 * WHAT IT IS. Two instructions: load a fixed table pointer, then tail-jump to the velocity lookup
 * at 0x596E, which IS ALREADY DECOMPILED — so the rewrite calls velocityForHeading directly with
 * the table as an argument, and dissolving that transfer belongs to this caller's unit. The whole
 * content of the entry is the CHOICE OF TABLE, plus the fact that a pointer the caller was
 * already holding is discarded.
 *
 * ★ RAM ALONE CANNOT GATE THIS ROUTINE. The lookup writes no memory, so a RAM diff reports
 *   identical for the correct arm, for every twin, and for a bare no-op. The BLIND arm asserts
 *   exactly that, and it is the written justification for gating on RAM *plus* the declared
 *   live-out {b, c, d, e} everywhere else.
 *
 * ★ THIS ENTRY IS THE BOTTOM RUNG. Six velocity tables sit in the image whose peak magnitudes
 *   climb in even steps — 0x59D7, 0x5C00, 0x5E00, 0x2530, 0x2E3E, 0x08FA — and a shim like this
 *   one picks a rung of that ladder. There is no rung below this one, so the twins hand the lookup
 *   the rung ABOVE, the far end of the ladder, and three pointers that are no table at all; the
 *   RUNG LADDER arm then re-derives, from the table bytes themselves, why a neighbour cannot hide.
 *
 * GATE: strict unit-capture, three replayed sessions at every dispatch, an exhaustive sweep of the
 *   whole heading space, and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. CONTRACT — unitEquivalence at the first real dispatch: RAM identical. `equal` is not
 *      asserted; it folds in the register diff this contract deliberately drops.
 *   2. BLIND — that same call passes a no-op. If it ever fails, the routine writes memory after
 *      all and every arm leaning on the live-out has to be re-derived.
 *   3. TAPE REACH — measured, not assumed: only the undriven attract session reaches this entry,
 *      and it does so twice. The driven tapes reach it zero times.
 *   4. LIVE-OUT — the pair, asserted at every dispatch and over the whole crafted sweep.
 *   5. UNIFORM CORPUS — the two real dispatches present ONE record base and two headings between
 *      them, which is why the crafted sweep, not the corpus, is the load-bearing arm here: one of
 *      the nine twins is invisible on BOTH real dispatches and the per-twin counts say so.
 *   6. EXCLUDED — over the whole sweep the registers that move are exactly the scratch set.
 *   7. EXHAUSTIVE — all 256 headings crafted off the real entry.
 *   8. RUNG LADDER — the six peak magnitudes, read out of memory, and the headings at which a
 *      neighbouring rung agrees on ONE sample but never on the perpendicular pair.
 *   9. WHOLE-MACHINE — attract with the rewrite wired, diffed every frame.
 *  10. TEETH — nine twins, each declaring the exact headings it survives, its catch count in each
 *      session, and whether the whole machine forks.
 *
 * The replay needs a shim: the host engine is cycle-driven and the one caller arrives by a call
 * that ends in the lookup's own return, so a candidate charging no T-states and not taking that
 * return would move the interrupt and leak two stack bytes per dispatch. The total is measured off
 * a clone rather than predicted, which makes it exact by construction; what the arm then tests is
 * memory, not timing.
 *
 * HOLE: ONE object slot and ONE heading in the whole corpus. Every crafted arm varies the heading
 * read out of that record, never the record it is read from.
 * HOLE: the whole-machine arm can only see a twin that changes what the CALLER writes. It is not
 * the arm that holds this entry to its table; the unit arms are.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5942.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { loc_5942 } from "../loc_5942.js";
import { velocityForHeading } from "../velocityForHeading.js";
import { loc_5942 as oracle } from "../../translated/loc_5942.js";
import {
  firstStateDiff,
  unitEquivalence,
  wholeMachineEquivalence,
} from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x5942;

/** The one table this entry exists to select, and the whole ladder it sits at the bottom of. */
const VELOCITY_TABLE = 0x59d7;
const LADDER = [0x59d7, 0x5c00, 0x5e00, 0x2530, 0x2e3e, 0x08fa];
const RUNG_ABOVE = LADDER[1];
const PEAKS = [206, 231, 256, 281, 306, 331];

/** Malformed pointers: one entry along, one BYTE along so each sample straddles two entries. */
const OFF_BY_ONE_ENTRY = VELOCITY_TABLE + 2;
const MISALIGNED = VELOCITY_TABLE + 1;

const HEADING_CELL = 2;
const HEADINGS = 256;
const QUARTER = HEADINGS / 4;

/** Headings at which a mispointed or mirrored lookup happens to give the same pair. Measured. */
const OFF_BY_ONE_SURVIVORS = [127, 191];
const QUARTER_REVERSED_SURVIVORS = [0, 127, 128, 255];

const LIVE_OUT = ["b", "c", "d", "e"];
const MOVED = ["a", "f", "h", "l", "sp"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 1600;
const ENTRY_BUDGET = 1600;
const RET_TSTATES = 10;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const everyHeading = Array.from({ length: HEADINGS }, (_unused, h) => h);

const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const drivenMachine = (overrides) => makeMachine(overrides);

const SESSIONS = [["attract", attractMachine], ["driven", drivenMachine]];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { attract: 2, driven: 0 };

const headingOf = (m) => m.mem8[(m.regs.ix + HEADING_CELL) & 0xffff];
const sampleAt = (m, table, index) => m.mem16[table + 2 * (index & (HEADINGS - 1))];
const signedAt = (m, table, index) => {
  const v = sampleAt(m, table, index);
  return v & 0x8000 ? v - 0x10000 : v;
};

// ── the entry, and the comparison ───────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    attractMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_BUDGET },
  );
}

function entryState() {
  if (entry === null) gate(loc_5942);
  return entry;
}

/** Oracle vs candidate on clones of one machine: RAM first, then the declared pair. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  if (ram) return ram;
  for (const k of LIVE_OUT) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** A real captured machine nudged onto one heading, which is the crafted-entry idiom. */
function selector(heading) {
  const m = entryState().clone();
  m.mem8[(m.regs.ix + HEADING_CELL) & 0xffff] = heading;
  return m;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  const headings = new Set();
  const bases = new Set();
  const pointers = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      headings.add(headingOf(mm));
      bases.add(mm.regs.ix);
      pointers.add(mm.regs.hl);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, headings, bases, pointers };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, loc_5942) }));
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
  wholeMachineEquivalence(attractMachine, WHOLE_FRAMES, new Map([[TARGET, hosted(candidate)]]));

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: uses the pointer the caller happened to be holding instead of overriding it. */
function brokenForwardsPointer(m) {
  velocityForHeading(m, m.regs.hl);
}

/** BUG: the pointer is off by a single entry, so every heading reads its neighbour. */
function brokenOffByOneEntry(m) {
  velocityForHeading(m, OFF_BY_ONE_ENTRY);
}

/** BUG: the pointer is off by one BYTE, so each sample straddles two entries. */
function brokenMisaligned(m) {
  velocityForHeading(m, MISALIGNED);
}

/** BUG: hands back the same sample twice instead of a perpendicular pair. */
function brokenNotPerpendicular(m) {
  const { regs } = m;
  regs.de = sampleAt(m, VELOCITY_TABLE, headingOf(m));
  regs.bc = regs.de;
}

/** BUG: takes the partner a quarter turn the OTHER way, which mirrors one axis. */
function brokenQuarterReversed(m) {
  const { regs } = m;
  regs.de = sampleAt(m, VELOCITY_TABLE, headingOf(m));
  regs.bc = sampleAt(m, VELOCITY_TABLE, headingOf(m) + QUARTER);
}

/** BUG: the two halves of the answer change places. */
function brokenPairSwapped(m) {
  const { regs } = m;
  const first = sampleAt(m, VELOCITY_TABLE, headingOf(m));
  regs.de = sampleAt(m, VELOCITY_TABLE, headingOf(m) - QUARTER);
  regs.bc = first;
}

const TWINS = [
  ["no-op", brokenNoOp, [], [2, 0], true],
  ["forwards-the-pointer", brokenForwardsPointer, [], [2, 0], true],
  ["rung-above", (m) => velocityForHeading(m, RUNG_ABOVE), [], [2, 0], true],
  ["top-rung", (m) => velocityForHeading(m, LADDER[5]), [], [2, 0], true],
  ["off-by-one-entry", brokenOffByOneEntry, OFF_BY_ONE_SURVIVORS, [2, 0], true],
  ["misaligned-by-a-byte", brokenMisaligned, [], [2, 0], true],
  ["not-perpendicular", brokenNotPerpendicular, [], [2, 0], true],
  ["quarter-reversed", brokenQuarterReversed, QUARTER_REVERSED_SURVIVORS, [0, 0], false],
  ["pair-swapped", brokenPairSwapped, [], [2, 0], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: unitEquivalence at the first real dispatch, RAM identical", { skip }, () => {
  const r = gate(loc_5942);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  const e = entryState();
  console.log(
    `  CONTRACT: entry heading ${headingOf(e)} base ${hex4(e.regs.ix)} holding ${hex4(e.regs.hl)}; ` +
      "RAM identical",
  );
});

test("BLIND: RAM alone passes a no-op, which is why the pair is gated too", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  brokenNoOp(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(
    ram,
    null,
    "RAM caught a candidate that does nothing, so this routine DOES write memory and every arm " +
      "below that leans on the declared pair has to be re-derived",
  );
  assert.notEqual(unitDiff(brokenNoOp, entryState()), null, "the pair must catch the no-op");
  console.log("  BLIND: RAM sees nothing; the declared pair catches the empty candidate");
});

test("TAPE REACH: only the undriven session reaches this entry", { skip }, () => {
  const seen = sessions();
  console.log(`  TAPE REACH (measured): ${seen.map((s) => `${s.label} ${s.dispatches}`).join(", ")}`);
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  assert.ok(seen[0].dispatches > 0, "vacuous: no session reaches the routine at all");
});

test("UNIFORM CORPUS: one base, one heading, one incoming pointer", { skip }, () => {
  const seen = sessions().filter((s) => s.dispatches > 0);
  const bases = new Set(seen.flatMap((s) => [...s.bases]));
  const headings = new Set(seen.flatMap((s) => [...s.headings]));
  const pointers = new Set(seen.flatMap((s) => [...s.pointers]));
  console.log(
    `  UNIFORM CORPUS (measured): bases ${[...bases].map(hex4).join(",")}; headings ` +
      `${[...headings].join(",")}; incoming pointers ${[...pointers].map(hex4).join(",")}`,
  );
  assert.equal(bases.size, 1, "the number of record bases real play presents moved");
  assert.equal(pointers.size, 2, "the number of incoming pointers real play presents moved");
  assert.equal(headings.size, 2, "the number of headings the corpus presents moved, so the " +
    "crafted sweep is covering a different hole from the one this file records");
  for (const table of LADDER) {
    assert.ok(!pointers.has(table), `a caller now arrives holding ${hex4(table)}, so forwarding hides`);
  }
});

test("CORPUS: every dispatch of every session replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, RAM and the pair identical on each`);
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole sweep", { skip }, () => {
  const moved = new Set();
  for (const heading of everyHeading) {
    const a = selector(heading);
    const b = a.clone();
    oracle(a);
    loc_5942(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
    for (const k of LIVE_OUT) assert.equal(a.regs[k], b.regs[k], `live-out ${k} at heading ${heading}`);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} and pc`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k)), MOVED, "the excluded set changed shape");
});

test("EXHAUSTIVE: all 256 headings crafted off the real entry are identical", { skip }, () => {
  for (const heading of everyHeading) {
    const d = unitDiff(loc_5942, selector(heading));
    assert.equal(d, null, `heading ${heading}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${HEADINGS} headings identical on RAM and on the pair`);
});

test("RUNG LADDER: the neighbour agrees on one sample and never on the pair", { skip }, () => {
  const m = entryState();
  const peaks = LADDER.map((t) => Math.max(...everyHeading.map((h) => Math.abs(signedAt(m, t, h)))));
  console.log(`  RUNG LADDER (measured): peaks ${peaks.join("/")}`);
  assert.deepEqual(peaks, PEAKS, "the ladder of peak magnitudes moved");
  const oneAgrees = everyHeading.filter(
    (h) => sampleAt(m, VELOCITY_TABLE, h) === sampleAt(m, RUNG_ABOVE, h),
  );
  const bothAgree = oneAgrees.filter(
    (h) => sampleAt(m, VELOCITY_TABLE, h - QUARTER) === sampleAt(m, RUNG_ABOVE, h - QUARTER),
  );
  assert.deepEqual(bothAgree, [], "the neighbouring rung matches on BOTH samples somewhere, so " +
    "those headings cannot discriminate it and the twin's survivor list must record them");
  console.log(`  RUNG LADDER: the neighbour matches one sample on ${oneAgrees.length} headings, the pair on none`);
});

test("WHOLE-MACHINE: attract is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(loc_5942);
  assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the override never dispatched");
  assert.equal(w.framesCompared, WHOLE_FRAMES, "the replay ran short of the frames asked for");
  assert.equal(w.equal, true, `forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  console.log(`  WHOLE-MACHINE: ${w.framesCompared} frames, ${w.invocations.get(TARGET)} dispatches, identical`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, survives, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on EXACTLY the declared headings`, { skip }, () => {
    const missed = everyHeading.filter((h) => unitDiff(twin, selector(h)) === null);
    console.log(
      `  TEETH/${label}: caught on ${HEADINGS - missed.length} of ${HEADINGS} headings; ` +
        `survivors [${missed.join(",")}]`,
    );
    assert.deepEqual(missed, survives, `${label}: wrong survivor set over the heading sweep`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, twin));
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
    for (const [i, r] of counts.entries()) {
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} catch count moved`);
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
