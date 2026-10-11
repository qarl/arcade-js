// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceEra1EnemyCraftSlot — memory-equivalent to the frozen oracle at ROM 0x294C, run through the dispatch seam so SP
 * and pc are compared for equality. GATE: the undriven attract run is what reaches this arm (the era
 * index turns to 1 there; the coin-start tape holds era 0 and never dispatches it), so every real
 * dispatch of an attract replay is compared, plus capped buckets of every status class the run
 * presents -- empty, active, retiring (active and reaching the line), held, dying -- all REAL entries.
 * A second session reaches it on the played game: the coin-start tape with the era cell held at 1 by a
 * poke, so the game dispatches this arm through its own code; every dispatch of it is compared too.
 * Registers: ix and iy are HELD on every entry, compared for equality. The scratch registers the
 * frozen body leaves -- the accumulator and flags the sprite refresh (0x2A47) leaves on the active
 * path, and what the tested byte and the helpers leave on the others -- are a measured CEILING, not
 * compared. That they are dead is asked of the ORACLE, not argued: DEAD AT EXIT complements every
 * register in the ceiling on the frozen game at every exit of this entry, over the attract session
 * and the era-held coin-start session, and not one frame of state changes, while the same
 * instrument hears SP moved at the same exit and the record register shifted on the refresh's way
 * in. The rewrite's refresh writes no register at all, so a twin leaving the wrong accumulator is
 * HARMLESS and is asserted caught nowhere. Teeth: broken twins, each caught exactly where its
 * bug shows. SPLIT: the slot handed in as arguments is the slot worked on even when the registers
 * name a different one -- asserted on every class.
 * HOLE: the unpoked coin-start tape holds era 0 and never dispatches this arm; its played-game
 * coverage is the era-held session, which reaches era 1 by a poke rather than by play.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-294c.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { assertDeadAtExit, heard, heardAs } from "./_deadAtExit.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { ERA_INDEX } from "../names.js";
import { withOmittedRet } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { serviceEra1EnemyCraftSlot } from "../serviceEra1EnemyCraftSlot.js";
import { loc_294c as oracle } from "../../translated/loc_294c.js";
import { steerTowardAimHeading } from "../steerTowardAimHeading.js";
import { loc_5854 } from "../loc_5854.js";
import { hasReachedRetireLine } from "../hasReachedRetireLine.js";
import { retireSlotAndSubPixel } from "../retireSlotAndSubPixel.js";
import { fireCraftShotWhenAimedNearPlayer } from "../fireCraftShotWhenAimedNearPlayer.js";
import { refreshSecondEraSpriteFromHeading } from "../refreshSecondEraSpriteFromHeading.js";
import { refreshSpriteFromHeading } from "../refreshSpriteFromHeading.js";
import { releaseHeldObject } from "../releaseHeldObject.js";
import { stepDyingObjectState } from "../stepDyingObjectState.js";

const TARGET = 0x294c;
/** The retire arm the oracle transfers to; hooked only to classify a captured entry as retiring. */
const RETIRE_ARM = 0x2bde;
const EMPTY = 0;
const HELD = 0xfe;
const ACTIVE = 0xff;
const DATA_TOP = 0xadff;
const CAP = 60;
/** Measured: the attract run first dispatches this arm near frame 1123 and presents every class by 4000. */
const CAPTURE_FRAMES = 4000;
const REPLAY_FRAMES = 1800;
const CLASSES = ["empty", "active", "retiring", "held", "dying"];
const ATTRACT = { tape: [] };
/** The played game held in era 1: coin-start tape, era cell poked to this arm's era once play is under way. */
const ERA1_POKES = [{ addr: ERA_INDEX, val: 1, frame: 701, dur: null }];
const ERA1_HELD = { pokes: ERA1_POKES };
const ERA1_FRAMES = 2400;
/** The refresh this entry calls last on the active path, and the record stride it walks. */
const REFRESH = 0x2a47;
const RECORD_STRIDE = 0x10;
/**
 * A CEILING, measured over every dispatch of both sessions: the registers the rewrite leaves otherwise
 * than the frozen body. DEAD AT EXIT shows every one dead at this entry's exit.
 */
const MOVED = ["a", "f", "b", "c", "d", "e", "h", "l", "a_"];
/** Compared for equality on every entry: the slot pointers. SP is compared through the seam. */
const HELD_REGS = ["ix", "iy"];
/** The sessions the DEAD AT EXIT arm poisons: both that dispatch this entry. */
const DEAD_SESSIONS = [
  { label: "attract", tape: [], pokes: [], frames: CAPTURE_FRAMES },
  { label: "coin-start era 1", tape: undefined, pokes: ERA1_POKES, frames: ERA1_FRAMES },
];
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${d.key ?? hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const seam = (candidate) => withOmittedRet(candidate, TARGET);

const statusClass = (m) => {
  const s = m.mem8[m.regs.ix];
  return s === EMPTY ? "empty" : s === ACTIVE ? "active" : s === HELD ? "held" : "dying";
};

/** Oracle vs seam-wrapped candidate on two clones: masked RAM (dead stack scratch below the seat,
 *  watched off both sides' pushes), then SP, pc and the HELD slot pointers. `moved`, when given,
 *  collects every register that differs, so the ceiling is measured rather than declared. */
function unitDiff(candidate, machine, moved = null) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const pa = a.push16.bind(a); a.push16 = (v) => { pa(v); if (a.regs.sp < low) low = a.regs.sp; };
  const pb = b.push16.bind(b); b.push16 = (v) => { pb(v); if (b.regs.sp < low) low = b.regs.sp; };
  oracle(a);
  seam(candidate)(b);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  if (a.regs.sp !== b.regs.sp) return { key: "sp", a: hex4(a.regs.sp), b: hex4(b.regs.sp) };
  if (a.pc !== b.pc) return { key: "pc", a: hex4(a.pc), b: hex4(b.pc) };
  if (moved) for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  for (const k of HELD_REGS) if (a.regs[k] !== b.regs[k]) return { key: k, a: hex4(a.regs[k]), b: hex4(b.regs[k]) };
  return null;
}

/** The window floor and the SP re-seat, watched off the frozen side's own pushes. */
function maskProbe(machine) {
  const a = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const pa = a.push16.bind(a); a.push16 = (v) => { pa(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  return { low, seat, reseat: (a.regs.sp - seat) & 0xffff };
}

// ── captures ──────────────────────────────────────────────────────────────────────────────

let captured = null;
/** One attract run; each entry is cloned BEFORE the oracle runs, then filed by the path it took. */
function captureBuckets() {
  if (captured) return captured;
  const buckets = Object.fromEntries(CLASSES.map((k) => [k, []]));
  const retireArm = buildRoutines().get(RETIRE_ARM);
  let inside = false;
  let retired = false;
  let dispatches = 0;
  const m = makeMachine(new Map([
    [TARGET, (mm) => {
      dispatches++;
      const entry = mm.clone();
      inside = true; retired = false;
      const r = oracle(mm);
      inside = false;
      let k = statusClass(entry);
      if (k === "active" && retired) k = "retiring";
      if (buckets[k].length < CAP) buckets[k].push(entry);
      return r;
    }],
    [RETIRE_ARM, (mm) => { if (inside) retired = true; return retireArm(mm); }],
  ]), ATTRACT);
  const frames = m.runFrames(CAPTURE_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CAPTURE_FRAMES, "the capture run ran short");
  captured = { buckets, dispatches };
  return captured;
}

function replaySession(opts, frameCount, candidate) {
  let dispatches = 0;
  let caught = 0;
  let first = null;
  const classes = new Set();
  const moved = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    classes.add(statusClass(mm));
    const d = unitDiff(candidate, mm, moved);
    if (d) { caught++; if (!first) first = d; }
    return oracle(mm);
  }]]), opts);
  if (opts.pokes) m.pokes = opts.pokes;
  const frames = m.runFrames(frameCount);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, frameCount, "session ran short");
  return { dispatches, caught, first, classes, moved };
}

const caughtOn = (candidate, entries) => entries.filter((e) => unitDiff(candidate, e)).length;

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** The correct active arm with one step swapped out, shared by the twins that bend only that arm. */
function activeArm(m, { steer = true, retire = "test", refresh = refreshSecondEraSpriteFromHeading } = {}) {
  if (steer) steerTowardAimHeading(m);
  loc_5854(m);
  const reached = hasReachedRetireLine(m);
  if (retire === "always" || (retire === "test" && reached)) return retireSlotAndSubPixel(m);
  fireCraftShotWhenAimedNearPlayer(m);
  return refresh(m);
}
function dispatchWith(active) {
  return (m) => {
    const s = m.mem8[m.regs.ix];
    if (s === EMPTY) return;
    if (s === HELD) return releaseHeldObject(m);
    if (s !== ACTIVE) return stepDyingObjectState(m);
    return active(m);
  };
}

/** BUG: does nothing. */
function brokenNoOp() {}
/** BUG: never retires, so a craft on the line is launched from and refreshed instead of cleared. */
const brokenNeverRetires = dispatchWith((m) => activeArm(m, { retire: "never" }));
/** BUG: retires every active craft. */
const brokenAlwaysRetires = dispatchWith((m) => activeArm(m, { retire: "always" }));
/** BUG: dresses the sprite from the first era's bank, the refresh this arm exists to differ by. */
const brokenFirstEraRefresh = dispatchWith((m) => activeArm(m, { refresh: refreshSpriteFromHeading }));
/** BUG: treats a held object as dying. */
function brokenHeldAsDying(m) {
  const s = m.mem8[m.regs.ix];
  if (s === EMPTY) return;
  if (s !== ACTIVE) return stepDyingObjectState(m);
  return activeArm(m);
}
/** BUG: scribbles the slot pointer on the way out -- memory-invisible, the register arm must see it. */
function brokenMovesIx(m) { const r = serviceEra1EnemyCraftSlot(m); m.regs.ix = (m.regs.ix + 1) & 0xffff; return r; }
/** HARMLESS: leaves the wrong accumulator on the refreshed path. The accumulator is dead where this
 *  entry hands back (DEAD AT EXIT), so this is not a defect and must be caught nowhere. */
function brokenLeavesA(m) {
  const r = serviceEra1EnemyCraftSlot(m);
  if (m.mem8[m.regs.ix] === ACTIVE) m.regs.a = (m.regs.a ^ 0x01) & 0xff;
  return r;
}

/** Per class: "all" the twin must be caught on every entry, "none" it must match on every one. */
const TWINS = [
  ["no-op", brokenNoOp, { empty: "none", active: "all", retiring: "all", held: "all", dying: "all" }],
  ["never-retires", brokenNeverRetires, { empty: "none", active: "none", retiring: "all", held: "none", dying: "none" }],
  ["always-retires", brokenAlwaysRetires, { empty: "none", active: "all", retiring: "none", held: "none", dying: "none" }],
  ["first-era-refresh", brokenFirstEraRefresh, { empty: "none", active: "all", retiring: "none", held: "none", dying: "none" }],
  ["held-as-dying", brokenHeldAsDying, { empty: "none", active: "none", retiring: "none", held: "all", dying: "none" }],
  ["moves-ix", brokenMovesIx, { empty: "all", active: "all", retiring: "all", held: "all", dying: "all" }],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

let replays = null;
function sessions() {
  if (!replays) {
    replays = {
      attract: replaySession(ATTRACT, REPLAY_FRAMES, serviceEra1EnemyCraftSlot),
      driven: replaySession({}, ENTRY_FRAMES, serviceEra1EnemyCraftSlot),
      era1: replaySession(ERA1_HELD, ERA1_FRAMES, serviceEra1EnemyCraftSlot),
    };
  }
  return replays;
}

test("REACHED: attract and the era-held coin-start dispatch this arm; the unpoked coin-start tape does not", { skip }, () => {
  const { attract, driven, era1 } = sessions();
  assert.ok(attract.dispatches > 0, "vacuous: the attract replay never reached the routine");
  assert.equal(attract.caught, 0, `the rewrite diverged on ${attract.caught} real dispatches: ${show(attract.first)}`);
  assert.ok(era1.dispatches > 0, "vacuous: the era-held coin-start session never reached the routine");
  assert.equal(era1.caught, 0, `the rewrite diverged on ${era1.caught} era-held dispatches: ${show(era1.first)}`);
  assert.equal(driven.dispatches, 0,
    "the coin-start tape now reaches this arm, so attract is no longer the only source of the corpus");
  console.log(`  REACHED: attract ${attract.dispatches} over {${[...attract.classes].sort().join(",")}}, ` +
    `era-held coin-start ${era1.dispatches} over {${[...era1.classes].sort().join(",")}}, all identical; ` +
    `coin-start ${driven.dispatches}`);
});

test("EQUAL at every captured entry of every class; a no-op FAILS the same comparison", { skip }, () => {
  const { buckets, dispatches } = captureBuckets();
  for (const k of CLASSES) {
    assert.ok(buckets[k].length > 0, `vacuous: no ${k} entry captured`);
    for (const entry of buckets[k]) {
      const d = unitDiff(serviceEra1EnemyCraftSlot, entry);
      assert.equal(d, null, `a ${k} entry diverged: ${show(d)}`);
    }
  }
  assert.notEqual(unitDiff(brokenNoOp, buckets.active[0]), null,
    "the masked comparison passed a do-nothing candidate on an active entry, so it measures nothing");
  console.log(`  EQUAL: ${dispatches} dispatches; ` +
    `${CLASSES.map((k) => `${k}=${buckets[k].length}`).join(" ")} all identical (RAM, SP, pc, ix, iy)`);
});

test("SP AND SCRATCH: the oracle nets one return and the window stays above game data", { skip }, () => {
  const { buckets } = captureBuckets();
  for (const k of CLASSES) {
    for (const entry of buckets[k]) {
      const r = maskProbe(entry);
      assert.equal(r.reseat, 2, `${k}: the oracle did not net exactly one return (${r.reseat})`);
      assert.ok(r.low > DATA_TOP, `${k}: the stack window ${hex4(r.low)} reached down into game data`);
    }
  }
  const r = maskProbe(buckets.active[0]);
  console.log(`  SP AND SCRATCH: every exit re-seats +2; window floor ${hex4(r.low)} over ${hex4(DATA_TOP)}`);
});

test("DEAD AT EXIT: on the frozen game, every register in the ceiling is dead where this entry hands back", { skip }, () => {
  const exits = assertDeadAtExit({
    at: TARGET, poison: MOVED, reachEvery: true, sessions: DEAD_SESSIONS,
    // ENTRY CONTROL, same instrument: shift the record register one record on at the refresh's way
    // IN, where it is read. Every session must reach it and hear it, or its silence proves nothing.
    controls: [{
      label: "entry", at: REFRESH, poison: ["ix"], flip: { ix: RECORD_STRIDE }, before: true,
      every: true, reachEvery: true,
    }],
  });
  for (const r of exits) {
    // EXIT CONTROL, same instrument and exit: SP flipped by one word where this entry hands back.
    // The ROM returns through the stack, so an exit poison that lands has to be heard in EVERY session.
    assert.ok(heard(r.exitControl), `${r.label}: SP flipped at this entry's exit went unheard, so the ` +
      "exit poison never lands there and its silence proves nothing");
    console.log(`  DEAD AT EXIT/${r.label}: the entry control is heard (${heardAs(r.controls.entry)}); ` +
      `the exit control is heard (${heardAs(r.exitControl)})`);
  }
});

test("EXCLUDED, deliberately: a CEILING on the registers that may diverge; the slot pointers are held", { skip }, () => {
  const { attract, era1 } = sessions();
  const { buckets } = captureBuckets();
  const moved = new Set([...attract.moved, ...era1.moved]);
  for (const k of CLASSES) for (const entry of buckets[k]) unitDiff(serviceEra1EnemyCraftSlot, entry, moved);
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ") || "none"}`);
  // A CEILING, not a set the rewrite must fill: equality would go RED on a register-exact rewrite.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
  for (const k of [...HELD_REGS, "sp"]) assert.ok(!moved.has(k), `a held register moved (${k})`);
});

test("REGISTERS: a twin leaving the wrong accumulator is HARMLESS -- it moves A and is caught nowhere", { skip }, () => {
  const { buckets } = captureBuckets();
  let differs = 0;
  for (const entry of buckets.active) {
    const a = entry.clone();
    const b = entry.clone();
    seam(serviceEra1EnemyCraftSlot)(a);
    seam(brokenLeavesA)(b);
    if (a.regs.a !== b.regs.a) differs++;
  }
  assert.equal(differs, buckets.active.length, "the leaves-A twin does not move A, so its harmlessness is vacuous");
  for (const k of CLASSES) assert.equal(caughtOn(brokenLeavesA, buckets[k]), 0, `the leaves-A twin was caught on a ${k} entry`);
  console.log(`  REGISTERS: leaves-A moves A on ${differs}/${buckets.active.length} active entries and is caught on none (A dead at exit)`);
});

for (const [label, twin, expect] of TWINS) {
  test(`TEETH: the ${label} twin is caught exactly where its bug shows`, { skip }, () => {
    const { buckets } = captureBuckets();
    const report = {};
    for (const k of CLASSES) {
      const caught = caughtOn(twin, buckets[k]);
      report[k] = `${caught}/${buckets[k].length}`;
      if (expect[k] === "all") assert.equal(caught, buckets[k].length, `the ${label} twin escaped some ${k} entries`);
      else assert.equal(caught, 0, `the ${label} twin was caught on a ${k} entry it should have matched`);
    }
    assert.ok(Object.values(expect).includes("all"), `the ${label} twin catches nothing`);
    console.log(`  TEETH/${label}: ${CLASSES.map((k) => `${k}=${report[k]}`).join(" ")}`);
  });
}

// ── the split ───────────────────────────────────────────────────────────────────────────

/** The registers moved to the neighbouring slot while the entry's own slot is handed over as
 *  arguments; the registers are put back afterwards so only memory, SP and pc can tell. */
const NEIGHBOUR_RECORD = 0x10;
const NEIGHBOUR_ENTRY = 2;
const SPLIT_CLASSES = CLASSES;
function split(fn) {
  return (m) => {
    const { ix, iy } = m.regs;
    m.regs.ix = (ix + NEIGHBOUR_RECORD) & 0xffff;
    m.regs.iy = (iy + NEIGHBOUR_ENTRY) & 0xffff;
    const r = fn(m, ix, iy);
    m.regs.ix = ix;
    m.regs.iy = iy;
    return r;
  };
}
/** BUG: takes the slot as arguments but lets the release read it off the registers. */
function brokenUnforwarded(m, ix = m.regs.ix) {
  const s = m.mem8[ix];
  if (s === EMPTY) return;
  if (s === HELD) return releaseHeldObject(m);
  return serviceEra1EnemyCraftSlot(m, ix);
}

test("SPLIT: the slot handed over is the slot worked on, whatever the registers name", { skip }, () => {
  const { buckets } = captureBuckets();
  for (const k of SPLIT_CLASSES) {
    for (const entry of buckets[k]) {
      const d = unitDiff(split(serviceEra1EnemyCraftSlot), entry);
      assert.equal(d, null, `a ${k} entry worked on the slot the registers name: ${show(d)}`);
    }
  }
  const caught = caughtOn(split(brokenUnforwarded), buckets.held);
  assert.equal(caught, buckets.held.length, "a release that reads the slot off the registers went unseen");
  assert.equal(caughtOn(split(brokenUnforwarded), buckets.empty), 0, "the unforwarded twin was caught where it does nothing");
  console.log(`  SPLIT: ${SPLIT_CLASSES.map((k) => `${k}=${buckets[k].length}`).join(" ")} identical; ` +
    `unforwarded release caught ${caught}/${buckets.held.length}`);
});
