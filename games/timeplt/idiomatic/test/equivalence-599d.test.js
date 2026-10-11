// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_599d — memory-equivalent to the frozen oracle at ROM 0x599D.
 *
 * WHAT IT IS. One instruction and a fall-through: read the heading byte out of the object record
 * the caller is pointing at, then continue into the DOUBLED velocity lookup at 0x59A0, which IS
 * ALREADY DECOMPILED — so the rewrite calls doubledVelocityForHeading directly and dissolving that
 * transfer belongs to this caller's unit. What separates this entry from the sibling shims at
 * 0x59C5/0x59CB/0x59D1 is two things at once: the heading comes off a RECORD rather than in as a
 * value, and the table pointer is FORWARDED rather than replaced, so the pace is the caller's.
 *
 * ★ RAM ALONE CANNOT GATE THIS ROUTINE. The lookup writes no memory, so a RAM diff reports
 *   identical for the correct arm, for every twin, and for a bare no-op. The BLIND arm asserts
 *   exactly that, and it is the written justification for gating on RAM *plus* the declared
 *   live-out {b, c, d, e} everywhere else.
 *
 * ★ THE LIVE-OUT IS DERIVED FROM THE ORACLE, AND FROM ITS EXIT SUCCESSORS, NOT FROM THE MODULE.
 *   The oracle ends by taking the return of the routine it falls into, so its successor is the
 *   caller's own slot. There are two such successors in the image and they agree: each banks four
 *   registers into four consecutive bytes of the record the entry was handed, and neither reads
 *   anything else the entry leaves — one reloads the pair it just stored from the stack on the very
 *   next instruction, the other reloads the accumulator out of memory before using it. The SEAT arm
 *   below shows the oracle landing on the first of those two successors, so the derivation is
 *   watched and not only read. Empirically the LIVE-OUT arm forces a, f and hl hostile AFTER every
 *   real dispatch of a whole session and the run stays bit-identical, while forcing either half of
 *   the pair alone forks it — so the pair is live, the rest is not, and both directions are proved.
 *
 * ★ THE CORPUS IS THIN AND UNIFORM IN THE TWO WAYS THAT MATTER, AND BOTH ARE MEASURED HERE RATHER
 *   THAN ASSUMED. Every real dispatch arrives holding the SAME table, and at every real dispatch
 *   the accumulator ALREADY HOLDS the byte the record holds, because the one caller that reaches
 *   this entry writes the heading into the record from the accumulator immediately before calling.
 *   Two twins are therefore invisible to real play — one that pins the table it always sees, one
 *   that reads the accumulator instead of the record — and they are recorded as caught by zero real
 *   dispatches rather than quietly counted as coverage. The crafted cross is what holds them.
 *
 * ★ EVERY ZERO IN THIS FILE IS PAIRED WITH A POSITIVE CONTROL IN THE SAME ARM. Three tapes reach
 *   this entry zero times; the SAME three tapes with one cell held in the once-per-frame service
 *   reach it. The dead registers leave no trace; the live pair forks the run. The pinned-table twin
 *   is caught by no real dispatch; it is caught 1792 times in the cross.
 *
 * GATE: strict unit-capture, six replayed real sessions at every dispatch, an exhaustive cross of
 *   every table this entry can be handed against the whole heading space, and a whole-machine
 *   replay. What it exercises, holes stated:
 *
 *   1. CONTRACT — unitEquivalence at the first real dispatch: RAM identical. `equal` is not
 *      asserted; it folds in the register diff this contract deliberately drops.
 *   2. BLIND — that same call passes a no-op, which is why the pair is gated too.
 *   3. SEAT — the rewrite leaves the stack pointer exactly where it found it, over the whole cross.
 *      That is the shape the dispatch seam measures, asserted here as a property of the rewrite.
 *   4. TAPE REACH — measured, with the A/B that makes each zero mean something.
 *   5. UNIFORM CORPUS — one record base, one table, a handful of headings.
 *   6. THE ACCUMULATOR SHADOWS THE RECORD — measured at every real dispatch.
 *   7. CORPUS — every dispatch of every session, not a deduplicated sample.
 *   8. EXCLUDED — a CEILING over the whole cross: no register outside the scratch set moves.
 *   9. EXHAUSTIVE CROSS — eight pointers by all 256 headings, RAM and the pair.
 *  10. LIVE-OUT — the hostile-register instrument, with its controls in both directions.
 *  11. POINTER DISCRIMINATION — read out of memory: no two of the eight pointers agree on BOTH
 *      halves of the pair at any heading, which is why a pinned-pointer twin cannot hide.
 *  12. WHOLE-MACHINE — a held session with the rewrite wired, diffed every frame.
 *  13. TEETH — fifteen twins, each with its exact cross catch count, its exact per-session count,
 *      and its whole-machine verdict; the two that no real dispatch catches say so.
 *
 * The whole-machine replay needs a shim: the host engine is cycle-driven and the way in is a call
 * that ends in the lookup's own return, so a candidate charging no T-states and not taking that
 * return would move the vblank interrupt and leak two stack bytes per dispatch. The total is
 * measured off a clone per dispatch rather than predicted, which makes it exact by construction.
 *
 * HOLE: ONE record base across the whole corpus, and every crafted arm varies the heading inside
 * that record or the pointer beside it, never the record it is read from. Nothing here speaks for
 * a second slot.
 * HOLE: the second real way in — the era-indexed dispatch that would hand this entry the 0x5C00
 * table — is reached by NO session in this file. That table appears here only as a crafted pointer,
 * so nothing here shows the game itself taking that path.
 * HOLE: the pair is compared as four register bytes. Which of the two is the screen's across and
 * which its down is not settled anywhere in this file.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-599d.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { buildRoutines } from "../../routines.js";
import { loc_599d } from "../loc_599d.js";
import { velocityForHeading } from "../velocityForHeading.js";
import { doubledVelocityForHeading } from "../doubledVelocityForHeading.js";
import { ERA_INDEX } from "../names.js";
import { loc_599d as oracle } from "../../translated/loc_599d.js";
import {
  firstStateDiff,
  unitEquivalence,
  wholeMachineEquivalence,
} from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u16 } from "../../../../core/int.js";

const TARGET = 0x599d;

/** The six velocity tables in the image, and two pointers that are no table at all. */
const LADDER = [0x59d7, 0x5c00, 0x5e00, 0x2530, 0x2e3e, 0x08fa];
const JUNK_POINTERS = [0x0000, 0xa800];
const POINTERS = [...LADDER, ...JUNK_POINTERS];
const PEAKS = [206, 231, 256, 281, 306, 331];

/** The one table every real dispatch presents, and the one the unreached second way in supplies. */
const CORPUS_TABLE = LADDER[0];
const OTHER_REAL_TABLE = LADDER[1];

const RECORD_HEADING_CELL = 2;
const HEADINGS = 256;
const QUARTER = HEADINGS / 4;

const LIVE_OUT = ["b", "c", "d", "e"];
/** Registers the contract drops. The arm asserts CONTAINMENT in this set, never equality to it. */
const SCRATCH = ["a", "f", "h", "l", "sp"];
/** Left behind and claimed dead; the live-out arm forces each hostile and looks for a trace. */
const LEFT_BEHIND = ["a", "f", "hl"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 2000;
const ENTRY_BUDGET = 1600;
const RET_TSTATES = 10;

/** The era whose handler set reaches this entry. Held in the frame service, never at the entry. */
const HELD_ERA = 3;
const FRAME_SERVICE = 0x0038;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const everyHeading = Array.from({ length: HEADINGS }, (_unused, h) => h);

/** The coin-then-start tape with the stick walked round the compass, trigger held. */
function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (let i = 0; i < 60; i++) {
    tape.push({ frame, port: IN1, bits: compass[i % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const frameService = buildRoutines().get(FRAME_SERVICE);

/** Any tape, with one cell held in the once-per-frame service and nothing else touched. */
function eraHeld(tape) {
  return (overrides) => {
    const merged = new Map(overrides ?? []);
    const inner = merged.get(FRAME_SERVICE) ?? frameService;
    merged.set(FRAME_SERVICE, (mm, ...args) => {
      mm.mem8[ERA_INDEX] = HELD_ERA;
      return inner(mm, ...args);
    });
    return makeMachine(merged, { tape });
  };
}

const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const sharedMachine = (overrides) => makeMachine(overrides, {});
const turningMachine = (overrides) => makeMachine(overrides, { tape: turnTape() });
const eraAttract = eraHeld([]);
const eraShared = eraHeld(undefined);
const eraTurning = eraHeld(turnTape());

/**
 * Three tapes and the SAME three with one cell held. The pairing is the instrument: a zero on the
 * left means something only because its partner on the right is not zero.
 */
const SESSIONS = [
  ["attract", attractMachine],
  ["shared", sharedMachine],
  ["turning", turningMachine],
  ["era-attract", eraAttract],
  ["era-shared", eraShared],
  ["era-turning", eraTurning],
];
const AB_PAIRS = [["attract", "era-attract"], ["shared", "era-shared"], ["turning", "era-turning"]];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = {
  attract: 0, shared: 0, turning: 0, "era-attract": 3, "era-shared": 9, "era-turning": 5,
};

const headingOf = (m) => m.mem8[(m.regs.ix + RECORD_HEADING_CELL) & 0xffff];
const sampleAt = (m, table, index) => m.mem16[table + 2 * (index & (HEADINGS - 1))];
const signedAt = (m, table, index) => {
  const v = sampleAt(m, table, index);
  return v & 0x8000 ? v - 0x10000 : v;
};
const doubledSampleAt = (m, table, index) => u16(2 * sampleAt(m, table, index));

// ── the entry, and the comparison ───────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    eraTurning,
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
  if (entry === null) gate(loc_599d);
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

/** A real captured machine with one heading written into the record it points at. */
function selector(heading) {
  const m = entryState().clone();
  m.mem8[(m.regs.ix + RECORD_HEADING_CELL) & 0xffff] = heading;
  return m;
}

/** The same, with the pointer the caller is carrying forced too. */
function withPointer(heading, pointer) {
  const m = selector(heading);
  m.regs.hl = pointer;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const pointer of POINTERS) for (const heading of everyHeading) out.push([heading, pointer]);
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  let shadowed = 0;
  const headings = new Set();
  const pointers = new Set();
  const bases = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      headings.add(headingOf(mm));
      pointers.add(mm.regs.hl);
      bases.add(mm.regs.ix);
      if (mm.regs.a === headingOf(mm)) shadowed++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, shadowed, headings, pointers, bases };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, loc_599d) }));
  return sessionCache;
}
const sessionNamed = (label) => sessions().find((s) => s.label === label);

// ── the whole-session hostile-register instrument ───────────────────────────────────────

/** Two held sessions diffed frame by frame: clean, and one mutated at every dispatch. */
function hostileSession(mutate) {
  const base = eraTurning();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let dispatches = 0;
  const host = eraTurning(new Map([[TARGET, (mm) => {
    dispatches += 1;
    return mutate(mm);
  }]]));
  const hostFrames = host.runFrames(CORPUS_FRAMES);
  const addrs = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = baseFrames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) addrs.add(base.stateOffsetToAddr(o));
  }
  return { cells: addrs.size, frames: n, dispatches, stopped: base.stoppedBy ?? host.stoppedBy };
}

const forceAfter = (keys) => (mm) => {
  const v = oracle(mm);
  for (const k of keys) mm.regs[k] = k.length === 1 ? 0x5a : 0x5a5a;
  return v;
};

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
  wholeMachineEquivalence(eraTurning, WHOLE_FRAMES, new Map([[TARGET, hosted(candidate)]]));

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: pins the table every real dispatch happens to present instead of forwarding one. */
function brokenPinsCorpusTable(m) {
  doubledVelocityForHeading(m, CORPUS_TABLE, headingOf(m));
}

/** BUG: pins the table the other way in supplies, so the reachable path runs at the wrong pace. */
function brokenPinsOtherRealTable(m) {
  doubledVelocityForHeading(m, OTHER_REAL_TABLE, headingOf(m));
}

/** BUG: takes the heading as a value the way the sibling shims do, ignoring the record. */
function brokenHeadingFromAccumulator(m) {
  doubledVelocityForHeading(m, m.regs.hl);
}

/** BUG: the heading is read one cell too far along the record. */
function brokenHeadingFromNextCell(m) {
  doubledVelocityForHeading(m, m.regs.hl, m.mem8[(m.regs.ix + RECORD_HEADING_CELL + 1) & 0xffff]);
}

/** BUG: the heading is read one cell too early. */
function brokenHeadingFromPreviousCell(m) {
  doubledVelocityForHeading(m, m.regs.hl, m.mem8[(m.regs.ix + RECORD_HEADING_CELL - 1) & 0xffff]);
}

/** BUG: the record is addressed through the other index register. */
function brokenHeadingOffOtherBase(m) {
  doubledVelocityForHeading(m, m.regs.hl, m.mem8[(m.regs.iy + RECORD_HEADING_CELL) & 0xffff]);
}

/** BUG: the undoubled lookup — the near-identical body this entry does NOT fall into. */
function brokenNotDoubled(m) {
  velocityForHeading(m, m.regs.hl, headingOf(m));
}

/** BUG: doubles twice, which is the same mistake in the other direction. */
function brokenQuadrupled(m) {
  const { regs } = m;
  velocityForHeading(m, regs.hl, headingOf(m));
  regs.de = u16(4 * regs.de);
  regs.bc = u16(4 * regs.bc);
}

/** BUG: doubles one half of the pair and leaves the other at its table length. */
function brokenDoubledFirstOnly(m) {
  const { regs } = m;
  velocityForHeading(m, regs.hl, headingOf(m));
  regs.de = u16(2 * regs.de);
}

/** BUG: the pointer is off by a single entry, so every heading reads its neighbour. */
function brokenOffByOneEntry(m) {
  doubledVelocityForHeading(m, u16(m.regs.hl + 2), headingOf(m));
}

/** BUG: the pointer is off by one BYTE, so each sample straddles two entries. */
function brokenMisaligned(m) {
  doubledVelocityForHeading(m, u16(m.regs.hl + 1), headingOf(m));
}

/** BUG: hands back the same sample twice instead of a perpendicular pair. */
function brokenNotPerpendicular(m) {
  const { regs } = m;
  regs.de = doubledSampleAt(m, regs.hl, headingOf(m));
  regs.bc = regs.de;
}

/** BUG: takes the partner a quarter turn the OTHER way, which mirrors one axis. */
function brokenQuarterReversed(m) {
  const { regs } = m;
  const heading = headingOf(m);
  const table = regs.hl;
  regs.de = doubledSampleAt(m, table, heading);
  regs.bc = doubledSampleAt(m, table, heading + QUARTER);
}

/** BUG: the two halves of the answer change places. */
function brokenPairSwapped(m) {
  const { regs } = m;
  const heading = headingOf(m);
  const table = regs.hl;
  const first = doubledSampleAt(m, table, heading);
  regs.de = doubledSampleAt(m, table, heading - QUARTER);
  regs.bc = first;
}

/**
 * label, twin, its cross catch count, its per-session catch counts in SESSIONS order, and whether
 * the whole machine forks on it. All measured. A twin no real dispatch catches carries zeroes and
 * a false, which records the blindness instead of hiding it.
 */
const TWINS = [
  ["no-op", brokenNoOp, 2048, [0, 0, 0, 3, 9, 5], true],
  ["pins-the-corpus-table", brokenPinsCorpusTable, 1792, [0, 0, 0, 0, 0, 0], false],
  ["pins-the-other-real-table", brokenPinsOtherRealTable, 1792, [0, 0, 0, 3, 9, 5], true],
  ["heading-from-the-accumulator", brokenHeadingFromAccumulator, 2040, [0, 0, 0, 0, 0, 0], false],
  ["heading-from-the-next-cell", brokenHeadingFromNextCell, 2040, [0, 0, 0, 3, 9, 5], true],
  ["heading-from-the-previous-cell", brokenHeadingFromPreviousCell, 2038, [0, 0, 0, 3, 9, 5], true],
  ["heading-off-the-other-base", brokenHeadingOffOtherBase, 2034, [0, 0, 0, 3, 9, 5], true],
  ["not-doubled", brokenNotDoubled, 1913, [0, 0, 0, 3, 9, 5], true],
  ["quadrupled", brokenQuadrupled, 1913, [0, 0, 0, 3, 9, 5], true],
  ["doubled-first-only", brokenDoubledFirstOnly, 1838, [0, 0, 0, 3, 9, 5], true],
  ["off-by-one-entry", brokenOffByOneEntry, 1952, [0, 0, 0, 3, 9, 5], true],
  ["misaligned-by-a-byte", brokenMisaligned, 1928, [0, 0, 0, 3, 9, 5], true],
  ["not-perpendicular", brokenNotPerpendicular, 1913, [0, 0, 0, 3, 9, 5], true],
  ["quarter-reversed", brokenQuarterReversed, 1884, [0, 0, 0, 3, 9, 5], true],
  ["pair-swapped", brokenPairSwapped, 1913, [0, 0, 0, 3, 9, 5], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: unitEquivalence at the first real dispatch, RAM identical", { skip }, () => {
  const r = gate(loc_599d);
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

test("SEAT: the rewrite leaves the stack pointer where it found it, over the cross", { skip }, () => {
  for (const [heading, pointer] of cross()) {
    const m = withPointer(heading, pointer);
    const seat = m.regs.sp;
    loc_599d(m);
    assert.equal(m.regs.sp, seat, `the rewrite moved the stack pointer at heading ${heading}`);
  }
  const watched = entryState().clone();
  const seat = watched.regs.sp;
  oracle(watched);
  console.log(
    `  SEAT: rewrite holds ${hex4(seat)} across ${cross().length} entries; the oracle takes the ` +
      `return in the routine it falls into and lands on ${hex4(watched.pc)}`,
  );
  assert.equal(watched.regs.sp, u16(seat + 2), "the oracle stopped consuming the caller's slot, so " +
    "the seam that supplies the omitted return for the rewrite is no longer describing this entry");
});

test("TAPE REACH: three tapes never reach this entry; one held cell turns each around", { skip }, () => {
  const seen = sessions();
  console.log(`  TAPE REACH (measured): ${seen.map((s) => `${s.label} ${s.dispatches}`).join(", ")}`);
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  for (const [bare, held] of AB_PAIRS) {
    assert.equal(sessionNamed(bare).dispatches, 0, `${bare} started reaching this entry on its own`);
    assert.ok(
      sessionNamed(held).dispatches > 0,
      `${held} reaches this entry zero times too, so the zero at ${bare} is a rig that can reach ` +
        "nothing rather than a tape that does not come here, and it proves nothing",
    );
  }
});

test("UNIFORM CORPUS: one base, one table, a handful of headings", { skip }, () => {
  const seen = sessions().filter((s) => s.dispatches > 0);
  const bases = new Set(seen.flatMap((s) => [...s.bases]));
  const pointers = new Set(seen.flatMap((s) => [...s.pointers]));
  const headings = new Set(seen.flatMap((s) => [...s.headings]));
  console.log(
    `  UNIFORM CORPUS (measured): bases ${[...bases].map(hex4).join(",")}; pointers ` +
      `${[...pointers].map(hex4).join(",")}; ${headings.size} distinct headings`,
  );
  assert.equal(bases.size, 1, "the number of record bases real play presents moved");
  assert.deepEqual([...pointers], [CORPUS_TABLE], "real play now presents a second table, so the " +
    "twin that pins the corpus table is no longer blind and its recorded zeroes are stale");
  assert.ok(headings.size < HEADINGS, "the corpus now covers the whole circle, so the crafted " +
    "cross is no longer what covers it");
});

test("THE ACCUMULATOR SHADOWS THE RECORD at every real dispatch", { skip }, () => {
  const seen = sessions().filter((s) => s.dispatches > 0);
  const total = seen.reduce((n, s) => n + s.dispatches, 0);
  const shadowed = seen.reduce((n, s) => n + s.shadowed, 0);
  console.log(`  SHADOWED (measured): ${shadowed} of ${total} real dispatches`);
  assert.ok(total > 0, "vacuous: no session reaches the routine at all");
  assert.equal(shadowed, total, "a real dispatch now arrives with the accumulator holding " +
    "something other than the record's heading, so real play CAN tell the two apart and the " +
    "heading-from-the-accumulator twin's recorded zeroes are stale");
});

test("CORPUS: every dispatch of every session replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  assert.ok(total > 0, "vacuous: no session reaches the routine at all");
  console.log(`  CORPUS: ${total} real dispatches, RAM and the pair identical on each`);
});

test("EXCLUDED, deliberately: nothing outside the scratch set moves, over the cross", { skip }, () => {
  const moved = new Set();
  for (const [heading, pointer] of cross()) {
    const a = withPointer(heading, pointer);
    const b = a.clone();
    oracle(a);
    const pair = loc_599d(b);
    // The rewrite RETURNS the pair its idiomatic callers take; it must be the oracle's DE, BC.
    assert.deepEqual(pair, [a.regs.de, a.regs.bc], `returned pair at heading ${heading}`);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    for (const k of LIVE_OUT) assert.equal(a.regs[k], b.regs[k], `live-out ${k} at heading ${heading}`);
  }
  const measured = REG_FIELDS.filter((k) => moved.has(k));
  console.log(`  EXCLUDED (measured): ${measured.join(", ")}`);
  // SCRATCH is a CEILING, not a set the rewrite is required to fill. deepEqual against it would
  // demand the divergence and go RED on a rewrite that became register-exact -- a gate that
  // requires a wart refuses the fix. Only a register OUTSIDE the ceiling fails here.
  assert.deepEqual(measured.filter((k) => !SCRATCH.includes(k)), [], "a register outside the " +
    "scratch set moved, so the contract this file gates on no longer describes the rewrite");
});

test("EXHAUSTIVE CROSS: every pointer by every heading is identical", { skip }, () => {
  for (const [heading, pointer] of cross()) {
    const d = unitDiff(loc_599d, withPointer(heading, pointer));
    assert.equal(d, null, `pointer ${hex4(pointer)} heading ${heading}: ${show(d)}`);
  }
  console.log(
    `  EXHAUSTIVE CROSS: ${POINTERS.length} pointers x ${HEADINGS} headings identical on RAM ` +
      "and on the pair",
  );
});

test("LIVE-OUT: the dead registers steer nothing and the pair steers the game", { skip }, () => {
  const dead = hostileSession(forceAfter(LEFT_BEHIND));
  assert.equal(dead.stopped, null, `a run stopped early (${dead.stopped})`);
  assert.equal(dead.frames, CORPUS_FRAMES, `compared ${dead.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(dead.dispatches > 0, "vacuous: the instrument never reached the routine");
  assert.equal(dead.cells, 0, "a hostile value in a register the rewrite does not promise reached " +
    "game memory: some caller CONSUMES it and the live-out declaration is wrong");
  const first = hostileSession(forceAfter(["de"]));
  const second = hostileSession(forceAfter(["bc"]));
  assert.ok(first.cells > 0, "forcing half the declared pair changed nothing, so the instrument " +
    "does not reach this routine and the arm above proves nothing");
  assert.ok(second.cells > 0, "forcing the other half changed nothing, so the instrument does " +
    "not reach this routine and the arm above proves nothing");
  console.log(
    `  LIVE-OUT: ${LEFT_BEHIND.join(", ")} forced hostile after all ${dead.dispatches} dispatches, ` +
      `no trace; the pair's halves fork ${first.cells} and ${second.cells} cells`,
  );
});

test("POINTER DISCRIMINATION: no two pointers agree on BOTH halves of the pair", { skip }, () => {
  const m = entryState();
  const peaks = LADDER.map((t) => Math.max(...everyHeading.map((h) => Math.abs(signedAt(m, t, h)))));
  console.log(`  POINTER DISCRIMINATION (measured): ladder peaks ${peaks.join("/")}`);
  assert.deepEqual(peaks, PEAKS, "the ladder of peak magnitudes moved");
  let agreeingPairs = 0;
  for (let i = 0; i < POINTERS.length; i++) {
    for (let j = i + 1; j < POINTERS.length; j++) {
      const both = everyHeading.filter(
        (h) => sampleAt(m, POINTERS[i], h) === sampleAt(m, POINTERS[j], h) &&
          sampleAt(m, POINTERS[i], h - QUARTER) === sampleAt(m, POINTERS[j], h - QUARTER),
      );
      if (both.length) agreeingPairs++;
      assert.deepEqual(both, [], `${hex4(POINTERS[i])} and ${hex4(POINTERS[j])} agree on the whole ` +
        "pair somewhere, so a twin pinning either one can hide at those headings and the twin " +
        "catch counts below must record them");
    }
  }
  console.log(
    `  POINTER DISCRIMINATION: ${agreeingPairs} of the pointer pairs agree on the whole pair ` +
      `anywhere, which is what puts every pinned-pointer twin at ${HEADINGS} catches per pointer`,
  );
});

test("WHOLE-MACHINE: a held session is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(loc_599d);
  assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the override never dispatched");
  assert.equal(w.framesCompared, WHOLE_FRAMES, "the replay ran short of the frames asked for");
  assert.equal(w.equal, true, `forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  console.log(`  WHOLE-MACHINE: ${w.framesCompared} frames, ${w.invocations.get(TARGET)} dispatches, identical`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([h, p]) => unitDiff(twin, withPointer(h, p)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere, so nothing in ` +
      "this file holds the rewrite against it");
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, twin));
    console.log(
      `  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}` +
        (perSession.every((n) => n === 0) ? " — BLIND to real play, as recorded" : ""),
    );
    for (const [i, r] of counts.entries()) {
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} catch count moved`);
    }
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const w = replay(twin);
    assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the twin never dispatched");
    console.log(
      `  TEETH/${label}: whole machine ${w.equal ? "is BLIND, as recorded" : `forks at frame ${w.frame}`}`,
    );
    assert.equal(w.equal, !wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}
