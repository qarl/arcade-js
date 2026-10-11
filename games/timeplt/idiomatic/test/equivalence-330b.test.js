// SPDX-License-Identifier: GPL-3.0-only
/**
 * fileScoreAfterGameOverHoldElsePassTurn — memory-equivalent to the frozen oracle at ROM 0x330B.
 * GATE: capture-clone-replay on two real tapes plus crafted branch entries.
 *   - tapes/game-over.poke.json reaches this arm (sub-step 8) for the whole game-over hold and its
 *     expiry, where the score beats no standing record (the unfiled branch).
 *   - tapes/high-score.poke.json reaches the same hold and expires with a qualifying score (the
 *     filed branch, which runs the image fold).
 *   Crafted from those: a wrapping tick, a hand-over to a second player with lives left, a filed
 *   expiry with the play flag raised and the pen away from its route start, and a filed expiry on a
 *   TAMPERED image (one byte of the folded run changed in a private copy of the program ROM).
 * Compared: RAM outside the dead stack scratch the oracle's nested calls write, pc, and SP. The
 *   candidate runs through machine.js's withOmittedRet seam (the ret it omits is completed there).
 * Live-out registers, derived from the oracle's continuation: none. Every exit is a ret (direct or
 *   through a tail callee) onto the dispatcher's parked slot, whose first instructions reload A from
 *   memory and set the flags from it; no path there reads BC/DE/HL/IX/IY before overwriting them.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-330b.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { fileScoreAfterGameOverHoldElsePassTurn as candidate } from "../fileScoreAfterGameOverHoldElsePassTurn.js";
import { loc_330b as oracle } from "../../translated/loc_330b.js";
import { fileScoreIntoHighScoreTable } from "../fileScoreIntoHighScoreTable.js";
import { postCommand } from "../postCommand.js";
import { passTurnToOtherPlayerIfLivesElseStepSequence } from "../passTurnToOtherPlayerIfLivesElseStepSequence.js";
import { requestHighScoreFiledSound } from "../requestHighScoreFiledSound.js";
import { armThePenRouteThenColdStartOnATamperedImage } from "../armThePenRouteThenColdStartOnATamperedImage.js";
import { advanceSequencePhase } from "../advanceSequencePhase.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import {
  SEQUENCE_DELAY, SEQUENCE_SUBSTEP, PEN_COLOUR, PEN_GLYPH, PEN_ROUTE_LEG, PLAY_ACTIVE,
  ACTIVE_PLAYER, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES, COMMAND_WRITE_CURSOR,
} from "../names.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x330b;
const SEED = 0x0843;
const BLOCK = 0x01f1;
const GENUINE_TOTAL = 0x19;
const TAMPER_AT = 0x0250; // inside the folded run
const DATA_TOP = 0xadff;
const FRAMES = 1250;
const IN0 = 0xc300;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

const TAPES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tapes");

/** A poke tape as the machine consumes it; JS frames run one later than the lua frames. */
function loadTape(file) {
  const t = JSON.parse(readFileSync(join(TAPES, file), "utf8"));
  const num = (v) => (typeof v === "string" ? parseInt(v, 16) : v);
  // A tape names its coin and start frames either as top-level fields or as entries of its `inputs`
  // list; only those two presses are replayed here (later entry-screen presses are not this arm's).
  const at = (key, press) => t[key] ?? t.inputs.find((i) => i.press === press).frame;
  const inputs = [
    { frame: at("coin", "coin") + 1, port: IN0, bits: 0x01, dur: t.hold },
    { frame: at("start", "start1p") + 1, port: IN0, bits: 0x08, dur: t.hold },
  ];
  const pokes = t.pokes.map((p) => ({ frame: p.frame + 1, addr: num(p.addr), val: num(p.val), dur: p.dur }));
  return { inputs, pokes };
}

const captured = new Map();
function capture(file) {
  if (captured.has(file)) return captured.get(file);
  const { inputs, pokes } = loadTape(file);
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => { entries.push(mm.clone()); return oracle(mm); }]]), { tape: inputs });
  m.pokes = pokes;
  m.runFrames(FRAMES);
  assert.equal(m.stoppedBy, null, `${file}: the run stopped early: ${m.stoppedBy}`);
  captured.set(file, entries);
  return entries;
}

const expiring = (entries) => entries.find((e) => e.mem8[SEQUENCE_DELAY] === 1);
const ticking = (entries) => entries.find((e) => e.mem8[SEQUENCE_DELAY] > 1);

/**
 * Oracle direct vs a candidate through the seam, on independent clones. The oracle nests calls and
 * leaves dead words below its seat; the diff excludes [low, seat) with low measured from the
 * oracle's own pushes. Both sides throwing is agreement; one side alone escapes.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  let threwO = false, threwC = false;
  try { oracle(a); } catch { threwO = true; }
  try { withOmittedRet(cand, TARGET)(b); } catch { threwC = true; }
  if (threwO || threwC) return { escaped: threwO !== threwC ? "throw" : null, low, seat };
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  if (escaped === null && a.pc !== b.pc) escaped = { addr: "pc", oracle: a.pc, candidate: b.pc };
  if (escaped === null && a.regs.sp !== b.regs.sp) escaped = { addr: "sp", oracle: a.regs.sp, candidate: b.regs.sp };
  return { escaped, low, seat };
}

const craft = (base, mutate) => { const m = base.clone(); mutate(m); return m; };

/** A clone whose private ROM copy has one byte of the folded run changed. */
function tampered(base) {
  const saved = base.rom;
  const rom = Buffer.from(saved);
  rom[TAMPER_AT] = u8(rom[TAMPER_AT] + 1);
  base.rom = rom;
  try { return base.clone(); } finally { base.rom = saved; }
}

let cachedScenarios = null;
function scenarios() {
  if (cachedScenarios) return cachedScenarios;
  const over = capture("game-over.poke.json");
  const high = capture("high-score.poke.json");
  const dropped = expiring(over);
  const filed = expiring(high);
  assert.ok(ticking(over), "the game-over hold no longer ticks this arm");
  assert.ok(dropped, "the game-over hold no longer expires in this arm");
  assert.ok(filed, "the high-score hold no longer expires in this arm");
  const filedPlaying = craft(filed, (m) => { m.mem8[PLAY_ACTIVE] = 0xff; m.mem8[PEN_ROUTE_LEG] = 7; });
  cachedScenarios = [
    ["tick", ticking(over).clone()],
    ["tickWrap", craft(ticking(over), (m) => { m.mem8[SEQUENCE_DELAY] = 0; })],
    ["dropped", dropped.clone()],
    ["droppedHandover", craft(dropped, (m) => {
      m.mem8[m.mem8[ACTIVE_PLAYER] === 0 ? PLAYER_TWO_LIVES : PLAYER_ONE_LIVES] = 2;
    })],
    ["filed", filed.clone()],
    ["filedPlaying", filedPlaying],
    ["filedTampered", tampered(filedPlaying)],
  ];
  return cachedScenarios;
}
const scenario = (label) => scenarios().find(([l]) => l === label)[1];

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every default matches fileScoreAfterGameOverHoldElsePassTurn. */
function twin({ tick = true, command = 3, args = [0x09, 0x0b], seed = SEED, passTurn = true,
               invert = false, sound = true, colour = 0, glyph = 0xf1, arm = true,
               genuine = GENUINE_TOTAL, phase = true, step = true } = {}) {
  return (m) => {
    const { mem8 } = m;
    if (tick) mem8[SEQUENCE_DELAY] = mem8[SEQUENCE_DELAY] - 1;
    if (mem8[SEQUENCE_DELAY] !== 0) return;
    const dropped = fileScoreIntoHighScoreTable(m) !== invert;
    if (dropped) {
      for (const a of args) postCommand(m, command, a);
      mem8[SEQUENCE_SUBSTEP] = mem8[seed];
      if (passTurn) passTurnToOtherPlayerIfLivesElseStepSequence(m);
      return;
    }
    if (sound) requestHighScoreFiledSound(m);
    mem8[PEN_COLOUR] = colour;
    mem8[PEN_GLYPH] = glyph;
    if (arm) armThePenRouteThenColdStartOnATamperedImage(m);
    let total = 0;
    for (let i = 0; i < 0x100; i++) total = u8(total + mem8[u16(BLOCK + i)]);
    if (total !== genuine && phase) advanceSequencePhase(m);
    if (step) advanceSequenceSubStep(m);
  };
}

const ALL = ["tick", "tickWrap", "dropped", "droppedHandover", "filed", "filedPlaying", "filedTampered"];
const EXPIRING = ALL.slice(2);
const FILED = ["filed", "filedPlaying", "filedTampered"];

const TWINS = [
  ["no-op", () => {}, ALL],
  ["no-tick", twin({ tick: false }), ALL],
  ["inverted-verdict", twin({ invert: true }), EXPIRING],
  ["wrong-command", twin({ command: 4 }), ["dropped", "droppedHandover"]],
  ["wrong-second-argument", twin({ args: [0x09, 0x0a] }), ["dropped", "droppedHandover"]],
  ["one-command-only", twin({ args: [0x09] }), ["dropped", "droppedHandover"]],
  // ★ the hand-over reseats the sub-step itself, so the seed is visible only when the turn does not pass.
  ["wrong-seed", twin({ seed: SEED + 1 }), ["dropped"]],
  ["skip-pass-turn", twin({ passTurn: false }), ["dropped", "droppedHandover"]],
  // ★ the sound is requested only while the play flag is raised; the captured expiry's flag is
  // whatever the tape left, so it MAY also catch there.
  ["skip-sound", twin({ sound: false }), ["filedPlaying", "filedTampered"], ["filed"]],
  ["wrong-pen-colour", twin({ colour: 1 }), FILED],
  ["wrong-glyph", twin({ glyph: 0xf0 }), FILED],
  // ★ the pen is poked away from its route start on the crafted pair; the captured one may already sit there.
  ["skip-arm", twin({ arm: false }), ["filedPlaying", "filedTampered"], ["filed"]],
  // ★ a wrong genuine total derails the genuine image and agrees on the tampered one.
  ["wrong-genuine-total", twin({ genuine: 0x18 }), ["filed", "filedPlaying"]],
  ["skip-phase-advance", twin({ phase: false }), ["filedTampered"]],
  ["skip-final-step", twin({ step: false }), FILED],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

for (const file of ["game-over.poke.json", "high-score.poke.json"]) {
  test(`CAPTURED: every real dispatch on ${file} replays identically`, { skip }, () => {
    const entries = capture(file);
    assert.ok(entries.length > 1, `vacuous: ${file} no longer dispatches this arm`);
    for (const e of entries) {
      const r = compare(candidate, e);
      assert.equal(r.escaped, null, r.escaped && `a dispatch escaped at ${typeof r.escaped === "string" ? r.escaped : r.escaped.addr}`);
      // ★ The mask is safe only if its floor sits above every data cell the routine writes.
      assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached into game data`);
    }
    console.log(`  CAPTURED/${file}: ${entries.length} dispatches identical`);
  });
}

test("PATHS: every crafted branch is equivalent, and the branches really differ", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped: ${JSON.stringify(r.escaped)}`);
  }
  // ★ Vacuity guards: the two captured expiries take opposite verdicts, the unfiled one queues
  // commands, the tampered image really derails, and the hand-over really hands over.
  const verdict = (label) => fileScoreIntoHighScoreTable(scenario(label).clone());
  assert.equal(verdict("dropped"), true, "the game-over expiry no longer beats nothing");
  assert.equal(verdict("filed"), false, "the high-score expiry no longer files its score");
  const after = (label) => { const a = scenario(label).clone(); oracle(a); return a; };
  assert.notEqual(after("dropped").mem8[COMMAND_WRITE_CURSOR], scenario("dropped").mem8[COMMAND_WRITE_CURSOR],
    "the unfiled expiry queued nothing, so the command twins prove nothing");
  assert.notEqual(after("filedTampered").mem8[SEQUENCE_SUBSTEP], after("filedPlaying").mem8[SEQUENCE_SUBSTEP],
    "the tampered image does not derail, so the fold is untested");
  assert.notEqual(after("droppedHandover").mem8[ACTIVE_PLAYER], scenario("droppedHandover").mem8[ACTIVE_PLAYER],
    "the hand-over scenario did not hand over");
});

test("SP-TOOTH: the rewrite is placeable by the seam on every path, and a stray push is not", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = seamPlaceable(withOmittedRet, candidate, TARGET, m.clone());
    assert.equal(r.placeable, true, `${label}: ${r.error}`);
  }
  // null-mutant: a word left on the stack must be refused
  const stray = (m) => { candidate(m); m.push16(0); };
  for (const [label, m] of scenarios()) {
    assert.equal(seamPlaceable(withOmittedRet, stray, TARGET, m.clone()).placeable, false, `${label}: the stray push was placed`);
  }
});

for (const [label, brokenTwin, expected, may = []] of TWINS) {
  test(`TEETH: the ${label} twin is caught on exactly its scenarios`, { skip }, () => {
    const caught = scenarios().filter(([, m]) => compare(brokenTwin, m).escaped).map(([l]) => l);
    assert.ok(expected.length > 0);
    for (const l of expected) assert.ok(caught.includes(l), `the ${label} twin escaped on ${l}`);
    for (const l of caught) assert.ok(expected.includes(l) || may.includes(l), `the ${label} twin is caught on ${l}, outside its expected set`);
    console.log(`  TEETH/${label}: caught on ${caught.join(", ")}`);
  });
}
