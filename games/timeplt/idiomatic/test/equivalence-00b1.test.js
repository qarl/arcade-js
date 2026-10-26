// SPDX-License-Identifier: GPL-3.0-only
/**
 * tileCharPlaneWithBoxLattice — memory-equivalent to the frozen oracle at ROM 0x00B1.
 *
 * WHAT IT IS. Two counted loops around a stamp: fourteen bands of sixteen boxes, the cursor stepped
 * two cells along inside a band and a whole line skipped between them. The stamp at ROM 0x00C7 IS
 * ALREADY DECOMPILED, so the rewrite calls stampGridBox directly and dissolving those 224 calls
 * belongs to this caller's unit. Nothing is read to decide where a box goes, so the whole content
 * of the routine is WHICH CELLS, and the LATTICE arm compares that set against the oracle's own.
 *
 * ★ HOW THE LIVE-OUT WAS DERIVED, AND IT IS FROM THE ORACLE. The oracle's only exit is its own
 *   return, and the instructions at the one return site this port has transcribed load a counter, a
 *   fresh address pair, and clear the accumulator before reading any of them — so nothing this
 *   routine leaves in a register is consumed and the live-out is memory only. What the rewrite
 *   happens to agree on anyway is asserted HELD rather than merely permitted, because agreeing more
 *   closely should never be something a gate has to be edited to accept.
 *
 * ★ THE MASKED WINDOW IS THE ORACLE'S OWN, AND IT IS MEASURED. Each dissolved call laid down a
 *   return address and the stamp saved the cursor under it; the rewrite writes neither. The SCRATCH
 *   arm instruments the oracle's own `push16` over this file's whole sweep and PINS the depth it
 *   reaches, so a change in the oracle's stack traffic turns this gate red instead of being
 *   absorbed by a wider mask.
 *
 * ★ THE CRAFTED ENTRIES POISON BOTH PLANES. On a real machine the lattice is stamped onto cells
 *   that mostly already hold the blanking glyph, so an unpoisoned comparison would be weak in
 *   exactly the place the routine works. Filling both planes with a marker first makes every cell
 *   the routine writes visible, and is what gives the LATTICE arm and the teeth their power.
 *
 * ★ SP AND pc BELONG TO THE DISPATCH SEAM. The oracle nets one return; the rewrite performs none.
 *   The candidate runs THROUGH `withOmittedRet`, and SP and pc are then compared for EQUALITY.
 *
 * GATE: strict unit-capture on the one dispatch each session produces, a crafted sweep over the
 *   planes' prior contents, and a convergent whole-machine replay.
 *
 *   1. REACH — dispatch counts per session, measured and pinned.
 *   2. EQUAL — masked RAM, SP and pc identical at the real dispatch of each session.
 *   3. NOT VACUOUS — a candidate that does nothing FAILS the same comparison.
 *   4. SCRATCH — the oracle's own deepest push, pinned; every raw difference strictly below the
 *      entry pointer and no deeper; and at least one seen, so the mask is not decoration.
 *   5. CRAFTED — eight prior fills of both planes, all identical outside the window.
 *   6. LATTICE — the set of cells written and the codes written into them, taken from the ORACLE
 *      at run time and required of the rewrite; plus the shape that set has to have, so a rewrite
 *      writing a different 896 cells could not pass by count alone.
 *   7. CALLS, NOT RESTATES — the module's text: it must name the stamp's file and call it rather
 *      than carry the stamp's own body, with that body as the control.
 *   8. EXCLUDED — the registers that move, bounded by a CEILING asserted as a subset, with the
 *      untouched ones asserted HELD and a positive control.
 *   9. WHOLE-MACHINE, CONVERGENT — and it does NOT come back clean, deliberately. See below.
 *  10. WHOLE-MACHINE TEETH — a do-nothing twin does not heal, so the convergence above is a
 *      property of the rewrite rather than of the instrument.
 *  11. TEETH — eight twins on exact counts.
 *
 * ★ WHY THE WHOLE-MACHINE ARM IS CONVERGENT AND NOT STRICT, WITH THE MECHANISM MEASURED BESIDE THE
 *   NUMBER. The oracle's own span is longer than what is left of the frame it starts in — the arm
 *   MEASURES the T-states it spends and the frame boundary it crosses — so the dump taken at that
 *   boundary catches the lattice PART-WAY on the oracle's side. The rewrite spends no T-states, so
 *   even with the oracle's cost handed back in one piece afterwards the same dump catches the
 *   lattice COMPLETE. That is the one frame the two disagree on in the character plane, and the arm
 *   pins it. Everything else is dead stack below the dispatch seat, and all of it heals. Handing
 *   the cost back per box instead would need this file to re-time the oracle instruction by
 *   instruction, which is the oracle.
 *
 * HOLE: ONE dispatch per session, in boot, so there is no variety in real machine state at all and
 * the crafted priors are doing all the discriminating.
 * HOLE: the cursor origin, the band count and the box count are constants no crafted entry can
 * vary. The twins vary them instead.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-00b1.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { tileCharPlaneWithBoxLattice } from "../tileCharPlaneWithBoxLattice.js";
import { stampGridBox } from "../stampGridBox.js";
import { loc_00b1 as oracle } from "../../translated/loc_00b1.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x00b1;

/** The shape the rewrite claims, as the twins' baseline. */
const CURSOR_ORIGIN = 0xa420;
const CELLS_PER_LINE = 32;
const BANDS = 14;
const BOXES_PER_BAND = 16;
const BOX_CELLS = 2;

/** The two 1KB tilemap planes, colour first in the address space. */
const COLOUR_PLANE = 0xa000;
const CHARACTER_PLANE = 0xa400;
const PLANE_BYTES = 0x400;

/** Bytes below the entry stack pointer the dissolved calls reach. Measured by the SCRATCH arm. */
const WINDOW = 4;

const CORPUS_FRAMES = 2500;
const SESSIONS = [["coin-start", {}], ["demo", { tape: [] }]];

/** Measured over CORPUS_FRAMES. A move is a finding about the tapes, not a tolerance to widen. */
const DISPATCHES = { "coin-start": 1, demo: 1 };

/** Prior fills of both planes. None is a code this routine lays down, so every write shows. */
const PRIORS = [0x00, 0xff, 0x55, 0xaa, 0x01, 0x80, 0x7f, 0xf0];

/**
 * A CEILING on the registers that may differ, not a pin: asserted as a subset, so a rewrite that
 * happens to agree on one of these still passes. What is asserted positively is HELD.
 */
const MAY_MOVE = ["f", "b", "c", "h", "l"];
const HELD = ["a", "d", "e", "ix", "iy", "sp"];

/** Measured: the dead stack cells a whole wired session leaves differing, as a CEILING. */
const SESSION_SCRATCH = [0xaffa, 0xaffb, 0xaffc, 0xaffd];
/** Measured: the frames on which a cell OUTSIDE the stack differs, and when everything heals. */
const PLANE_FRAMES = [34];
const HEALED_BY = 236;
/** Measured: how many frame boundaries the oracle's own span crosses. This is the mechanism. */
const ORACLE_BOUNDARIES = 1;
const RET_TSTATES = 10;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d === null || d === undefined ? "identical" : `${d.key ?? hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}`;

const seam = (candidate) => withOmittedRet(candidate, TARGET);
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

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

/** How far below its seat a function's own pushes take the stack pointer, on one machine. */
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
  try { fn(c); } catch { /* a faulting run still pushed whatever it pushed */ }
  return seat - deepest;
}

// ── the sessions ────────────────────────────────────────────────────────────────────────

const entries = new Map();
const sessionCache = new Map();

function runSession(label, opts) {
  const moved = new Set();
  let dispatches = 0;
  let caught = 0;
  let informative = 0;
  let deepest = 0;
  let escaped = 0;
  let oracleDepth = 0;
  let spent = 0;
  let boundaries = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (!entries.has(label)) entries.set(label, mm.clone());
    const r = diffOf(tileCharPlaneWithBoxLattice, mm);
    if (r.informative) informative++;
    for (const k of r.moved) moved.add(k);
    if (r.caught) caught++;
    oracleDepth = Math.max(oracleDepth, pushDepth(oracle, mm));
    for (const d of r.raw) {
      if (d.addr >= r.sp) escaped++;
      else deepest = Math.max(deepest, r.sp - d.addr);
    }
    // The mechanism the WHOLE-MACHINE arm reports, measured on the REAL machine: how long the
    // oracle's own span is and how many frame boundaries it runs through.
    const cycles = mm.cycles;
    const frames = mm.frames.length;
    const out = oracle(mm);
    spent = Math.max(spent, mm.cycles - cycles);
    boundaries = Math.max(boundaries, mm.frames.length - frames);
    return out;
  }]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `the ${label} session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, `the ${label} session ran short`);
  return { label, dispatches, moved, caught, informative, deepest, escaped, oracleDepth, spent, boundaries };
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

/** A real captured machine with both planes filled with one marker byte. */
function craft(machine, prior) {
  const m = machine.clone();
  for (let a = COLOUR_PLANE; a < CHARACTER_PLANE + PLANE_BYTES; a++) m.mem8[a] = prior;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  crossCache = [];
  for (const [label] of SESSIONS) {
    for (const prior of PRIORS) crossCache.push({ label, prior, machine: craft(entryFor(label), prior) });
  }
  return crossCache;
}

const craftedCaught = (twin) => cross().filter((c) => diffOf(twin, c.machine).caught).length;

/** What one side leaves in the two planes, against the marker it was given. */
function written(fn, machine, prior) {
  const m = machine.clone();
  try { fn(m); } catch { /* a faulting side is reported as whatever it managed to write */ }
  const cells = [];
  for (let a = COLOUR_PLANE; a < CHARACTER_PLANE + PLANE_BYTES; a++) {
    if (m.mem8[a] !== prior) cells.push([a, m.mem8[a]]);
  }
  return cells;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** The lattice with one of its five constants changed, built the way the module is built. */
function grid({ bands = BANDS, boxes = BOXES_PER_BAND, origin = CURSOR_ORIGIN,
  line = CELLS_PER_LINE, step = BOX_CELLS, skipLine = true } = {}) {
  return (m) => {
    let cursor = origin;
    for (let band = 0; band < bands; band++) {
      if (skipLine) cursor += line;
      for (let box = 0; box < boxes; box++) {
        stampGridBox(m, cursor);
        cursor += step;
      }
    }
  };
}

/** BUG: does nothing at all — no box is stamped. */
function brokenNoOp() {}

/** NOT A TWIN OF THIS ROUTINE: the positive control for the held-register instrument. */
function clobbersAHeldRegister(m) {
  tileCharPlaneWithBoxLattice(m);
  m.regs.a = (m.regs.a + 1) & 0xff;
}

/** Measured over the crafted priors. */
const TWINS = [
  ["no-op", brokenNoOp, 16],
  ["one-band-short", grid({ bands: BANDS - 1 }), 16],
  ["one-band-long", grid({ bands: BANDS + 1 }), 16],
  ["one-box-short", grid({ boxes: BOXES_PER_BAND - 1 }), 16],
  ["one-box-long", grid({ boxes: BOXES_PER_BAND + 1 }), 16],
  ["wrong-origin", grid({ origin: CURSOR_ORIGIN - CELLS_PER_LINE }), 16],
  ["no-band-skip", grid({ skipLine: false }), 16],
  ["wrong-box-stride", grid({ step: BOX_CELLS + 1 }), 16],
];

/**
 * The module's text against the stamp it is supposed to CALL. The stamp is identified by a name out
 * of its own body; the module must name the stamp's file, call it, and NOT carry that name.
 */
const HELPER = ["stampGridBox", "../stampGridBox.js", "SECOND_TO_THIRD"];

function callsRatherThanRestates(text, [name, file, ownName]) {
  return text.includes(`from "./${file.slice(3)}"`) &&
    text.includes(`${name}(m`) &&
    !text.includes(ownName);
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

/** The candidate wired as the game dispatches it, with the oracle's own T-state cost handed back. */
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

/** Per differing cell, every frame it differed on. */
function wholeRun(candidate, label, opts) {
  const { frames: baseFrames, toAddr } = baselineFrames(label, opts);
  const fired = { n: 0 };
  const host = makeMachine(new Map([[TARGET, hosted(candidate, fired)]]), opts);
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try { hostFrames = host.runFrames(CORPUS_FRAMES); } catch (e) { threw = String(e).slice(0, 100); }
  const lastFrame = new Map();
  const framesOf = new Map();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] === hostFrames[i][o]) continue;
      const addr = toAddr(o);
      lastFrame.set(addr, i);
      if (!framesOf.has(addr)) framesOf.set(addr, new Set());
      framesOf.get(addr).add(i);
    }
  }
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => toAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { lastFrame, framesOf, frames: n, fired: fired.n, threw, stopped: host.stoppedBy };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REACH: the dispatch count of each session, and the oracle's own span", { skip }, () => {
  for (const s of sessions()) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} session never reaches the routine`);
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.ok(s.informative > 0, `no ${s.label} dispatch writes anything outside the window`);
    assert.equal(s.boundaries, ORACLE_BOUNDARIES, `the ${s.label} session's oracle span now runs ` +
      "through a different number of frame boundaries, which is the whole account the " +
      "WHOLE-MACHINE arm gives of why it is convergent");
    console.log(`  REACH/${s.label}: ${s.dispatches} dispatch, ${s.informative} informative; the ` +
      `oracle spends ${s.spent} T-states and runs through ${s.boundaries} frame boundary`);
  }
});

test("EQUAL at the real dispatch of each session", { skip }, () => {
  for (const [label] of SESSIONS) {
    const r = diffOf(tileCharPlaneWithBoxLattice, entryFor(label));
    assert.equal(r.faultA, null, `${label}: the oracle faulted (${r.faultA})`);
    assert.equal(r.faultB, null, `${label}: the rewrite faulted (${r.faultB})`);
    assert.deepEqual(r.masked, [], `${label}: ${show(r.masked[0])}`);
    assert.equal(r.spDiff, null, `${label}: the stack pointer must come back to the same seat`);
    assert.equal(r.pcDiff, null, `${label}: the seam must land pc where the caller's slot pointed`);
    console.log(`  EQUAL/${label}: entry pointer ${hex4(r.sp)}, ${r.raw.length} raw bytes differ, ` +
      "all masked");
  }
});

test("NOT VACUOUS: a candidate that does nothing FAILS the same comparison", { skip }, () => {
  for (const [label] of SESSIONS) {
    assert.ok(diffOf(brokenNoOp, entryFor(label)).caught,
      `${label}: the comparison passed a candidate that does nothing`);
  }
  const r = diffOf(brokenNoOp, entryFor(SESSIONS[0][0]));
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(r.masked[0])}`);
});

test("SCRATCH: the window is the oracle's own deepest push, and nothing escapes it", { skip }, () => {
  let deepestDiff = 0;
  let deepestPush = 0;
  let seen = 0;
  for (const c of cross()) {
    deepestPush = Math.max(deepestPush, pushDepth(oracle, c.machine));
    const r = diffOf(tileCharPlaneWithBoxLattice, c.machine);
    for (const d of r.raw) {
      assert.ok(d.addr < r.sp, `${c.label} prior ${c.prior}: ${hex4(d.addr)} is at or above the seat`);
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
    "is no longer the measured one");
  console.log(`  SCRATCH: oracle pushes ${deepestPush} below its seat, window ${WINDOW}, deepest ` +
    `difference ${deepestDiff}, none at or above the seat`);
});

test("CRAFTED: every prior fill of both planes is identical outside the window", { skip }, () => {
  let informative = 0;
  for (const c of cross()) {
    const r = diffOf(tileCharPlaneWithBoxLattice, c.machine);
    assert.equal(r.faulted, false, `${c.label} prior ${c.prior}: ${r.faultA} vs ${r.faultB}`);
    assert.deepEqual(r.masked, [], `${c.label} prior ${c.prior}: ${show(r.masked[0])}`);
    assert.equal(r.spDiff, null, "the seam left SP adrift");
    assert.equal(r.pcDiff, null, "the seam left pc adrift");
    if (r.informative) informative++;
  }
  assert.ok(informative > 0, "no crafted entry wrote anything outside the window");
  console.log(`  CRAFTED: ${cross().length} plane fills identical, ${informative} informative`);
});

test("LATTICE: the cells written and the codes in them, taken from the oracle", { skip }, () => {
  for (const c of cross()) {
    const fromOracle = written(oracle, c.machine, c.prior);
    const fromRewrite = written(tileCharPlaneWithBoxLattice, c.machine, c.prior);
    assert.deepEqual(fromRewrite, fromOracle, `${c.label} prior ${c.prior}: the rewrite writes a ` +
      "different set of cells, or different codes into them");
  }
  // The set has to have a SHAPE, or "896 cells" would be satisfied by 896 wrong ones. All of it is
  // read off the oracle's own output rather than written down here.
  const c = cross()[0];
  const cells = written(oracle, c.machine, c.prior);
  const addrs = cells.map(([a]) => a);
  const codes = [...new Set(cells.map(([, v]) => v))].sort((x, y) => x - y);
  assert.ok(cells.length > 0, "the oracle wrote nothing over a poisoned plane: this arm has no power");
  assert.equal(cells.length, BANDS * BOXES_PER_BAND * codes.length,
    "the cells written are no longer one code per box per band");
  assert.equal(new Set(addrs).size, addrs.length, "a cell was counted twice");
  assert.ok(addrs.every((a) => a >= CHARACTER_PLANE), "a cell outside the character plane was written");
  assert.equal(Math.min(...addrs), CURSOR_ORIGIN + CELLS_PER_LINE,
    "the lattice no longer begins one line past the cursor's origin");
  assert.equal(
    Math.max(...addrs),
    CURSOR_ORIGIN + CELLS_PER_LINE * (1 + 2 * BANDS) - 1,
    "the lattice no longer ends where two lines per band from that origin would put it",
  );
  console.log(`  LATTICE: ${cells.length} cells ${hex4(Math.min(...addrs))}..${hex4(Math.max(...addrs))}, ` +
    `codes ${codes.join(",")}, identical to the oracle's on ${cross().length} plane fills`);
});

test("CALLS, NOT RESTATES: the module's text, with the stamp as a positive control", () => {
  const module = read("../tileCharPlaneWithBoxLattice.js");
  assert.ok(callsRatherThanRestates(module, HELPER), `the module does not call ${HELPER[0]}`);
  assert.ok(!callsRatherThanRestates(read(HELPER[1]), HELPER), `the check passes ${HELPER[0]}'s ` +
    "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  console.log(`  CALLS, NOT RESTATES: ${HELPER[0]} is called, and its own body fails the same check`);
});

test("EXCLUDED: the registers that move, bounded by a ceiling", { skip }, () => {
  const moved = new Set();
  for (const s of sessions()) for (const k of s.moved) moved.add(k);
  for (const c of cross()) for (const k of diffOf(tileCharPlaneWithBoxLattice, c.machine).moved) moved.add(k);
  const list = REG_FIELDS.filter((k) => moved.has(k));
  console.log(`  EXCLUDED (measured): ${list.join(", ")} — ceiling ${MAY_MOVE.join(", ")}`);
  // A CEILING, never `deepEqual`: an equality here would DEMAND the divergence and go red on a
  // rewrite that became register-exact.
  assert.deepEqual(list.filter((k) => !MAY_MOVE.includes(k)), [], "a register outside the ceiling moved");
  for (const k of HELD) assert.ok(!moved.has(k), `a register asserted held moved (${k})`);
  const control = new Set(diffOf(clobbersAHeldRegister, entryFor(SESSIONS[0][0])).moved);
  assert.ok(control.has("a"), "the register instrument cannot see a held register being clobbered, " +
    "so the assertion above proves nothing");
  console.log(`  EXCLUDED control: the same instrument reports ${[...control].join(", ")} on a clobbered twin`);
});

test("WHOLE-MACHINE, CONVERGENT: the plane disagrees on the boundary frame only, and heals", { skip }, () => {
  for (const [label, opts] of SESSIONS) {
    const r = wholeRun(tileCharPlaneWithBoxLattice, label, opts);
    assert.equal(r.threw, null, `${label}: the run threw: ${r.threw}`);
    assert.equal(r.stopped, null, `${label}: the run stopped early (${r.stopped})`);
    assert.equal(r.frames, CORPUS_FRAMES, `${label}: compared ${r.frames} of ${CORPUS_FRAMES} frames`);
    assert.ok(r.fired > 0, `${label}: vacuous — the override never dispatched`);
    const cells = [...r.lastFrame.keys()].sort((x, y) => x - y);
    const stack = cells.filter((c) => SESSION_SCRATCH.includes(c));
    const plane = cells.filter((c) => !SESSION_SCRATCH.includes(c));
    for (const cell of plane) {
      assert.ok(cell >= CHARACTER_PLANE && cell < CHARACTER_PLANE + PLANE_BYTES,
        `${label}: ${hex4(cell)} differs and is neither dead stack nor a character cell`);
      assert.deepEqual([...r.framesOf.get(cell)].sort((x, y) => x - y), PLANE_FRAMES,
        `${label}: ${hex4(cell)} differs on frames other than the one the oracle's span straddles`);
    }
    const last = Math.max(...r.lastFrame.values());
    assert.equal(last, HEALED_BY, `${label}: the run now heals at frame ${last}`);
    assert.ok(CORPUS_FRAMES - 1 - last > CORPUS_FRAMES / 2, `${label}: too little converged tail ` +
      "to call this healed rather than merely not yet diverged");
    console.log(`  WHOLE-MACHINE/${label}: ${r.fired} dispatch; ${plane.length} character cells on ` +
      `frame ${PLANE_FRAMES.join(",")} only, ${stack.length} dead stack cells; healed at ${last}, ` +
      `${CORPUS_FRAMES - 1 - last} converged frames after`);
  }
});

test("WHOLE-MACHINE TEETH: a do-nothing twin does NOT heal", { skip }, () => {
  for (const [label, opts] of SESSIONS) {
    const r = wholeRun(brokenNoOp, label, opts);
    assert.ok(r.fired > 0, `${label}: vacuous — the twin never dispatched`);
    const last = r.lastFrame.size ? Math.max(...r.lastFrame.values()) : -1;
    assert.ok(r.threw !== null || last > HEALED_BY,
      `${label}: the convergent arm passed a candidate that does nothing, so healing is a property ` +
        "of the instrument rather than of the rewrite");
    console.log(`  WHOLE-MACHINE TEETH/${label}: the no-op still differs at frame ${last} on ` +
      `${r.lastFrame.size} cells`);
  }
});

for (const [label, twin, crafted] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted fills`, { skip }, () => {
    const caught = craftedCaught(twin);
    assert.ok(caught > 0, `the crafted sweep missed the ${label} twin everywhere`);
    assert.equal(caught, crafted, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted fills`);
  });
}
