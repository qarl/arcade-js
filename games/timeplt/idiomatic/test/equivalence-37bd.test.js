// SPDX-License-Identifier: GPL-3.0-only
/**
 * gateTheFreeSlotSearchAndPickItsRun — two whole captured corpora (coin-then-start and undriven
 * attract) replayed with the REAL spawner running underneath, crafted sweeps of the routine's input
 * space, and teeth. The gate itself pushes nothing; the spawner it tails into does.
 *
 * The dissolved spawner drops its tail return and never writes the stack scratch the frozen side
 * leaves, so a full comparison masks [low, seat) (floor watched off the oracle's pushes, proved
 * above the data) and asserts the two-byte drift. The gate stages a count and two cursors and tails
 * into the spawner; a staging bug shows as a memory divergence once occupancy makes it visible, so
 * the real rewrite is held to the oracle by the masked full run, and the TWINS — which still reach
 * the spawner by dispatch — are compared against a RECORDER so a staging bug is caught whatever the
 * occupancy. The registers the spawner leaves are excluded as a ceiling.
 *
 * The address is a dispatch target (the caller leaves HL on the low life-tick counter, so the REACH
 * arm measures how often each byte value arrives), and the cleared arm is never taken by either tape
 * (ARMS counts all three with the two the tapes take as the control), so it is crafted.
 *
 * HOLE: the sweeps vary the three cells this routine reads and nothing else.
 * HOLE: the corpus arms run the spawner, so a divergence they catch need not be this routine's; the
 * recorder sweeps localise it.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-37bd.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { buildRoutines } from "../../routines.js";
import { gateTheFreeSlotSearchAndPickItsRun } from "../gateTheFreeSlotSearchAndPickItsRun.js";
import { loc_37bd as oracle } from "../../translated/loc_37bd.js";
import { loc_36af as caller } from "../../translated/loc_36af.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { deadAfterThePass } from "./_spawnPassScratchDeadAtExit.js";

const TARGET = 0x37bd;
const CALLER = 0x36af;
const SLOT_BODY = 0x37d6;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

/** The three cells this routine reads. HL is the caller's pointer, not a constant. */
const KILLS_REMAINING = 0xad02;
const CRAFT_SPAWN_SLOT_COUNT = 0xacc1;

/** What the two arms must stage, derived here so an edit to the module's table cannot pass. */
const CLEARED = { b: 5, ix: 0xa890, iy: 0xaa22 };
const OWED = { ix: 0xa8b0, iy: 0xaa26 };
const OPEN = [0x00, 0x30];

const VALUES = 256;
const CORPUS_ENTRIES = 400;

/** Every data write lands at or below here; the stack seats far above it, so the mask is safe. */
const DATA_TOP = 0xadff;

/**
 * The ceiling on divergence. The gate leaves the tested byte in A and the comparison in the flags
 * and takes a return the rewrite does not; the spawner it tails into leaves the staging pair, the
 * accumulator and the shadow set differently. The count and the two cursors the gate stages are
 * handed to the spawner as arguments and never land in a register, and so are the step count and
 * table pointer the shape step works a filled slot with, which the frozen side leaves in C and H/L;
 * all six are in the ceiling on the ORACLE's word: DEAD AFTER THE PASS below poisons them wherever
 * the frozen search ends and nothing changes. The TWINS stage through the registers and are held by the recorder, which
 * compares what they stage whatever the ceiling. A CEILING and not a demand: a subset still passes.
 */
const MOVED = ["a", "b", "c", "d", "e", "f", "h", "l", "sp", "ix", "iy", "a_", "f_", "b_", "c_", "d_", "e_", "h_", "l_"];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** Drop decoded graphics from a captured machine: nothing here renders, and cloning one is slow. */
function lean(mm) {
  mm.assets = {};
  mm.video = null;
  return mm;
}

// ── the captured machines ───────────────────────────────────────────────────────────────

const corpora = new Map();

/** Every machine this address is entered on, up to the cap, under one tape. */
function capture(tapeName) {
  if (corpora.has(tapeName)) return corpora.get(tapeName);
  const entries = [];
  let dispatches = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (entries.length < CORPUS_ENTRIES) entries.push(lean(mm.clone()));
    return oracle(mm);
  }]]), tapeName === "attract" ? { tape: [] } : {});
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `capture run stopped early: ${m.stoppedBy}`);
  const got = { entries, dispatches };
  corpora.set(tapeName, got);
  return got;
}

const bothCorpora = () => [...capture("coin-start").entries, ...capture("attract").entries];

// ── comparison ──────────────────────────────────────────────────────────────────────────

/** A routine map whose spawner records what it was handed and returns instead of launching. */
function recorderRoutines(seen) {
  const map = buildRoutines();
  map.set(SLOT_BODY, (mm) => {
    seen.push({ b: mm.regs.b, ix: mm.regs.ix, iy: mm.regs.iy });
    mm.ret();
  });
  return map;
}

/**
 * Oracle vs candidate on independent clones: the whole dump outside the dead stack scratch, then
 * the registers outside MOVED. The spawner the frozen side tails into pushes below its seat and
 * takes a return the rewrite leaves; [low, seat) is masked, low watched off the oracle's pushes.
 */
function unitDiff(candidate, machine, setup) {
  const a = machine.clone();
  const b = machine.clone();
  if (setup) {
    setup(a);
    setup(b);
  }
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 60) };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  return null;
}

/** The same comparison, but with the spawner replaced by a recorder, so the STAGING is compared. */
function stagedDiff(candidate, machine, setup) {
  const seenA = [];
  const seenB = [];
  const a = machine.clone();
  const b = machine.clone();
  a.routines = recorderRoutines(seenA);
  b.routines = recorderRoutines(seenB);
  setup(a);
  setup(b);
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 60) };
  }
  if (JSON.stringify(seenA) !== JSON.stringify(seenB)) {
    return { addr: null, a: JSON.stringify(seenA), b: JSON.stringify(seenB) };
  }
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  return null;
}

/** The mask floor and the sp drift over a full run, watched off the frozen side's own pushes. */
function maskProbe(machine, setup) {
  const a = machine.clone();
  const b = machine.clone();
  if (setup) {
    setup(a);
    setup(b);
  }
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  gateTheFreeSlotSearchAndPickItsRun(b);
  return { low, seat, spDiff: a.regs.sp - b.regs.sp };
}

// ── the crafted sweeps ──────────────────────────────────────────────────────────────────

/**
 * Every value of the byte HL points at, on both settings of the kill counter. The real rewrite is
 * held to the oracle by the masked full run; the twins reach the spawner by dispatch, so they are
 * compared against the recorder, which catches a staging bug whatever the occupancy.
 */
function sweepGateByte(candidate, diff) {
  const base = capture("coin-start").entries[0];
  let caught = 0;
  for (const kills of [0, 7]) {
    for (let value = 0; value < VALUES; value++) {
      const d = diff(candidate, base, (mm) => {
        mm.mem8[mm.regs.hl] = value;
        mm.mem8[KILLS_REMAINING] = kills;
        mm.mem8[CRAFT_SPAWN_SLOT_COUNT] = 3;
      });
      if (d) caught++;
    }
  }
  return caught;
}

/** Every value of the round's craft count, gate open and enemies still owed. */
function sweepCraftCount(candidate, diff) {
  const base = capture("coin-start").entries[0];
  let caught = 0;
  for (let value = 0; value < VALUES; value++) {
    const d = diff(candidate, base, (mm) => {
      mm.mem8[mm.regs.hl] = 0x30;
      mm.mem8[KILLS_REMAINING] = 1;
      mm.mem8[CRAFT_SPAWN_SLOT_COUNT] = value;
    });
    if (d) caught++;
  }
  return caught;
}

const SWEEP_RUNS = { gateByte: 2 * VALUES, craftCount: VALUES };

/** Which arm an entry state takes, decided from the cells rather than from either arm's code. */
function armOf(mm) {
  if (!OPEN.includes(mm.mem8[mm.regs.hl])) return "reject";
  return mm.mem8[KILLS_REMAINING] === 0 ? "cleared" : "owed";
}

// ── broken twins ────────────────────────────────────────────────────────────────────────

/** BUG: does nothing — the tell that a gate is measuring an idle entry. */
function brokenNoOp() {}

/** BUG: opens the gate on the zero value only, so half the launch ticks are dropped. */
function brokenOnlyZeroOpens(m) {
  if (m.mem8[m.regs.hl] !== 0x00) return;
  m.regs.b = m.mem8[CRAFT_SPAWN_SLOT_COUNT];
  m.regs.ix = OWED.ix;
  m.regs.iy = OWED.iy;
  return m.call(SLOT_BODY);
}

/** BUG: opens the gate on every value, so a launch is attempted every tick. */
function brokenGateAlwaysOpen(m) {
  const cleared = m.mem8[KILLS_REMAINING] === 0;
  m.regs.b = cleared ? CLEARED.b : m.mem8[CRAFT_SPAWN_SLOT_COUNT];
  m.regs.ix = cleared ? CLEARED.ix : OWED.ix;
  m.regs.iy = cleared ? CLEARED.iy : OWED.iy;
  return m.call(SLOT_BODY);
}

/** BUG: hands over the two runs the other way round. */
function brokenRunsSwapped(m) {
  if (!OPEN.includes(m.mem8[m.regs.hl])) return;
  const cleared = m.mem8[KILLS_REMAINING] === 0;
  m.regs.b = cleared ? CLEARED.b : m.mem8[CRAFT_SPAWN_SLOT_COUNT];
  m.regs.ix = cleared ? OWED.ix : CLEARED.ix;
  m.regs.iy = cleared ? OWED.iy : CLEARED.iy;
  return m.call(SLOT_BODY);
}

/** BUG: always five slots, so the round's craft count never shortens or lengthens the run. */
function brokenAlwaysFive(m) {
  if (!OPEN.includes(m.mem8[m.regs.hl])) return;
  const cleared = m.mem8[KILLS_REMAINING] === 0;
  m.regs.b = CLEARED.b;
  m.regs.ix = cleared ? CLEARED.ix : OWED.ix;
  m.regs.iy = cleared ? CLEARED.iy : OWED.iy;
  return m.call(SLOT_BODY);
}

/** BUG: steps the record cursor to the other run but leaves the entry cursor behind. */
function brokenEntryCursorStale(m) {
  if (!OPEN.includes(m.mem8[m.regs.hl])) return;
  const cleared = m.mem8[KILLS_REMAINING] === 0;
  m.regs.b = cleared ? CLEARED.b : m.mem8[CRAFT_SPAWN_SLOT_COUNT];
  m.regs.ix = cleared ? CLEARED.ix : OWED.ix;
  m.regs.iy = OWED.iy;
  return m.call(SLOT_BODY);
}

/** BUG: scribbles on a register outside the ceiling — the control for the EXCLUDED arm. Aimed at
 * the interrupt vector, the one register left outside the ceiling. */
function brokenMovesI(m) {
  gateTheFreeSlotSearchAndPickItsRun(m);
  m.regs.i = m.regs.i ^ 0xff;
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["only-zero-opens", brokenOnlyZeroOpens],
  ["gate-always-open", brokenGateAlwaysOpen],
  ["runs-swapped", brokenRunsSwapped],
  ["always-five", brokenAlwaysFive],
  ["entry-cursor-stale", brokenEntryCursorStale],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REACH: the game dispatches this address under both tapes", { skip }, () => {
  const driven = capture("coin-start");
  const idle = capture("attract");
  assert.notEqual(driven.entries[0] ?? null, null, "vacuous: the tape never reached the routine");
  assert.ok(idle.dispatches > 0, "the undriven tape never reached it, so the attract corpus below " +
    "is empty and the second corpus arm proves nothing");
  const bytes = new Set(bothCorpora().map((e) => e.mem8[e.regs.hl]));
  console.log(`  REACH: dispatched ${driven.dispatches} times driven and ${idle.dispatches} idle; ` +
    `the byte behind HL took ${bytes.size} distinct values across the two corpora`);
});

test("SCRATCH AND SP: the drift is two bytes and the mask floor sits above the data", { skip }, () => {
  // The spawner the frozen side tails into pushes below its seat and pops one return the rewrite
  // leaves; its deepest push stays above every data cell, so the masked window hides nothing real.
  let floor = 0xffff;
  for (const e of bothCorpora()) {
    const r = maskProbe(e);
    assert.equal(r.spDiff, 2, `the frozen side no longer re-seats two bytes higher (${r.spDiff})`);
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
    if (r.low < floor) floor = r.low;
  }
  console.log(`  SCRATCH AND SP: spDiff 2 over both corpora; deepest mask floor ${hex4(floor)}`);
});

for (const tapeName of ["coin-start", "attract"]) {
  test(`CORPUS (${tapeName}): every captured machine replays identically`, { skip }, () => {
    const { entries } = capture(tapeName);
    assert.ok(entries.length > 0, `vacuous: no entry captured under ${tapeName}`);
    for (const e of entries) {
      const d = unitDiff(gateTheFreeSlotSearchAndPickItsRun, e);
      assert.equal(d, null, show(d));
    }
    console.log(`  CORPUS/${tapeName}: ${entries.length} captured machines identical, with the ` +
      "real spawner running underneath");
  });
}

test("ARMS: which arms the tapes take, and which they never do", { skip }, () => {
  const tally = { reject: 0, owed: 0, cleared: 0 };
  for (const e of bothCorpora()) tally[armOf(e)]++;
  console.log(`  ARMS: reject ${tally.reject}, owed ${tally.owed}, cleared ${tally.cleared}`);
  // The zero is evidence only because the SAME predicate counted the other two arms in the same
  // pass. Without those the counter could simply be broken.
  assert.ok(tally.reject > 0 && tally.owed > 0, "the arm counter found neither of the two arms " +
    "the tapes are known to take, so it is broken and any zero it reports means nothing");
  assert.equal(tally.cleared, 0, "the tapes now reach the cleared arm, so the crafted arm below " +
    "is no longer the best evidence available and this gate should capture real entries for it");
});

test("CLEARED: the arm the tapes never take, crafted over the whole corpus", { skip }, () => {
  const entries = bothCorpora();
  let staged = 0;
  for (const e of entries) {
    const d = unitDiff(gateTheFreeSlotSearchAndPickItsRun, e, (mm) => {
      mm.mem8[KILLS_REMAINING] = 0;
      mm.mem8[mm.regs.hl] = 0x00;
    });
    assert.equal(d, null, show(d));
    // The masked full run above holds the rewrite to the oracle; this recorder probe reads the
    // FROZEN side to pin what the cleared arm stages, so this account cannot rot.
    const seen = [];
    const probe = e.clone();
    probe.routines = recorderRoutines(seen);
    probe.mem8[KILLS_REMAINING] = 0;
    probe.mem8[probe.regs.hl] = 0x00;
    oracle(probe);
    if (seen.length === 1 && seen[0].b === CLEARED.b && seen[0].ix === CLEARED.ix &&
        seen[0].iy === CLEARED.iy) staged++;
  }
  assert.equal(staged, entries.length, "the crafted entries did not all reach the cleared arm, so " +
    "this arm is not covering what it says it covers");
  console.log(`  CLEARED: ${entries.length} crafted machines identical, every one of them staging ` +
    "the fixed run of five");
});

test("GATE-BYTE: all 256 values, on both settings of the kill counter", { skip }, () => {
  assert.equal(sweepGateByte(gateTheFreeSlotSearchAndPickItsRun, unitDiff), 0, "a gate byte diverged");
  console.log(`  GATE-BYTE: ${SWEEP_RUNS.gateByte} value-and-counter combinations identical`);
});

test("CRAFT-COUNT: all 256 values of the round's craft count", { skip }, () => {
  assert.equal(sweepCraftCount(gateTheFreeSlotSearchAndPickItsRun, unitDiff), 0, "a craft count diverged");
  const seen = [];
  const probe = capture("coin-start").entries[0].clone();
  probe.routines = recorderRoutines(seen);
  probe.mem8[probe.regs.hl] = 0x30;
  probe.mem8[KILLS_REMAINING] = 1;
  probe.mem8[CRAFT_SPAWN_SLOT_COUNT] = 0;
  oracle(probe);
  assert.deepEqual(seen, [{ b: 0, ix: OWED.ix, iy: OWED.iy }],
    "a craft count of zero must be handed over as zero, not clamped or skipped");
  console.log(`  CRAFT-COUNT: ${SWEEP_RUNS.craftCount} counts identical, zero handed over as zero`);
});

/** Which registers a candidate parts company with the oracle on, over both corpora. */
function movedOver(candidate) {
  const moved = new Set();
  for (const e of bothCorpora()) {
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    try {
      candidate(b);
    } catch {
      continue;
    }
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

test("DEAD AFTER THE PASS: on the frozen game, the three staged values and the shape step's C and H/L are read by nobody once the pass ends",
  { skip }, () => {
    deadAfterThePass();
  });

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(gateTheFreeSlotSearchAndPickItsRun);
  const control = movedOver(brokenMovesI);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
    "the measurement reports nothing outside the ceiling even for a twin that scribbles on a " +
      "register, so a clean reading below proves nothing");
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${MOVED.join(", ")}; the control twin also moves ` +
    `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
  // MOVED is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

test("CALLER: the dispatch really is a tail, so the rewrite may omit the return", { skip }, () => {
  // 0x36AF reaches this address by `jp`, which means our `ret` is the CALLER's `ret`. If that ever
  // stopped being true the omitted return would leak two bytes of stack per dispatch.
  const e = capture("coin-start").entries[0].clone();
  const seat = e.regs.sp;
  const held = e.mem.read16(seat);
  oracle(e);
  assert.equal(e.regs.sp, (seat + 2) & 0xffff, "the oracle no longer pops exactly one slot");
  assert.equal(e.pc, held, "the oracle returned somewhere other than the slot it found on entry");
  assert.equal(typeof caller, "function", "the dispatching routine is not where this gate thinks");
  console.log(`  CALLER: the oracle pops one slot and lands on ${hex4(held)}, the address the ` +
    `caller at ${hex4(CALLER)} left there`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    // Twins reach the spawner by dispatch, so the recorder catches a staging bug whatever the
    // occupancy — the localisation the masked full run cannot give on its own.
    const gateByte = sweepGateByte(twin, stagedDiff);
    const craftCount = sweepCraftCount(twin, stagedDiff);
    console.log(`  TEETH/${label}: caught on ${gateByte}/${SWEEP_RUNS.gateByte} gate bytes, ` +
      `${craftCount}/${SWEEP_RUNS.craftCount} craft counts`);
    assert.ok(gateByte + craftCount > 0, `every sweep PASSED the ${label} twin`);
  });
}
