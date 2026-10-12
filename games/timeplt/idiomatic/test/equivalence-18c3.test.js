// SPDX-License-Identifier: GPL-3.0-only
/**
 * stepHighScoreInitialsEntry — memory-equivalent to the frozen oracle at ROM 0x18C3 (high-score initials entry).
 *
 * WHAT IT IS. One frame of the initials-entry screen. Even frames roll four panel controls into
 * press histories and act on a fresh press (commit a letter, step the shown letter either way) or
 * empty a saturated history; odd frames flash the cursor cell's colour; every eighth frame ticks an
 * entry clock. Finishing (last slot committed, or clock out) re-arms the clock, queues the
 * transition sounds and steps the sequence sub-step. Then, once neither player has lives, a held
 * start button with a credit (or on free play) starts a game. Every callee is a direct call.
 *
 * CORPUS. The shipped high-score recipe (tapes/high-score.poke.json: a held qualifying score, then a
 * forced last death) reaches this entry for real, from its real dispatcher. Two sessions ride it:
 * IDLE (nothing pressed on the entry screen, so the clock runs out) and LETTERS (forward, back,
 * held-to-repeat on both, and both commit buttons, until the last slot finishes the entry).
 *
 * GATE, holes stated:
 *   1. NATURAL — every real dispatch in both sessions replays identically: RAM outside the dead
 *      stack window below the entry SP, plus pc and SP. The candidate runs through the game's own
 *      omitted-return seam, so SP and pc are comparable with the oracle's `ret`.
 *   2. PATHS — the natural corpus is asserted to reach the commit, letter-step, rearm and finish
 *      paths, so arm 1 is not green on the idle path alone.
 *   3. CRAFTED SCAN — a real captured entry with the frame tick, the facing panel (both screen
 *      orientations), the four histories, the letter, the slots left, the clock and the cursor
 *      plane poked identically on both sides.
 *   4. CRAFTED START — lives, free play, credit count and start buttons swept, reaching the three
 *      game-start tails the natural corpus never takes.
 *   5. REGISTERS — the union of registers that differ is measured and held to the scratch set. The
 *      one caller's continuation reads memory before any register, so none is a live-out.
 *   6. WHOLE-MACHINE — both sessions with the rewrite wired at the entry, frame by frame; only the
 *      dead stack window below the dispatch SP may differ.
 *   7. SP-TOOTH — the rewrite is placeable by the seam; a twin with a stray push is not.
 *   8. TEETH — source mutants of the rewrite, each required to be caught somewhere.
 *
 * HOLE: the start-a-game tails run only on crafted entries; no session inserts a coin on the
 * entry screen and presses start while this entry still owns the frame.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-18c3.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, COIN_FRAME, COIN_START_TAPE, romsPresent } from "./_harness.js";
import { assertDeadAtExit, TAPE_SESSIONS } from "./_deadAtExit.js";
import { withOmittedRet } from "../../machine.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { stepHighScoreInitialsEntry } from "../stepHighScoreInitialsEntry.js";
import { loc_18c3 as oracle } from "../../translated/loc_18c3.js";
import {
  CREDIT_COUNT, FRAME_TICK, FREE_PLAY, IN0_MIRROR, IN1_MIRROR, IN2_MIRROR, PLAYER_ONE_LIVES,
  PLAYER_SPRITE_Y, PLAYER_TWO_LIVES, PLAY_ACTIVE, SCRATCH_PTR_B, SCREEN_UNFLIPPED, SEQUENCE_DELAY,
  SEQUENCE_SUBSTEP,
} from "../names.js";

const TARGET = 0x18c3;

// Initials-entry cells (no names.js entry yet).
const BACK_HISTORY = 0xa995;
const FORWARD_HISTORY = 0xa996;
const COMMIT_HISTORY = 0xa997;
const OTHER_COMMIT_HISTORY = 0xa998;
const LETTER_INDEX = 0xa999;
const SLOTS_LEFT = 0xa99a;
const HISTORIES = [BACK_HISTORY, FORWARD_HISTORY, COMMIT_HISTORY, OTHER_COMMIT_HISTORY];

/** Measured: the deepest oracle call bracket leaves return words in the ten bytes below entry SP. */
const SCRATCH_BYTES = 10;
/** Measured over natural + crafted entries. The one caller's continuation reads memory before any
 * register. b, a_ and f_ move only on the game-start tails, whose own gates carry the same ceiling. */
/**
 * c is NOT a live-out (it would hold the pen colour a game start's credit-panel repaint leaves): the
 * panel's painter now takes its colour as an argument. From the ORACLE: this sub-step arm returns
 * through the dispatcher's tail 0x0F54 — on the start path that leaves c, play has just been made
 * active, so 0x0F54 returns at once — into the NMI epilogue 0x0174, whose
 * 0x55D4 writes b/c before any read and which then pops every register.
 * Measured on the ORACLE by the DEAD AT EXIT arm below: c complemented where this entry hands back is
 * heard nowhere, over every tape session — but only tapes/high-score.poke.json reaches this entry, on
 * its initials-entry path. No session takes the start path that leaves the colour in c, so on that
 * path c's liveness rests on the static read above (0x0F54 returns at once, 0x55D4 writes b/c first),
 * not on a measurement.
 */
const MOVED = ["a", "f", "b", "d", "e", "h", "l", "a_", "f_", "c"];

const IN1 = 0xc320;
const BACK = 0x01;
const FORWARD = 0x02;
const COMMIT = 0x10;
const OTHER_COMMIT = 0x20;

const IDLE_FRAMES = 4000;
const LETTERS_FRAMES = 3000;
/** Measured dispatch counts; a move here is a finding. */
const DISPATCHES = { idle: 2044, letters: 418 };

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${d.addr === null ? "reg" : hex4(d.addr)}: oracle=${d.a} candidate=${d.b}` : "identical");

// ── the recipe ──────────────────────────────────────────────────────────────────────────

const RECIPE = JSON.parse(readFileSync(new URL("../../tapes/high-score.poke.json", import.meta.url), "utf8"));
/** The recipe rides MAME's frame numbering; the JS tape is one frame later (COIN_FRAME vs coin). */
// The coin frame is a top-level field on older tapes and an `inputs` entry on newer ones.
const SHIFT = COIN_FRAME - (RECIPE.coin ?? RECIPE.inputs.find((i) => i.press === "coin").frame);
const POKES = RECIPE.pokes.map((p) => ({
  frame: p.frame + SHIFT, addr: parseInt(p.addr, 16), val: parseInt(p.val, 16), dur: p.dur ?? null,
}));

function lettersTape() {
  const presses = [
    [FORWARD, 6], [0, 10], [FORWARD, 6], [0, 10], [BACK, 6], [0, 10], [COMMIT, 6], [0, 10],
    [FORWARD, 120], [0, 10], [BACK, 120], [0, 10], [OTHER_COMMIT, 6], [0, 10], [BACK, 6], [0, 10],
    [COMMIT, 6],
  ];
  const tape = [...COIN_START_TAPE];
  let frame = 1300;
  for (const [bits, dur] of presses) {
    if (bits) tape.push({ frame, port: IN1, bits, dur });
    frame += dur;
  }
  return tape;
}

const SESSIONS = [
  ["idle", COIN_START_TAPE, IDLE_FRAMES],
  ["letters", lettersTape(), LETTERS_FRAMES],
];

function session(overrides, tape) {
  const m = makeMachine(overrides, { tape });
  m.pokes = POKES;
  return m;
}

// ── the comparison ──────────────────────────────────────────────────────────────────────

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    withOmittedRet(candidate, TARGET)(b);
  } catch (e) {
    return { addr: null, a: "placed", b: `seam threw: ${String(e.message).slice(0, 60)}` };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp) continue;
    return { addr, a: da[i], b: db[i] };
  }
  if (a.pc !== b.pc) return { addr: null, a: `pc ${hex4(a.pc)}`, b: `pc ${hex4(b.pc)}` };
  if (a.regs.sp !== b.regs.sp) return { addr: null, a: `sp ${hex4(a.regs.sp)}`, b: `sp ${hex4(b.regs.sp)}` };
  return null;
}

function movedRegisters(candidate, machine, into) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  withOmittedRet(candidate, TARGET)(b);
  for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) into.add(k);
}

// ── the natural corpus ──────────────────────────────────────────────────────────────────

let corpusCache = null;
function corpus() {
  if (corpusCache) return corpusCache;
  corpusCache = {};
  for (const [label, tape, frames] of SESSIONS) {
    const entries = [];
    const paths = { commit: 0, letter: 0, rearm: 0, finish: 0, odd: 0 };
    const m = session(new Map([[TARGET, (mm) => {
      const before = mm.clone();
      entries.push(before);
      oracle(mm);
      if (before.mem8[SLOTS_LEFT] !== mm.mem8[SLOTS_LEFT]) paths.commit++;
      if (before.mem8[LETTER_INDEX] !== mm.mem8[LETTER_INDEX]) paths.letter++;
      if (before.mem8[SEQUENCE_SUBSTEP] !== mm.mem8[SEQUENCE_SUBSTEP]) paths.finish++;
      if (before.mem8[FRAME_TICK] & 1) paths.odd++;
      for (const [h, saturated] of [[BACK_HISTORY, 0x7f], [FORWARD_HISTORY, 0xff]]) {
        const rolledPressed = ((before.mem8[h] << 1) | 1) & 0xff;
        if (!(before.mem8[FRAME_TICK] & 1) && rolledPressed === saturated && mm.mem8[h] === 0) paths.rearm++;
      }
    }]]), tape);
    const ran = m.runFrames(frames);
    assert.equal(m.stoppedBy, null, `the ${label} session stopped early: ${m.stoppedBy}`);
    assert.equal(ran.length, frames, `the ${label} session ran short`);
    corpusCache[label] = { entries, paths };
  }
  return corpusCache;
}

const allNatural = () => Object.values(corpus()).flatMap((s) => s.entries);

/** A real even-frame dispatch from the idle session, the base every crafted entry is poked from. */
function baseEntry() {
  const e = corpus().idle.entries.find((m) => (m.mem8[FRAME_TICK] & 1) === 0);
  assert.ok(e, "vacuous: no even-frame dispatch captured");
  return e;
}

// ── the crafted entries ─────────────────────────────────────────────────────────────────

const TICKS = [0x00, 0x01, 0x02, 0x11];
const FACINGS = [1, 0];
const CONTROLS = [0x00, BACK, FORWARD, COMMIT, OTHER_COMMIT];
const HISTORY_SETS = [
  [0x00, 0x00, 0x00, 0x00],
  [0x3f, 0x7f, 0x00, 0x00],
  [0x7f, 0xff, 0x00, 0x00],
  [0x04, 0x04, 0x04, 0x04],
  [0x80, 0x80, 0x80, 0x80],
  [0x7e, 0xfe, 0x7e, 0xfe],
];
const LETTERS = [0, 26];
const SLOTS = [1, 3];
const CLOCKS = [1, 60];
const CURSOR_PLANES = [0, 0x400];

function* scanEntries() {
  const base = baseEntry();
  const cursor = base.mem16[SCRATCH_PTR_B];
  for (const tick of TICKS) for (const facing of FACINGS) for (const controls of CONTROLS)
    for (const hist of HISTORY_SETS) for (const letter of LETTERS) for (const slots of SLOTS)
      for (const clock of CLOCKS) for (const plane of CURSOR_PLANES) {
        const m = base.clone();
        m.mem8[FRAME_TICK] = tick;
        m.mem8[SCREEN_UNFLIPPED] = facing;
        m.mem8[facing ? IN1_MIRROR : IN2_MIRROR] = controls;
        m.mem8[facing ? IN2_MIRROR : IN1_MIRROR] = controls ^ 0x33;
        HISTORIES.forEach((h, i) => (m.mem8[h] = hist[i]));
        m.mem8[LETTER_INDEX] = letter;
        m.mem8[SLOTS_LEFT] = slots;
        m.mem8[SEQUENCE_DELAY] = clock;
        m.mem16[SCRATCH_PTR_B] = cursor ^ plane;
        yield m;
      }
}

const LIVES = [[0, 0], [1, 0], [0, 1]];
const FREE = [0, 1];
const CREDITS = [0x00, 0x01, 0x02, 0x99];
const STARTS = [0x00, 0x08, 0x10, 0x18];
const SPRITE_SLOTS = 24;

function* startEntries() {
  const base = baseEntry();
  for (const tick of [0x01, 0x02]) for (const [p1, p2] of LIVES) for (const free of FREE)
    for (const credits of CREDITS) for (const start of STARTS) {
      const m = base.clone();
      m.mem8[FRAME_TICK] = tick;
      m.mem8[IN1_MIRROR] = 0;
      m.mem8[IN2_MIRROR] = 0;
      HISTORIES.forEach((h) => (m.mem8[h] = 0));
      m.mem8[PLAYER_ONE_LIVES] = p1;
      m.mem8[PLAYER_TWO_LIVES] = p2;
      m.mem8[FREE_PLAY] = free;
      m.mem8[CREDIT_COUNT] = credits;
      m.mem8[IN0_MIRROR] = start | 0x01;
      m.mem8[PLAY_ACTIVE] = 0;
      // Sprites left standing, so a tail that forgets to hide them is visible.
      for (let slot = 0; slot < SPRITE_SLOTS; slot++) m.mem8[PLAYER_SPRITE_Y + 2 * slot] = 0x55;
      yield m;
    }
}

/** The first entry (in order) a candidate diverges on, or null; stops early, for the teeth. */
function firstCatch(candidate, entries) {
  for (const m of entries) {
    const d = unitDiff(candidate, m);
    if (d) return d;
  }
  return null;
}

function caughtOver(candidate, entries) {
  let caught = 0;
  let first = null;
  for (const m of entries) {
    const d = unitDiff(candidate, m);
    if (d) {
      caught++;
      first ??= d;
    }
  }
  return { caught, first };
}

// ── the whole-machine arm ───────────────────────────────────────────────────────────────

const RET_TSTATES = 10;

function hosted(candidate) {
  const seated = withOmittedRet(candidate, TARGET);
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    seated(mm);
    mm.tick(total - RET_TSTATES);
  };
}

function wholeRun(candidate, tape, frames) {
  const base = session(null, tape);
  const baseFrames = base.runFrames(frames);
  let fired = 0;
  const sps = new Set();
  const host = session(new Map([[TARGET, (mm) => {
    fired++;
    sps.add(mm.regs.sp);
    return hosted(candidate)(mm);
  }]]), tape);
  const hostFrames = host.runFrames(frames);
  const lo = Math.min(...sps) - SCRATCH_BYTES;
  const hi = Math.max(...sps);
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = baseFrames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) {
      if (x[o] === y[o]) continue;
      const addr = base.stateOffsetToAddr(o);
      if (addr !== null && addr >= lo && addr < hi) continue;
      cells.add(addr);
    }
  }
  return { cells: [...cells], frames: n, fired, lengths: [baseFrames.length, hostFrames.length] };
}

// ── the teeth: source mutants of the rewrite ────────────────────────────────────────────

const SOURCE = readFileSync(new URL("../stepHighScoreInitialsEntry.js", import.meta.url), "utf8");
const IDIOMATIC = new URL("../", import.meta.url).href;
const CORE = new URL("../../../../core/", import.meta.url).href;

async function mutant(from, to) {
  assert.ok(SOURCE.includes(from), `mutant anchor not found in the rewrite: ${from}`);
  const src = SOURCE.replace(from, to)
    .replaceAll('from "./', `from "${IDIOMATIC}`)
    .replaceAll('from "../../../core/', `from "${CORE}`);
  const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  return mod.stepHighScoreInitialsEntry;
}

const MUTANTS = [
  ["fresh-press-any-bit", "(history & LAST_THREE_SAMPLES) === FRESH_PRESS", "(history & FRESH_PRESS) !== 0"],
  ["forward-wraps-late", "next > LAST_LETTER ? 0 : next", "next > LETTER_COUNT ? 0 : next"],
  ["back-wraps-to-first", "next < WRAPPED_BELOW ? next : LAST_LETTER", "next < WRAPPED_BELOW ? next : 0"],
  ["forward-never-rearmed", "rearmHeldControlRepeat(m, INITIALS_FORWARD_PRESS_HISTORY);", ";"],
  ["back-rearmed-at-ff", "=== BACK_SATURATED", "=== FORWARD_SATURATED"],
  ["other-commit-ignored", "isFreshPress(mem8[INITIALS_ALT_COMMIT_PRESS_HISTORY]) || ", ""],
  ["histories-swapped", "rollHistory(mem8, INITIALS_BACK_PRESS_HISTORY, controls & BACK_BIT);", "rollHistory(mem8, INITIALS_BACK_PRESS_HISTORY, controls & FORWARD_BIT);"],
  ["locked-colour-constant", "= mem8[INITIALS_LOCKED_LETTER_COLOUR];", "= CURSOR_COLOUR;"],
  ["copy-not-stepped", "mem16[SCRATCH_PTR_A] = copy + 1;", "mem16[SCRATCH_PTR_A] = copy;"],
  ["cursor-plane-not-snapped", "advanceCharCursor(m, cursor | GLYPH_PLANE_BIT)", "advanceCharCursor(m, cursor)"],
  ["last-slot-keeps-going", "if (commitLetter(m)) return true;", "commitLetter(m);"],
  ["flash-inverted", "phase & FLASH_BIT ? CURSOR_FLASH_COLOUR : CURSOR_COLOUR", "phase & FLASH_BIT ? CURSOR_COLOUR : CURSOR_FLASH_COLOUR"],
  ["clock-every-frame", "(mem8[FRAME_TICK] & EVERY_EIGHTH_FRAME) !== 0", "false"],
  ["finish-without-step", "  advanceSequenceSubStep(m);\n", ""],
  ["one-credit-two-players", "credits === 1 ? start !== ONE_PLAYER_START : start === 0", "start === 0"],
  ["lives-ignored", "if ((mem8[PLAYER_ONE_LIVES] | mem8[PLAYER_TWO_LIVES]) !== 0) return;", ""],
  ["free-play-ignored", "mem8[FREE_PLAY] !== 0", "false"],
  ["sprites-left-up", "  hideAllSprites(m);\n  if (start", "  if (start"],
  ["stray-push", "  if ((mem8[FRAME_TICK] & EVERY_OTHER_FRAME)", "  m.push16(0);\n  if ((mem8[FRAME_TICK] & EVERY_OTHER_FRAME)"],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("NATURAL: every real dispatch in both sessions replays identically", { skip }, () => {
  for (const [label] of SESSIONS) {
    const { entries } = corpus()[label];
    assert.equal(entries.length, DISPATCHES[label], `the ${label} session's dispatch count moved`);
    const { caught, first } = caughtOver(stepHighScoreInitialsEntry, entries);
    console.log(`  NATURAL/${label}: ${entries.length} dispatches, ${caught} diverge`);
    assert.equal(caught, 0, `${label}: ${show(first)}`);
  }
});

test("PATHS: the natural corpus reaches commit, letter step, rearm, finish and the flash", { skip }, () => {
  const { idle, letters } = corpus();
  console.log(`  PATHS: idle ${JSON.stringify(idle.paths)}; letters ${JSON.stringify(letters.paths)}`);
  assert.ok(idle.paths.finish > 0, "the idle session never ran the clock out");
  assert.ok(idle.paths.odd > 0, "no odd-frame (flash) dispatch");
  for (const k of ["commit", "letter", "rearm", "finish"]) {
    assert.ok(letters.paths[k] > 0, `the letters session never took the ${k} path`);
  }
});

test("NOT VACUOUS: a no-op FAILS the natural corpus on a real cell", { skip }, () => {
  const { caught, first } = caughtOver(() => {}, allNatural());
  console.log(`  NOT VACUOUS: no-op caught on ${caught}; ${show(first)}`);
  assert.ok(caught > 0, "the corpus passed a candidate that does nothing");
  assert.notEqual(first.addr, null, "the no-op must be caught on a memory cell");
});

test("CRAFTED SCAN: ticks, facings, controls, histories, letters, slots, clock, cursor plane", { skip }, () => {
  let n = 0;
  let caught = 0;
  let first = null;
  for (const m of scanEntries()) {
    n++;
    const d = unitDiff(stepHighScoreInitialsEntry, m);
    if (d) {
      caught++;
      first ??= d;
    }
  }
  console.log(`  CRAFTED SCAN: ${n} entries, ${caught} diverge`);
  assert.equal(caught, 0, show(first));
});

test("CRAFTED START: lives, free play, credits and start buttons reach every game-start tail", { skip }, () => {
  let n = 0;
  let caught = 0;
  let first = null;
  let started = 0;
  for (const m of startEntries()) {
    n++;
    const d = unitDiff(stepHighScoreInitialsEntry, m);
    if (d) {
      caught++;
      first ??= d;
    }
    const probe = m.clone();
    oracle(probe);
    if (probe.mem8[PLAY_ACTIVE] !== 0) started++;
  }
  console.log(`  CRAFTED START: ${n} entries, ${started} start a game, ${caught} diverge`);
  assert.ok(started > 0, "vacuous: no crafted entry starts a game");
  assert.equal(caught, 0, show(first));
});

/** Frames each TAPE_SESSIONS session runs for the DEAD AT EXIT arm. */
const DEAD_FRAMES = 2500;

test("DEAD AT EXIT: on the frozen game, c is dead where this entry hands back", { skip }, () => {
  assertDeadAtExit({ at: TARGET, poison: ["c"], sessions: TAPE_SESSIONS, frames: DEAD_FRAMES });
});

test("REGISTERS: only scratch registers differ, over natural and crafted entries", { skip }, () => {
  const moved = new Set();
  for (const m of allNatural()) movedRegisters(stepHighScoreInitialsEntry, m, moved);
  for (const m of scanEntries()) movedRegisters(stepHighScoreInitialsEntry, m, moved);
  for (const m of startEntries()) movedRegisters(stepHighScoreInitialsEntry, m, moved);
  const list = REG_FIELDS.filter((k) => moved.has(k));
  console.log(`  REGISTERS (measured): ${list.join(", ")}`);
  assert.deepEqual(list.filter((k) => !MOVED.includes(k)), [], "a register outside the scratch set diverged");
});

for (const [label, tape, frames] of SESSIONS) {
  test(`WHOLE-MACHINE/${label}: the wired rewrite changes nothing but dead stack`, { skip }, () => {
    const r = wholeRun(stepHighScoreInitialsEntry, tape, frames);
    console.log(`  WHOLE-MACHINE/${label}: ${r.frames} frames, ${r.fired} dispatches, ${r.cells.length} cells`);
    assert.equal(r.fired, DISPATCHES[label], "the wired session's dispatch count moved");
    assert.deepEqual(r.lengths, [frames, frames], "a session ran short");
    assert.deepEqual(r.cells.map((a) => (a === null ? "reg" : hex4(a))), [], "the run diverged");
  });
}

test("SP-TOOTH: the rewrite is seam-placeable; a stray push is not", { skip }, async () => {
  const entry = baseEntry();
  assert.equal(seamPlaceable(withOmittedRet, stepHighScoreInitialsEntry, TARGET, entry.clone()).placeable, true);
  const [, from, to] = MUTANTS.find(([l]) => l === "stray-push");
  const broken = await mutant(from, to);
  assert.equal(seamPlaceable(withOmittedRet, broken, TARGET, entry.clone()).placeable, false,
    "the seam placed a rewrite that left a word on the stack");
});

for (const [label, from, to] of MUTANTS) {
  test(`TEETH: the ${label} mutant is caught`, { skip }, async () => {
    const broken = await mutant(from, to);
    let arm = null;
    let d = null;
    for (const [name, entries] of [["natural", allNatural()], ["scan", scanEntries()], ["start", startEntries()]]) {
      d = firstCatch(broken, entries);
      if (d) {
        arm = name;
        break;
      }
    }
    console.log(`  TEETH/${label}: ${arm ? `caught by ${arm} -- ${show(d)}` : "NOT caught"}`);
    assert.notEqual(arm, null, `the ${label} mutant is invisible to every arm`);
  });
}
