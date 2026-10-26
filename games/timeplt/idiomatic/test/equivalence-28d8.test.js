// SPDX-License-Identifier: GPL-3.0-only
/**
 * seatCraftSlot3ThenDispatchByEra — memory-equivalent to the frozen oracle at ROM 0x28D8.
 *
 * WHAT IT IS. Three instructions: two immediates loaded into the index registers, then a transfer
 * to the era dispatch. It pushes nothing for that dispatch to come back to, so the arm the era
 * picks returns past this entry and nothing of this entry runs after it.
 *
 * ★ HOW THE LIVE-OUT WAS DERIVED, and it is from the ORACLE and its call site — never from the
 *   rewrite. The oracle's only exit is that transfer, so its exit successor is the ARM: whatever
 *   the arm writes is this entry's product, and every arm below is RUN rather than compared as an
 *   address. The two index registers are the successor's INPUTS, not this entry's outputs, and the
 *   call site says so: the frozen caller reaches this entry from a run of siblings, and the next
 *   sibling re-loads BOTH index registers before its own transfer, while the two siblings that do
 *   not re-load them unconditionally read their condition out of memory rather than out of a
 *   register. So no register carries back across the seam, and the live-out is memory plus the
 *   arm's. The EXCLUDED arm below MEASURES which registers survive rather than declaring it, and
 *   it is a CEILING: nothing outside the declared set may diverge, and the set is not required to
 *   be filled. The ceiling holds the scratch registers because the rewrite runs the LIFTED arms,
 *   which leave them otherwise than the transcribed ones do. That they are dead is not argued from
 *   the ROM alone: DEAD AT EXIT flips every bit of every register in the ceiling on the FROZEN game
 *   at each of this entry's exits, for each whole session, and not one frame of state changes,
 *   while the same instrument does hear a one-record shift of the record register on the way in.
 *
 * ★ THE COMPARISON IS MASKED BELOW THE EXIT STACK POINTER, and the mask is accounted for rather
 *   than assumed. Two things write there on the frozen side and not on the rewrite's. The frozen
 *   dispatch chain pushes and pops nested return addresses just under the arm's frame; a PROBE
 *   TWIN that reproduces exactly that stack traffic and hand-off, over the frozen arms, leaves ZERO
 *   raw difference at every dispatch of all three sessions, so the chain's share is identified
 *   rather than told. The rest is the arms' own: the rewrite runs the lifted arm, which reaches its
 *   helpers by direct call, where the frozen arm's calls park return addresses deeper in the same
 *   free stack. Every masked byte lies strictly below the exit pointer, in stack the machine has
 *   already given back, and SCRATCH asserts both that and the measured depth.
 *
 * ★ SP AND pc BELONG TO THE DISPATCH SEAM. The oracle nets exactly one return, through the arm's
 *   own; the rewrite and the lifted arm perform none. Every candidate is therefore run THROUGH
 *   `withOmittedRet`, the way the registry wires this entry, and exit pointer and program counter
 *   are then compared for EQUALITY. SP-TOOTH shows the seam placing the rewrite and refusing a
 *   rewrite that parks a word nothing lifts, or lifts one it was never given.
 *
 * ★ THIS ENTRY HAS THREE NEAR-NEIGHBOURS OF THE SAME SHAPE AND TWO THAT ONLY LOOK LIKE IT, and
 *   that is asserted here rather than assumed. Reading the family as one thing is how a gate that
 *   passes anything gets written, so two arms attack it: a NEIGHBOUR twin loads each sibling's
 *   immediates in place of this entry's and must be caught, and a GUARDED twin adds the
 *   memory-tested early return the two odd siblings carry and must be caught when that cell is
 *   set and NOT caught when it is clear. The second is the two-sided control: the instrument is
 *   shown able to see a guard in the same breath as it reports this entry has none.
 *
 * ★ THE RECORD THIS ENTRY AIMS AT IS BUSY IN ALL THREE SESSIONS, which is what separates this
 *   address from two of its neighbours rather than anything in its own three instructions. Ten of
 *   the twelve twins are caught by real dispatches of every session here. The two that are not are
 *   the ones whose bug needs a state a played session does not present, and their zeros are
 *   recorded below rather than summed away. One era the attract session presents contributes no
 *   informative dispatch at all, so the entry kept for it is a plain first dispatch.
 *
 * GATE: strict unit-capture over three sessions, crafted arms, selectors and guard states off
 *   every kept entry, and a whole-run diff. What it exercises, holes stated:
 *
 *   1. DISPATCHED — each session's dispatch count, the eras it presents, and how many of those
 *      dispatches are INFORMATIVE, meaning the frozen side writes something outside the mask.
 *   2. EQUAL — masked RAM identical at every kept entry, raw difference reported.
 *   3. SCRATCH — every raw differing byte lies strictly BELOW the exit pointer and no deeper than
 *      the window, both asserted rather than assumed, and the mask is required to be measuring
 *      something.
 *   4. CAUSE — the probe twin above, which must leave nothing at all.
 *   5. CORPUS — every dispatch of all three sessions replayed.
 *   6. ARMS — all eight table entries off every kept entry, identical or faulting identically.
 *   7. SELECTOR — all 256 values of the era cell, so the five ignored bits are measured.
 *   8. GUARD — the two-sided control described above.
 *   9. STACK — exit pointer and program counter identical on every arm that completes, and on
 *      every real dispatch, the candidate run through the seam.
 *  10. SP-TOOTH — the seam places the rewrite on every completing arm and refuses two mutants.
 *  11. DEAD AT EXIT — the ceiling below, poisoned on the frozen game at every exit of each whole
 *      session, changes nothing, beside a control the same instrument does hear.
 *  12. EXCLUDED — a ceiling on the registers that may diverge, plus the ones asserted HELD.
 *  13. WHOLE RUN — the rewrite dispatched through the seam for a whole session, cycle-matched, must
 *      leave the per-frame state byte-identical; uncompensated it may differ only in stack bytes.
 *  14. TEETH — twelve twins, each with an exact catch count per session and a recorded whole-run
 *      verdict.
 *  15. ATTRACT WHOLE RUN — the attract tape, where this record is live, replayed whole: the rewrite
 *      differs only in dead stack inside the window below a measured exit pointer, and the
 *      do-nothing twin is seen outside it.
 *
 * HOLE: the sessions present eras 0, 1 and 2 and no other; the remaining selectors are crafted off
 * entries their era would not really produce, and where such an arm faults it is asserted only to
 * fault IDENTICALLY on both sides, never to be correct.
 * HOLE: two of the eight table words address nothing this port has transcribed, so of those two
 * the sweep can say only that both sides fault the same way.
 * HOLE: the WHOLE RUN arm replays the coin-start tape, and the attract tape only for the do-nothing
 * twin; the other twins' whole-run verdicts are for the coin-start tape alone.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-28d8.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { seatCraftSlot3ThenDispatchByEra } from "../seatCraftSlot3ThenDispatchByEra.js";
import { dispatchSeatedSlotByEraIndex } from "../dispatchSeatedSlotByEraIndex.js";
import { ERA_INDEX } from "../names.js";
import { loc_28d8 as oracle } from "../../translated/loc_28d8.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { withOmittedRet } from "../../machine.js";
import { deadStackBelow, seamPlaceable } from "../../../../core/equivalence.js";
import { assertDeadAtExit } from "./_deadAtExit.js";
import { recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x28d8;
/** The era-keyed dispatch this entry hands its seated pair to. */
const HANDLER = 0x290e;

/** The two immediates this entry loads. */
const CRAFT_RECORD = 0xa880;
const DISPLAY_ENTRY = 0xaa20;
/** The cell the two DIFFERENTLY-SHAPED siblings test before they do anything. */
const GUARD_CELL = 0xad0d;
const GUARD_SET = 255;

const ARM_TABLE = 0x2914;
const ARM_MASK = 0x07;
const ARM_COUNT = ARM_MASK + 1;
const RECORD_STRIDE = 0x10;
const ENTRY_STRIDE = 2;
const SELECTOR_VALUES = 256;

/** Bytes below the exit stack pointer the frozen chain's and frozen arm's dead scratch reach; measured. */
const WINDOW = 14;
/** The slot the frozen caller parked for this entry, measured at every dispatch. */
const EXIT_PC = 0x28ad;

const WHOLE_FRAMES = 1400;
/** Uncompensated, the rewrite spends fewer cycles and the interrupt lands elsewhere; measured. */
const WHOLE_RUN_STACK_CELLS = [0xaffd, 0xaffe];
const STACK_FLOOR = 0xafc0;
const STACK_TOP = 0xb000;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 40;
const TURN_FIRST_FRAME = 640;
const FIRE_FRAME = 620;
const DRIVEN_FRAMES = 4000;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

/** A candidate as an assembled run reaches it: through the seam that supplies the omitted return. */
const seam = (candidate) => withOmittedRet(candidate, TARGET);

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (ds) =>
  ds.length === 0 ? "identical" : ds.slice(0, 6).map((d) => `${hex4(d.addr)}(${d.a}/${d.b})`).join(" ");

// ── the sessions ────────────────────────────────────────────────────────────────────────

/** Coin, start, then fire held down while the heading is walked round the compass. */
function drivenTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: FIRE_FRAME, port: IN1, bits: 0x10, dur: DRIVEN_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09];
  let frame = TURN_FIRST_FRAME;
  while (frame < DRIVEN_FRAMES) {
    for (const bits of compass) {
      tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
      frame += TURN_HOLD;
    }
  }
  return tape;
}

/**
 * Per session: how many dispatches, era -> how many presented it, and era -> how many of those the
 * frozen side writes anything outside the mask at. Measured; a move is a finding about which
 * states the sessions reach, not a tolerance to widen.
 */
const SESSIONS = [
  {
    label: "shared",
    tape: undefined,
    frames: 2000,
    dispatches: 598,
    spread: [[0, 598]],
    informative: [[0, 366]],
  },
  {
    label: "attract",
    tape: [],
    frames: 6000,
    dispatches: 3919,
    spread: [[1, 3228], [2, 691]],
    informative: [[1, 2063]],
  },
  {
    label: "driven",
    tape: drivenTape(),
    frames: DRIVEN_FRAMES,
    dispatches: 1457,
    spread: [[0, 1023], [1, 434]],
    informative: [[0, 713], [1, 144]],
  },
];

/**
 * A CEILING, measured: the chain's hand-off registers, and the scratch registers the lifted arms
 * leave otherwise than the transcribed ones. DEAD AT EXIT shows every one dead at this entry's exit.
 */
const MOVED = ["a", "f", "b", "c", "d", "e", "h", "l", "a_", "ix", "iy"];
/**
 * Named separately so a failure says which: the seat. The two cursors are in the ceiling: the rewrite hands
 * them to the handler as arguments, and DEAD AT EXIT flips both on the frozen game where this entry hands
 * back with nothing after it hearing them.
 */
const HELD = ["sp"];

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** A twin that aims whichever cursors it is given and leaves the others as it found them. */
const aimedAt = (record, entry) => (m) => {
  if (record !== undefined) m.regs.ix = record;
  if (entry !== undefined) m.regs.iy = entry;
  return dispatchSeatedSlotByEraIndex(m);
};

/** BUG: does nothing — neither cursor, nor the arm. */
function brokenNoOp() {}

/** BUG: both cursors aimed, but the era's arm is never run. */
function brokenArmNotRun(m) {
  m.regs.ix = CRAFT_RECORD;
  m.regs.iy = DISPLAY_ENTRY;
}

/** BUG: the arm runs on whatever the previous entry left in the cursors. */
function brokenPointersNotSet(m) {
  return dispatchSeatedSlotByEraIndex(m);
}

/** BUG: the early return the two odd siblings carry, grafted onto an entry that has none. */
function brokenGuarded(m) {
  if (m.mem8[GUARD_CELL] !== 0) return undefined;
  m.regs.ix = CRAFT_RECORD;
  m.regs.iy = DISPLAY_ENTRY;
  return dispatchSeatedSlotByEraIndex(m);
}

/** BUG: the era is ignored and the first arm always taken. */
function brokenFirstArmAlways(m) {
  m.regs.ix = CRAFT_RECORD;
  m.regs.iy = DISPLAY_ENTRY;
  return m.call(m.mem16[ARM_TABLE]);
}

/**
 * Per twin: an exact catch count for each session in SESSIONS order, and whether the whole run
 * sees it. Both are MEASURED. A twin no real dispatch of a session catches is recorded with its
 * zero rather than dropped — the zero says which session is blind to it, which is the point.
 */
const TWINS = [
  ["no-op", brokenNoOp, [366, 2063, 857], true],
  ["arm-not-run", brokenArmNotRun, [366, 2063, 857], true],
  ["pointers-not-set", brokenPointersNotSet, [366, 2781, 1007], true],
  ["record-only", aimedAt(CRAFT_RECORD, undefined), [366, 1948, 854], true],
  ["entry-only", aimedAt(undefined, DISPLAY_ENTRY), [366, 2781, 1007], true],
  ["record-one-slot-on", aimedAt(CRAFT_RECORD + RECORD_STRIDE, DISPLAY_ENTRY), [426, 2909, 1163], true],
  ["entry-one-on", aimedAt(CRAFT_RECORD, DISPLAY_ENTRY + ENTRY_STRIDE), [366, 1952, 854], true],
  ["guarded", brokenGuarded, [0, 370, 0], false],
  ["first-arm-always", brokenFirstArmAlways, [0, 1420, 70], false],
  ["neighbour-28b7", aimedAt(0xa850, 0xaa1a), [366, 2502, 857], true],
  ["neighbour-28c2", aimedAt(0xa860, 0xaa1c), [366, 2441, 857], true],
  ["neighbour-28cd", aimedAt(0xa870, 0xaa1e), [366, 2781, 1007], true],
];

/**
 * NOT A BROKEN TWIN. This reproduces the frozen chain's stack traffic and register hand-off — the
 * transfer's own push, the nested calls it makes and their returns, and the arithmetic that leaves
 * the arm's address and the table pointer where the chain leaves them. If the dead scratch really
 * is the whole of the difference, this must leave none at all.
 */
function probeReproducesTheChain(m) {
  const { regs } = m;
  regs.ix = CRAFT_RECORD;
  regs.iy = DISPLAY_ENTRY;
  regs.a = m.mem8[ERA_INDEX];
  regs.and(ARM_MASK);
  m.push16(ARM_TABLE);
  regs.hl = m.pop16();
  m.push16(0x0032);
  regs.add(regs.a);
  m.push16(0x0012);
  const landed = (regs.hl + regs.a) & 0xffff;
  regs.hl = landed;
  regs.a = landed & 0xff;
  m.pop16();
  m.pop16();
  regs.e = m.mem8[regs.hl];
  regs.hl = (regs.hl + 1) & 0xffff;
  regs.d = m.mem8[regs.hl];
  regs.hl = (regs.hl + 1) & 0xffff;
  const arm = regs.de;
  regs.de = regs.hl;
  regs.hl = arm;
  return m.call(arm);
}

const MODULE = "module";
const PROBE = "cause-probe";
const CANDIDATES = [[MODULE, seatCraftSlot3ThenDispatchByEra], [PROBE, probeReproducesTheChain], ...TWINS.map(([l, f]) => [l, f])];

// ── the masked comparison ───────────────────────────────────────────────────────────────

/**
 * Run both sides on clones of one machine and report the raw difference, the masked one, how each
 * side faulted, and whether the comparison has any POWER here — `informative` is the frozen side's
 * own masked footprint against the untouched entry, which is exactly what a candidate doing
 * nothing would be caught by. It costs one extra dump rather than a second emulation.
 */
function diffOf(candidate, machine) {
  const before = machine.dumpState();
  const a = machine.clone();
  const b = machine.clone();
  let faultA = null;
  let faultB = null;
  try { oracle(a); } catch (e) { faultA = e.constructor.name; }
  try { seam(candidate)(b); } catch (e) { faultB = e.constructor.name; }
  const moved = faultA || faultB ? [] : REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);

  const da = a.dumpState();
  const db = b.dumpState();
  const exitSp = a.regs.sp;
  const dead = deadStackBelow({ lo: exitSp - WINDOW, hi: exitSp }, machine.regs.sp); // cut at the entry SP
  const outside = (addr) => !dead(addr);
  const raw = [];
  let informative = false;
  for (let off = 0; off < da.length; off++) {
    const addr = a.stateOffsetToAddr(off);
    if (da[off] !== db[off]) raw.push({ addr, a: da[off], b: db[off] });
    if (da[off] !== before[off] && outside(addr)) informative = true;
  }
  const masked = raw.filter((d) => outside(d.addr));
  const faulted = faultA !== null || faultB !== null;
  return {
    raw,
    masked,
    informative,
    moved,
    exitSp,
    spB: b.regs.sp,
    pcA: a.pc,
    pcB: b.pc,
    faultA,
    faultB,
    faulted,
    caught: faulted ? faultA !== faultB : masked.length > 0 || exitSp !== b.regs.sp || a.pc !== b.pc,
  };
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

/** Kept per session and era: the first dispatch, and the first INFORMATIVE one where there is
 *  such a dispatch at all. The crafted sweeps run off every one of them. */
const kept = new Map();

function keep(label, era, informative, machine) {
  const key = `${label}/${era}`;
  let slot = kept.get(key);
  if (!slot) {
    slot = { first: null, informative: null };
    kept.set(key, slot);
  }
  if (slot.first === null) slot.first = machine.clone();
  if (informative && slot.informative === null) slot.informative = machine.clone();
}

const cache = new Map();

function runSession(spec) {
  const spread = new Map();
  const informative = new Map();
  const moved = new Set();
  const caught = new Map(CANDIDATES.map(([label]) => [label, 0]));
  const exitPcs = new Set();
  const exitSps = new Set();
  let dispatches = 0;
  let deepest = 0;
  let escaped = 0;
  let probeRawBytes = 0;
  let stackMoved = 0;
  const opts = spec.tape === undefined ? {} : { tape: spec.tape };
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const era = mm.mem8[ERA_INDEX] & ARM_MASK;
    spread.set(era, (spread.get(era) ?? 0) + 1);
    for (const [label, fn] of CANDIDATES) {
      const r = diffOf(fn, mm);
      if (r.caught) caught.set(label, caught.get(label) + 1);
      if (label === PROBE) probeRawBytes += r.raw.length;
      if (label !== MODULE) continue;
      if (r.informative) informative.set(era, (informative.get(era) ?? 0) + 1);
      keep(spec.label, era, r.informative, mm);
      for (const k of r.moved) moved.add(k);
      exitPcs.add(r.pcA);
      exitSps.add(r.exitSp);
      if (r.exitSp !== r.spB || r.pcA !== r.pcB) stackMoved++;
      for (const d of r.raw) {
        if (d.addr >= r.exitSp) escaped++;
        else deepest = Math.max(deepest, r.exitSp - d.addr);
      }
    }
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(spec.frames);
  assert.equal(m.stoppedBy, null, `the ${spec.label} session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, spec.frames, `the ${spec.label} session ran short`);
  return { dispatches, spread, informative, moved, caught, deepest, escaped, probeRawBytes, stackMoved, exitPcs, exitSps };
}

function session(spec) {
  if (!cache.has(spec.label)) cache.set(spec.label, runSession(spec));
  return cache.get(spec.label);
}

function allSessions() {
  return SESSIONS.map((spec) => [spec, session(spec)]);
}

// ── crafted entries ─────────────────────────────────────────────────────────────────────

function bases() {
  allSessions();
  const out = [];
  for (const [key, slot] of kept) {
    if (slot.informative) out.push([`${key}/informative`, slot.informative]);
    else out.push([`${key}/first`, slot.first]);
  }
  assert.ok(out.length > 0, "no session reaches this entry at all");
  return out;
}

function informativeBases() {
  allSessions();
  const out = [];
  for (const [key, slot] of kept) if (slot.informative) out.push([key, slot.informative]);
  return out;
}

function craft(base, era, guard) {
  const m = base.clone();
  if (era !== undefined) m.mem8[ERA_INDEX] = era;
  if (guard !== undefined) m.mem8[GUARD_CELL] = guard;
  return m;
}

// ── the whole run ───────────────────────────────────────────────────────────────────────

const baselineRuns = new Map();
function baseline(spec) {
  if (!baselineRuns.has(spec.label)) {
    const base = makeMachine(undefined, spec.tape === undefined ? {} : { tape: spec.tape });
    const floors = recordFrameFloors(base);
    const frames = base.runFrames(spec.frames);
    assert.equal(base.stoppedBy, null, `the ${spec.label} baseline run stopped early: ${base.stoppedBy}`);
    baselineRuns.set(spec.label, { frames, floors, offsetToAddr: (o) => base.stateOffsetToAddr(o) });
  }
  return baselineRuns.get(spec.label);
}

/** The session the whole-run arms replay unless told otherwise. */
const WHOLE_SESSION = { label: "whole", tape: undefined, frames: WHOLE_FRAMES };
/** The session in which this entry's record is live; see the attract row of SESSIONS. */
const LIVE_WHOLE_SESSION = { ...SESSIONS.find((spec) => spec.label === "attract"), label: "attract-whole" };

/**
 * Dispatch `candidate` in place of the frozen entry for a whole session and collect every cell
 * whose per-frame trace differs from the all-frozen baseline. `matchCycles` spends the cycles the
 * frozen side would have spent, which is the difference between measuring the rewrite and
 * measuring the absence of its T-states. The candidate is dispatched through the seam, as the
 * registry wires it.
 */
function wholeRun(candidate, matchCycles, spec = WHOLE_SESSION) {
  const base = baseline(spec);
  let fired = 0;
  let overspent = 0;
  const seated = seam(candidate);
  const host = makeMachine(new Map([[TARGET, (mm) => {
    fired++;
    if (!matchCycles) return seated(mm);
    const probe = mm.clone();
    const probeBefore = probe.cycles;
    oracle(probe);
    const owed = probe.cycles - probeBefore;
    const before = mm.cycles;
    const r = seated(mm);
    const spent = mm.cycles - before;
    if (owed < spent) overspent++;
    else mm.tick(owed - spent);
    return r;
  }]]), spec.tape === undefined ? {} : { tape: spec.tape });
  let frames = [];
  let threw = null;
  try {
    frames = host.runFrames(spec.frames);
  } catch (e) {
    threw = e.constructor.name;
  }
  const cells = new Set();
  const live = new Set(); // differed at or above the baseline sample's SP: a live frame, never scratch
  const n = Math.min(base.frames.length, frames.length);
  for (let i = 0; i < n; i++) {
    const x = base.frames[i];
    const y = frames[i];
    for (let o = 0; o < x.length; o++) {
      if (x[o] === y[o]) continue;
      cells.add(base.offsetToAddr(o));
      if (base.offsetToAddr(o) >= base.floors[i]) live.add(base.offsetToAddr(o));
    }
  }
  return { cells: [...cells].sort((a, b) => a - b), live, frames: n, fired, threw, overspent, stopped: host.stoppedBy };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

for (const spec of SESSIONS) {
  test(`DISPATCHED: the ${spec.label} session reaches this entry with a measured era spread`, { skip }, () => {
    const s = session(spec);
    assert.equal(s.dispatches, spec.dispatches, "the dispatch count moved");
    assert.deepEqual(
      [...s.spread.entries()].sort((a, b) => a[0] - b[0]),
      spec.spread,
      "the spread of eras the session presents moved",
    );
    assert.deepEqual(
      [...s.informative.entries()].sort((a, b) => a[0] - b[0]),
      spec.informative,
      "the share of dispatches the frozen side writes anything at moved",
    );
    console.log(
      `  DISPATCHED/${spec.label}: ${s.dispatches} times, eras ` +
        `${[...s.spread].map(([k, v]) => `${k}x${v}`).join(" ")}; informative ` +
        `${[...s.informative].map(([k, v]) => `${k}x${v}`).join(" ") || "none"}`,
    );
  });
}

test("EQUAL at every kept entry: masked RAM identical", { skip }, () => {
  for (const [label, base] of bases()) {
    const r = diffOf(seatCraftSlot3ThenDispatchByEra, base);
    assert.equal(r.faultA, null, `${label}: the frozen side faulted (${r.faultA})`);
    assert.equal(r.faultB, null, `${label}: the rewrite faulted (${r.faultB})`);
    assert.deepEqual(r.masked, [], `${label}: ${show(r.masked)}`);
    console.log(`  EQUAL: ${label}, exit pointer ${hex4(r.exitSp)}, raw difference ${show(r.raw)}`);
  }
});

test("SCRATCH: the whole raw difference lies below the exit pointer, inside the window", { skip }, () => {
  let deepest = 0;
  let seen = 0;
  for (const [label, base] of bases()) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(seatCraftSlot3ThenDispatchByEra, craft(base, i));
      for (const d of r.raw) {
        assert.ok(d.addr < r.exitSp, `${label} arm ${i}: ${hex4(d.addr)} is at or above the exit pointer`);
        deepest = Math.max(deepest, r.exitSp - d.addr);
        seen++;
      }
    }
  }
  for (const [spec, s] of allSessions()) {
    assert.equal(s.escaped, 0, `${spec.label}: a difference reached or passed the exit pointer`);
    deepest = Math.max(deepest, s.deepest);
    seen += s.deepest > 0 ? 1 : 0;
  }
  assert.ok(seen > 0, "no raw difference anywhere: the mask is not measuring anything, so it " +
    "cannot be what makes this gate pass and should be removed");
  assert.ok(
    deepest <= WINDOW,
    `the deepest difference is ${deepest} bytes below the exit pointer, past the ${WINDOW}-byte ` +
      "window this file masks — widen it deliberately, do not let it drift",
  );
  console.log(`  SCRATCH: raw differences seen, deepest ${deepest} below the exit pointer, ` +
    `window ${WINDOW}, none at or above it`);
});

test("CAUSE: reproducing the frozen chain's stack traffic leaves NO difference at all", { skip }, () => {
  for (const [spec, s] of allSessions()) {
    assert.equal(s.caught.get(PROBE), 0, `${spec.label}: the probe diverged outside the window`);
    assert.equal(s.probeRawBytes, 0, `${spec.label}: the probe still leaves ${s.probeRawBytes} bytes ` +
      "of scratch, so the chain's stack traffic is NOT the whole of the difference and the mask is " +
      "covering something this file has not identified");
    console.log(`  CAUSE/${spec.label}: ${s.dispatches} dispatches, nothing differs, unmasked`);
  }
});

for (const spec of SESSIONS) {
  test(`CORPUS: every dispatch of the ${spec.label} session replays identically`, { skip }, () => {
    const s = session(spec);
    assert.equal(s.caught.get(MODULE), 0, "the rewrite diverged on a real dispatch");
    console.log(`  CORPUS/${spec.label}: ${s.dispatches} real dispatches, none diverging`);
  });
}

test("ARMS: every table entry runs identically, or faults identically", { skip }, () => {
  let faulted = 0;
  let informative = 0;
  let total = 0;
  for (const [label, base] of bases()) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(seatCraftSlot3ThenDispatchByEra, craft(base, i));
      total++;
      if (r.informative) informative++;
      if (r.faulted) {
        assert.equal(r.faultA, r.faultB, `${label} arm ${i}: ${r.faultA} on one side, ${r.faultB} on the other`);
        faulted++;
        continue;
      }
      assert.deepEqual(r.masked, [], `${label} arm ${i}: ${show(r.masked)}`);
    }
  }
  assert.ok(faulted < total, "every arm faulted, on every entry: this sweep proves nothing");
  assert.ok(informative > 0, "no swept arm wrote anything outside the window, so `identical` here " +
    "is a comparison with no power rather than a result");
  console.log(`  ARMS: ${total} entries swept, ${faulted} faulting identically on both sides, ` +
    `${informative} writing anything`);
});

test("SELECTOR: the five high bits are ignored, over the cell's whole range", { skip }, () => {
  let informative = 0;
  let total = 0;
  for (const [label, base] of bases()) {
    for (let v = 0; v < SELECTOR_VALUES; v++) {
      const r = diffOf(seatCraftSlot3ThenDispatchByEra, craft(base, v));
      total++;
      if (r.informative) informative++;
      if (r.faulted) assert.equal(r.faultA, r.faultB, `${label} selector ${v}: ${r.faultA} vs ${r.faultB}`);
      else assert.deepEqual(r.masked, [], `${label} selector ${v}: ${show(r.masked)}`);
    }
  }
  assert.ok(informative > 0, "no crafted selector wrote anything outside the window");
  console.log(`  SELECTOR: ${total} crafted selectors identical, ${informative} of them writing ` +
    "something — only three bits can matter");
});

test("GUARD: this entry tests no cell before acting, and the instrument can see one that does", { skip }, () => {
  const seen = informativeBases();
  assert.ok(seen.length > 0, "no kept entry writes anything outside the mask, so a guard that " +
    "suppressed the write could not be told from one that did nothing");
  let caughtWhenSet = 0;
  let caughtWhenClear = 0;
  for (const [label, base] of seen) {
    for (const value of [0, GUARD_SET]) {
      const mine = diffOf(seatCraftSlot3ThenDispatchByEra, craft(base, undefined, value));
      assert.deepEqual(mine.masked, [], `${label} with the cell at ${value}: ${show(mine.masked)}`);
      const guarded = diffOf(brokenGuarded, craft(base, undefined, value));
      if (guarded.caught) {
        if (value === 0) caughtWhenClear++;
        else caughtWhenSet++;
      }
    }
  }
  console.log(`  GUARD: ${seen.length} entries, the grafted guard caught ${caughtWhenSet} times with ` +
    `the cell set and ${caughtWhenClear} times with it clear`);
  assert.ok(caughtWhenSet > 0, "the grafted guard was caught NOWHERE with the cell set, so this " +
    "arm cannot tell a guarded sibling from this entry and proves nothing about the shape");
  assert.equal(caughtWhenClear, 0, "the grafted guard was caught with the cell CLEAR, where it is " +
    "supposed to behave exactly as this entry does — so the catch is not the guard");
});

test("STACK: the exit pointer and the program counter are identical", { skip }, () => {
  let completed = 0;
  for (const [label, base] of bases()) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(seatCraftSlot3ThenDispatchByEra, craft(base, i));
      if (r.faulted) continue;
      assert.equal(r.exitSp, r.spB, `${label} arm ${i}: exit pointers ${hex4(r.exitSp)} and ${hex4(r.spB)}`);
      assert.equal(r.pcA, r.pcB, `${label} arm ${i}: program counters ${hex4(r.pcA)} and ${hex4(r.pcB)}`);
      completed++;
    }
  }
  assert.ok(completed > 0, "no arm completed, so nothing here compared a stack pointer");
  for (const [spec, s] of allSessions()) {
    assert.equal(s.stackMoved, 0, `${spec.label}: a real dispatch moved the pointer or the counter`);
    assert.deepEqual([...s.exitPcs], [EXIT_PC], `${spec.label}: the slot the caller parked moved`);
  }
  console.log(`  STACK: ${completed} completing arms plus every real dispatch, exit pointer and ` +
    `program counter identical, counter ${hex4(EXIT_PC)}`);
});

/** SP MUTANT: the rewrite exactly, after parking a word nothing will lift. */
function mutantParksAWord(m) {
  m.push16(EXIT_PC);
  return seatCraftSlot3ThenDispatchByEra(m);
}

/** SP MUTANT: the rewrite exactly, after lifting a word it was never given. */
function mutantLiftsAWord(m) {
  m.pop16();
  return seatCraftSlot3ThenDispatchByEra(m);
}

test("SP-TOOTH: the seam places the rewrite, and refuses one that parks or lifts a word", { skip }, () => {
  let placed = 0;
  for (const [label, base] of bases()) {
    for (let i = 0; i < ARM_COUNT; i++) {
      if (diffOf(seatCraftSlot3ThenDispatchByEra, craft(base, i)).faulted) continue;
      const good = seamPlaceable(withOmittedRet, seatCraftSlot3ThenDispatchByEra, TARGET, craft(base, i));
      assert.equal(good.placeable, true, `${label} arm ${i}: the seam could not place the rewrite: ${good.error}`);
      for (const [shape, mutant] of [["parks", mutantParksAWord], ["lifts", mutantLiftsAWord]]) {
        const bad = seamPlaceable(withOmittedRet, mutant, TARGET, craft(base, i));
        assert.equal(bad.placeable, false, `${label} arm ${i}: the seam placed a rewrite that ${shape} a word`);
        assert.ok(diffOf(mutant, craft(base, i)).caught, `${label} arm ${i}: the gate passed a rewrite that ${shape} a word`);
      }
      placed++;
    }
  }
  assert.ok(placed > 0, "no arm completed, so the seam placed nothing here");
  console.log(`  SP-TOOTH: ${placed} completing arms placed; both stack mutants refused on every one`);
});

test("DEAD AT EXIT: on the frozen game, every register in the ceiling is dead where this entry hands back", { skip }, () => {
  assertDeadAtExit({
    at: TARGET, poison: MOVED, sessions: SESSIONS,
    controls: [{
      // POSITIVE CONTROL, same instrument: shift the record register one record on, on this entry's
      // way INTO the arm, where it is read. Silence at the exit means something only if this is heard.
      label: "entry", at: HANDLER, poison: ["ix"], flip: { ix: RECORD_STRIDE }, before: true,
      only: (m) => m.regs.ix === CRAFT_RECORD, reachEvery: true,
    }],
  });
});

test("EXCLUDED, deliberately: a CEILING on the registers that may diverge", { skip }, () => {
  const moved = new Set();
  for (const [, s] of allSessions()) for (const k of s.moved) moved.add(k);
  for (const [, base] of bases()) {
    for (let i = 0; i < ARM_COUNT; i++) for (const k of diffOf(seatCraftSlot3ThenDispatchByEra, craft(base, i)).moved) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ") || "none"}`);
  // MOVED is a CEILING, not a set the rewrite is required to fill. An equality against it would
  // DEMAND the divergence and go RED on a rewrite that became register-exact.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared cap diverged");
  for (const k of HELD) assert.ok(!moved.has(k), `a register the successor reads moved (${k})`);
});

test("WHOLE RUN: dispatched for a session, cycle-matched, the state is byte-identical", { skip }, () => {
  const matched = wholeRun(seatCraftSlot3ThenDispatchByEra, true);
  console.log(`  WHOLE RUN: ${matched.frames} frames, ${matched.fired} dispatches, differing cells ` +
    `[${matched.cells.map(hex4).join(" ")}]`);
  assert.equal(matched.threw, null, `the cycle-matched run threw: ${matched.threw}`);
  assert.equal(matched.frames, WHOLE_FRAMES, `compared ${matched.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(matched.fired > 0, "vacuous: the override never dispatched");
  assert.equal(matched.overspent, 0, "the rewrite spent MORE cycles than the frozen side at some " +
    "dispatch, so the compensation is not measuring what it claims");
  assert.deepEqual(matched.cells, [], "a cell diverged over a whole cycle-matched run");

  const bare = wholeRun(seatCraftSlot3ThenDispatchByEra, false);
  console.log(`  WHOLE RUN (uncompensated): differing cells [${bare.cells.map(hex4).join(" ")}]`);
  assert.equal(bare.threw, null, `the uncompensated run threw: ${bare.threw}`);
  for (const cell of bare.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address`);
  }
  assert.deepEqual(bare.cells, WHOLE_RUN_STACK_CELLS, "the dead stack bytes the missing T-states " +
    "leave differing moved, so this exclusion is no longer measured");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = allSessions().map(([, s]) => s.caught.get(label));
    console.log(`  TEETH/${label}: sessions catch ${counts.join("/")} of ` +
      `${allSessions().map(([, s]) => s.dispatches).join("/")}`);
    assert.deepEqual(counts, perSession, `the ${label} twin's catch counts moved`);
    assert.ok(counts.reduce((n, c) => n + c, 0) > 0,
      `NO real dispatch of ANY session catches the ${label} twin`);
  });

  test(`TEETH: the whole run sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRun(twin, true);
    const sees = r.threw !== null || r.cells.length > 0;
    console.log(`  TEETH/${label}: whole run ${sees ? `catches it (${r.threw ?? r.cells.length + " cells"})` : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(sees, wholeRunSees, `the whole run's verdict on the ${label} twin changed`);
  });
}

test("TEETH: a whole run of the attract tape, where this record is live, sees the no-op twin", { skip }, () => {
  // The lifted handler leaves the frozen handler's own stack scratch unwritten, so here, where
  // the arms really run, those bytes may differ: only inside the window below an exit pointer a
  // real dispatch was measured at, which is stack the machine has already given back.
  const exitSps = new Set(allSessions().flatMap(([, s]) => [...s.exitSps]));
  const scratch = (cell) => [...exitSps].some((sp) => cell >= sp - WINDOW && cell < sp);
  const good = wholeRun(seatCraftSlot3ThenDispatchByEra, true, LIVE_WHOLE_SESSION);
  assert.equal(good.threw, null, `the rewrite's attract run threw: ${good.threw}`);
  assert.equal(good.overspent, 0, "the rewrite spent MORE cycles than the frozen side at some dispatch");
  assert.deepEqual(good.cells.filter((c) => !scratch(c) || good.live.has(c)).map(hex4), [],
    "the rewrite's cycle-matched attract run diverged outside the dead scratch below the exit pointer");
  const bad = wholeRun(brokenNoOp, true, LIVE_WHOLE_SESSION);
  assert.ok(bad.fired > 0, "vacuous: the twin never dispatched");
  const escaped = bad.cells.filter((c) => !scratch(c) || bad.live.has(c));
  assert.ok(bad.threw !== null || escaped.length > 0, "the attract whole run is blind to a candidate that does nothing");
  console.log(`  TEETH/no-op (attract whole run): the rewrite differs only in ` +
    `[${good.cells.map(hex4).join(" ")}], below exit pointer ${[...exitSps].map(hex4).join(" ")}; ` +
    `the twin ${bad.threw ?? escaped.length + " cells outside it"}`);
});
