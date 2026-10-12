// SPDX-License-Identifier: GPL-3.0-only
/**
 * requestDestructionSoundBurst — memory-equivalent to the frozen oracle at ROM 0x56D2.
 *
 * WHAT IT IS. Three sound codes, each fetched from a byte of the program image and offered to the
 * IN-PLAY-ONLY permission test at ROM 0x560C, and then a fall-through into ROM 0x56E4, which asks
 * for two more under a LOOSER test. ALL OF THOSE ARE ALREADY DECOMPILED, so the rewrite calls
 * enqueueSoundIfGameInProgress three times and requestDestructionOrRoundEndSoundPair once, and dissolving all four transfers belongs to this
 * caller's unit. The fall-through is a plain call here, which is the same thing under
 * memory-equivalence.
 *
 * ★ THE TWO PERMISSION TESTS ARE DIFFERENT, AND THAT IS WHAT THIS GATE IS FOR. The three ask only
 *   whether a game is in progress; the trailing pair also accepts the cabinet's attract-sound
 *   setting. So there is a state — play inactive, attract sounds on — where the three are dropped
 *   and the pair is heard, and it is the only thing that can tell the two apart. NO REAL DISPATCH
 *   IN ANY SESSION ARRIVES IN IT: every one has both cells set. The SPLIT arm crafts it, asserts
 *   what lands, and carries a control twin that uses the loose test throughout.
 *
 * ★ LIVE-OUT, DERIVED FROM THE ORACLE, NOT FROM THE MODULE. Two sites reach this entry. ROM
 *   0x2010 calls it and returns to 0x202A, which begins `ld a,(0xABFE)`; ROM 0x43F0 calls it and
 *   returns to 0x4567, which loads HL, DE, B and C before reading any of them. No successor reads
 *   a register this entry leaves and neither tests the flags, SO THE DECLARED LIVE-OUT IS MEMORY
 *   ONLY. The rewrite nevertheless agrees on every register except the accumulator, the flags and
 *   the stack pointer, and the gate holds that as a CEILING — outside it fails, a rewrite that
 *   diverged on fewer still passes. It never requires a divergence.
 *
 * ★ THE ORACLE'S TAIL TAKES A RETURN. The frozen form runs on into ROM 0x56E4 and out through
 *   0x5617's own `ret`, so it performs exactly one net return and leaves the stack pointer two
 *   above its seat; the rewrite models no stack. That is why SP is in the ceiling, and the host
 *   shim supplies the one return on the rewrite's behalf.
 *
 * GATE: strict unit-capture with one measured exclusion, every replayed session at every
 *   dispatch, a crafted cross over both permission cells and the queue length, and a whole-run
 *   masked diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside the measured window. Its control is the
 *      arm below, on the same entry.
 *   2. NOT VACUOUS — a no-op FAILS that same masked diff, on a real cell.
 *   3. WINDOW — the oracle's deepest push over the whole cross, measured, not inferred from the
 *      diff; a diff-derived window cannot see a pushed byte that already held its own value.
 *   4. EXCLUDED — the registers that move over the cross, bounded by the ceiling, with an in-arm
 *      control twin that moves one outside it so the clean reading means something.
 *   5. UNIFORM CORPUS — measured dispatch counts and the permission state every dispatch
 *      arrives in, which is what shows the SPLIT arm is crafted-only.
 *   6. CORPUS — every dispatch of every session.
 *   7. CRAFTED CROSS — both permission cells against a range of queue lengths, including the
 *      lengths at which the count byte wraps.
 *   8. SPLIT — with play inactive and attract sounds on, the three are dropped and the pair
 *      lands; the codes that land are read out of the queue and checked, and a twin using the
 *      loose test throughout is shown to land all five there.
 *   9. THE DROPPED CASE — with both cells clear nothing at all is written, and the twin that
 *      skips the tests is shown to write there, so the silence is a finding rather than a hole.
 *  10. CALLS, NOT RESTATES — the module's text, with each callee's own body as a control.
 *  11. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame, every
 *      differing cell asserted to be a stack address and the exact set pinned.
 *  12. TEETH — a bank of twins, each with an exact catch count over the cross and per session,
 *      and its whole-run verdict recorded rather than assumed. FOUR are recorded blind to the
 *      whole run, and three of those are ALSO invisible on every real dispatch: both twins that
 *      swap the two permission tests, and the one that skips them, only show in a state real
 *      play never presented, so the crafted cross is the ONLY thing holding them.
 *
 * HOLE: the five codes are constants of the image, so no arm here varies them; the twins send the
 * WRONG constants instead and the cross measures that it is seen.
 * HOLE: nothing reaches this entry in the undriven session at all, so everything real here comes
 * from the two driven tapes.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-56d2.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { requestDestructionSoundBurst } from "../requestDestructionSoundBurst.js";
import { enqueueSoundIfGameInProgress } from "../enqueueSoundIfGameInProgress.js";
import { enqueueSoundIfGameOrDemoSoundsOn } from "../enqueueSoundIfGameOrDemoSoundsOn.js";
import { appendSoundCommandToQueue } from "../appendSoundCommandToQueue.js";
import { requestDestructionOrRoundEndSoundPair } from "../requestDestructionOrRoundEndSoundPair.js";
import { PLAY_ACTIVE } from "../names.js";
import { loc_56d2 as oracle } from "../../translated/loc_56d2.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x56d2;

/** The three codes this entry chooses, and the pair the tail asks for. */
const FIRST_CODE_CELL = 0x0c5b;
const SECOND_CODE_CELL = 0x0855;
const THIRD_CODE_CELL = 0x1675;
const TAIL_FIRST_CODE_CELL = 0x27cb;
const TAIL_SECOND_CODE_CELL = 0x33a0;
const WRONG_CODE_CELL = 0x0c5c;

/** The cabinet's attract-sound setting: the second cell the LOOSER test accepts. */
const DEMO_SOUNDS = 0xa9c6;
/** The queue this entry appends to: a count byte, then that many codes. */
const QUEUE_LENGTH = 0xac43;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 8;

/** The ceiling on divergence. Not a set the rewrite is required to fill. */
const MOVED = ["a", "f", "sp"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 1400;
const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The module's text against the callees it is supposed to CALL. Each is identified by a constant
 * out of its own body; the module must name the callee's file, call it, and NOT carry that
 * constant. The same predicate runs over each callee as a positive control, so an absence is
 * evidence only once the check is shown able to see the thing present.
 */
const HELPERS = [
  ["enqueueSoundIfGameInProgress", "../enqueueSoundIfGameInProgress.js", "PLAY_ACTIVE"],
  ["requestDestructionOrRoundEndSoundPair", "../requestDestructionOrRoundEndSoundPair.js", "0x27cb"],
];

function callsRatherThanRestates(text, [name, file, ownConstant]) {
  return text.includes(`from "./${file.slice(3)}"`) &&
    text.includes(`${name}(m`) &&
    !text.includes(ownConstant);
}

function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (const bits of compass) {
    tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const sharedMachine = (overrides) => makeMachine(overrides);
const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const turningMachine = (overrides) => makeMachine(overrides, { tape: turnTape() });

const SESSIONS = [
  ["shared", sharedMachine],
  ["attract", attractMachine],
  ["turning", turningMachine],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { shared: 2, attract: 0, turning: 1 };

// ── the entry, and the masked comparison ────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    sharedMachine,
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
  if (entry === null) gate(requestDestructionSoundBurst);
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

function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/** Oracle vs candidate on clones: masked RAM, then every register outside the ceiling. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: `raised ${String(e).slice(0, 40)}` };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: a.regs[k], b: b.regs[k] };
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

// ── the crafted cross ───────────────────────────────────────────────────────────────────

/**
 * The two permission cells. The third row — play inactive, attract sounds ON — is the one that
 * separates the strict test from the loose one, and no real dispatch presents it.
 */
const PERMISSIONS = [[0, 0], [255, 0], [0, 255], [1, 0], [0, 1], [255, 255], [1, 1]];
const LENGTHS = [0, 1, 2, 7, 60, 125, 126, 127, 128, 200, 250, 251, 252, 253, 254, 255];

function craft(playing, demo, length) {
  const m = entryState().clone();
  m.mem8[PLAY_ACTIVE] = playing;
  m.mem8[DEMO_SOUNDS] = demo;
  m.mem8[QUEUE_LENGTH] = length;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const [playing, demo] of PERMISSIONS) for (const n of LENGTHS) out.push([playing, demo, n]);
  crossCache = out;
  return out;
}

/** The codes sitting in the queue after a run, in arrival order. */
function queued(machine, before) {
  const grown = u8(machine.mem8[QUEUE_LENGTH] - before);
  const out = [];
  for (let i = 1; i <= grown; i++) out.push(machine.mem8[u16(QUEUE_LENGTH + u8(before + i))]);
  return { grown, codes: out };
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  let bothPermissive = 0;
  const lengths = new Set();
  const states = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      lengths.add(mm.mem8[QUEUE_LENGTH]);
      states.add(`${mm.mem8[PLAY_ACTIVE]}/${mm.mem8[DEMO_SOUNDS]}`);
      if (mm.mem8[PLAY_ACTIVE] !== 0 && mm.mem8[DEMO_SOUNDS] !== 0) bothPermissive++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, bothPermissive, lengths, states };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, requestDestructionSoundBurst) }));
  return sessionCache;
}

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = sharedMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

/**
 * Every cell that EVER differs between an all-oracle run and one with the candidate wired. A
 * first-difference helper cannot express "differs only inside the scratch window", so this walks
 * the whole dump every frame and hands back the set.
 */
function wholeRunCells(candidate) {
  const base = baseline();
  let fired = 0;
  const host = sharedMachine(new Map([[TARGET, (mm) => (fired++, hosted(candidate)(mm))]]));
  let hostFrames = [];
  let threw = null;
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(base.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = base.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.offsetToAddr(o));
  }
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw };
}

const STACK_FLOOR = 0xafc0;
const STACK_TOP = 0xb000;

/**
 * Measured over a whole run with the CORRECT rewrite wired: the driven session is byte-identical,
 * every frame, so the correct rewrite leaves NO cell differing and a twin is caught by any.
 */
const WHOLE_RUN_CELLS = [];

const sameCells = (cells) =>
  cells.length === WHOLE_RUN_CELLS.length && cells.every((c, i) => c === WHOLE_RUN_CELLS[i]);

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the three go through the LOOSER test, so the attract loop makes sounds it must not. */
function brokenLoosePermissionThroughout(m) {
  const { mem8 } = m;
  enqueueSoundIfGameOrDemoSoundsOn(m, mem8[FIRST_CODE_CELL]);
  enqueueSoundIfGameOrDemoSoundsOn(m, mem8[SECOND_CODE_CELL]);
  enqueueSoundIfGameOrDemoSoundsOn(m, mem8[THIRD_CODE_CELL]);
  requestDestructionOrRoundEndSoundPair(m);
}

/** BUG: the trailing pair goes through the STRICTER test, so it is dropped where it should land. */
function brokenStrictPermissionForThePair(m) {
  const { mem8 } = m;
  enqueueSoundIfGameInProgress(m, mem8[FIRST_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[SECOND_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[THIRD_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[TAIL_FIRST_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[TAIL_SECOND_CODE_CELL]);
}

/** BUG: the entry stops at its own three and never runs on. */
function brokenDropsTheTail(m) {
  const { mem8 } = m;
  enqueueSoundIfGameInProgress(m, mem8[FIRST_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[SECOND_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[THIRD_CODE_CELL]);
}

/** BUG: only the tail runs. */
function brokenTailOnly(m) {
  requestDestructionOrRoundEndSoundPair(m);
}

/** BUG: the three go out back to front. */
function brokenOrderReversed(m) {
  const { mem8 } = m;
  enqueueSoundIfGameInProgress(m, mem8[THIRD_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[SECOND_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[FIRST_CODE_CELL]);
  requestDestructionOrRoundEndSoundPair(m);
}

/** BUG: the first code is fetched one byte along. */
function brokenWrongFirstCode(m) {
  const { mem8 } = m;
  enqueueSoundIfGameInProgress(m, mem8[WRONG_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[SECOND_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[THIRD_CODE_CELL]);
  requestDestructionOrRoundEndSoundPair(m);
}

/** BUG: only two of the three are asked for. */
function brokenTwoCodesOnly(m) {
  const { mem8 } = m;
  enqueueSoundIfGameInProgress(m, mem8[FIRST_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[SECOND_CODE_CELL]);
  requestDestructionOrRoundEndSoundPair(m);
}

/** BUG: the same code goes out three times. */
function brokenSameCodeThrice(m) {
  const { mem8 } = m;
  enqueueSoundIfGameInProgress(m, mem8[FIRST_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[FIRST_CODE_CELL]);
  enqueueSoundIfGameInProgress(m, mem8[FIRST_CODE_CELL]);
  requestDestructionOrRoundEndSoundPair(m);
}

/** BUG: no permission is asked at all, so the codes go out whatever the cabinet is doing. */
function brokenBypassesPermission(m) {
  const { mem8 } = m;
  appendSoundCommandToQueue(m, mem8[FIRST_CODE_CELL]);
  appendSoundCommandToQueue(m, mem8[SECOND_CODE_CELL]);
  appendSoundCommandToQueue(m, mem8[THIRD_CODE_CELL]);
  requestDestructionOrRoundEndSoundPair(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 96, [2, 0, 1], true],
  ["loose-permission-throughout", brokenLoosePermissionThroughout, 32, [0, 0, 0], false],
  ["strict-permission-for-the-pair", brokenStrictPermissionForThePair, 32, [0, 0, 0], false],
  ["drops-the-tail", brokenDropsTheTail, 96, [2, 0, 1], true],
  ["tail-only", brokenTailOnly, 64, [2, 0, 1], true],
  ["order-reversed", brokenOrderReversed, 64, [2, 0, 1], true],
  ["wrong-first-code", brokenWrongFirstCode, 64, [2, 0, 1], false],
  ["two-codes-only", brokenTwoCodesOnly, 64, [2, 0, 1], true],
  ["same-code-thrice", brokenSameCodeThrice, 64, [2, 0, 1], true],
  ["bypasses-permission", brokenBypassesPermission, 48, [0, 0, 0], false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the measured window", { skip }, () => {
  gate(requestDestructionSoundBurst);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  requestDestructionSoundBurst(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: permission ${e.mem8[PLAY_ACTIVE]}/${e.mem8[DEMO_SOUNDS]}, queue length ` +
      `${e.mem8[QUEUE_LENGTH]}, sp ${hex4(sp)}; ${all.length} differing bytes, ${strays.length} ` +
      "outside the window",
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.ok(all.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell, not on a register alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("WINDOW: the oracle's own deepest push, measured over the whole cross", { skip }, () => {
  let deepest = 0;
  for (const [playing, demo, n] of cross()) {
    deepest = Math.max(deepest, oracleDepth(craft(playing, demo, n)));
  }
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
});

/** Which registers a candidate parts company with the oracle on, over the whole cross. */
function movedOver(candidate) {
  const moved = new Set();
  for (const [playing, demo, n] of cross()) {
    const a = craft(playing, demo, n);
    const b = a.clone();
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
  const moved = movedOver(requestDestructionSoundBurst);
  // The absence is evidence only if the measurement CAN report a register outside the ceiling.
  const control = movedOver((m) => {
    requestDestructionSoundBurst(m);
    m.regs.b = u8(m.regs.b + 1);
  });
  assert.ok(control.has("b"), "the measurement misses a candidate that plainly moves a register, " +
    "so a clean reading below proves nothing");
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${MOVED.join(", ")}; the control also moves ` +
    `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
  // MOVED is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

test("UNIFORM CORPUS: the permission state every real dispatch arrives in", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / permission [${[...s.states].join(" ")}] / lengths ` +
      `[${[...s.lengths].join(",")}]`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const total = seen.reduce((n, s) => n + s.dispatches, 0);
  const permissive = seen.reduce((n, s) => n + s.bothPermissive, 0);
  assert.ok(total > 0, "vacuous: no session reaches the routine at all");
  assert.equal(permissive, total, "a real dispatch now arrives with one permission cell clear, so " +
    "the SPLIT arm is no longer crafted-only and this file's account of the corpus is wrong");
});

test("CORPUS: every dispatch of every session replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("CRAFTED CROSS: every permission x queue-length combination is identical", { skip }, () => {
  for (const [playing, demo, n] of cross()) {
    const d = unitDiff(requestDestructionSoundBurst, craft(playing, demo, n));
    assert.equal(d, null, `permission ${playing}/${demo} length ${n}: ${show(d)}`);
  }
  console.log(`  CRAFTED CROSS: ${cross().length} entries identical`);
});

test("SPLIT: play inactive with attract sounds on drops the three and keeps the pair", { skip }, () => {
  const m = craft(0, 255, 0);
  const codes = [m.mem8[TAIL_FIRST_CODE_CELL], m.mem8[TAIL_SECOND_CODE_CELL]];
  const after = m.clone();
  requestDestructionSoundBurst(after);
  const landed = queued(after, 0);
  console.log(`  SPLIT: with play inactive and attract sounds on, ${landed.grown} codes land ` +
    `[${landed.codes.join(",")}], and the tail's own codes are [${codes.join(",")}]`);
  assert.deepEqual(landed.codes, codes, "the codes that landed are not the tail's pair, so this " +
    "arm is not measuring the split between the two permission tests");
  // Control: with play ACTIVE and attract sounds off, all five land instead.
  const active = craft(255, 0, 0);
  const both = active.clone();
  requestDestructionSoundBurst(both);
  const all = queued(both, 0);
  assert.equal(all.grown, 5, `with a game in progress ${all.grown} codes land, not all five, so ` +
    "the comparison above cannot be attributed to the permission split");
  // And the tooth: a candidate using the loose test throughout lands all five in the split state.
  const loose = m.clone();
  brokenLoosePermissionThroughout(loose);
  assert.equal(queued(loose, 0).grown, 5, "the loose-permission twin also drops the three in the " +
    "split state, so this arm cannot tell the two tests apart and proves nothing");
});

test("THE DROPPED CASE: with both permission cells clear, nothing is written", { skip }, () => {
  let checked = 0;
  for (const n of LENGTHS) {
    const before = craft(0, 0, n);
    const after = before.clone();
    requestDestructionSoundBurst(after);
    const strays = allDiffs(before, after).filter((d) => !inScratch(d.addr, before.regs.sp));
    assert.deepEqual(strays, [], `length ${n}: a dropped burst still wrote ${show(strays[0])}`);
    checked++;
  }
  const bypass = craft(0, 0, 0);
  const after = bypass.clone();
  brokenBypassesPermission(after);
  assert.notEqual(
    allDiffs(bypass, after).filter((d) => !inScratch(d.addr, bypass.regs.sp)).length,
    0,
    "the permission-skipping twin wrote nothing either, so this arm proves nothing",
  );
  console.log(`  THE DROPPED CASE: ${checked} lengths write nothing with both cells clear`);
});

test("CALLS, NOT RESTATES: the module's text, with the callees as positive controls", () => {
  const module = read("../requestDestructionSoundBurst.js");
  for (const helper of HELPERS) {
    assert.ok(callsRatherThanRestates(module, helper), `the module does not call ${helper[0]}`);
    assert.ok(!callsRatherThanRestates(read(helper[1]), helper), `the check passes ${helper[0]}'s ` +
      "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  }
  console.log(`  CALLS, NOT RESTATES: ${HELPERS.map((h) => h[0]).join(" and ")} are called, and ` +
    "neither of their bodies passes the same check");
});

test("WHOLE-MACHINE: a driven session differs only in stack scratch", { skip }, () => {
  const r = wholeRunCells(requestDestructionSoundBurst);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, differing cells ` +
      `[${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address, so a ` +
      "real game cell diverged over the run");
  }
  assert.deepEqual(r.cells, WHOLE_RUN_CELLS, "the set of dead stack bytes a whole run leaves " +
    "differing moved, so the exclusion is no longer measured");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([p, d, n]) => unitDiff(twin, craft(p, d, n)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, twin));
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
    for (const [i, r] of counts.entries()) {
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} count moved`);
    }
  });

  test(`TEETH: the whole-run masked diff sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin);
    const seen = r.threw !== null || !sameCells(r.cells);
    console.log(`  TEETH/${label}: whole run ${seen ? "catches it" : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-run verdict on the ${label} twin changed`);
  });
}
