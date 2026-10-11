// SPDX-License-Identifier: GPL-3.0-only
/**
 * stepSevenCraftSlots — memory-equivalent to the frozen oracle at ROM 0x28A1.
 *
 * WHAT IT IS. Seven calls in a row, each to a sibling entry that seats one object record and one
 * sprite entry and then runs the era-keyed handler over them. ALL SEVEN SIBLINGS ARE ALREADY
 * DECOMPILED, so the rewrite calls them directly and dissolving those seven transfers belongs to
 * this caller's unit. What is left over is the ORDER, and one resume point per call.
 *
 * ★ WHY THIS FILE IS BUILT AROUND AN ORDER ARM, AND IT IS NOT A PRECAUTION. Each sibling works a
 *   DIFFERENT record and a DIFFERENT sprite entry, so the seven writes do not overlap and the
 *   memory comparison cannot see what order they happened in. Measured, not assumed: the SWAP and
 *   REVERSED twins below are caught on ZERO of the crafted entries and ZERO of the real dispatches
 *   by the masked RAM/SP/pc comparison, and on thousands by the ORDER arm. A gate for this routine
 *   that only diffed memory would be green on a rewrite that ran the chain backwards.
 *
 * ★ HOW THE LIVE-OUT WAS DERIVED, AND IT IS FROM THE ORACLE. The oracle's only exit is its own
 *   return, reached after the seventh call; every call is bracketed by a push the callee's chain
 *   consumes, so nothing is left on the stack and the seat is restored. The oracle therefore hands
 *   its caller memory and whatever the seventh sibling's handler left in registers — this entry
 *   computes nothing of its own. Which registers those are is MEASURED by the EXCLUDED arm rather
 *   than declared, and bounded by a ceiling.
 *
 * ★ NOTHING IS LAID ON THE STACK. Each sibling, and the era-keyed handler it runs, is a direct
 *   call that leaves the stack where it found it, so the rewrite lays no resume point down for any
 *   of them. The two stack twins are the old shapes: PARKS-LIKE-THE-ROM lays one down wherever the
 *   frozen chain does, and PARKS-ALWAYS lays one down for every link; nothing lifts either, and
 *   both are caught.
 *
 * ★ SP AND pc BELONG TO THE DISPATCH SEAM. The oracle nets one return; the rewrite performs none.
 *   The candidate is run THROUGH `withOmittedRet` here, as an assembled run reaches it, and SP and
 *   pc are then compared for EQUALITY. Nothing in this file asserts the candidate DIFFERS anywhere.
 *
 * GATE: strict unit-capture over every dispatch of two real sessions, a crafted cross over the
 *   mother-ship gate byte and all 256 era values, an order trace, and a whole-machine replay.
 *
 *   1. REACH — dispatch counts, and the eras and gate bytes the sessions present, all measured,
 *      with a positive control that the collectors can read values the sessions do not present.
 *   2. EQUAL — at the first dispatch of each session: masked RAM, SP and pc identical.
 *   3. NOT VACUOUS — a candidate that does nothing FAILS that same comparison.
 *   4. SCRATCH — the masked window is the ORACLE'S OWN deepest push, instrumented over this file's
 *      whole sweep and PINNED; every raw difference lies strictly below the entry pointer and no
 *      deeper than that; and at least one is seen, so the mask is not decoration.
 *   5. CORPUS — every dispatch of both sessions replays identically.
 *   6. CROSS — two captured bases crossed with four gate-byte values and all 256 eras; the eras
 *      whose handler word this port has not transcribed are required to fault IDENTICALLY on both
 *      sides rather than to be correct.
 *   7. ORDER — the sequence of cursor pairs the handler works, taken from BOTH sides by the same
 *      REGISTER-FREE instrument (the selector read, then the first read inside a seated record),
 *      compared as an ordered list, with a permuted twin as the control that the instrument can
 *      report a difference.
 *   7a. FAIRNESS — on the oracle, which still seats the pair, that instrument agrees EXACTLY with
 *      the register probe this file used before, on every crafted entry of arms 0-4 and every real
 *      dispatch; on arm 7 the pair is shown not to be an input (cursors complemented into it:
 *      silent; the same poison into the era-0 handler: heard); arms 5-6 fault alike.
 *   8. EXCLUDED — the registers that move, bounded by a CEILING asserted as a subset so a rewrite
 *      that agrees MORE closely cannot fail, plus a positive control on a register outside it.
 *   8a. LIVE — against the chain the live game ran before this rewrite (resume points parked, the
 *      cursors seated, the handler reached through the call seam into the lifted handlers), every
 *      register but the two seated cursors is identical: the rest of the ceiling is the frozen
 *      handlers' scratch, not this rewrite's.
 *   8b. DEAD AT EXIT — every register in that ceiling, the two cursors included, poisoned on the
 *      frozen game at every exit of each whole session, changes nothing, beside a control the same
 *      instrument does hear.
 *   9. WHOLE-MACHINE — a wired session of each tape through a shim that also restores the oracle's
 *      T-state cost, differing only in dead stack bytes; and the same instrument shown catching a
 *      do-nothing twin.
 *  10. TEETH — eight twins, each with an exact crafted and real catch count under BOTH the masked
 *      comparison and the order comparison, so a twin one of them is blind to is recorded as such.
 *
 * WHY THE WHOLE-MACHINE SHIM RESTORES T-STATES. No idiomatic module spends any, and the engine this
 * arm drives is cycle-driven, so a rewrite moves the frame phase. That is a property nothing here
 * owns; the shim measures the oracle's own cost on a clone and gives it back, so the arm reports on
 * memory rather than on phase. The TEETH arm beside it shows the arm still fails a broken twin.
 *
 * HOLE: both sessions present ONE era each and gate byte 0 only, so five of the eight handler arms
 * and the whole stand-down path are reached only by the crafted cross.
 * HOLE: two of the eight handler words address nothing this port has transcribed. For those the
 * cross can say no more than that both sides fault the same way.
 * HOLE: the order instrument watches entries into the handler ARMS. A rewrite that reordered work
 * INSIDE one arm is out of its view; that belongs to the arms' own gates.
 * HOLE: the order instrument names a pair only when the handler reads its record. Arms 5-6 fault
 * first and arm 7 takes no pair, so on those arms (crafted only) it reports nothing on either side;
 * how many times arm 7 runs is left to the masked comparison.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-28a1.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { stepSevenCraftSlots } from "../stepSevenCraftSlots.js";
import { seatCraftSlot0ThenDispatchByEra } from "../seatCraftSlot0ThenDispatchByEra.js";
import { seatCraftSlot1ThenDispatchByEra } from "../seatCraftSlot1ThenDispatchByEra.js";
import { seatCraftSlot2ThenDispatchByEra } from "../seatCraftSlot2ThenDispatchByEra.js";
import { seatCraftSlot3ThenDispatchByEra } from "../seatCraftSlot3ThenDispatchByEra.js";
import { seatCraftSlot4ThenDispatchByEra } from "../seatCraftSlot4ThenDispatchByEra.js";
import { seatMotherShipSlotThenDispatchByEraUnlessArmed } from "../seatMotherShipSlotThenDispatchByEraUnlessArmed.js";
import { seatCraftSlot6ThenDispatchByEraUnlessArmed } from "../seatCraftSlot6ThenDispatchByEraUnlessArmed.js";
import { loc_28a1 as oracle } from "../../translated/loc_28a1.js";
import { ERA_INDEX, MOTHER_SHIP_ARMED } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { assertDeadAtExit } from "./_deadAtExit.js";
import { serviceEra0EnemyCraftSlot } from "../serviceEra0EnemyCraftSlot.js";
import { serviceEra1EnemyCraftSlot } from "../serviceEra1EnemyCraftSlot.js";
import { serviceEra2EnemyCraftSlot } from "../serviceEra2EnemyCraftSlot.js";
import { serviceEra3EnemyCraftSlot } from "../serviceEra3EnemyCraftSlot.js";
import { serviceEra4EnemyCraftSlot } from "../serviceEra4EnemyCraftSlot.js";
import { stepRoundWonBandAnimation } from "../stepRoundWonBandAnimation.js";

const TARGET = 0x28a1;
/** The era-keyed dispatch each sibling hands its seated pair to. */
const HANDLER = 0x290e;
/** The inline table of handler words the siblings dispatch through. */
const HANDLER_TABLE = 0x2914;

/** The chain the oracle runs: the sibling, its resume point, and whether it can stand down. */
const LINKS = [
  [seatCraftSlot0ThenDispatchByEra, 0x28a4, false],
  [seatCraftSlot1ThenDispatchByEra, 0x28a7, false],
  [seatCraftSlot2ThenDispatchByEra, 0x28aa, false],
  [seatCraftSlot3ThenDispatchByEra, 0x28ad, false],
  [seatCraftSlot4ThenDispatchByEra, 0x28b0, false],
  [seatMotherShipSlotThenDispatchByEraUnlessArmed, 0x28b3, true],
  [seatCraftSlot6ThenDispatchByEraUnlessArmed, 0x28b6, true],
];

/** Bytes below the entry stack pointer the dissolved chain reaches. Measured by the SCRATCH arm. */
const WINDOW = 14;

const CORPUS_FRAMES = 2500;
const SESSIONS = [["coin-start", {}], ["demo", { tape: [] }]];

/** Measured over CORPUS_FRAMES. A move is a finding about the tapes, not a tolerance to widen. */
const DISPATCHES = { "coin-start": 863, demo: 1379 };
/** Measured: what real play presents at this entry. */
const REAL_ERAS = { "coin-start": [0], demo: [1] };
const REAL_GATE_BYTES = [0];

/** Gate-byte values crossed against every era. Only the first occurs in real play. */
const GATE_VALUES = [0, 1, 0x80, 0xff];
const ERA_VALUES = 256;

/**
 * A CEILING on the registers that may differ, not a pin: asserted as a subset, so a rewrite that
 * happens to agree on one of these still passes. What is asserted positively is HELD. The ceiling
 * is the frozen handlers' own scratch, plus the two cursors the frozen chain seats: the rewrite
 * hands the record and entry to the handler as arguments and seats neither, and DEAD AT EXIT flips
 * both on the frozen game where this entry hands back with nothing after it hearing them. The LIVE
 * arm shows the rewrite matching, on every register but those two cursors, the chain the live game
 * ran into the lifted handlers.
 */
const MAY_MOVE = ["a", "f", "b", "c", "d", "e", "h", "l", "a_", "ix", "iy"];
/** The cursors the previous live chain seated and the rewrite does not. */
const SEATED_CURSORS = ["ix", "iy"];
const HELD = ["sp"];

/** Measured: the dead stack cells a whole wired session leaves differing, as a CEILING. */
const SESSION_SCRATCH = [0xafd6, 0xafd7, 0xafd8, 0xafd9, 0xafda, 0xafdb, 0xafdc, 0xafdd];
const STACK_FLOOR = 0xaf00;
const STACK_TOP = 0xb000;
const RET_TSTATES = 10;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d === null || d === undefined ? "identical" : `${d.key ?? hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}`;

/** The candidate as an assembled run reaches it: through the seam that supplies the omitted return. */
const seam = (candidate) => withOmittedRet(candidate, TARGET);

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inWindow = (addr, sp) => addr !== null && addr >= sp - WINDOW && addr < sp;

/**
 * Run both sides on clones of one machine. Reports the raw difference, the masked one, how each
 * side faulted, and whether the comparison has POWER here — `informative` is whether the oracle
 * wrote anything outside the dead window, which is what a do-nothing candidate is caught by.
 */
function diffOf(candidate, machine) {
  const before = machine.dumpState();
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  let faultA = null;
  let faultB = null;
  try { oracle(a); } catch (e) { faultA = e.constructor.name; }
  try { seam(candidate)(b); } catch (e) { faultB = e.constructor.name; }
  if (faultA !== null || faultB !== null) {
    return { faulted: true, faultA, faultB, raw: [], masked: [], moved: [], informative: false,
      caught: faultA !== faultB, sp, spDiff: null, pcDiff: null };
  }
  const raw = allDiffs(a, b);
  const masked = raw.filter((d) => !inWindow(d.addr, sp));
  const da = a.dumpState();
  let informative = false;
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== before[i] && !inWindow(a.stateOffsetToAddr(i), sp)) { informative = true; break; }
  }
  const spDiff = a.regs.sp !== b.regs.sp ? { key: "sp", a: a.regs.sp, b: b.regs.sp } : null;
  const pcDiff = a.pc !== b.pc ? { key: "pc", a: a.pc, b: b.pc } : null;
  return {
    faulted: false, faultA, faultB, raw, masked, informative, sp,
    moved: REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    spDiff, pcDiff,
    caught: masked.length > 0 || spDiff !== null || pcDiff !== null,
  };
}

/** How far below its seat one side's own pushes take the stack pointer, on one machine. */
function pushDepth(fn, machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  try { fn(c); } catch { /* a faulting arm still pushed whatever it pushed */ }
  return seat - deepest;
}

// ── the order instrument ────────────────────────────────────────────────────────────────

/** Bytes per object record; each seated pair's record is the RECORD_BYTES starting at its base. */
const RECORD_BYTES = 0x10;

/**
 * The cursor pairs the era-keyed handler works, IN ORDER, taken WITHOUT registers. The rewrite
 * seats no index register -- the record and entry are arguments -- so the instrument reads the
 * machine's memory only, the same way on both sides: every read of the era selector (the one read
 * the handler's dispatch makes on entry) arms it, and the FIRST read after that which lands inside
 * one of the seven seated records names the pair being worked. Every handler arm opens by reading
 * its record's head byte, so that first read is the handler's own. A repeated identification of the
 * same pair is one entry, so a handler that reads the selector again deeper in, and then its own
 * record, cannot pad the list. The oracle reaches its arm through a restart vector (table reads in
 * ROM, pushes in the stack page -- neither inside a record) and the rewrite calls it directly; both
 * read the selector and the record through the machine's own memory, which is what makes one probe
 * fair to both. FAIRNESS below measures it against the register probe on the oracle, which still
 * seats the pair.
 */
function armOrder(fn, machine) {
  const c = machine.clone();
  const seq = [];
  let armed = false;
  const read8 = c.mem.read8.bind(c.mem);
  c.mem.read8 = (addr, ...rest) => {
    if (addr === ERA_INDEX) armed = true;
    else if (armed) {
      const i = SEAT_PAIRS.findIndex(([r]) => addr >= r && addr < r + RECORD_BYTES);
      if (i >= 0) {
        armed = false;
        const pair = `${hex4(SEAT_PAIRS[i][0])}/${hex4(SEAT_PAIRS[i][1])}`;
        if (seq[seq.length - 1] !== pair) seq.push(pair);
      }
    }
    return read8(addr, ...rest);
  };
  let faulted = null;
  try { fn(c); } catch (e) { faulted = e.constructor.name; }
  return { seq: seq.join(" "), faulted };
}

/**
 * The register probe this file used while the chain seated the pair in IX/IY: the seated pair at
 * each selector read. Kept ONLY as the FAIRNESS reference, run on the ORACLE, which still seats them.
 */
function registerOrder(machine) {
  const SEATED = new Set(SEAT_PAIRS.map(([r, e]) => `${r}/${e}`));
  const c = machine.clone();
  const seq = [];
  const read8 = c.mem.read8.bind(c.mem);
  c.mem.read8 = (addr, ...rest) => {
    if (addr === ERA_INDEX && SEATED.has(`${c.regs.ix}/${c.regs.iy}`)) {
      const pair = `${hex4(c.regs.ix)}/${hex4(c.regs.iy)}`;
      if (seq[seq.length - 1] !== pair) seq.push(pair);
    }
    return read8(addr, ...rest);
  };
  let faulted = null;
  try { oracle(c); } catch (e) { faulted = e.constructor.name; }
  return { seq: seq.join(" "), faulted };
}

function orderOf(candidate, machine) {
  const a = armOrder(oracle, machine);
  const b = armOrder(seam(candidate), machine);
  return {
    oracle: a.seq,
    candidate: b.seq,
    caught: a.seq !== b.seq || (a.faulted === null) !== (b.faulted === null),
  };
}

// ── the sessions ────────────────────────────────────────────────────────────────────────

const entries = new Map();
const sessionCache = new Map();

function runSession(label, opts) {
  const eras = new Map();
  const gateBytes = new Map();
  const moved = new Set();
  let dispatches = 0;
  let caught = 0;
  let orderCaught = 0;
  let fairnessMisses = 0;
  let deepest = 0;
  let escaped = 0;
  let informative = 0;
  let oracleDepth = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const era = mm.mem8[ERA_INDEX];
    eras.set(era, (eras.get(era) ?? 0) + 1);
    const gate = mm.mem8[MOTHER_SHIP_ARMED];
    gateBytes.set(gate, (gateBytes.get(gate) ?? 0) + 1);
    if (!entries.has(label)) entries.set(label, mm.clone());
    const r = diffOf(stepSevenCraftSlots, mm);
    if (r.informative) informative++;
    for (const k of r.moved) moved.add(k);
    if (r.caught) caught++;
    if (orderOf(stepSevenCraftSlots, mm).caught) orderCaught++;
    if (armOrder(oracle, mm).seq !== registerOrder(mm).seq) fairnessMisses++;
    oracleDepth = Math.max(oracleDepth, pushDepth(oracle, mm));
    for (const d of r.raw) {
      if (d.addr >= r.sp) escaped++;
      else deepest = Math.max(deepest, r.sp - d.addr);
    }
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `the ${label} session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, `the ${label} session ran short`);
  return { label, dispatches, eras, gateBytes, moved, caught, orderCaught, fairnessMisses, deepest, escaped,
    informative, oracleDepth };
}

function session(label) {
  if (!sessionCache.has(label)) {
    const spec = SESSIONS.find(([l]) => l === label);
    sessionCache.set(label, runSession(label, spec[1]));
  }
  return sessionCache.get(label);
}

const sessions = () => SESSIONS.map(([label]) => session(label));

function entryFor(label) {
  session(label);
  const e = entries.get(label);
  assert.notEqual(e, undefined, `the ${label} session never reaches the routine`);
  return e;
}

/** A real captured machine with the mother-ship gate byte and the era selector forced. */
function craft(label, gate, era) {
  const m = entryFor(label).clone();
  m.mem8[MOTHER_SHIP_ARMED] = gate;
  m.mem8[ERA_INDEX] = era;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  crossCache = [];
  for (const [label] of SESSIONS) {
    for (const gate of GATE_VALUES) {
      for (let era = 0; era < ERA_VALUES; era++) crossCache.push([label, gate, era]);
    }
  }
  return crossCache;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** The chain in a given order; a twin may also lay down each sibling's old resume point. */
function chain(order, parking = "never") {
  return (m) => {
    for (const i of order) {
      const [link, resumePoint, standsDown] = LINKS[i];
      const park = parking === "always" ? true
        : parking === "never" ? false
        : !standsDown || m.mem8[MOTHER_SHIP_ARMED] === 0;
      if (park) m.push16(resumePoint);
      link(m);
    }
  };
}

/** BUG: does nothing at all — no slot is worked. */
function brokenNoOp() {}

/**
 * NOT A TWIN OF THIS ROUTINE: the positive control for the register instrument -- a register
 * outside the ceiling (a shadow half this chain never touches). The held seat, SP, is not clobbered
 * here: the seam refuses a moved SP outright, which the EQUAL/CROSS SP comparisons measure.
 */
function clobbersARegisterOutsideTheCeiling(m) {
  stepSevenCraftSlots(m);
  m.regs.h_ = (m.regs.h_ + 1) & 0xff;
}

/**
 * Per twin: the crafted catch count under the masked comparison, the crafted count under the
 * order comparison, and the same two per session in SESSIONS order. All measured. A zero is a
 * RECORDED BLINDNESS, which is the point of keeping both columns.
 *
 * The crafted ORDER column was re-measured when the order probe stopped reading registers (the
 * chain no longer seats them). Every real-dispatch count, and every crafted count on arms 0-4, is
 * unchanged; what left the column is exactly the arms where no handler takes a pair, and FAIRNESS
 * measures why: arms 5-6 fault before any record is read, identically on both sides (the register
 * probe had named the FIRST seated pair before the fault, so a twin whose first link differs --
 * reversed, swap-first-two -- was caught there on that alone: 512 entries); arm 7 is handed no pair
 * and complementing the seated cursors into it changes nothing, so the order of pairs is not an
 * observable there (256 entries; 64 for swap-last-two, whose swap is only live at gate byte 0).
 */
const TWINS = [
  ["no-op", brokenNoOp, 960, 1792, [863, 863], [1379, 1379]],
  ["reversed", chain([6, 5, 4, 3, 2, 1, 0]), 0, 1280, [0, 863], [0, 1379]],
  ["swap-last-two", chain([0, 1, 2, 3, 4, 6, 5]), 0, 320, [0, 863], [0, 1379]],
  ["swap-first-two", chain([1, 0, 2, 3, 4, 5, 6]), 0, 1280, [0, 863], [0, 1379]],
  ["drops-the-fifth", chain([0, 1, 2, 3, 5, 6]), 128, 1280, [614, 863], [1012, 1379]],
  ["repeats-the-first", chain([0, 0, 2, 3, 4, 5, 6]), 0, 1280, [0, 863], [311, 1379]],
  ["parks-like-the-rom", chain([0, 1, 2, 3, 4, 5, 6], "gated"), 1536, 1536, [863, 863], [1379, 1379]],
  ["parks-always", chain([0, 1, 2, 3, 4, 5, 6], "always"), 1536, 1536, [863, 863], [1379, 1379]],
];

const craftedCaught = (twin) => cross().filter((c) => diffOf(twin, craft(...c)).caught).length;
const craftedOrderCaught = (twin) => cross().filter((c) => orderOf(twin, craft(...c)).caught).length;

/** Every twin scored against every real dispatch in ONE pass per session. */
function realCaught(label, opts, twins) {
  const unit = twins.map(() => 0);
  const order = twins.map(() => 0);
  let dispatches = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    twins.forEach(([, twin], i) => {
      if (diffOf(twin, mm).caught) unit[i]++;
      if (orderOf(twin, mm).caught) order[i]++;
    });
    return oracle(mm);
  }]]), opts);
  m.runFrames(CORPUS_FRAMES);
  return { dispatches, unit, order };
}

let realTwinCache = null;
function realTwinCounts() {
  if (!realTwinCache) {
    realTwinCache = new Map(SESSIONS.map(([label, opts]) => [label, realCaught(label, opts, TWINS)]));
  }
  return realTwinCache;
}

// ── the live dispatch this rewrite replaced ─────────────────────────────────────────────

/** The handler each table word named in the live game, lifted, keyed by the word. */
const LIFTED_HANDLERS = [
  [0x2927, serviceEra0EnemyCraftSlot], [0x294c, serviceEra1EnemyCraftSlot],
  [0x2984, serviceEra2EnemyCraftSlot], [0x29b0, serviceEra3EnemyCraftSlot],
  [0x29d5, serviceEra4EnemyCraftSlot], [0x1323, stepRoundWonBandAnimation],
];

/** The cursor pair each sibling seats, in chain order. */
const SEAT_PAIRS = [
  [0xa850, 0xaa1a], [0xa860, 0xaa1c], [0xa870, 0xaa1e], [0xa880, 0xaa20],
  [0xa890, 0xaa22], [0xa8a0, 0xaa24], [0xa8b0, 0xaa26],
];

/** A machine whose handler words dispatch to the lifted handlers, as the live game's did. */
function liveMachine(machine) {
  const m = machine.clone();
  m.routines = new Map(m.routines);
  for (const [addr, fn] of LIFTED_HANDLERS) m.routines.set(addr, withOmittedRet(fn, addr));
  return m;
}

/**
 * The chain as the live game ran it before this rewrite: for each sibling that does not stand
 * down, park its resume point, seat the two cursors, and send the handler word through the call
 * seam into the lifted handler, which the seam returns from.
 */
function previousLiveChain(m) {
  LINKS.forEach(([, resumePoint, standsDown], i) => {
    if (standsDown && m.mem8[MOTHER_SHIP_ARMED] !== 0) return;
    m.push16(resumePoint);
    [m.regs.ix, m.regs.iy] = SEAT_PAIRS[i];
    m.call(m.mem16[HANDLER_TABLE + 2 * (m.mem8[ERA_INDEX] & 0x07)]);
  });
}

function liveDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = liveMachine(machine);
  const b = machine.clone();
  let faultA = null;
  let faultB = null;
  try { seam(previousLiveChain)(a); } catch (e) { faultA = e.constructor.name; }
  try { seam(candidate)(b); } catch (e) { faultB = e.constructor.name; }
  if (faultA !== null || faultB !== null) return { faulted: true, faultA, faultB, masked: [], moved: [] };
  return {
    faulted: false,
    masked: allDiffs(a, b).filter((d) => !inWindow(d.addr, sp)),
    moved: [...REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]), ...(a.pc !== b.pc ? ["pc"] : [])],
  };
}

// ── the whole machine ───────────────────────────────────────────────────────────────────

const baselineCache = new Map();
function baselineFrames(label, opts) {
  if (!baselineCache.has(label)) {
    const base = makeMachine(undefined, opts);
    baselineCache.set(label, {
      frames: base.runFrames(CORPUS_FRAMES),
      toAddr: (o) => base.stateOffsetToAddr(o),
    });
  }
  return baselineCache.get(label);
}

/**
 * The candidate wired as the game dispatches it, with the oracle's own T-state cost measured on a
 * clone and given back. Without that the frame phase moves and the arm reports on phase rather
 * than on memory; the TEETH arm beside it shows it still fails a broken twin.
 */
function hosted(candidate, fired) {
  return seam((mm) => {
    fired.n++;
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const spent = probe.cycles - before;
    const r = candidate(mm);
    mm.tick(spent - RET_TSTATES);
    return r;
  });
}

function wholeRunCells(candidate, label, opts) {
  const { frames: baseFrames, toAddr } = baselineFrames(label, opts);
  const fired = { n: 0 };
  const host = makeMachine(new Map([[TARGET, hosted(candidate, fired)]]), opts);
  let hostFrames = [];
  let threw = null;
  try { hostFrames = host.runFrames(CORPUS_FRAMES); } catch (e) { threw = String(e).slice(0, 100); }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(toAddr(o));
    }
  }
  return { cells: [...cells].sort((x, y) => x - y), frames: n, fired: fired.n, threw,
    stopped: host.stoppedBy };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REACH: dispatch counts, the eras presented, and the gate byte presented", { skip }, () => {
  for (const s of sessions()) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} session never reaches the routine`);
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.deepEqual(
      [...s.eras.keys()].sort((a, b) => a - b),
      REAL_ERAS[s.label],
      `the eras the ${s.label} session presents moved, so the cross covers a different hole`,
    );
    assert.deepEqual(
      [...s.gateBytes.keys()].sort((a, b) => a - b),
      REAL_GATE_BYTES,
      `the mother-ship gate bytes the ${s.label} session presents moved`,
    );
    assert.ok(s.informative > 0, `no ${s.label} dispatch writes anything outside the window`);
    console.log(
      `  REACH/${s.label}: ${s.dispatches} dispatches, ${s.informative} informative, eras ` +
        `${[...s.eras].map(([k, v]) => `${k}x${v}`).join(" ")}, gate byte ` +
        `${[...s.gateBytes].map(([k, v]) => `${k}x${v}`).join(" ")}`,
    );
  }
  // POSITIVE CONTROL, same breath: the collectors above read two cells, so show them reading
  // values the sessions never present. Without this, "the gate byte is always 0" is
  // indistinguishable from a collector that cannot report anything else.
  const probe = entryFor(SESSIONS[0][0]).clone();
  probe.mem8[MOTHER_SHIP_ARMED] = 0xff;
  probe.mem8[ERA_INDEX] = 7;
  assert.equal(probe.mem8[MOTHER_SHIP_ARMED], 0xff, "the gate-byte collector cannot read a nonzero");
  assert.equal(probe.mem8[ERA_INDEX], 7, "the era collector cannot read a value the sessions lack");
  console.log("  REACH control: the same collectors read gate byte 255 and era 7 when present");
});

test("EQUAL at the first dispatch of each session", { skip }, () => {
  for (const [label] of SESSIONS) {
    const e = entryFor(label);
    const r = diffOf(stepSevenCraftSlots, e);
    assert.equal(r.faultA, null, `${label}: the oracle faulted (${r.faultA})`);
    assert.equal(r.faultB, null, `${label}: the rewrite faulted (${r.faultB})`);
    assert.deepEqual(r.masked, [], `${label}: ${show(r.masked[0])}`);
    assert.equal(r.spDiff, null, `${label}: the stack pointer must come back to the same seat`);
    assert.equal(r.pcDiff, null, `${label}: the seam must land pc where the caller's slot pointed`);
    console.log(
      `  EQUAL/${label}: era ${e.mem8[ERA_INDEX]}, entry pointer ${hex4(r.sp)}, ` +
        `${r.raw.length} raw bytes differ, all masked`,
    );
  }
});

test("NOT VACUOUS: a candidate that does nothing FAILS the same comparison", { skip }, () => {
  for (const [label] of SESSIONS) {
    const r = diffOf(brokenNoOp, entryFor(label));
    assert.ok(r.caught, `${label}: the comparison passed a candidate that does nothing`);
  }
  const r = diffOf(brokenNoOp, entryFor(SESSIONS[0][0]));
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(r.masked[0])}`);
});

test("SCRATCH: the window is the oracle's own deepest push, and nothing escapes it", { skip }, () => {
  let deepestDiff = 0;
  let deepestPush = 0;
  let seen = 0;
  for (const c of cross()) {
    const mm = craft(...c);
    deepestPush = Math.max(deepestPush, pushDepth(oracle, mm));
    const r = diffOf(stepSevenCraftSlots, mm);
    for (const d of r.raw) {
      assert.ok(d.addr < r.sp, `${c}: ${hex4(d.addr)} is at or above the entry pointer`);
      deepestDiff = Math.max(deepestDiff, r.sp - d.addr);
      seen++;
    }
  }
  for (const s of sessions()) {
    assert.equal(s.escaped, 0, `${s.label}: a difference reached or passed the entry pointer`);
    deepestDiff = Math.max(deepestDiff, s.deepest);
    deepestPush = Math.max(deepestPush, s.oracleDepth);
    seen += s.deepest > 0 ? 1 : 0;
  }
  assert.ok(seen > 0, "no raw difference anywhere, so the mask is not what makes this gate pass " +
    "and should be removed rather than left as decoration");
  assert.ok(deepestDiff <= WINDOW, `the deepest difference is ${deepestDiff} bytes below the entry ` +
    `pointer, past the ${WINDOW}-byte window this file masks`);
  assert.equal(deepestPush, WINDOW, "the oracle's own stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm here is masking the wrong bytes");
  console.log(`  SCRATCH: oracle pushes ${deepestPush} below its seat, window ${WINDOW}, deepest ` +
    `difference ${deepestDiff}, none at or above the seat`);
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    assert.equal(s.orderCaught, 0, `the rewrite ran the chain in a different order on ` +
      `${s.orderCaught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window and in order`);
});

test("CROSS: every crafted entry is identical, or faults identically", { skip }, () => {
  let informative = 0;
  let faulted = 0;
  for (const c of cross()) {
    const r = diffOf(stepSevenCraftSlots, craft(...c));
    if (r.informative) informative++;
    if (r.faulted) {
      assert.equal(r.faultA, r.faultB, `${c}: ${r.faultA} on one side, ${r.faultB} on the other`);
      faulted++;
      continue;
    }
    assert.deepEqual(r.masked, [], `${c}: ${show(r.masked[0])}`);
    assert.equal(r.spDiff, null, `${c}: the seam left SP adrift`);
    assert.equal(r.pcDiff, null, `${c}: the seam left pc adrift`);
  }
  assert.ok(informative > 0, "no crafted entry wrote anything outside the window, so `identical` " +
    "here is a comparison with no power rather than a result");
  assert.ok(faulted < cross().length, "every crafted entry faulted: this sweep proves nothing");
  console.log(`  CROSS: ${cross().length} crafted entries, ${informative} informative, ` +
    `${faulted} faulting alike`);
});

test("ORDER: the chain is worked in the oracle's order, with a control", { skip }, () => {
  let compared = 0;
  let nonEmpty = 0;
  let longest = "";
  for (const c of cross()) {
    const r = orderOf(stepSevenCraftSlots, craft(...c));
    assert.equal(r.candidate, r.oracle, `${c}: the chain was worked in a different order`);
    compared++;
    if (r.oracle.length > 0) nonEmpty++;
    if (r.oracle.length > longest.length) longest = r.oracle;
  }
  assert.ok(nonEmpty > 0, "the order instrument recorded nothing anywhere, so the equality above " +
    "compares two empty lists and proves nothing");
  // POSITIVE CONTROL, same breath: the arm claims a MATCH, so show the same instrument reporting a
  // mismatch on a chain that differs only in order and nowhere in memory.
  const control = orderOf(chain([0, 1, 2, 3, 4, 6, 5]), craft(SESSIONS[0][0], 0, 0));
  assert.notEqual(control.candidate, control.oracle,
    "the order instrument cannot see two links exchanged, so every match above is vacuous");
  const blindToIt = diffOf(chain([0, 1, 2, 3, 4, 6, 5]), craft(SESSIONS[0][0], 0, 0));
  assert.equal(blindToIt.caught, false, "the masked comparison caught the exchanged pair, so this " +
    "arm is no longer standing where the memory gate cannot see");
  console.log(`  ORDER: ${compared} entries agree, ${nonEmpty} non-empty, longest ${longest}`);
  console.log(`  ORDER control: exchanging two links gives ${control.candidate} — and the masked ` +
    "comparison is blind to it");
});

/** The handler word the arm-7 selector reaches: it is handed no pair (the rewrite calls it with none). */
const ARM7_HANDLER = 0x1323;
/** The era-0 handler, whose record is read on entry: the positive control for the pair poison. */
const ARM0_HANDLER = 0x2927;

/** The oracle on a clone with the seated cursors complemented on every entry into the handler at `at`. */
function oracleWithCursorsPoisoned(machine, at) {
  const c = machine.clone();
  c.routines = new Map(c.routines);
  const frozen = c.routines.get(at);
  c.routines.set(at, (mm, ...args) => {
    mm.regs.ix ^= 0xffff;
    mm.regs.iy ^= 0xffff;
    return frozen(mm, ...args);
  });
  let fault = null;
  try { oracle(c); } catch (e) { fault = e.constructor.name; }
  return { c, fault };
}

test("FAIRNESS: the register-free order probe is the register probe wherever a handler takes a pair", { skip }, () => {
  const tally = new Map();
  let agree = 0;
  let unconsumed = 0;
  let controlHeard = 0;
  for (const c of cross()) {
    const mm = craft(...c);
    const arm = c[2] & 0x07;
    const free = armOrder(oracle, mm);
    const reg = registerOrder(mm);
    tally.set(arm, (tally.get(arm) ?? 0) + (free.seq === reg.seq ? 1 : 0));
    if (arm <= 4) {
      // Arms 0-4 each take the pair and open by reading its record: exact agreement, entry for entry.
      assert.equal(free.seq, reg.seq, `${c}: the register-free probe disagrees with the register probe on the oracle`);
      assert.notEqual(free.seq, "", `${c}: the probes agree on an empty list, which proves nothing`);
      agree++;
    } else if (arm === 7) {
      // Arm 7 reads no record, so the register-free probe sees nothing -- and the pair is not an input
      // there: the oracle with both cursors complemented on every entry into that handler leaves
      // exactly the same memory. The order of pairs is not an observable of this arm.
      assert.equal(free.seq, "", `${c}: the register-free probe named a pair on arm 7`);
      const base = mm.clone();
      let baseFault = null;
      try { oracle(base); } catch (e) { baseFault = e.constructor.name; }
      const { c: poisoned, fault } = oracleWithCursorsPoisoned(mm, ARM7_HANDLER);
      assert.equal(fault, baseFault, `${c}: complementing the cursors into arm 7 changed how the oracle faults`);
      assert.deepEqual(allDiffs(base, poisoned).map((d) => hex4(d.addr)), [],
        `${c}: arm 7 read the seated pair, so its order IS observable and this probe is blind to it`);
      unconsumed++;
    } else {
      // Arms 5-6 address nothing transcribed: both probes see the fault, the free probe before any record.
      assert.equal(free.seq, "", `${c}: the register-free probe named a pair on a faulting arm`);
      assert.notEqual(free.faulted, null, `${c}: arm ${arm} did not fault`);
      assert.equal(free.faulted, reg.faulted, `${c}: the two probes saw different faults`);
    }
  }
  // POSITIVE CONTROL for the arm-7 claim: the same cursor poison into the era-0 handler, which reads
  // its record through the seated pair, must be heard.
  for (const [label] of SESSIONS) {
    const mm = craft(label, 0, 0);
    const base = mm.clone();
    oracle(base);
    if (allDiffs(base, oracleWithCursorsPoisoned(mm, ARM0_HANDLER).c).length > 0) controlHeard++;
  }
  assert.ok(controlHeard > 0, "complementing the cursors into the era-0 handler went unheard, so the " +
    "arm-7 silence proves nothing");
  // Every real dispatch too (both sessions present arms 0 and 1 only).
  for (const s of sessions()) assert.equal(s.fairnessMisses, 0, `${s.label}: the probes disagree on ${s.fairnessMisses} real dispatches`);
  console.log(`  FAIRNESS: ${agree} crafted arm-0..4 entries agree exactly with the register probe; ` +
    `arm 7 (${unconsumed} entries) takes no pair -- poisoning it is silent, the era-0 control is heard in ` +
    `${controlHeard}/${SESSIONS.length}; arms 5-6 fault alike. Agreement by arm: ` +
    `${[...tally].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}:${v}`).join(" ")}`);
});

test("EXCLUDED: the registers that move, bounded by a ceiling; the cursors are held", { skip }, () => {
  const moved = new Set();
  for (const s of sessions()) for (const k of s.moved) moved.add(k);
  for (const c of cross()) {
    const r = diffOf(stepSevenCraftSlots, craft(...c));
    if (r.faulted) continue;
    for (const k of r.moved) moved.add(k);
  }
  const list = REG_FIELDS.filter((k) => moved.has(k));
  console.log(`  EXCLUDED (measured): ${list.join(", ")} — ceiling ${MAY_MOVE.join(", ")}`);
  // A CEILING, never `deepEqual`: an equality here would DEMAND the divergence and go red on a
  // rewrite that became register-exact.
  assert.deepEqual(list.filter((k) => !MAY_MOVE.includes(k)), [], "a register outside the ceiling moved");
  for (const k of HELD) assert.ok(!moved.has(k), `a register asserted held moved (${k})`);
  // POSITIVE CONTROL, same breath: the ceiling is an ABSENCE claim, so show the same instrument
  // reporting a register outside it that really did move.
  const control = new Set();
  for (const [label] of SESSIONS) {
    for (const k of diffOf(clobbersARegisterOutsideTheCeiling, entryFor(label)).moved) control.add(k);
  }
  assert.ok(control.has("h_"), "the register instrument cannot see a register outside the ceiling being " +
    "clobbered, so the assertion above proves nothing");
  console.log(`  EXCLUDED control: the same instrument reports ${[...control].join(", ")} on a clobbered twin`);
});

test("DEAD AT EXIT: on the frozen game, every register in the ceiling is dead where this entry hands back", { skip }, () => {
  assertDeadAtExit({
    at: TARGET, poison: MAY_MOVE, frames: CORPUS_FRAMES,
    sessions: SESSIONS.map(([label, opts]) => ({ label, tape: opts.tape, dispatches: DISPATCHES[label] })),
    controls: [{
      // POSITIVE CONTROL, same instrument: shift the seated record one record on as the chain hands
      // it to the era-keyed dispatch, where it is read. Silence at the exit means something only if
      // this is heard.
      label: "entry", at: HANDLER, poison: ["ix"], flip: { ix: 0x10 }, before: true,
    }],
  });
});

test("LIVE: identical to the chain the live game ran before, every register but the seated cursors", { skip }, () => {
  let compared = 0;
  let faulted = 0;
  for (const c of cross()) {
    const r = liveDiff(stepSevenCraftSlots, craft(...c));
    if (r.faulted) {
      assert.equal(r.faultA, r.faultB, `${c}: ${r.faultA} on one side, ${r.faultB} on the other`);
      faulted++;
      continue;
    }
    assert.deepEqual(r.masked, [], `${c}: ${show(r.masked[0])}`);
    assert.deepEqual(r.moved.filter((k) => !SEATED_CURSORS.includes(k)), [], `${c}: a register differs from the live chain`);
    compared++;
  }
  for (const [label] of SESSIONS) {
    const r = liveDiff(stepSevenCraftSlots, entryFor(label));
    assert.deepEqual(r.masked, [], `${label}: ${show(r.masked[0])}`);
    assert.deepEqual(r.moved.filter((k) => !SEATED_CURSORS.includes(k)), [], `${label}: a register differs from the live chain`);
  }
  assert.ok(compared > 0, "every crafted entry faulted, so this arm compared nothing");
  // POSITIVE CONTROL, same breath: the arm claims a register match, so show it seeing a clobber.
  const control = liveDiff(clobbersARegisterOutsideTheCeiling, entryFor(SESSIONS[0][0]));
  assert.ok(control.moved.includes("h_"), "the live comparison cannot see a clobbered register");
  console.log(`  LIVE: ${compared} crafted entries and both sessions identical to the live chain, ` +
    `every register but ${SEATED_CURSORS.join(", ")} (dead at exit); ${faulted} fault alike`);
});

test("WHOLE-MACHINE: a wired session of each tape differs only in dead stack bytes", { skip }, () => {
  for (const [label, opts] of SESSIONS) {
    const r = wholeRunCells(stepSevenCraftSlots, label, opts);
    assert.equal(r.threw, null, `${label}: the run threw: ${r.threw}`);
    assert.equal(r.stopped, null, `${label}: the run stopped early (${r.stopped})`);
    assert.equal(r.frames, CORPUS_FRAMES, `${label}: compared ${r.frames} of ${CORPUS_FRAMES} frames`);
    assert.ok(r.fired > 0, `${label}: vacuous — the override never dispatched`);
    for (const cell of r.cells) {
      assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${label}: ${hex4(cell)} is not a stack address`);
    }
    // A CEILING again, so a rewrite that leaves FEWER cells differing passes.
    assert.deepEqual(r.cells.filter((c) => !SESSION_SCRATCH.includes(c)), [],
      `${label}: a cell outside the measured dead-stack set differs`);
    console.log(`  WHOLE-MACHINE/${label}: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
  }
});

test("WHOLE-MACHINE TEETH: the same instrument catches a do-nothing twin", { skip }, () => {
  for (const [label, opts] of SESSIONS) {
    const r = wholeRunCells(brokenNoOp, label, opts);
    assert.ok(r.fired > 0, `${label}: vacuous — the twin never dispatched`);
    const escaped = r.cells.filter((c) => !SESSION_SCRATCH.includes(c));
    assert.ok(r.threw !== null || escaped.length > 0,
      `${label}: the whole-machine arm passed a candidate that does nothing, so it proves only ` +
        "that the seam places the dispatch and nothing about the routine");
    console.log(`  WHOLE-MACHINE TEETH/${label}: the no-op leaves ${escaped.length} cells outside the set`);
  }
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [i, [label, twin, crafted, craftedOrder, coinCounts, demoCounts]] of TWINS.entries()) {
  const perSession = { "coin-start": coinCounts, demo: demoCounts };

  test(`TEETH: the ${label} twin's crafted catch counts, both instruments`, { skip }, () => {
    const unit = craftedCaught(twin);
    const order = craftedOrderCaught(twin);
    assert.ok(unit + order > 0, `neither instrument caught the ${label} twin anywhere`);
    assert.equal(unit, crafted, `the ${label} twin's crafted masked-comparison count moved`);
    assert.equal(order, craftedOrder, `the ${label} twin's crafted order count moved`);
    console.log(
      `  TEETH/${label}: crafted — masked ${unit}, order ${order}, of ${cross().length}` +
        (unit === 0 ? " — the masked comparison is BLIND to it" : ""),
    );
  });

  test(`TEETH: the ${label} twin's real catch counts per session`, { skip }, () => {
    const counts = realTwinCounts();
    for (const [l] of SESSIONS) {
      const got = counts.get(l);
      assert.equal(got.dispatches, DISPATCHES[l], `${l}: the dispatch count moved`);
      assert.equal(got.unit[i], perSession[l][0], `the ${label} twin's ${l} masked count moved`);
      assert.equal(got.order[i], perSession[l][1], `the ${label} twin's ${l} order count moved`);
    }
    const blind = SESSIONS
      .filter(([l]) => counts.get(l).unit[i] === 0 && counts.get(l).order[i] === 0)
      .map(([l]) => l);
    console.log(
      `  TEETH/${label}: real — ` +
        SESSIONS.map(([l]) => `${l} masked ${counts.get(l).unit[i]} order ${counts.get(l).order[i]}`).join(", ") +
        (blind.length ? ` — BLIND to real dispatches of: ${blind.join(", ")}` : ""),
    );
  });
}
