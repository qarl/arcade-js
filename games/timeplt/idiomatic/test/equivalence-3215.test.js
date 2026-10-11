// SPDX-License-Identifier: GPL-3.0-only
/**
 * startOnePlayerGame — memory-equivalent to the frozen oracle at ROM 0x3215.
 *
 * A handful of stores, one packed-decimal subtraction, and transfers into already-decompiled
 * routines — the caption park at 0x0B2B, the panel repaint at 0x4AFB, the tilemap keep copy at
 * 0x4B30 and the sequence jump at 0x172A. The rewrite calls each directly; dissolving those
 * transfers is this caller's unit, each callee is gated by its own file, so what this file gates is
 * the CHOICE of what is stored, the order relative to the repaint, and the dissolve.
 *
 * The transfers reached by `call` each bracket a pushed return below the entry seat, and the tail
 * jump's callee takes a return the direct call never takes — leaving DEAD STACK SCRATCH below the
 * seat and moving several registers, sp and pc (the declared ceiling). The window is MEASURED: the
 * WINDOW arm instruments the oracle's own `push16` over the whole sweep and reports the deepest
 * stack pointer reached. Every other arm walks the whole dump and masks ONLY that window.
 *
 * The live-out is MEMORY ONLY, derived from the ORACLE's exit successors: its last act is a tail
 * jump to 0x172A, whose `ret` lands on the bare `ret` at 0x181D, so no register this entry leaves
 * is read before it is overwritten. Confirmed by the tape: the oracle's pc after the dispatch is
 * 0x181D.
 *
 * A POISONED machine backs the strict arm, which alone would rest on wrong evidence: most cells
 * this entry stores to already hold what it stores, so a broken twin shows only in masked scratch.
 * Work RAM below the window is filled with one marker and the two tilemap planes with a SECOND —
 * it must be distinct, because the keep copy moves plane bytes into work RAM, so one shared marker
 * would make a copied byte indistinguishable from a cell nothing wrote (how the no-keep-copy twin
 * first went uncaught). The two cells this entry READS are loaded apart, so a twin taking the wrong
 * one diverges at a stored cell. One twin is memory-equivalent by construction and is caught on a
 * REGISTER alone — the marshalling leak a memory gate cannot see.
 *
 * HOLE: this gate pins pc but leaves sp in the excluded set, so a rewrite that leaked stack without
 * writing memory passes here.
 * No gate now owns that: the whole-game gate idiomatic.test.js compares memory only, outside the
 * stack window, under an engine that leaves SP unused.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3215.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, COIN_START_TAPE, romsPresent } from "./_harness.js";
import { startOnePlayerGame } from "../startOnePlayerGame.js";
import { hideCaptionSprites } from "../hideCaptionSprites.js";
import { seatSequencePhase3AndResetSubStep } from "../seatSequencePhase3AndResetSubStep.js";
import { paintCreditCountPanel } from "../paintCreditCountPanel.js";
import { copyThreeTilemapCellsFromBothPlanes } from "../copyThreeTilemapCellsFromBothPlanes.js";
import { loc_3215 as oracle } from "../../translated/loc_3215.js";
import { PLAYER_ONE_LIVES, PLAYER_TWO_LIVES, PLAY_ACTIVE, SEQUENCE_PHASE, SEQUENCE_SUBSTEP } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";
import { assertDeadAtExit, TAPE_SESSIONS } from "./_deadAtExit.js";

const TARGET = 0x3215;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SECOND_PLAYER_FLAG = 0xad31;
const STARTING_LIVES = 0xa9c1;
const PANEL_COUNT = 0xa986;
const CAPTION_SLOTS = [0xaa41, 0xaa43, 0xaa45, 0xaa47];
const KEEP_TABLE = 0x0d1b;
const KEEPS = 3;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 10;

/** The ceiling on register divergence: a BOUND, not a demand — a rewrite diverging on fewer still passes. */
/**
 * c (the pen colour the credit panel leaves) is NOT a live-out: the panel's painter now takes its
 * colour as an argument. Measured on the ORACLE by the DEAD AT EXIT arm below: c complemented where
 * this entry hands back is heard nowhere. The entry runs once per one-player start, so each tape
 * session poisons a single exit, all at the same point of the first start; the RESTARTS session
 * adds exits at later starts with fewer credits left.
 */
const CEILING = ["a", "f", "d", "e", "h", "l", "sp", "a_", "f_", "c"];
/** Outside the ceiling, so the EXCLUDED arm can show the measurement reports one. */
const OUTSIDE = "b";

const COLOUR_PLANE = 0xa000;
const WORK_RAM = 0xa800;
const PLANES_END = 0xa800;
/** No value this entry can store, so any write into work RAM is visible. */
const POISON = 0x5a;
/** A distinct SECOND marker for the tilemap planes (see the header: it disambiguates copied bytes). */
const PLANE_POISON = 0x5b;
/** Two READ cells loaded apart, so a twin taking the wrong one diverges at a stored cell. */
const POISON_STARTING_LIVES = 0x03;
const POISON_PANEL_COUNT = 0x27;

const LIVES_CASES = [0, 1, 2, 3, 5, 0x0f, 0x80, 0xff];

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

/**
 * The module's text against the callees it is supposed to CALL. Each callee is identified by a
 * name out of its own body; the module must name that callee's file, call it, and NOT carry that
 * name. The same predicate runs over each callee itself as a positive control, so the absence is
 * evidence only once the check is shown able to see the thing present.
 */
const HELPERS = [
  ["hideCaptionSprites", "../hideCaptionSprites.js", "SLOT_STRIDE"],
  ["paintCreditCountPanel", "../paintCreditCountPanel.js", "PEN_COLOUR"],
  ["copyThreeTilemapCellsFromBothPlanes", "../copyThreeTilemapCellsFromBothPlanes.js", "PLANE_GAP_HIGH"],
  ["seatSequencePhase3AndResetSubStep", "../seatSequencePhase3AndResetSubStep.js", "LAST_PHASE"],
];

function callsRatherThanRestates(text, [name, file, ownName]) {
  const called = new RegExp(`\\b${name}\\(\\s*m[,)]`);
  return text.includes(`from "./${file.slice(3)}"`) && called.test(text) && !text.includes(ownName);
}

// ── capture ─────────────────────────────────────────────────────────────────────────────

let entries = null;

/** Every dispatch the tape produces, each cloned before the oracle runs on the host machine. */
function captured() {
  if (entries === null) {
    const got = [];
    const host = makeMachine(new Map([[TARGET, (mm) => {
      got.push(mm.clone());
      return oracle(mm);
    }]]));
    host.runFrames(ENTRY_FRAMES);
    assert.equal(host.stoppedBy, null, `the tape stopped early: ${host.stoppedBy}`);
    entries = got;
  }
  assert.ok(entries.length > 0, "vacuous: the tape never reached the routine");
  return entries;
}

const entryState = () => captured()[0];

/**
 * A clone of the captured entry with work RAM below the masked window and both tilemap planes
 * filled with a marker, then the two cells this entry READS loaded apart from one another. The
 * marker makes every write visible; the two distinct read cells are what let a twin taking the
 * wrong one diverge at a stored cell rather than only in stack scratch.
 */
function poisoned() {
  const mm = entryState().clone();
  const floor = mm.regs.sp - SCRATCH_BYTES;
  for (let a = COLOUR_PLANE; a < PLANES_END; a++) mm.mem8[a] = PLANE_POISON;
  for (let a = WORK_RAM; a < floor; a++) mm.mem8[a] = POISON;
  mm.mem8[STARTING_LIVES] = POISON_STARTING_LIVES;
  mm.mem8[PANEL_COUNT] = POISON_PANEL_COUNT;
  return mm;
}

/** The poisoned machine with the packed-decimal count set to `value`. */
function withCount(value) {
  const mm = poisoned();
  mm.mem8[PANEL_COUNT] = value;
  return mm;
}

/** The poisoned machine with the starting count set to `value`. */
function withLives(value) {
  const mm = poisoned();
  mm.mem8[STARTING_LIVES] = value;
  return mm;
}

const COUNT_CASES = Array.from({ length: 256 }, (_unused, i) => i);

/** Every machine this file compares on. What the WINDOW arm measures the oracle over. */
function sweep() {
  return [...captured(), poisoned(), ...COUNT_CASES.map(withCount), ...LIVES_CASES.map(withLives)];
}

// ── comparison ──────────────────────────────────────────────────────────────────────────

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The masked window, and nothing else: the bytes the oracle's own pushes reach and no others. */
function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/**
 * Oracle vs candidate on clones of `machine`: the whole state dump masked to the measured window,
 * then every register outside the ceiling. A candidate that raises counts as caught; only the
 * candidate's side is wrapped, because a raise from the oracle is a harness fault.
 */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, reg: "raised", a: "returned", b: String(e).slice(0, 40) };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (CEILING.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

const show = (d) => {
  if (!d) return "identical";
  return d.addr === null
    ? `${d.reg}: oracle=${d.a} candidate=${d.b}`
    : `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}`;
};

/** How far below its seat the oracle's own pushes take the stack pointer, on one entry state. */
function oracleDepth(machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  oracle(c);
  return seat - deepest;
}

/**
 * The BOUNDARY arm's probe: the ORACLE ITSELF, plus one byte flipped at `sp + offset`. Built on
 * the oracle so what the arm reports is a property of the MASK alone.
 */
function scribbler(offset) {
  return (m) => {
    const at = (m.regs.sp + offset) & 0xffff;
    oracle(m);
    m.mem8[at] ^= 0xff;
  };
}

/** The EXCLUDED arm's probe: the ORACLE ITSELF, plus one register moved. */
function regScribbler(k) {
  return (m) => {
    oracle(m);
    m.regs[k] = m.regs[k] ^ 1;
  };
}

// ── broken twins ────────────────────────────────────────────────────────────────────────
// Each is the module with one thing wrong, transferring the way the module transfers — DIRECT
// calls. A twin reaching a callee by `m.call` would match the oracle's stack traffic exactly and
// so would never be masked, which would let the teeth pass without exercising the exclusion.

const LOW_DIGIT = 0x0f;
const HIGHEST = 0x99;

function stepDown(value) {
  const difference = u8(value - 1);
  let correction = 0;
  if ((value & LOW_DIGIT) === 0 || (difference & LOW_DIGIT) > 9) correction += 6;
  if (value === 0 || difference > HIGHEST) correction += 0x60;
  return u8(difference - correction);
}

function build(o = {}) {
  const opt = {
    park: true, clearFlag: true, clearSecond: true, raisePlay: true, stockFirst: true,
    decimal: true, subtract: true, repaint: true, keeps: true, jump: true,
    livesFrom: STARTING_LIVES, armSecond: false, marshal: false, ...o,
  };
  return (m) => {
    const { mem8 } = m;
    if (opt.park) hideCaptionSprites(m);
    if (opt.clearFlag) mem8[SECOND_PLAYER_FLAG] = 0;
    if (opt.clearSecond) mem8[PLAYER_TWO_LIVES] = 0;
    if (opt.raisePlay) mem8[PLAY_ACTIVE] = 255;
    else mem8[PLAY_ACTIVE] = 0;
    if (opt.stockFirst) mem8[PLAYER_ONE_LIVES] = mem8[opt.livesFrom];
    if (opt.armSecond) mem8[PLAYER_TWO_LIVES] = mem8[opt.livesFrom];
    if (opt.subtract) {
      mem8[PANEL_COUNT] = opt.decimal
        ? stepDown(mem8[PANEL_COUNT])
        : u8(mem8[PANEL_COUNT] - 1);
    }
    if (opt.repaint) paintCreditCountPanel(m);
    if (opt.keeps) {
      if (opt.marshal) {
        m.regs.hl = KEEP_TABLE;
        m.regs.b = KEEPS;
      }
      copyThreeTilemapCellsFromBothPlanes(m);
    }
    if (opt.jump) seatSequencePhase3AndResetSubStep(m);
  };
}

/** BUG: does nothing — the twin that proves the comparison sees a real dispatch. */
function brokenNoOp() {}

const TWINS = [
  ["no-op", brokenNoOp],
  ["plain-decrement", build({ decimal: false })],
  ["arms-both-players", build({ armSecond: true })],
  ["leaves-the-play-flag-clear", build({ raisePlay: false })],
  ["keeps-the-second-player-flag", build({ clearFlag: false })],
  ["no-caption-park", build({ park: false })],
  ["no-repaint", build({ repaint: false })],
  ["no-keep-copy", build({ keeps: false })],
  ["no-sequence-jump", build({ jump: false })],
  ["stocks-from-the-panel-count", build({ livesFrom: PANEL_COUNT })],
  ["marshals-the-keep-copy", build({ marshal: true })],
];

/** How many of the sweep's machines a candidate is caught on, and where it is caught first. */
function caughtOver(candidate) {
  let caught = 0;
  let first = null;
  for (const m of sweep()) {
    const d = unitDiff(candidate, m);
    if (!d) continue;
    caught++;
    first ??= d;
  }
  return { caught, first };
}

/** Measured catch counts over the sweep. A move in any of them is a finding, and zeros are kept. */
const CATCHES = {
  "no-op": 266,
  // Only the counts whose decimal correction is non-zero; the rest agree with a plain subtract.
  "plain-decrement": 156,
  // Every machine but the one whose starting count is zero, where arming the second player stores
  // the zero it is meant to store anyway.
  "arms-both-players": 265,
  "leaves-the-play-flag-clear": 266,
  // Every machine but the real captured one, where that flag already reads zero.
  "keeps-the-second-player-flag": 265,
  "no-caption-park": 266,
  "no-repaint": 266,
  "no-keep-copy": 266,
  "no-sequence-jump": 266,
  // Every machine but the one whose packed count equals its starting count.
  "stocks-from-the-panel-count": 265,
  "marshals-the-keep-copy": 266,
};

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at every real dispatch: identical outside the measured window", { skip }, () => {
  const all = captured();
  let worst = 0;
  for (const e of all) {
    const sp = e.regs.sp;
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    startOnePlayerGame(b);
    const diffs = allDiffs(a, b);
    const strays = diffs.filter((d) => !inScratch(d.addr, sp));
    assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
    assert.ok(diffs.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
    assert.equal(b.pc, e.pc, "the dissolved chain never steps, so the rewrite leaves pc where it " +
      "found it; the oracle's pc is its caller's return address instead");
    worst = Math.max(worst, diffs.length);
  }
  console.log(
    `  EQUAL: ${all.length} dispatch(es) within ${ENTRY_FRAMES} frames, seat ` +
      `${hex4(all[0].regs.sp)}; at most ${worst} differing bytes, all inside the window`,
  );
});

test("WINDOW: the oracle's own deepest push, measured over the whole sweep", { skip }, () => {
  let deepest = 0;
  for (const m of sweep()) deepest = Math.max(deepest, oracleDepth(m));
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
});

test("BOUNDARY: the exclusion is exactly as wide as it declares", { skip }, () => {
  const sp = entryState().regs.sp;
  const below = unitDiff(scribbler(-SCRATCH_BYTES - 1), entryState());
  const seat = unitDiff(scribbler(0), entryState());
  const inside = unitDiff(scribbler(-1), entryState());
  console.log(
    `  BOUNDARY: ${hex4(sp - SCRATCH_BYTES - 1)} caught, ${hex4(sp)} caught, ` +
      `${hex4(sp - 1)} masked`,
  );
  assert.notEqual(below, null, "a divergence one byte BELOW the window was swallowed, so the " +
    "exclusion is wider than it declares and a leaking stack pointer would walk out of sight");
  assert.notEqual(seat, null, "a divergence AT the entry seat was swallowed: the window must lie " +
    "strictly below the seat, and live stack above it must still fail");
  assert.equal(inside, null, "a divergence INSIDE the window was caught, so the catches above " +
    "are the instrument catching everything rather than the boundary being where it says");
});

test("STORES: the oracle really writes every cell the twins break", { skip }, () => {
  const before = poisoned();
  const after = before.clone();
  oracle(after);
  const keeps = [];
  for (let i = 0; i < KEEPS; i++) keeps.push(after.mem16[KEEP_TABLE + i * 4 + 2]);
  const owed = [
    ...CAPTION_SLOTS, SECOND_PLAYER_FLAG, PLAYER_TWO_LIVES, PLAY_ACTIVE, PLAYER_ONE_LIVES,
    PANEL_COUNT, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, ...keeps,
  ];
  const unwritten = owed.filter((a) => after.mem8[a] === POISON);
  assert.deepEqual(unwritten.map(hex4), [], "a cell a twin below is built to break was never " +
    "written by the oracle, so that twin's catch would rest on something else");
  const painted = [];
  for (let a = COLOUR_PLANE; a < PLANES_END; a++) {
    if (after.mem8[a] !== PLANE_POISON) painted.push(a);
  }
  assert.ok(painted.length > 0, "the repaint wrote no plane cell: the no-repaint twin has nothing");
  assert.equal(after.mem8[PLAYER_ONE_LIVES], POISON_STARTING_LIVES, "the first player's stock " +
    "did not come from the starting-count cell, so the wrong-source twin is indistinguishable");
  assert.notEqual(POISON_STARTING_LIVES, POISON_PANEL_COUNT, "the two read cells must differ");
  console.log(
    `  STORES: ${owed.length} named cells written, ${painted.length} plane cells painted ` +
      `from ${hex4(painted[0])}, keeps ${keeps.map(hex4).join(" ")}`,
  );
});

/** Which registers a candidate parts company with the oracle on, over the whole sweep. */
function movedOver(candidate) {
  const moved = new Set();
  for (const m of sweep()) {
    const a = m.clone();
    const b = m.clone();
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

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  // The absence below is evidence only if the same measurement CAN report a register outside the
  // ceiling, and only if it does NOT report one inside. Both controls are planted on the oracle.
  const outside = unitDiff(regScribbler(OUTSIDE), entryState());
  const inside = unitDiff(regScribbler(CEILING[0]), entryState());
  assert.notEqual(outside, null, `a planted move of ${OUTSIDE} was not reported, so a clean ` +
    "reading below proves nothing");
  assert.equal(inside, null, `a planted move of ${CEILING[0]} WAS reported, so the arm is not ` +
    "excluding the ceiling and the two-sided control has collapsed into one");
  const moved = movedOver(startOnePlayerGame);
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${CEILING.join(", ")}; the control moves ${OUTSIDE} and is seen`);
  // CEILING is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !CEILING.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

/**
 * Three credits, then a one-player start every hundred frames; the game-over pokes are laid twice, so
 * the game ends and restarts on the credits left (JS frames: presses one after the schedule's).
 */
const IN0 = COIN_START_TAPE[0].port;
const GAME_OVER = TAPE_SESSIONS.find((s) => s.label === "game-over").pokes;
const RESTARTS = {
  label: "restarts",
  tape: [
    ...[401, 441, 481].map((frame) => ({ frame, port: IN0, bits: 0x01, dur: 8 })),
    ...Array.from({ length: 30 }, (_, k) => ({ frame: 501 + 100 * k, port: IN0, bits: 0x08, dur: 8 })),
  ],
  pokes: [...GAME_OVER, ...GAME_OVER.map((p) => ({ ...p, frame: p.frame + 1500 }))],
  frames: 3600,
};

test("DEAD AT EXIT: on the frozen game, c is dead where this entry hands back", { skip }, () => {
  const exits = assertDeadAtExit({ at: TARGET, poison: ["c"], sessions: [...TAPE_SESSIONS, RESTARTS], frames: 1500 });
  const restarts = exits.find((r) => r.label === "restarts").dead.poisoned;
  assert.ok(restarts > 1, `the RESTARTS session started ${restarts} game(s), so it adds no later exit`);
});

test("PRIORS: every count value and a spread of starting counts", { skip }, () => {
  for (const value of COUNT_CASES) {
    const d = unitDiff(startOnePlayerGame, withCount(value));
    assert.equal(d, null, `count=${value}: ${show(d)}`);
  }
  for (const value of LIVES_CASES) {
    const d = unitDiff(startOnePlayerGame, withLives(value));
    assert.equal(d, null, `lives=${value}: ${show(d)}`);
  }
  // Vacuity guard: the count sweep must actually move what is stored, or it tests nothing.
  const stored = new Set(COUNT_CASES.map((v) => {
    const mm = withCount(v);
    oracle(mm);
    return mm.mem8[PANEL_COUNT];
  }));
  assert.ok(stored.size > 1, "the count sweep leaves the same byte stored every time");
  console.log(
    `  PRIORS: ${COUNT_CASES.length} counts (${stored.size} distinct results) and ` +
      `${LIVES_CASES.length} starting counts identical outside the window`,
  );
});

test("CALLS, NOT RESTATES: the module's text, with each callee as a positive control", () => {
  const module = read("../startOnePlayerGame.js");
  for (const helper of HELPERS) {
    assert.ok(callsRatherThanRestates(module, helper), `the module does not call ${helper[0]}`);
    assert.ok(!callsRatherThanRestates(read(helper[1]), helper),
      `the check passes ${helper[0]}'s ` +
      "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  }
  console.log(`  CALLS, NOT RESTATES: ${HELPERS.map((h) => h[0]).join(", ")} each called, and ` +
    "each of their own bodies fails the same check");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const { caught, first: d } = caughtOver(twin);
    const total = sweep().length;
    assert.ok(caught > 0, `the masked comparison PASSED the ${label} twin everywhere`);
    assert.equal(caught, CATCHES[label], `the ${label} twin's catch count moved`);
    if (label === "marshals-the-keep-copy") {
      assert.equal(d.addr, null, "this twin is memory-equivalent by construction, so a catch on " +
        "a CELL means the twin is not the marshalling leak it is meant to be");
    } else {
      assert.notEqual(d.addr, null, `the ${label} twin is caught on a register alone, so nothing ` +
        "says a cell it stores is wrong");
    }
    console.log(`  TEETH/${label}: caught on ${caught} of ${total} — first ${show(d)}`);
  });
}
