// SPDX-License-Identifier: GPL-3.0-only
/**
 * pickScriptAtRandomOrInTurn — memory-equivalent to the frozen oracle at ROM 0x382D.
 *
 * WHAT IT IS. A draw from the shared generator, one comparison against a threshold cell, and two
 * entirely different answers behind it: at or above the threshold the drawn byte is folded into a
 * four-wide band and handed back with nothing written; below it the drawn byte is discarded and a
 * five-long cycle counter is stepped, stored and handed back instead. The generator is ALREADY
 * DECOMPILED, so the rewrite calls it directly and dissolving that transfer belongs here.
 *
 * ★ THE LIVE-OUT IS A REGISTER, AND IT IS DERIVED FROM THE ORACLE'S CALL SITES, NOT FROM THE
 *   MODULE. Both frozen callers store the accumulator into the same slot of an object record the
 *   moment this returns — one of them adds nine first — so the accumulator is what this routine
 *   is FOR, and a gate comparing memory alone would be green on a rewrite that computed the wrong
 *   answer on the band arm, which writes nothing. The BLIND arm demonstrates precisely that with
 *   two twins, and every comparison below therefore checks the accumulator as well as memory.
 *
 * ★ THE ALTERNATE REGISTER SET IS IN THE CEILING BECAUSE THE FROZEN GENERATOR SWAPS THROUGH IT
 *   and the rewrite's generator does not. That is measured here, not assumed: the sweep carries
 *   an arm with those six registers scrambled to a marker, which is what makes them show up in
 *   the EXCLUDED reading at all rather than sitting at values the generator would have left
 *   anyway. Nothing between either caller's call site and its next write to those registers reads
 *   them, so no caller is coupled to the difference.
 *
 * GATE: strict unit-capture with one measured exclusion, two replayed sessions, twenty-three
 *   crafted arms. What it exercises, holes stated:
 *
 *   1. CONTRACT   — unitEquivalence at the first real dispatch: RAM identical.
 *   2. WINDOW     — the oracle's own deepest push, measured over the whole sweep and PINNED.
 *   3. BOUNDARY   — the exclusion is exactly as wide as it declares: one byte BELOW is caught,
 *                   one AT the entry seat is caught, one INSIDE is masked.
 *   4. ARM REACH  — measured: both answers are reached by both sessions, so neither arm below
 *                   rests on crafting alone.
 *   5. CORPUS     — every dispatch of both sessions replays identically, counts pinned.
 *   6. BLIND      — RAM alone passes two twins that return the wrong answer, and the same
 *                   measurement catches them once the accumulator is included.
 *   7. CRAFTED    — every arm identical outside the measured window.
 *   8. EXCLUDED   — no register outside the declared CEILING moves, with a twin that keeps a
 *                   pointer as the in-arm control that the measurement can see one.
 *   9. CALLS, NOT DISPATCHES — the module's text: it must import and call the generator rather
 *                   than reach it through the registry, with the frozen oracle as the control.
 *  10. TEETH      — eleven broken twins, each with the number of crafted arms that catches it and
 *                   its catch count in each real session, zeros kept.
 *
 * HOLE: the threshold cell holds one value per session and the crafted arms move it, so what is
 * swept is the DECISION, not the distribution of draws the game really presents.
 * HOLE: the equality case is reached only by a crafted arm whose threshold is set to the byte the
 * generator is about to produce — read off a clone first. No session ever lands on it, and the
 * off-by-one twin that lives there is caught nowhere else.
 * HOLE: the generator itself is gated by its own file. What this file gates is the comparison,
 * the fold and the cycle.
 *
 * WHERE THE STACK POINTER IS OWNED. sp sits inside the excluded ceiling here, so a rewrite that
 * leaked stack without writing memory would pass. No gate now owns that: the whole-game gate
 * idiomatic.test.js compares memory only, outside the stack window, under an engine that leaves SP
 * unused. This gate says so rather than implying a coverage it does not have.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-382d.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { pickScriptAtRandomOrInTurn
} from "../pickScriptAtRandomOrInTurn.js";
import { drawRandomByte } from "../drawRandomByte.js";
import { loc_382d as oracle } from "../../translated/loc_382d.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x382d;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const THRESHOLD = 0xacc4;
const CYCLE_COUNTER = 0xa9cf;
const BAND_SIZE = 4;
const FIRST_IN_BAND = 5;
const CYCLE_LENGTH = 5;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 2;

/** What the callers consume. Derived from the oracle's two call sites, not from the module. */
const LIVE_OUT = ["a"];

/**
 * The ceiling on divergence, and the whole of it: the oracle takes a return the dissolved call
 * does not, walks a pointer the rewrite has no use for, and swaps the generator's work through
 * the alternate set. Not a set the rewrite is required to fill — a rewrite diverging on fewer
 * still passes, so this can never refuse a fix.
 */
const MOVED = ["f", "h", "l", "sp", "b_", "c_", "d_", "e_", "h_", "l_"];

const SESSION_FRAMES = 3000;
/** Dispatches each session produces, and how they split between the two answers. Measured. */
const DISPATCHES = {
  attract: { total: 52, band: 34, cycle: 18 },
  driven: { total: 24, band: 16, cycle: 8 },
};

const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const drivenMachine = (overrides) => makeMachine(overrides);
const SESSIONS = [["attract", attractMachine], ["driven", drivenMachine]];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => {
  if (!d) return "identical";
  return d.addr === null || d.addr === undefined
    ? `${d.reg}: oracle=${d.a} candidate=${d.b}`
    : `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}`;
};

/** The byte the generator is about to hand back, read off a clone so the machine is undisturbed. */
const peek = (m) => drawRandomByte(m.clone());

/** Which answer a machine's cells will produce, decided before either side runs. */
const armOf = (m) => (peek(m) >= m.mem8[THRESHOLD] ? "band" : "cycle");

// ── the entry, and the comparison ───────────────────────────────────────────────────────

let entry = null;

function capture(candidate) {
  return unitEquivalence(
    attractMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) capture(pickScriptAtRandomOrInTurn);
  return entry;
}

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The masked window, and nothing else: the bytes the oracle's own push reaches and no others. */
function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/** RAM outside the measured window, or null. The half of the comparison the live-out is blind to. */
function ramDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

/**
 * Oracle vs candidate on clones of `machine`: RAM outside the window, then the declared live-out,
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
  for (const k of LIVE_OUT) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k) || LIVE_OUT.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

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

// ── the crafted arms ────────────────────────────────────────────────────────────────────
// A real captured machine with the threshold and the counter nudged. The two draw-relative arms
// need the byte the generator is about to produce, which is why they are built from `peek`.

const THRESHOLDS = [["threshold-zero", 0], ["threshold-one", 1], ["threshold-mid", 128],
  ["threshold-max", 255]];
const COUNTERS = [0, 3, 4, 5, 255];
const SHADOW_REGISTERS = ["b_", "c_", "d_", "e_", "h_", "l_"];
const MARKER = 0x5a;

function tuned(threshold, counter) {
  const mm = entryState().clone();
  mm.mem8[THRESHOLD] = threshold;
  mm.mem8[CYCLE_COUNTER] = counter;
  return mm;
}

function craftedArms() {
  const arms = [];
  for (const [label, threshold] of THRESHOLDS) {
    for (const counter of COUNTERS) arms.push([`${label}/counter-${counter}`, tuned(threshold, counter)]);
  }
  const draw = peek(entryState());
  arms.push(["threshold-equals-the-draw", tuned(draw, 0)]);
  arms.push(["threshold-one-above-the-draw", tuned(u8(draw + 1), 0)]);
  const scrambled = entryState().clone();
  for (const k of SHADOW_REGISTERS) scrambled.regs[k] = MARKER;
  arms.push(["shadow-scrambled", scrambled]);
  return arms;
}

const ARM_COUNT = THRESHOLDS.length * COUNTERS.length + 3;

/** Every machine this file compares on. What the WINDOW arm measures the oracle over. */
const sweep = () => [entryState(), ...craftedArms().map(([, mm]) => mm)];

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let total = 0;
  let caught = 0;
  let band = 0;
  let cycle = 0;
  const m = factory(
    new Map([[TARGET, (mm) => {
      total++;
      if (armOf(mm) === "band") band++;
      else cycle++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(SESSION_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, SESSION_FRAMES, "session ran short");
  return { total, caught, band, cycle };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, f]) => ({ label, ...replaySession(f, pickScriptAtRandomOrInTurn) }));
  return sessionCache;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────
// Each is the module with one decision wrong, reaching the generator the way the module reaches
// it. A twin going through the registry would match the oracle's stack traffic exactly and so
// would never be masked, which would let the teeth pass without exercising the exclusion.

const cycled = (m, wrapAt) => {
  const stepped = u8(m.mem8[CYCLE_COUNTER] + 1);
  m.regs.a = stepped < wrapAt ? stepped : 0;
  m.mem8[CYCLE_COUNTER] = m.regs.a;
  return m.regs.a;
};
const banded = (m, drawn, size, base) => {
  m.regs.a = (drawn % size) + base;
  return m.regs.a;
};

/** BUG: does nothing — the twin that proves the comparison sees a real dispatch. */
function brokenNoOp() {}

/** BUG: folds whatever the accumulator already held instead of drawing. */
function brokenSkipsTheDraw(m) {
  const drawn = m.regs.a;
  return drawn >= m.mem8[THRESHOLD]
    ? banded(m, drawn, BAND_SIZE, FIRST_IN_BAND)
    : cycled(m, CYCLE_LENGTH);
}

/** BUG: draws twice, so the generator advances one place too far. */
function brokenDrawsTwice(m) {
  drawRandomByte(m);
  const drawn = drawRandomByte(m);
  return drawn >= m.mem8[THRESHOLD]
    ? banded(m, drawn, BAND_SIZE, FIRST_IN_BAND)
    : cycled(m, CYCLE_LENGTH);
}

/** BUG: the two answers change places. */
function brokenInvertedThreshold(m) {
  const drawn = drawRandomByte(m);
  return drawn < m.mem8[THRESHOLD]
    ? banded(m, drawn, BAND_SIZE, FIRST_IN_BAND)
    : cycled(m, CYCLE_LENGTH);
}

/** BUG: off by one at the boundary — a draw EQUAL to the threshold takes the wrong answer. */
function brokenStrictlyAbove(m) {
  const drawn = drawRandomByte(m);
  return drawn > m.mem8[THRESHOLD]
    ? banded(m, drawn, BAND_SIZE, FIRST_IN_BAND)
    : cycled(m, CYCLE_LENGTH);
}

/** BUG: the band is twice as wide. */
function brokenWideBand(m) {
  const drawn = drawRandomByte(m);
  return drawn >= m.mem8[THRESHOLD]
    ? banded(m, drawn, BAND_SIZE * 2, FIRST_IN_BAND)
    : cycled(m, CYCLE_LENGTH);
}

/** BUG: the band starts one lower. */
function brokenWrongBase(m) {
  const drawn = drawRandomByte(m);
  return drawn >= m.mem8[THRESHOLD]
    ? banded(m, drawn, BAND_SIZE, FIRST_IN_BAND - 1)
    : cycled(m, CYCLE_LENGTH);
}

/** BUG: the cycle is one short. */
function brokenCycleFour(m) {
  const drawn = drawRandomByte(m);
  return drawn >= m.mem8[THRESHOLD]
    ? banded(m, drawn, BAND_SIZE, FIRST_IN_BAND)
    : cycled(m, CYCLE_LENGTH - 1);
}

/** BUG: the cycle is one long. */
function brokenCycleSix(m) {
  const drawn = drawRandomByte(m);
  return drawn >= m.mem8[THRESHOLD]
    ? banded(m, drawn, BAND_SIZE, FIRST_IN_BAND)
    : cycled(m, CYCLE_LENGTH + 1);
}

/** BUG: stores the answer over the counter on the band arm too, which writes nothing. */
function brokenAlsoWritesCounter(m) {
  const drawn = drawRandomByte(m);
  if (drawn >= m.mem8[THRESHOLD]) {
    banded(m, drawn, BAND_SIZE, FIRST_IN_BAND);
    m.mem8[CYCLE_COUNTER] = m.regs.a;
    return m.regs.a;
  }
  return cycled(m, CYCLE_LENGTH);
}

/** BUG: hands back the counter without stepping it. */
function brokenUnstepped(m) {
  const drawn = drawRandomByte(m);
  if (drawn >= m.mem8[THRESHOLD]) return banded(m, drawn, BAND_SIZE, FIRST_IN_BAND);
  m.regs.a = m.mem8[CYCLE_COUNTER];
  m.mem8[CYCLE_COUNTER] = m.regs.a;
  return m.regs.a;
}

const TWINS = [
  ["no-op", brokenNoOp, 23, { attract: 52, driven: 24 }],
  ["skips-the-draw", brokenSkipsTheDraw, 23, { attract: 52, driven: 24 }],
  ["draws-twice", brokenDrawsTwice, 23, { attract: 52, driven: 24 }],
  ["inverted-threshold", brokenInvertedThreshold, 23, { attract: 52, driven: 24 }],
  ["strictly-above", brokenStrictlyAbove, 1, { attract: 0, driven: 0 }],
  ["wide-band", brokenWideBand, 12, { attract: 20, driven: 7 }],
  ["wrong-base", brokenWrongBase, 12, { attract: 34, driven: 16 }],
  ["cycle-of-four", brokenCycleFour, 2, { attract: 3, driven: 1 }],
  ["cycle-of-six", brokenCycleSix, 2, { attract: 3, driven: 1 }],
  ["also-writes-the-counter", brokenAlsoWritesCounter, 12, { attract: 34, driven: 16 }],
  ["unstepped-counter", brokenUnstepped, 11, { attract: 18, driven: 8 }],
];

/**
 * NOT A TOOTH — the EXCLUDED arm's positive control. It produces the right answer and writes the
 * right bytes; what it does is keep the threshold's address in a pointer pair outside the
 * declared ceiling, which is the one thing the register measurement must be able to report or its
 * clean readings prove nothing.
 */
function keepsThePointer(m) {
  m.regs.de = THRESHOLD;
  const drawn = drawRandomByte(m);
  return drawn >= m.mem8[THRESHOLD]
    ? banded(m, drawn, BAND_SIZE, FIRST_IN_BAND)
    : cycled(m, CYCLE_LENGTH);
}

/**
 * The BOUNDARY arm's probe: the ORACLE ITSELF plus one byte flipped at `sp + offset`. Built on the
 * oracle so what the arm reports is a property of the MASK alone — a broken rewrite must fail the
 * arms that judge the rewrite, not be re-reported here as a mis-placed window.
 */
function scribbler(offset) {
  return (m) => {
    const at = (m.regs.sp + offset) & 0xffff;
    oracle(m);
    m.mem8[at] ^= 0xff;
  };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: at the first real dispatch, identical outside the window", { skip }, () => {
  capture(pickScriptAtRandomOrInTurn);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  pickScriptAtRandomOrInTurn(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  CONTRACT: entered within ${ENTRY_FRAMES} frames on the ${armOf(e)} arm, threshold ` +
      `${e.mem8[THRESHOLD]}, counter ${e.mem8[CYCLE_COUNTER]}, seat ${hex4(sp)}; ${all.length} ` +
      `differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.ok(all.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
  assert.equal(a.regs.a, b.regs.a, "the answer the callers store differs at the real dispatch");
});

test("WINDOW: the oracle's own deepest push, measured over the whole sweep", { skip }, () => {
  let deepest = 0;
  for (const m of sweep()) deepest = Math.max(deepest, oracleDepth(m));
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
});

test("BOUNDARY: the exclusion is exactly as wide as it declares", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const below = unitDiff(scribbler(-SCRATCH_BYTES - 1), e);
  const seat = unitDiff(scribbler(0), e);
  const inside = unitDiff(scribbler(-1), e);
  console.log(
    `  BOUNDARY: ${hex4(sp - SCRATCH_BYTES - 1)} caught, ${hex4(sp)} caught, ${hex4(sp - 1)} masked`,
  );
  assert.notEqual(below, null, "a divergence one byte BELOW the window was swallowed, so the " +
    "exclusion is wider than it declares and a leaking stack pointer would walk out of sight");
  assert.notEqual(seat, null, "a divergence AT the entry seat was swallowed: the window must lie " +
    "strictly below the seat, and live stack above it must still fail");
  assert.equal(inside, null, "a divergence INSIDE the window was caught, so the two catches above " +
    "are the instrument catching everything rather than the boundary being where it says");
});

test("ARM REACH: both answers are reached by both sessions", { skip }, () => {
  for (const s of sessions()) {
    console.log(`  ARM REACH (measured) ${s.label}: band ${s.band}, cycle ${s.cycle}`);
    assert.equal(s.band, DISPATCHES[s.label].band, `${s.label}: the band-arm count moved`);
    assert.equal(s.cycle, DISPATCHES[s.label].cycle, `${s.label}: the cycle-arm count moved`);
    assert.ok(s.band > 0 && s.cycle > 0, `${s.label} no longer reaches both answers, so the twins ` +
      "that live on one of them have stopped being exercised by real play");
  }
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    assert.equal(s.total, DISPATCHES[s.label].total, `${s.label}: the dispatch count moved`);
    total += s.total;
  }
  assert.ok(total > 0, "vacuous: no session reached the routine at all");
  console.log(`  CORPUS: ${total} real dispatches, identical on RAM and on the answer`);
});

test("BLIND: RAM alone passes a wrong answer; the live-out is what catches it", { skip }, () => {
  const bandArm = craftedArms().find(([label]) => label === "threshold-zero/counter-0")[1];
  assert.equal(armOf(bandArm), "band", "the arm chosen for this demonstration no longer takes the " +
    "answer that writes nothing, so it cannot show what RAM is blind to");
  for (const [label, twin] of [["wide-band", brokenWideBand], ["wrong-base", brokenWrongBase]]) {
    assert.equal(ramDiff(twin, bandArm), null, `RAM caught the ${label} twin, so this arm writes ` +
      "memory after all and the live-out is no longer the thing carrying the band comparison");
    assert.notEqual(unitDiff(twin, bandArm), null, `the ${label} twin survives even WITH the ` +
      "live-out, so it is not a tooth at all");
  }
  assert.equal(ramDiff(pickScriptAtRandomOrInTurn, bandArm), null, "the rewrite itself diverges in RAM here");
  console.log("  BLIND: two wrong-answer twins are RAM-identical and caught by the accumulator");
});

test("CRAFTED: every arm identical outside the measured window", { skip }, () => {
  const arms = craftedArms();
  assert.equal(arms.length, ARM_COUNT, "the crafted arm set changed size");
  for (const [label, mm] of arms) {
    const d = unitDiff(pickScriptAtRandomOrInTurn, mm);
    assert.equal(d, null, `${label}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${arms.length} arms identical`);
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
  const moved = movedOver(pickScriptAtRandomOrInTurn);
  const control = movedOver(keepsThePointer);
  const controlStrays = REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)
    && !LIVE_OUT.includes(k));
  assert.ok(controlStrays.length > 0, "the measurement reports nothing outside the ceiling even " +
    "for a twin that keeps a pointer in one, so a clean reading below proves nothing");
  assert.ok(SHADOW_REGISTERS.some((k) => moved.has(k)), "the alternate set no longer moves at all, " +
    "so the scrambled arm has stopped exercising it and those ceiling entries are unjustified");
  console.log(
    `  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ceiling ` +
      `${MOVED.join(", ")}; the control also moves ${controlStrays.join(", ")}`,
  );
  // MOVED is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(
    REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k) && !LIVE_OUT.includes(k)),
    [],
    "a register outside the declared ceiling diverged",
  );
});

function callsRatherThanDispatches(text) {
  return text.includes('from "./drawRandomByte.js"') && text.includes("drawRandomByte(m)")
    && !text.includes("m.call(");
}

test("CALLS, NOT DISPATCHES: the module's text, with the oracle as the control", () => {
  const module = readFileSync(new URL("../pickScriptAtRandomOrInTurn.js", import.meta.url), "utf8");
  const frozen = readFileSync(new URL("../../translated/loc_382d.js", import.meta.url), "utf8");
  assert.ok(callsRatherThanDispatches(module), "the module does not import and call the generator");
  assert.ok(!callsRatherThanDispatches(frozen), "the check passes the frozen oracle, which reaches " +
    "the generator through the registry, so it cannot tell a call from a dispatch");
  console.log("  CALLS, NOT DISPATCHES: the generator is imported and called; the oracle's text fails");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, caughtOnArms, perSession] of TWINS) {
  test(`TEETH: the ${label} twin is caught on the declared number of arms`, { skip }, () => {
    const arms = craftedArms();
    const caught = arms.filter(([, mm]) => unitDiff(twin, mm) !== null).map(([l]) => l);
    const first = arms.map(([l, mm]) => [l, unitDiff(twin, mm)]).find(([, d]) => d);
    console.log(`  TEETH/${label}: caught on ${caught.length} of ${arms.length} arms; first at ` +
      `${first ? `${first[0]} — ${show(first[1])}` : "nowhere"}`);
    assert.ok(caught.length > 0, `${label}: no arm catches this twin, so it is not a tooth`);
    assert.equal(caught.length, caughtOnArms, `${label}: the number of arms catching it moved`);
  });

  test(`TEETH: the ${label} twin's catch count in each real session`, { skip }, () => {
    const counts = Object.fromEntries(
      SESSIONS.map(([l, f]) => [l, replaySession(f, twin).caught]),
    );
    console.log(`  TEETH/${label}: real sessions catch ${JSON.stringify(counts)}`);
    assert.deepEqual(counts, perSession, `the ${label} twin's real-session catch counts moved`);
  });
}
