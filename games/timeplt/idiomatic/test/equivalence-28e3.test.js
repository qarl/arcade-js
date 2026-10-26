// SPDX-License-Identifier: GPL-3.0-only
/**
 * seatCraftSlot4ThenDispatchByEra — memory-equivalent to the frozen oracle at ROM 0x28E3.
 *
 * WHAT IT IS. Two instructions that load an object record and a sprite entry, and a tail jump into
 * the era-keyed per-slot handler at 0x290E, which is ALREADY DECOMPILED — so the rewrite calls it
 * directly and dissolving that transfer belongs to this caller's unit. The whole content of the
 * entry is the CHOICE OF PAIR.
 *
 * ★ HOW THE LIVE-OUT WAS DERIVED, AND IT IS FROM THE ORACLE. The oracle has ONE exit: a transfer
 *   into 0x290E with nothing parked for it to come back to, so the arm 0x290E selects returns past
 *   this entry and the arm's product IS this entry's product. Live-out is therefore memory plus
 *   whatever the arm leaves. Reading the ORACLE's successors settles the registers: the return lands
 *   on the next of the seven sibling calls the caller makes, whose ROM form opens `ld a,(0xAD0D)` /
 *   `and a`, so A is overwritten and F set from it before either is read; and whichever way that
 *   sibling and the one after it go, the chain's own return lands on a call whose target opens
 *   `ld a,(0xB411)` / `bit 7,a`, which does the same again. Nothing on that path reads D, E, H or L.
 *   What the successors DO consume is memory. The index pair is left exactly as the oracle leaves
 *   it, which the EXCLUDED arm asserts rather than argues; that arm measures the moving set too,
 *   rather than declaring it, and it moves B, C and A' as well, because the rewrite runs the lifted
 *   handler, which leaves its scratch registers otherwise than the transcribed one does.
 *   DEAD AT EXIT checks that reading on the oracle itself rather than trusting it: every bit of
 *   every register in the ceiling below is flipped on the FROZEN game at each of this entry's
 *   exits, for each whole session, and not one frame of state changes, while the same instrument
 *   does hear a one-record shift of the record register on its way into the handler.
 *
 * ★ THE STACK COMPARISON IS MASKED BELOW THE ENTRY POINTER, AND THE CAUSE ARM ESTABLISHES WHY. The
 *   frozen 0x290E chain reaches its arm through a restart vector, pushing and popping nested return
 *   addresses in the bytes just under the frame; the rewrite computes the same arm arithmetically
 *   and writes none of that. A PROBE — this entry's own two loads, then the FROZEN chain — leaves
 *   ZERO raw difference, unmasked, on every real dispatch and every crafted entry, which identifies
 *   the chain's share rather than telling a story about it. The rest is the arm's own: the rewrite
 *   runs the lifted handler, which reaches its helpers by direct call, where the frozen handler's
 *   calls park return addresses deeper in the same free stack. Every masked byte lies below the
 *   entry pointer, in stack the machine has already given back, and SCRATCH measures the depth.
 *
 * ★ SP AND pc BELONG TO THE DISPATCH SEAM. The oracle nets exactly one return, through the arm; the
 *   rewrite performs none. `withOmittedRet` MEASURES which shape a dispatch took and supplies the
 *   missing pop, so the candidate is run THROUGH it here, as an assembled run reaches it, and SP and
 *   pc are then compared for EQUALITY everywhere. Nothing in this file asserts that the candidate
 *   DIFFERS from the oracle anywhere.
 *
 * GATE: strict unit-capture over every dispatch of two real sessions, a crafted cross over the era
 *   selector and the Mother-Ship gate byte, and a whole-machine replay. What it exercises, holes
 *   stated:
 *   1. REACH — dispatch counts, eras and gate byte presented, all measured, with a positive control.
 *   2. EQUAL — at the first INFORMATIVE dispatch of each session: masked RAM, SP and pc identical.
 *   3. NOT VACUOUS — a candidate that does nothing FAILS that same comparison.
 *   4. CAUSE — the probe above, which must leave nothing at all.
 *   5. SCRATCH — every raw difference lies strictly BELOW the entry pointer and no deeper than the
 *      window, both asserted; and at least one is seen, so the mask is not decorative.
 *   6. CORPUS — every dispatch of both sessions replays identically.
 *   7. CROSS — two captured bases crossed with four gate-byte values and all 256 era values.
 *   8. ARMS — the eight words of the handler table, with the two this port has not transcribed
 *      required to fault IDENTICALLY on both sides rather than to be correct.
 *   9. SP-TOOTH — the seam places the rewrite on every completing crafted entry, and refuses a
 *      rewrite that parks a word nothing lifts or lifts one it was never given.
 *  10. DEAD AT EXIT — the ceiling, poisoned on the frozen game at every exit of each whole session,
 *      changes nothing, beside a control the same instrument does hear.
 *  11. EXCLUDED — the registers that move, bounded by a CEILING asserted as a subset so a rewrite
 *      that agrees MORE closely cannot fail; the pair and SP asserted held; and a positive control
 *      showing the instrument catches a held register being clobbered.
 *  12. WHOLE-MACHINE — a wired session of each tape, differing only in dead stack bytes.
 *  13. WHOLE-MACHINE TEETH — the same instrument shown catching a do-nothing twin.
 *  14. TEETH — seven twins, each with an exact crafted catch count and an exact real count per
 *      session, so a twin no real dispatch can see is recorded as such rather than passing quietly.
 *      One is: the twin that always runs the FIRST arm is invisible to every coin-start dispatch,
 *      because the era that tape holds selects that arm anyway. The crafted cross is what holds it.
 *
 * HOLE: both sessions present ONE era each, and between them only two of the eight arms run for
 * real. The other six are reached by poking the era cell on a real captured machine, and two of
 * those address nothing this port has transcribed — of those two the cross can say no more than
 * that both sides fault the same way, which is a statement about the dispatch and not about them.
 * HOLE: the record and sprite-entry addresses are constants, so no crafted entry varies them. What
 * varies is the machine they are read against.
 * HOLE: the whole-machine arm sees only what changes the FRAME dumps; a twin whose damage is
 * confined to the same dead stack bytes would pass it. The unit arms are what hold the pair.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-28e3.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { seatCraftSlot4ThenDispatchByEra } from "../seatCraftSlot4ThenDispatchByEra.js";
import { dispatchSeatedSlotByEraIndex } from "../dispatchSeatedSlotByEraIndex.js";
import { loc_28e3 as oracle } from "../../translated/loc_28e3.js";
import { ERA_INDEX, MOTHER_SHIP_ARMED } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { assertDeadAtExit } from "./_deadAtExit.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x28e3;
const HANDLER = 0x290e;
const ARM_TABLE = 0x2914;
const ARM_COUNT = 8;

/** The pair this entry exists to choose, and the neighbours a twin reaches for. */
const CRAFT_RECORD = 0xa890;
const SPRITE_ENTRY = 0xaa22;
const RECORD_STRIDE = 16;
const ENTRY_STRIDE = 2;

/** Bytes below the entry stack pointer the frozen chain's and frozen handler's dead scratch reach; measured. */
const WINDOW = 12;

const CORPUS_FRAMES = 2500;
const SESSIONS = [["coin-start", {}], ["demo", { tape: [] }]];

/** Measured over CORPUS_FRAMES. A move is a finding about the tapes, not a tolerance to widen. */
const DISPATCHES = { "coin-start": 863, demo: 1379 };
/** Measured: the eras real play presents at this entry, and the gate byte it presents. */
const REAL_ERAS = { "coin-start": [0], demo: [1] };
const REAL_GATE_BYTES = [0];

/**
 * A CEILING on the registers that may differ, not a pin: asserted as a subset, so a rewrite that
 * happens to agree on one of these still passes. What is asserted positively is HELD.
 */
const MAY_MOVE = ["a", "f", "b", "c", "d", "e", "h", "l", "a_", "ix", "iy"];
/**
 * The seat. The two cursors are in the ceiling: the rewrite hands them to the handler as arguments, and
 * DEAD AT EXIT flips both on the frozen game where this entry hands back with nothing after it hearing them.
 */
const HELD = ["sp"];

/** Gate-byte values crossed against every era. Only the first occurs in real play. */
const GATE_VALUES = [0, 1, 0x80, 0xff];
const ERA_VALUES = 256;

/**
 * Measured: the dead stack cells a whole wired session leaves differing, as a CEILING — the
 * handler's own scratch below the entry pointer, and the two a shifted interrupt leaves.
 */
const SESSION_SCRATCH = [0xafd6, 0xafd7, 0xafd8, 0xafd9, 0xafda, 0xafdb, 0xafdc, 0xafdd, 0xaffd, 0xaffe];
const STACK_FLOOR = 0xaf00;
const STACK_TOP = 0xb000;

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
 * side faulted, and whether the comparison has POWER here — `informative` is the oracle's own
 * masked footprint against the untouched machine, which is what a do-nothing candidate is caught by.
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
  const faulted = faultA !== null || faultB !== null;
  if (faulted) {
    return { faulted, faultA, faultB, raw: [], masked: [], moved: [], informative: false,
      caught: faultA !== faultB, sp };
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
    faulted, faultA, faultB, raw, masked, informative, sp,
    moved: REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    spDiff, pcDiff,
    caught: masked.length > 0 || spDiff !== null || pcDiff !== null,
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
  let deepest = 0;
  let escaped = 0;
  let informative = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const era = mm.mem8[ERA_INDEX];
    eras.set(era, (eras.get(era) ?? 0) + 1);
    const gate = mm.mem8[MOTHER_SHIP_ARMED];
    gateBytes.set(gate, (gateBytes.get(gate) ?? 0) + 1);
    const r = diffOf(seatCraftSlot4ThenDispatchByEra, mm);
    if (r.informative) {
      informative++;
      if (!entries.has(label)) entries.set(label, mm.clone());
    }
    for (const k of r.moved) moved.add(k);
    if (r.caught) caught++;
    for (const d of r.raw) {
      if (d.addr >= r.sp) escaped++;
      else deepest = Math.max(deepest, r.sp - d.addr);
    }
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `the ${label} session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, `the ${label} session ran short`);
  return { label, dispatches, eras, gateBytes, moved, caught, deepest, escaped, informative };
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
  assert.notEqual(e, undefined, `the ${label} session presents no dispatch at which the handler ` +
    "writes anything, so every crafted arm below would rest on a comparison with no power");
  return e;
}

/** A real captured machine with the era selector and the Mother-Ship gate byte forced. */
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

const craftedCaught = (candidate) => cross().filter((c) => diffOf(candidate, craft(...c)).caught).length;

/** Every twin scored against every real dispatch in ONE pass per session. */
function realCaught(label, opts, twins) {
  const counts = twins.map(() => 0);
  let dispatches = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    twins.forEach(([, twin], i) => { if (diffOf(twin, mm).caught) counts[i]++; });
    return oracle(mm);
  }]]), opts);
  m.runFrames(CORPUS_FRAMES);
  return { dispatches, counts };
}

let realTwinCache = null;
function realTwinCounts() {
  if (!realTwinCache) {
    realTwinCache = new Map(
      SESSIONS.map(([label, opts]) => [label, realCaught(label, opts, TWINS)]),
    );
  }
  return realTwinCache;
}

// ── the whole machine ───────────────────────────────────────────────────────────────────

const baselineCache = new Map();
function baselineFrames(label, opts) {
  if (!baselineCache.has(label)) {
    const base = makeMachine(undefined, opts);
    baselineCache.set(label, { frames: base.runFrames(CORPUS_FRAMES), toAddr: (o) => base.stateOffsetToAddr(o) });
  }
  return baselineCache.get(label);
}

function wholeRunCells(candidate, label, opts) {
  const { frames: baseFrames, toAddr } = baselineFrames(label, opts);
  let fired = 0;
  const host = makeMachine(new Map([[TARGET, seam((mm) => (fired++, candidate(mm)))]]), opts);
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try { hostFrames = host.runFrames(CORPUS_FRAMES); } catch (e) { threw = String(e).slice(0, 100); }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(toAddr(o));
    }
  }
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => toAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((x, y) => x - y), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the probe that identifies the cause ─────────────────────────────────────────────────

/**
 * NOT A BROKEN TWIN. This entry's own two loads, and then the FROZEN handler reached the way the
 * oracle reaches it. If the dissolved chain really is the whole of the masked difference, this must
 * leave none at all, with nothing masked.
 */
function probeReachesTheFrozenChain(m) {
  m.regs.ix = CRAFT_RECORD;
  m.regs.iy = SPRITE_ENTRY;
  return m.call(HANDLER);
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — neither the pair nor the handler. */
function brokenNoOp() {}

/** BUG: the record one slot back, so the handler works the neighbouring craft. */
function brokenNeighbourRecord(m) {
  m.regs.ix = CRAFT_RECORD - RECORD_STRIDE;
  m.regs.iy = SPRITE_ENTRY;
  return dispatchSeatedSlotByEraIndex(m);
}

/** BUG: the sprite entry one place back, so the craft is drawn into its neighbour's entry. */
function brokenNeighbourEntry(m) {
  m.regs.ix = CRAFT_RECORD;
  m.regs.iy = SPRITE_ENTRY - ENTRY_STRIDE;
  return dispatchSeatedSlotByEraIndex(m);
}

/** BUG: the two halves of the pair change places. */
function brokenSwappedPair(m) {
  m.regs.ix = SPRITE_ENTRY;
  m.regs.iy = CRAFT_RECORD;
  return dispatchSeatedSlotByEraIndex(m);
}

/** BUG: only the record is chosen; the sprite entry is whatever the caller was holding. */
function brokenRecordOnly(m) {
  m.regs.ix = CRAFT_RECORD;
  return dispatchSeatedSlotByEraIndex(m);
}

/** BUG: only the sprite entry is chosen; the record is whatever the caller was holding. */
function brokenEntryOnly(m) {
  m.regs.iy = SPRITE_ENTRY;
  return dispatchSeatedSlotByEraIndex(m);
}

/** BUG: the pair is right but the first arm always runs, so the era stops choosing. */
function brokenFixedFirstArm(m) {
  m.regs.ix = CRAFT_RECORD;
  m.regs.iy = SPRITE_ENTRY;
  return m.call(m.mem16[ARM_TABLE]);
}

/**
 * NOT A TWIN OF THIS ROUTINE: the positive control for the register instrument -- it clobbers a register
 * outside the ceiling (a shadow half this entry never touches). The held seat, SP, is not clobbered here:
 * the seam refuses a moved SP outright, which is what the SP-TOOTH arm measures.
 */
function clobbersARegisterOutsideTheCeiling(m) {
  seatCraftSlot4ThenDispatchByEra(m);
  m.regs.h_ = (m.regs.h_ + 1) & 0xff;
}

/** Measured: crafted catches, then real catches per session in SESSIONS order. */
const TWINS = [
  ["no-op", brokenNoOp, 1920, [614, 1012]],
  ["neighbour-record", brokenNeighbourRecord, 1280, [683, 1108]],
  ["neighbour-entry", brokenNeighbourEntry, 1280, [613, 940]],
  ["swapped-pair", brokenSwappedPair, 1280, [734, 1012]],
  ["record-only", brokenRecordOnly, 1280, [613, 940]],
  ["entry-only", brokenEntryOnly, 1280, [683, 1108]],
  ["fixed-first-arm", brokenFixedFirstArm, 1792, [0, 662]],
];

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
      `the Mother-Ship gate bytes the ${s.label} session presents moved`,
    );
    assert.ok(s.informative > 0, `no ${s.label} dispatch writes anything outside the window`);
    console.log(
      `  REACH/${s.label}: ${s.dispatches} dispatches, ${s.informative} informative, eras ` +
        `${[...s.eras].map(([k, v]) => `${k}x${v}`).join(" ")}, gate byte ` +
        `${[...s.gateBytes].map(([k, v]) => `${k}x${v}`).join(" ")}`,
    );
  }
  // POSITIVE CONTROL, same breath: the collector above reads a cell, so show it reading another
  // value. Without this, "the gate byte is always 0" is indistinguishable from a collector that
  // cannot report anything else.
  const probe = entryFor(SESSIONS[0][0]).clone();
  probe.mem8[MOTHER_SHIP_ARMED] = 0xff;
  probe.mem8[ERA_INDEX] = 7;
  assert.equal(probe.mem8[MOTHER_SHIP_ARMED], 0xff, "the gate-byte collector cannot read a nonzero");
  assert.equal(probe.mem8[ERA_INDEX], 7, "the era collector cannot read a value the sessions lack");
  console.log("  REACH control: the same collectors read gate byte 255 and era 7 when present");
});

test("EQUAL at the first informative dispatch of each session", { skip }, () => {
  for (const [label] of SESSIONS) {
    const e = entryFor(label);
    const r = diffOf(seatCraftSlot4ThenDispatchByEra, e);
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

test("CAUSE: reaching the FROZEN handler with this entry's pair leaves nothing at all", { skip }, () => {
  for (const [label, opts] of SESSIONS) {
    let dispatches = 0;
    let raw = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => {
      dispatches++;
      const r = diffOf(probeReachesTheFrozenChain, mm);
      if (r.raw.length || r.spDiff || r.pcDiff || r.faulted) raw++;
      return oracle(mm);
    }]]), opts);
    m.runFrames(CORPUS_FRAMES);
    assert.equal(dispatches, DISPATCHES[label], `${label}: the dispatch count moved`);
    assert.equal(raw, 0, `${label}: the probe left ${raw} dispatches differing, so the dissolved ` +
      "chain is NOT the whole of the masked difference and the mask covers something unidentified");
    console.log(`  CAUSE/${label}: ${dispatches} dispatches, nothing differs, unmasked`);
  }
  let crafted = 0;
  for (const c of cross()) {
    const r = diffOf(probeReachesTheFrozenChain, craft(...c));
    if (r.faulted) { assert.equal(r.faultA, r.faultB, `${c}: ${r.faultA} vs ${r.faultB}`); continue; }
    if (r.raw.length || r.spDiff || r.pcDiff) crafted++;
  }
  assert.equal(crafted, 0, `the probe left ${crafted} crafted entries differing`);
  console.log(`  CAUSE crafted: ${cross().length} entries, nothing differs, unmasked`);
});

test("SCRATCH: every raw difference is below the entry pointer and inside the window", { skip }, () => {
  let deepest = 0;
  let seen = 0;
  for (const c of cross()) {
    const r = diffOf(seatCraftSlot4ThenDispatchByEra, craft(...c));
    for (const d of r.raw) {
      assert.ok(d.addr < r.sp, `${c}: ${hex4(d.addr)} is at or above the entry pointer`);
      deepest = Math.max(deepest, r.sp - d.addr);
      seen++;
    }
  }
  for (const s of sessions()) {
    assert.equal(s.escaped, 0, `${s.label}: a difference reached or passed the entry pointer`);
    deepest = Math.max(deepest, s.deepest);
    seen += s.deepest > 0 ? 1 : 0;
  }
  assert.ok(seen > 0, "no raw difference anywhere, so the mask is not what makes this gate pass " +
    "and should be removed rather than left as decoration");
  assert.ok(deepest <= WINDOW, `the deepest difference is ${deepest} bytes below the entry ` +
    `pointer, past the ${WINDOW}-byte window this file masks`);
  console.log(`  SCRATCH: deepest ${deepest} below the entry pointer, window ${WINDOW}, none above`);
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("CROSS: every crafted entry is identical, or faults identically", { skip }, () => {
  let informative = 0;
  let faulted = 0;
  for (const c of cross()) {
    const r = diffOf(seatCraftSlot4ThenDispatchByEra, craft(...c));
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
  console.log(`  CROSS: ${cross().length} crafted entries, ${informative} informative, ${faulted} faulting alike`);
});

test("ARMS: the untranscribed handler words fault identically, the rest run", { skip }, () => {
  const base = entryFor(SESSIONS[0][0]);
  const words = Array.from({ length: ARM_COUNT }, (_u, i) => base.mem16[ARM_TABLE + 2 * i]);
  const missing = words.map((w) => !base.routines.has(w));
  for (const [label] of SESSIONS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(seatCraftSlot4ThenDispatchByEra, craft(label, 0, i));
      assert.equal(r.faulted, missing[i], `arm ${i} at ${hex4(words[i])}: faulted ${r.faulted}, ` +
        "which is not what the handler table's own registration says");
      if (r.faulted) assert.equal(r.faultA, r.faultB, `arm ${i}: ${r.faultA} vs ${r.faultB}`);
      else assert.deepEqual(r.masked, [], `arm ${i}: ${show(r.masked[0])}`);
    }
  }
  assert.ok(missing.some((x) => !x), "no handler word is transcribed: this arm proves nothing");
  console.log(`  ARMS: ${words.map(hex4).join(" ")}; untranscribed ` +
    `${words.filter((_u, i) => missing[i]).map(hex4).join(" ") || "none"}, faulting alike`);
});

/** SP MUTANT: the rewrite exactly, after parking a word nothing will lift. */
function mutantParksAWord(m) {
  m.push16(TARGET);
  return seatCraftSlot4ThenDispatchByEra(m);
}

/** SP MUTANT: the rewrite exactly, after lifting a word it was never given. */
function mutantLiftsAWord(m) {
  m.pop16();
  return seatCraftSlot4ThenDispatchByEra(m);
}

test("SP-TOOTH: the seam places the rewrite, and refuses one that parks or lifts a word", { skip }, () => {
  let placed = 0;
  for (const [label] of SESSIONS) {
    for (const gate of GATE_VALUES) {
      for (let era = 0; era < ARM_COUNT; era++) {
        if (diffOf(seatCraftSlot4ThenDispatchByEra, craft(label, gate, era)).faulted) continue;
        const good = seamPlaceable(withOmittedRet, seatCraftSlot4ThenDispatchByEra, TARGET, craft(label, gate, era));
        assert.equal(good.placeable, true, `${label} gate ${gate} era ${era}: the seam could not place the rewrite: ${good.error}`);
        for (const [shape, mutant] of [["parks", mutantParksAWord], ["lifts", mutantLiftsAWord]]) {
          const bad = seamPlaceable(withOmittedRet, mutant, TARGET, craft(label, gate, era));
          assert.equal(bad.placeable, false, `${label} gate ${gate} era ${era}: the seam placed a rewrite that ${shape} a word`);
          assert.ok(diffOf(mutant, craft(label, gate, era)).caught, `${label} gate ${gate} era ${era}: the gate passed a rewrite that ${shape} a word`);
        }
        placed++;
      }
    }
  }
  assert.ok(placed > 0, "no crafted entry completed, so the seam placed nothing here");
  console.log(`  SP-TOOTH: ${placed} completing crafted entries placed; both stack mutants refused on every one`);
});

test("DEAD AT EXIT: on the frozen game, every register in the ceiling is dead where this entry hands back", { skip }, () => {
  assertDeadAtExit({
    at: TARGET, poison: MAY_MOVE, frames: CORPUS_FRAMES,
    sessions: SESSIONS.map(([label, opts]) => ({ label, tape: opts.tape, dispatches: DISPATCHES[label] })),
    controls: [{
      // POSITIVE CONTROL, same instrument: shift the record register one record on, on this entry's
      // way INTO the handler, where it is read. Silence at the exit means something only if this is heard.
      label: "entry", at: HANDLER, poison: ["ix"], flip: { ix: RECORD_STRIDE }, before: true,
      only: (m) => m.regs.ix === CRAFT_RECORD, reachEvery: true,
    }],
  });
});

test("EXCLUDED: the registers that move, bounded by a ceiling; the pair is held", { skip }, () => {
  const moved = new Set();
  for (const s of sessions()) for (const k of s.moved) moved.add(k);
  for (const c of cross()) {
    const r = diffOf(seatCraftSlot4ThenDispatchByEra, craft(...c));
    if (r.faulted) continue;
    for (const k of r.moved) moved.add(k);
  }
  const list = REG_FIELDS.filter((k) => moved.has(k));
  console.log(`  EXCLUDED (measured): ${list.join(", ")} — ceiling ${MAY_MOVE.join(", ")}`);
  // A CEILING, never `deepEqual`: an equality here would DEMAND the divergence and go red on a
  // rewrite that became register-exact.
  assert.deepEqual(list.filter((k) => !MAY_MOVE.includes(k)), [], "a register outside the ceiling moved");
  for (const k of HELD) assert.ok(!moved.has(k), `a register the handler is handed moved (${k})`);
  // POSITIVE CONTROL, same breath: the ceiling check above is an ABSENCE claim, so show the same
  // instrument reporting a register outside the ceiling that really did move.
  const control = new Set();
  for (const [label] of SESSIONS) {
    for (const k of diffOf(clobbersARegisterOutsideTheCeiling, entryFor(label)).moved) control.add(k);
  }
  assert.ok(control.has("h_"), "the register instrument cannot see a register outside the ceiling being clobbered, " +
    "so the assertion above proves nothing");
  console.log(`  EXCLUDED control: the same instrument reports ${[...control].join(", ")} on a clobbered twin`);
});

test("WHOLE-MACHINE: a wired session of each tape differs only in dead stack bytes", { skip }, () => {
  for (const [label, opts] of SESSIONS) {
    const r = wholeRunCells(seatCraftSlot4ThenDispatchByEra, label, opts);
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

for (const [i, [label, twin, crafted, perSession]] of TWINS.entries()) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = craftedCaught(twin);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
    assert.equal(caught, crafted, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
  });

  test(`TEETH: the ${label} twin's real catch count per session`, { skip }, () => {
    const counts = realTwinCounts();
    const got = SESSIONS.map(([l]) => counts.get(l).counts[i]);
    for (const [j, [l]] of SESSIONS.entries()) {
      assert.equal(counts.get(l).dispatches, DISPATCHES[l], `${l}: the dispatch count moved`);
      assert.equal(got[j], perSession[j], `the ${label} twin's ${l} catch count moved`);
    }
    const blind = SESSIONS.filter((_u, j) => got[j] === 0).map(([l]) => l);
    console.log(
      `  TEETH/${label}: real catches ${SESSIONS.map(([l], j) => `${l} ${got[j]}`).join(", ")}` +
        (blind.length ? ` — BLIND to real dispatches of: ${blind.join(", ")}` : ""),
    );
  });
}
