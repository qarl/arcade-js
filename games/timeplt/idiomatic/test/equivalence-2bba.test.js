// SPDX-License-Identifier: GPL-3.0-only
/**
 * countTheKillAndGrantTheSharedToken — memory-equivalent to the frozen oracle at ROM 0x2BBA.
 *
 * GATE: every dispatch of both sessions; a crafted cross-product over all four guards; exhaustive
 *   single-cell sweeps of the kill count, the shared countdown and the slot ordinal; a whole
 *   session swapped live; and a bench of broken twins with measured catch counts.
 *
 * ★ THREE OF THE FOUR EXITS ARE REACHED BY A REAL DISPATCH AND ONE IS NOT. Measured over the
 *   two sessions: of the dispatches captured, some return at the first guard, some spend a tick
 *   of the shared countdown and return, and exactly one goes all the way and writes the claim. The
 *   exit that is NEVER reached is the second guard — at every dispatch where the first guard passed
 *   the arming cell was non-zero, so the arming guard's REFUSAL is crafted-only here. ARMS measures
 *   all four counts rather than asserting the coverage, and the arming twin's catch count is what
 *   shows the crafted arm is doing work the corpus cannot.
 *
 * ★ THE SOUND REQUEST IS A DIRECT CALL AND ITS WINDOW IS MEASURED. The oracle reaches the request
 *   through the registry, brackets it with a push, and takes its own return; the rewrite calls the
 *   idiomatic sibling and leaves the return to the seam. The bytes that differ are exactly the dead
 *   stack the two conventions leave behind, and WINDOW pins the width of that at ten with BOUNDARY
 *   proving a scribble one byte below it is still caught.
 *
 * ★ THE COUNTDOWN IS SPENT BY EVERY CLAIMANT, NOT ONLY THE WINNER. It is stepped as soon as the
 *   first two guards pass and the test for zero happens after the step, so an entry that loses
 *   still leaves the cell one lower. The COUNTDOWN sweep walks all 256 values so the wrap at zero
 *   is covered, and the claims-early twin exists to prove the ordering is what is being measured.
 *
 * What it exercises, holes stated:
 *   1. WINDOW — the oracle's stack footprint, measured over corpus and sweep, pinned at 10.
 *   2. BOUNDARY — a scribble inside the window is masked, one byte below it is caught.
 *   3. CORPUS — every dispatch of both sessions, identical outside the window.
 *   4. ARMS — which of the four exits the corpus actually reaches, counted.
 *   5. NOT VACUOUS — a candidate that does nothing fails the same comparison, on a real cell.
 *   6. EXCLUDED — no register outside the measured ceiling moves, with a control twin.
 *   7. GUARDS — the crafted cross-product over all four guards, on two record slots.
 *   8. SLOTS — every record pointer the corpus presents, at each of the four exits.
 *   9. KILLS — all 256 values of the kill count, and the floor at zero.
 *  10. COUNTDOWN — all 256 values of the shared countdown, wrap included.
 *  11. ORDINAL — all 256 slot ordinals, so the mark is an addition and not an or.
 *  12. SESSION — a whole session swapped, differing only inside the measured stack band.
 *  13. TEETH — a bench of broken twins, each with its measured catch counts.
 *
 * HOLE: what the claim cell BUYS is entirely outside this gate. Nothing here reads it back, so a
 * rewrite could write the right byte to the right cell at the wrong moment in the round and every
 * arm would stay green.
 * HOLE: the record pointer only ever takes the values the corpus presents. A slot outside that set
 * is never exercised, and neither is a pointer that would wrap the address space.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2bba.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { countTheKillAndGrantTheSharedToken } from "../countTheKillAndGrantTheSharedToken.js";
import { loc_2bba as oracle } from "../../translated/loc_2bba.js";
import { requestTwoSounds } from "../requestTwoSounds.js";
import { withOmittedRet } from "../../machine.js";
import { KILLS_REMAINING } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x2bba;
const FRAMES = 4000;

/** Derived here independently of the module, so an edit to its constants cannot pass unnoticed. */
const COOLDOWN = 0x0e;
const ORDINAL = 0x0f;
const COOLDOWN_CLAIMS = 0x80;
const CLAIM_ARMED = 0xa812;
const CLAIM_COUNTDOWN = 0xa811;
const CLAIM_HOLDER = 0xa821;
const HOLDER_MARK = 0x80;

/** Measured by the WINDOW arm: the sound request's own frames plus the oracle's bracket. */
const SCRATCH_BYTES = 10;

/**
 * The ceiling on register divergence, measured over both corpora and the crafted cross-product.
 *   a — the oracle stages every byte it tests in A; the rewrite tests in expressions.
 *   f — the guards' comparisons and the two decrements set flags nothing downstream reads.
 *   h,l — the oracle points HL at each cell it steps; the rewrite addresses them by name.
 *   sp — the oracle takes its own return and the rewrite leaves that to the seam.
 * A ceiling, not a demand — a rewrite that diverged on fewer of these still passes.
 */
const MOVED = ["a", "f", "h", "l", "sp"];

const VALUES = 256;
const STACK_SEAT = 0xb000;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    // A JavaScript fault is a bug in THIS file, not a divergence — swallowing one reports a
    // broken twin as a caught twin. Only a machine-level raise counts as an outcome here.
    if (e instanceof ReferenceError || e instanceof TypeError) throw e;
    return { addr: null, a: "returned", b: String(e).slice(0, 60) };
  }
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

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
  return (seat - deepest) & 0xffff;
}

/** Which of the four exits an entry state will take, decided from the cells the guards read. */
function armOf(m) {
  const object = m.regs.ix;
  if ((m.mem8[object + COOLDOWN] & COOLDOWN_CLAIMS) === 0) return "cooldown-clear";
  if (m.mem8[CLAIM_ARMED] === 0) return "not-armed";
  if (((m.mem8[CLAIM_COUNTDOWN] - 1) & 0xff) !== 0) return "countdown-running";
  return "claims";
}

const ARM_NAMES = ["cooldown-clear", "not-armed", "countdown-running", "claims"];

// ── the captured entries ────────────────────────────────────────────────────────────────

let captured = null;

function capture() {
  if (captured) return captured;
  const out = [];
  for (const opts of [{}, { tape: [] }]) {
    const seen = [];
    const m = makeMachine(new Map([[TARGET, (mm) => {
      seen.push(mm.clone());
      return oracle(mm);
    }]]), opts);
    const frames = m.runFrames(FRAMES);
    assert.equal(m.stoppedBy, null, `capture run stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, FRAMES, "capture run ran short");
    out.push(...seen);
  }
  captured = out;
  return captured;
}

function entryState() {
  const e = capture()[0] ?? null;
  assert.notEqual(e, null, "vacuous: the tape never reached the routine");
  return e;
}

/** Every distinct record pointer the corpus presents, so the sweeps cover real slots. */
function slots() {
  return [...new Set(capture().map((e) => e.regs.ix))].sort((a, b) => a - b);
}

/** A real captured entry with the guard cells forced. */
function craft({ kills, cooldown, armed, countdown, ordinal, ix } = {}, from = entryState()) {
  const m = from.clone();
  if (ix !== undefined) m.regs.ix = ix;
  const object = m.regs.ix;
  if (kills !== undefined) m.mem8[KILLS_REMAINING] = kills;
  if (cooldown !== undefined) m.mem8[object + COOLDOWN] = cooldown;
  if (armed !== undefined) m.mem8[CLAIM_ARMED] = armed;
  if (countdown !== undefined) m.mem8[CLAIM_COUNTDOWN] = countdown;
  if (ordinal !== undefined) m.mem8[object + ORDINAL] = ordinal;
  return m;
}

const KILL_POINTS = [0, 1, 2, 0x80, 0xff];
const COOLDOWN_POINTS = [0x00, 0x01, 0x7f, 0x80, 0x81, 0xff];
const ARMED_POINTS = [0, 1, 0x80, 0xff];
const COUNTDOWN_POINTS = [0, 1, 2, 0xff];
const ORDINAL_POINTS = [0, 1, 23, 0x7f, 0x80, 0xff];

/** Two record pointers for the cross-product; the SLOTS arm covers the rest at the four exits. */
function guardSlots() {
  const all = slots();
  return [...new Set([all[0], all[all.length - 1]])];
}

function* guardCases() {
  for (const ix of guardSlots()) {
    for (const kills of KILL_POINTS) {
      for (const cooldown of COOLDOWN_POINTS) {
        for (const armed of ARMED_POINTS) {
          for (const countdown of COUNTDOWN_POINTS) {
            for (const ordinal of ORDINAL_POINTS) {
              yield { ix, kills, cooldown, armed, countdown, ordinal };
            }
          }
        }
      }
    }
  }
}

function sweepGuards(candidate) {
  let caught = 0;
  let total = 0;
  for (const spec of guardCases()) {
    total++;
    if (unitDiff(candidate, craft(spec))) caught++;
  }
  return { caught, total };
}

/** One cell walked over all 256 values, the others held at a value that reaches the claim. */
function sweepCell(candidate, cell) {
  const held = { cooldown: 0x80, armed: 1, countdown: 1, ordinal: 7, kills: 9 };
  let caught = 0;
  for (let value = 0; value < VALUES; value++) {
    if (unitDiff(candidate, craft({ ...held, [cell]: value }))) caught++;
  }
  return caught;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** Everything the entry does, parameterised, so each twin below differs in exactly one thing. */
function claimer(m, {
  sounds = true, kills = true, floor = true, bit = COOLDOWN_CLAIMS,
  armedGuard = true, testBeforeStep = false, mark = HOLDER_MARK, holder = CLAIM_HOLDER,
} = {}) {
  const { mem8 } = m;
  const object = m.regs.ix;
  if (sounds) requestTwoSounds(m);
  if (kills && (!floor || mem8[KILLS_REMAINING] !== 0)) {
    mem8[KILLS_REMAINING] = (mem8[KILLS_REMAINING] - 1) & 0xff;
  }
  if ((mem8[object + COOLDOWN] & bit) === 0) return;
  if (armedGuard && mem8[CLAIM_ARMED] === 0) return;
  if (testBeforeStep) {
    if (mem8[CLAIM_COUNTDOWN] !== 0) {
      mem8[CLAIM_COUNTDOWN] = (mem8[CLAIM_COUNTDOWN] - 1) & 0xff;
      return;
    }
  } else {
    mem8[CLAIM_COUNTDOWN] = (mem8[CLAIM_COUNTDOWN] - 1) & 0xff;
    if (mem8[CLAIM_COUNTDOWN] !== 0) return;
  }
  mem8[holder] = (mem8[object + ORDINAL] + mark) & 0xff;
}

/** BUG: never asks for the sounds. */
const brokenNoSounds = (m) => claimer(m, { sounds: false });
/** BUG: leaves the kill count alone. */
const brokenNoKillCount = (m) => claimer(m, { kills: false });
/** BUG: lets the kill count wrap past zero instead of stopping there. */
const brokenKillWraps = (m) => claimer(m, { floor: false });
/** BUG: reads the wrong bit of the +0x0E release-delay byte. */
const brokenWrongBit = (m) => claimer(m, { bit: 0x40 });
/** BUG: drops the arming guard, so a disarmed machine still spends the countdown. */
const brokenNoArmingGuard = (m) => claimer(m, { armedGuard: false });
/** BUG: tests the countdown before stepping it, so the claim lands a tick early. */
const brokenClaimsEarly = (m) => claimer(m, { testBeforeStep: true });
/** BUG: writes the ordinal unmarked. */
const brokenNoMark = (m) => claimer(m, { mark: 0 });
/** BUG: writes the claim into the cell next door. */
const brokenWrongHolder = (m) => claimer(m, { holder: CLAIM_HOLDER + 1 });

/** BUG: scribbles on an index register — the in-arm control for the register ceiling. */
function brokenMovesIndex(m) {
  countTheKillAndGrantTheSharedToken(m);
  m.regs.iy = (m.regs.iy + 1) & 0xffff;
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["no-sounds", brokenNoSounds],
  ["no-kill-count", brokenNoKillCount],
  ["kill-wraps", brokenKillWraps],
  ["wrong-bit", brokenWrongBit],
  ["no-arming-guard", brokenNoArmingGuard],
  ["claims-early", brokenClaimsEarly],
  ["no-mark", brokenNoMark],
  ["wrong-holder", brokenWrongHolder],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("WINDOW: the oracle's stack footprint, measured over corpus and sweep", { skip }, () => {
  let deepest = 0;
  for (const e of capture()) deepest = Math.max(deepest, oracleDepth(e));
  for (const arm of [{ cooldown: 0 }, { cooldown: 0x80, armed: 0 },
    { cooldown: 0x80, armed: 1, countdown: 5 }, { cooldown: 0x80, armed: 1, countdown: 1 }]) {
    deepest = Math.max(deepest, oracleDepth(craft(arm)));
  }
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is the wrong width and every arm here is comparing the wrong bytes");
});

test("BOUNDARY: the mask hides the window and nothing else", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const scribble = (offset) => (m) => {
    countTheKillAndGrantTheSharedToken(m);
    m.mem8[(sp + offset) & 0xffff] = (m.mem8[(sp + offset) & 0xffff] ^ 0xff) & 0xff;
  };
  assert.equal(unitDiff(scribble(-1), e), null, "a byte inside the window is not masked");
  assert.equal(unitDiff(scribble(-SCRATCH_BYTES), e), null, "the deepest byte of the window is not masked");
  assert.notEqual(unitDiff(scribble(-SCRATCH_BYTES - 1), e), null,
    "a byte one below the window is masked too, so the window is wider than it claims");
  assert.notEqual(unitDiff(scribble(0), e), null, "the seat itself is masked");
  console.log(`  BOUNDARY: ${hex4(sp - SCRATCH_BYTES)} masked, ${hex4(sp - SCRATCH_BYTES - 1)} ` +
    `caught, ${hex4(sp)} caught`);
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  const entries = capture();
  assert.ok(entries.length > 0, "vacuous: neither tape reached the routine");
  for (const e of entries) {
    const d = unitDiff(countTheKillAndGrantTheSharedToken, e);
    assert.equal(d, null, show(d));
  }
  console.log(`  CORPUS: ${entries.length} dispatches identical across ${slots().length} record ` +
    `slots, ${new Set(entries.map((e) => e.mem8[KILLS_REMAINING])).size} distinct kill counts`);
});

test("ARMS: which of the four exits the corpus actually reaches", { skip }, () => {
  const counts = Object.fromEntries(ARM_NAMES.map((n) => [n, 0]));
  for (const e of capture()) counts[armOf(e)]++;
  const reached = ARM_NAMES.filter((n) => counts[n] > 0);
  console.log(`  ARMS: ${ARM_NAMES.map((n) => `${n} ${counts[n]}`).join(", ")}`);
  assert.ok(reached.length >= 3, "the corpus reaches fewer arms than it used to, so the crafted " +
    "cross-product is now carrying more than this gate's notes say it does");
  // Stated rather than assumed: the arming refusal is crafted-only, and this is the measurement.
  assert.equal(counts["not-armed"], 0, "the corpus now reaches the arming refusal, which is better " +
    "than this gate expects — re-measure the note about it rather than deleting this assertion");
  assert.ok(counts.claims > 0, "no real dispatch reaches the claim, so the whole tail of this " +
    "entry rests on crafted state and the header should say so");
});

test("NOT VACUOUS: a no-op candidate FAILS the same comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked comparison passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell, not on an exception");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

/** Which registers a candidate parts company with the oracle on, over corpus and one arm each. */
function movedOver(candidate) {
  const moved = new Set();
  const machines = [...capture().slice(0, 20),
    craft({ cooldown: 0 }), craft({ cooldown: 0x80, armed: 0 }),
    craft({ cooldown: 0x80, armed: 1, countdown: 5 }),
    craft({ cooldown: 0x80, armed: 1, countdown: 1, ordinal: 7 })];
  for (const machine of machines) {
    const a = machine.clone();
    const b = machine.clone();
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
  const moved = movedOver(countTheKillAndGrantTheSharedToken);
  const control = movedOver(brokenMovesIndex);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
    "the measurement reports nothing outside the ceiling even for a twin that scribbles on an " +
      "index register, so a clean reading below proves nothing");
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${MOVED.join(", ")}; the control twin also moves ` +
    `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
  // A CEILING, not a demand: deepEqual against MOVED would go RED on a rewrite that became
  // register-exact, which is a gate refusing the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register diverged outside the excluded set");
});

test("GUARDS: the crafted cross-product over all four guards", { skip }, () => {
  const { caught, total } = sweepGuards(countTheKillAndGrantTheSharedToken);
  assert.equal(caught, 0, "a crafted guard combination diverged");
  const armsHit = new Set();
  for (const spec of guardCases()) armsHit.add(armOf(craft(spec)));
  assert.deepEqual([...armsHit].sort(), [...ARM_NAMES].sort(),
    "the cross-product does not reach all four exits, so it is not the sweep this arm claims");
  console.log(`  GUARDS: ${total} crafted combinations over ${guardSlots().length} record slots, ` +
    `identical, reaching all ${ARM_NAMES.length} exits`);
});

test("SLOTS: every record pointer the corpus presents, at each of the four exits", { skip }, () => {
  const arms = [
    { cooldown: 0x00 },
    { cooldown: 0x80, armed: 0 },
    { cooldown: 0x80, armed: 1, countdown: 5 },
    { cooldown: 0x80, armed: 1, countdown: 1, ordinal: 7 },
  ];
  const reached = new Set();
  let compared = 0;
  for (const ix of slots()) {
    for (const arm of arms) {
      const m = craft({ ix, ...arm });
      reached.add(armOf(m));
      const d = unitDiff(countTheKillAndGrantTheSharedToken, m);
      assert.equal(d, null, `slot ${hex4(ix)}: ${show(d)}`);
      compared++;
    }
  }
  assert.deepEqual([...reached].sort(), [...ARM_NAMES].sort(),
    "the four crafted specs no longer reach the four exits they are named for");
  console.log(`  SLOTS: ${compared} comparisons over ${slots().length} record slots by ` +
    `${arms.length} exits, all identical`);
});

test("KILLS: all 256 kill counts, and the floor at zero", { skip }, () => {
  assert.equal(sweepCell(countTheKillAndGrantTheSharedToken, "kills"), 0, "a kill count diverged");
  const floored = craft({ kills: 0, cooldown: 0 });
  countTheKillAndGrantTheSharedToken(floored);
  assert.equal(floored.mem8[KILLS_REMAINING], 0, "the kill count must stop at zero, not wrap");
  const stepped = craft({ kills: 1, cooldown: 0 });
  countTheKillAndGrantTheSharedToken(stepped);
  assert.equal(stepped.mem8[KILLS_REMAINING], 0, "a kill count of one must step to zero");
  console.log(`  KILLS: ${VALUES} values identical; zero stays zero and one steps to zero`);
});

test("COUNTDOWN: all 256 values of the shared countdown, wrap included", { skip }, () => {
  assert.equal(sweepCell(countTheKillAndGrantTheSharedToken, "countdown"), 0, "a countdown value diverged");
  const wrapped = craft({ cooldown: 0x80, armed: 1, countdown: 0 });
  countTheKillAndGrantTheSharedToken(wrapped);
  assert.equal(wrapped.mem8[CLAIM_COUNTDOWN], 0xff, "a countdown of zero must wrap, not saturate");
  const loser = craft({ cooldown: 0x80, armed: 1, countdown: 5 });
  const before = loser.mem8[CLAIM_HOLDER];
  countTheKillAndGrantTheSharedToken(loser);
  assert.equal(loser.mem8[CLAIM_COUNTDOWN], 4, "a losing claimant must still spend a tick");
  assert.equal(loser.mem8[CLAIM_HOLDER], before, "a losing claimant must not touch the claim");
  console.log(`  COUNTDOWN: ${VALUES} values identical; zero wraps to 255 and a loser still spends one`);
});

test("ORDINAL: all 256 ordinals, the mark added and not or-ed", { skip }, () => {
  assert.equal(sweepCell(countTheKillAndGrantTheSharedToken, "ordinal"), 0, "an ordinal diverged");
  const high = craft({ cooldown: 0x80, armed: 1, countdown: 1, ordinal: 0x81 });
  countTheKillAndGrantTheSharedToken(high);
  assert.equal(high.mem8[CLAIM_HOLDER], 0x01,
    "an ordinal already carrying the mark must ADD and wrap, which is what tells addition from or");
  const low = craft({ cooldown: 0x80, armed: 1, countdown: 1, ordinal: 7 });
  countTheKillAndGrantTheSharedToken(low);
  assert.equal(low.mem8[CLAIM_HOLDER], 0x87, "an ordinary ordinal must land marked");
  console.log(`  ORDINAL: ${VALUES} values identical; 0x81 lands as 0x01, so the mark is added`);
});

test("SESSION: a whole session swapped, differing only inside the measured stack band", { skip }, () => {
  const run = (fn) => {
    const m = makeMachine(fn ? new Map([[TARGET, withOmittedRet(fn, TARGET)]]) : null, { tape: [] });
    const floors = recordFrameFloors(m);
    let deepest = STACK_SEAT;
    const push = m.push16.bind(m);
    m.push16 = (v) => {
      const r = push(v);
      if (m.regs.sp < deepest) deepest = m.regs.sp;
      return r;
    };
    return { frames: m.runFrames(FRAMES), floors, deepest, m };
  };
  const differing = (base, swap) => {
    const out = new Set();
    const live = new Set(); // at or above the base sample's SP: a live frame, never the band
    for (let i = 0; i < base.frames.length; i++) {
      const x = base.frames[i];
      const y = swap.frames[i];
      for (let j = 0; j < x.length; j++) {
        if (x[j] === y[j]) continue;
        const a = base.m.stateOffsetToAddr(j);
        out.add(a);
        if (a >= base.floors[i]) live.add(a);
      }
    }
    return Object.assign([...out], { live });
  };
  // The control takes ONE extra kill on each dispatch: the smallest wrong thing this entry could
  // do, and something the dead-stack band must not be able to swallow.
  const overCounter = (m) => {
    countTheKillAndGrantTheSharedToken(m);
    m.mem8[KILLS_REMAINING] = (m.mem8[KILLS_REMAINING] - 1) & 0xff;
  };
  const base = run(null);
  const swap = run(countTheKillAndGrantTheSharedToken);
  const floor = Math.min(base.deepest, swap.deepest);
  const inBand = (a, d) => a >= floor && a < STACK_SEAT && !d.live.has(a);
  const ours = differing(base, swap);
  const control = differing(base, run(overCounter));
  console.log(`  SESSION: ${FRAMES} frames, stack band [${hex4(floor)}, ${hex4(STACK_SEAT)}); the ` +
    `rewrite differs at ${ours.length} address(es), all inside it; the control twin differs at ` +
    `${control.length}, ${control.filter((a) => !inBand(a, control)).length} of them outside`);
  assert.ok(control.some((a) => !inBand(a, control)),
    "a twin that miscounts one kill per dispatch differs nowhere outside the stack band either, " +
      "so this arm cannot tell a transparent swap from a broken one");
  assert.deepEqual(ours.filter((a) => !inBand(a, ours)).map(hex4), [],
    "the swapped session differs outside the stack band");
  assert.equal(swap.m.regs.sp, base.m.regs.sp, "the swapped session left the stack somewhere else");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const guards = sweepGuards(twin);
    const corpus = capture().filter((e) => unitDiff(twin, e)).length;
    console.log(`  TEETH/${label}: caught on ${guards.caught}/${guards.total} crafted combinations, ` +
      `${corpus}/${capture().length} real dispatches`);
    assert.ok(guards.caught > 0, `the crafted cross-product PASSED the ${label} twin`);
  });
}
