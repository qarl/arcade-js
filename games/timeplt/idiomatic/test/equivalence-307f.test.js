// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_307f — memory-equivalent to the frozen oracle at ROM 0x307F. UNREACHED by both tapes, so the
 * entries are crafted from a real end-of-session machine over painted sprite-entry bands.
 *
 * STRAIGHT PATH (the counter still holds): the dissolved placer (placeTileAtTableSuppliedOffset,
 * 0x3074, then 0x309B) drops the ROM `ret` chain and the register dance, so RAM is compared outside
 * the measured dead-stack window [low, seat), the +2 SP drift is asserted, the live-out cursors ix/iy
 * are checked, and the measured scrambled register set {a,f,b,d,e} is excluded with a control twin
 * (a shadow register clobbered) proving the check still sees a register outside that set. A joins the
 * set because the placer now builds the displaced coordinate in a local and only stores it, where the
 * frozen placer leaves it in A: DEAD AT EXIT complements A as the FROZEN routine hands back, over a
 * whole attract and a whole coin-start session each driven down the one real way in (the tamper
 * witness 0xAD39 poked off its sentinel, so the scenery seed's guard fails through 0x3114), and not
 * one frame of state changes, beside an SP exit control and an E entry control that are both heard.
 * HOLE: those sessions present only a few dispatches (pinned), all on the straight path.
 *
 * LAST SLOT (the counter runs out): the oracle indexes the word table, bumps the byte past the entry,
 * and then POPS TWO STACK BYTES IT NEVER PUSHED (`pop af` at 0x3088), dropping its caller's return
 * word. The rewrite lays no return words, so that unwind has no faithful form and it raises
 * NotImplemented at the pop. The two sides are compared AT the pop: the oracle is stopped on the step
 * just past it and the rewrite must raise naming loc_307f, with RAM identical at that point (the index,
 * the table walk and the bump all land before it). What happens after the pop is not compared.
 * The arm is dead in the image: the only way in (0x3117's guard-fail divert through 0x3114) arrives
 * with the clear loop's spent count B = 0 (by construction: 0x3117's only entry is the jp c at 0x30E0
 * straight after the clear loop's ld b,8/djnz at 0x30D7-0x30DB; MAME logged B = 0 at every sampled
 * fetch of 0x3117), which counts down
 * to 255, the straight path; MAME fetched 0x307F and the last-slot step 0x3083 zero times.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-307f.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_307f } from "../loc_307f.js";
import { loc_307f as oracle } from "../../translated/loc_307f.js";
// A batch sibling dispatched by both sessions -- the positive control for the UNREACHED arm.
import { dispatchSeatedSlotByEraIndex as controlModule } from "../dispatchSeatedSlotByEraIndex.js";
import { loc_290e as controlOracle } from "../../translated/loc_290e.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { NotImplemented } from "../../../../boards/timeplt/io.js";
import { TAMPER_WITNESS } from "../names.js";
import { assertDeadAtExit, heard } from "./_deadAtExit.js";

const TARGET = 0x307f;
const CONTROL = 0x290e;

const RECORD_STRIDE = 16;
const ENTRY_STRIDE = 2;
const RECORD_SEAT = 0xa800;
const ENTRY_SEAT = 0xac00; // sprite-entry band, clear of the table below it
const TABLE = 0xa900; // word table the last-slot lookup walks, in low work RAM

// Every crafted write lands at or below here; the stack seats far above it, so masking the scratch
// window can never hide a game-data divergence. Both bounds are asserted.
const DATA_TOP = 0xadff;
const SP_DRIFT = 2; // the dropped final ROM ret (straight path)
const AFTER_POP = 0x3089; // the oracle's step just past the unpaired `pop af`
const EXCLUDED = ["a", "f", "b", "d", "e", "sp"];

/** DEAD AT EXIT: the one real way in, forced -- the tamper witness knocked off its sentinel. */
const DIVERT_POKES = [{ addr: TAMPER_WITNESS, val: 0x00, frame: 260, dur: null }];
/** Whole sessions; measured dispatches of this address under the poke (a move is a finding). */
const DEAD_SESSIONS = [["undriven attract", [], 1], ["coin -> start", undefined, 2]];

const skip = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

// ── backdrop + crafting ───────────────────────────────────────────────────────────────────

let backdropCache = null;
function backdrop() {
  if (backdropCache === null) {
    const m = makeMachine();
    const frames = m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the backdrop session stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, "the backdrop session ran short");
    backdropCache = m.clone();
  }
  return backdropCache;
}

const marker = (addr, salt) => ((addr & 0xff) ^ salt) || salt;

/** A real machine with the entry band painted, a table laid down, and the registers the routine
 * reads seated. B=1 exhausts the counter (last-slot path); anything else takes the straight path.
 * The index the last-slot lookup uses is a&(hl-after-write), forced here to `index` via a=0xff. */
function craft(bval, { index = 0, c = 0x11, entry = ENTRY_SEAT, record = RECORD_SEAT } = {}) {
  const m = backdrop().clone();
  for (let d = -4; d <= ENTRY_STRIDE + 6; d++) {
    m.mem8[entry + d] = marker(entry + d, 0x5a);
    m.mem8[entry + 49 + d] = marker(entry + 49 + d, 0x33);
  }
  for (let d = 0; d < 260; d++) m.mem8[(TABLE + d) & 0xffff] = (d * 7 + 3) & 0xff;
  m.regs.iy = entry;
  m.regs.ix = record;
  m.regs.hl = TABLE;
  m.regs.b = bval;
  m.regs.a = 0xff;
  m.regs.e = index; // written through HL, then anded with A=0xff -> the lookup index
  m.regs.c = c;
  return m;
}

/**
 * Oracle vs candidate on clones. RAM is diffed with the dead-stack window [low, seat) masked, low
 * measured by watching the oracle's own pushes; the SP drift and the two cursors are returned.
 */
class PopReached extends Error {}

/** Which way a side left: "returned", "pop" (the oracle at the unpaired pop, or the rewrite raising
 * there by name), or the fault's text for anything else. */
function outcomeOf(err) {
  if (err === null) return "returned";
  if (err instanceof PopReached) return "pop";
  if (err instanceof NotImplemented && err.message.startsWith("not implemented: loc_307f:")) return "pop";
  return `fault: ${String(err.message ?? err).slice(0, 60)}`;
}

function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => {
    push(v);
    if (a.regs.sp < low) low = a.regs.sp;
  };
  const step = a.step.bind(a);
  a.step = (next, cycles) => {
    if (next === AFTER_POP) throw new PopReached();
    return step(next, cycles);
  };
  let retOracle, retCand;
  let errA = null;
  let errB = null;
  try { retOracle = oracle(a); } catch (e) { errA = e; }
  try { retCand = cand(b); } catch (e) { errB = e; }
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, a: da[i], b: db[i] };
  }
  const outcomeA = outcomeOf(errA);
  const outcomeB = outcomeOf(errB);
  const returned = outcomeA === "returned" && outcomeB === "returned";
  const regMoved = returned ? REG_FIELDS.filter((k) => !EXCLUDED.includes(k) && a.regs[k] !== b.regs[k]) : [];
  return {
    outcomeA,
    outcomeB,
    returned,
    escaped,
    low,
    seat,
    spDiff: (((a.regs.sp - b.regs.sp) & 0xffff) << 16) >> 16,
    regMoved,
    ixMatch: !returned || a.regs.ix === b.regs.ix,
    iyMatch: !returned || a.regs.iy === b.regs.iy,
    retOracle,
    retCand,
    cursorsOracle: returned ? [a.regs.ix, a.regs.iy] : null,
  };
}

/** A defect fails compare() if the two sides left differently, RAM escaped the mask, or -- when both
 * returned -- a live-out register moved or SP drifted wrong. */
function caught(cand, machine) {
  const r = compare(cand, machine);
  if (r.outcomeA !== r.outcomeB) return true;
  if (r.escaped) return true;
  if (!r.returned) return false;
  return r.regMoved.length > 0 || !r.ixMatch || !r.iyMatch || r.spDiff !== SP_DRIFT;
}

/** The largest cell the oracle moves outside the stack, so the mask cannot be hiding a data write. */
function footprintTop(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  const seat = a.regs.sp;
  const step = a.step.bind(a);
  a.step = (next, cycles) => {
    if (next === AFTER_POP) throw new PopReached();
    return step(next, cycles);
  };
  try { oracle(a); } catch (e) { if (!(e instanceof PopReached)) throw e; }
  const now = a.dumpState();
  let top = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] === before[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= seat - 8 && addr <= seat + 4) continue;
    if (addr > top) top = addr;
  }
  return top;
}

// A fixed corpus: the straight path at several counter values, and the last-slot path swept over
// the lookup index across the byte-doubling wrap.
const PATH1_B = [0, 2, 3, 5, 200, 255];
const PATH2_INDEX = [0, 1, 2, 15, 16, 127, 128, 200, 254, 255];
function corpus() {
  const out = [];
  for (const b of PATH1_B) out.push(craft(b));
  for (const index of PATH2_INDEX) out.push(craft(1, { index }));
  return out;
}
const corpusCaught = (cand) => corpus().filter((m) => caught(cand, m)).length;

// ── twins ─────────────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** Control: everything right, then clobbers a register outside the ceiling (a shadow half this entry
 * never touches), which the register check must see. */
function clobbersARegisterOutsideTheCeiling(m) {
  loc_307f(m);
  m.regs.h_ = (m.regs.h_ + 1) & 0xff;
}

/** BUG: never stores E through the pointer, so the fold and the table byte are off. */
function brokenSkipStore(m) {
  const { regs } = m;
  regs.and(m.mem.read8(regs.hl));
  if (regs.djnz() !== 0) return importStraight(m);
  return importLast(m);
}

/** BUG: takes the straight placer on the last slot too, never looking up the table. */
function brokenAlwaysStraight(m) {
  const { regs, mem } = m;
  mem.write8(regs.hl, regs.e);
  regs.and(mem.read8(regs.hl));
  regs.djnz();
  return importStraight(m);
}

/** BUG: runs on past the unpaired pop into the diagonal placer, as if the stack had a word to give. */
function brokenSkipPop(m) {
  const { regs, mem } = m;
  mem.write8(regs.hl, regs.e);
  regs.and(mem.read8(regs.hl));
  if (regs.djnz() !== 0) return importStraight(m);
  importFetch(m);
  regs.incMem8(mem, regs.hl);
  return importLast(m);
}

/** BUG: the byte just past the looked-up entry is never bumped (it raises at the pop all the same). */
function brokenSkipInc(m) {
  const { regs, mem } = m;
  mem.write8(regs.hl, regs.e);
  regs.and(mem.read8(regs.hl));
  if (regs.djnz() !== 0) return importStraight(m);
  importFetch(m);
  throw new NotImplemented("loc_307f: twin");
}

// Late-bound so the twins can reuse the real dissolved callees without another import block.
let importStraight, importLast, importFetch;

const TWINS = [
  ["no-op", brokenNoOp],
  ["skip-store", brokenSkipStore],
  ["always-straight", brokenAlwaysStraight],
  ["runs-past-the-pop", brokenSkipPop],
  ["skip-inc", brokenSkipInc],
];

// Measured catch counts over the corpus (6 straight-path B values + 10 last-slot indices).
const EXPECTED = {
  "no-op": 16,
  "skip-store": 16,
  "always-straight": 10,
  "runs-past-the-pop": 10,
  "skip-inc": 10,
};

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("wire the dissolved callees for the twins", { skip }, async () => {
  const { placeTileAtTableSuppliedOffset } = await import("../placeTileAtTableSuppliedOffset.js");
  importStraight = (mm) => placeTileAtTableSuppliedOffset(mm, mm.regs.iy, mm.regs.hl, mm.regs.c, mm.regs.b, mm.regs.ix);
  ({ placeDiagonallyAbuttingTile: importLast } = await import("../placeDiagonallyAbuttingTile.js"));
  ({ fetchTableWord: importFetch } = await import("../fetchTableWord.js"));
  assert.ok(importStraight && importLast && importFetch, "a dissolved callee did not import");
});

test("UNREACHED: neither tape dispatches it, and the same rig reaches a live control", { skip }, () => {
  for (const [label, opts] of [["coin -> start", {}], ["undriven attract", { tape: [] }]]) {
    let controlErr = null;
    try {
      unitEquivalence((ov) => makeMachine(ov, opts), CONTROL, controlOracle, controlModule, {
        maxFrames: ENTRY_FRAMES,
      });
    } catch (e) {
      controlErr = e;
    }
    assert.ok(!(controlErr && /never entered/.test(controlErr.message)),
      `the ${label} rig cannot reach the live control ${hex4(CONTROL)}, so a zero here says nothing`);
    assert.throws(
      () => unitEquivalence((ov) => makeMachine(ov, opts), TARGET, oracle, loc_307f, {
        maxFrames: ENTRY_FRAMES,
      }),
      /never entered/,
      `${label} unexpectedly reached the routine — this gate should become a real capture`);
    console.log(`  UNREACHED: ${label} — ${hex4(TARGET)} never entered, control ${hex4(CONTROL)} entered`);
  }
});

test("BOTH PATHS EQUAL: straight returns with cursors and SP drift +2; last slot stops at the pop", { skip }, () => {
  {
    const label = "straight (B=3)";
    const m = craft(3);
    const r = compare(loc_307f, m);
    assert.equal(r.outcomeA, "returned", `${label}: the oracle did not return`);
    assert.equal(r.outcomeB, "returned", `${label}: the rewrite did not return (${r.outcomeB})`);
    assert.equal(r.escaped, null, `${label} escaped the mask at ${r.escaped && hex4(r.escaped.addr)}`);
    assert.deepEqual(r.regMoved, [], `${label} moved a live register: ${r.regMoved}`);
    assert.ok(r.ixMatch && r.iyMatch, `${label} did not carry the cursors`);
    assert.equal(r.spDiff, SP_DRIFT, `${label} SP drift moved`);
    // The oracle hands its cursors back in IX/IY (its JS return is undefined); the rewrite returns them.
    assert.equal(r.retOracle, undefined, `${label}: the frozen routine returned a JS value`);
    assert.deepEqual(r.retCand, r.cursorsOracle, `${label}: the rewrite does not return the oracle's IX/IY cursors`);
    // The mask floor sits above every cell either side moves -- proven, not assumed.
    assert.ok(r.low > DATA_TOP, `${label} stack window ${hex4(r.low)} reached into game data`);
    assert.ok(footprintTop(m) <= DATA_TOP, `${label} wrote above ${hex4(DATA_TOP)}`);
    console.log(`  ${label}: window [${hex4(r.low)},${hex4(r.seat)}) masked, spDiff ${r.spDiff}`);
  }
  {
    const label = "last-slot (B=1)";
    const m = craft(1, { index: 5 });
    const r = compare(loc_307f, m);
    assert.equal(r.outcomeA, "pop", `${label}: the oracle did not reach the unpaired pop`);
    assert.equal(r.outcomeB, "pop", `${label}: the rewrite did not raise at the pop (${r.outcomeB})`);
    assert.equal(r.escaped, null, `${label} escaped the mask at ${r.escaped && hex4(r.escaped.addr)}`);
    assert.ok(r.low > DATA_TOP, `${label} stack window ${hex4(r.low)} reached into game data`);
    assert.ok(footprintTop(m) <= DATA_TOP, `${label} wrote above ${hex4(DATA_TOP)}`);
    // Anti-vacuity: the bump before the pop really moved a cell, so RAM-at-the-pop has something to hold.
    const before = m.dumpState().slice();
    const probe = m.clone();
    try { loc_307f(probe); } catch { /* raises at the pop */ }
    assert.ok(probe.dumpState().some((v, i) => v !== before[i]), `${label}: nothing moved before the pop`);
    console.log(`  ${label}: both stop at the pop, RAM identical outside [${hex4(r.low)},${hex4(r.seat)})`);
  }
});

test("NOT VACUOUS: a no-op candidate is caught on both paths", { skip }, () => {
  assert.ok(caught(brokenNoOp, craft(3)), "the straight path passed a no-op, so RAM is not the gate");
  assert.ok(caught(brokenNoOp, craft(1, { index: 5 })), "the last-slot path passed a no-op");
  console.log("  NOT VACUOUS: the empty candidate is caught on both paths");
});

test("EXCLUDED, deliberately: only the scrambled set moves, and the check still sees one outside it", { skip }, () => {
  const moved = new Set();
  // Registers are a contract only where both sides return: the straight-path entries.
  for (const m of corpus().filter((mm) => ((mm.regs.b - 1) & 0xff) !== 0)) {
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    loc_307f(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  assert.ok(caught(clobbersARegisterOutsideTheCeiling, craft(3)),
    "the control twin clobbers h_ and is NOT caught, so the live-out check proves nothing");
  assert.deepEqual(compare(clobbersARegisterOutsideTheCeiling, craft(3)).regMoved, ["h_"],
    "the control is caught for some reason other than the clobbered register");
  const unexpected = REG_FIELDS.filter((k) => moved.has(k) && !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], `a register moved outside the excluded set: ${unexpected}`);
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
});

test("DEAD AT EXIT: A, as the frozen routine leaves it, is read by nothing after it", { skip }, () => {
  const exits = assertDeadAtExit({
    at: TARGET, poison: ["a"], frames: ENTRY_FRAMES,
    sessions: DEAD_SESSIONS.map(([label, tape, dispatches]) =>
      ({ label, tape, pokes: DIVERT_POKES, dispatches })),
    // ENTRY CONTROL: E is the coordinate stored through the pointer; nudged on the way in it must be heard.
    controls: [{
      label: "entry", poison: ["e"], flip: { e: 0x01 }, before: true, every: true, reachEvery: true,
    }],
  });
  for (const r of exits) {
    assert.equal(r.dead.stopped, null, `${r.label}: the poisoned run stopped early: ${r.dead.stopped}`);
    assert.ok(heard(r.exitControl),
      `${r.label}: the SP nudge at this exit went unheard, so the exit poison never lands`);
  }
  console.log("  DEAD AT EXIT: the exit control and the E entry control are heard in every session");
});

test("BRANCH SWEEP: every one of the 256 counter values replays identically", { skip }, () => {
  let path2 = 0;
  for (let b = 0; b < 256; b++) {
    const m = craft(b, { index: b });
    assert.ok(!caught(loc_307f, m), `B=${b} diverged: ${show(compare(loc_307f, m).escaped)}`);
    if (compare(loc_307f, m).outcomeA === "pop") {
      assert.equal((b - 1) & 0xff, 0, `B=${b} reached the pop without exhausting the counter`);
      path2++;
    }
  }
  assert.equal(path2, 1, "exactly one counter value should exhaust to the last-slot path");
  console.log("  BRANCH SWEEP: 256 counter values identical, one last-slot path among them");
});

test("INDEX SWEEP: the last-slot lookup is identical up to the pop across all 256 indices, wrap included", { skip }, () => {
  for (let index = 0; index < 256; index++) {
    const m = craft(1, { index });
    assert.ok(!caught(loc_307f, m), `index ${index} diverged: ${show(compare(loc_307f, m).escaped)}`);
  }
  console.log("  INDEX SWEEP: 256 last-slot indices identical at the pop");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of the corpus`, { skip }, () => {
    const n = corpusCaught(twin);
    console.log(`  TEETH/${label}: caught on ${n} of ${corpus().length}`);
    assert.ok(n > 0, `the corpus missed the ${label} twin everywhere`);
    assert.equal(n, EXPECTED[label], `the ${label} twin's catch count moved`);
  });
}
