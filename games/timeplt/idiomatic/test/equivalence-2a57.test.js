// SPDX-License-Identifier: GPL-3.0-only
/**
 * spriteForHeading — memory-equivalent to the frozen oracle at ROM 0x2A57.
 *
 * GATE: crafted-entry live-out over the whole input space, every dispatch of a driven session,
 *   and a whole-session substitution with the rewrite actually wired in. The standard
 *   unitEquivalence verdict is worse than weak here, and this file measures that rather than
 *   asserting around it.
 *
 * ★ THE HOLES, STATED FIRST.
 *   1. `r.ram === null` is FALSE for the correct rewrite. The oracle brackets its inner call
 *      with a stack push, so it leaves a return address in the two bytes below the entry stack
 *      pointer; the rewrite models no stack and leaves them alone. Those two bytes are the
 *      WHOLE RAM difference, in both directions — the BLIND arm shows an empty body produce the
 *      identical RAM verdict. RAM decides nothing about this routine.
 *   2. The routine writes no memory at all, so the comparison every arm is judged by is RAM
 *      outside those two scratch bytes AND the register pair the callers consume.
 *   3. The FIRST dispatch the tape reaches is blind to HALF the twins below. It arrives on the
 *      captured record, on a heading where rounding to the nearest sector and truncating to it
 *      agree and where the circle does not wrap, while the counter is in the far half of the
 *      animation. unitEquivalence clones the first entry, not the first informative one, so no
 *      frame budget fixes that; the DEGENERATE arm names the four survivors and pins them.
 *   4. The routine reads its object through a caller-supplied record pointer, so a single
 *      captured dispatch pins ONE slot. The fixed-slot twin is the discriminating case: it
 *      survives the captured slot and dies on the other four the session presents.
 *
 * WHY THE LIVE-OUT IS {b, c}, DERIVED FROM THE CALLERS. refreshSpriteFromHeading stores the
 * second register into the object's sprite-entry control byte and the first into its tile code;
 * refreshSecondEraSpriteFromHeading stores the same two, each stepped by a constant, into the same two cells. Nothing else
 * the oracle leaves behind survives: both callers overwrite the accumulator on their next step,
 * neither branches on a flag, and their own callers loc_2927 and serviceEra1EnemyCraftSlot either return at once
 * or go on to loc_4243, which loads the accumulator and both address pairs before reading any of
 * them. That is an argument, so the SUBSTITUTION arm is the falsifiable version — it wires the
 * rewrite, which never touches those registers, into a whole driven session.
 *
 * What it exercises, holes stated:
 *   1. CONTRACT — unitEquivalence at the real dispatch, with the scratch window excluded.
 *   2. BLIND — the RAM verdict shown to be identical for the rewrite and for an empty body.
 *   3. EXCLUDED — the divergence bounded by {a, f, d, e, h, l, sp} plus pc, and the RAM
 *      difference pinned to the scratch window, so "excluded" cannot quietly widen. A rewrite
 *      that clobbers fewer of those registers is an improvement and stays green.
 *   4. DEGENERATE — the four twins the captured entry cannot see, each named and each shown to
 *      be caught elsewhere.
 *   5. SESSION — every dispatch of a whole driven session compared on a real machine, the run
 *      asserted complete rather than merely finished.
 *   6. WINDOW — the excluded scratch measured at every one of those dispatches against THAT
 *      dispatch's own stack pointer. HOLE: every dispatch arrives at one depth, so the window
 *      has one sample; it is measured rather than assumed, but it is not measured deep.
 *   7. EXHAUSTIVE — every record the session presents, every heading of the circle, and four
 *      counter values covering both animation halves and both of the neighbouring bits.
 *   8. COUNTER — all 256 counter values, to show the animation half is decided by exactly one
 *      bit of it rather than by the low bits generally.
 *   9. ANTIPODE — the fixed-slot twin's predicate re-derived from the table data, so a gate
 *      agreeing with a wrong theory of why that twin fails would break here instead of passing.
 *  10. SUBSTITUTION — the rewrite wired into a driven session behind a shim that pays the
 *      T-states and the return the cycle-driven host still expects. Only the two scratch bytes
 *      ever differ, and they heal well before the end.
 *  11. TEETH — eight twins, each caught on exactly the inputs a stated predicate names, each
 *      caught on real traffic, and each shown to fork the substituted session.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2a57.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { spriteForHeading as rewrite } from "../spriteForHeading.js";
import { loc_2a57 as oracle } from "../../translated/loc_2a57.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8, u16 } from "../../../../core/int.js";
import { FRAME_TICK } from "../names.js";

const TARGET = 0x2a57;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const HEADING = 2;
const STEPS_PER_TURN = 256;
const SECTORS = 16;
const STEPS_PER_SECTOR = STEPS_PER_TURN / SECTORS;
const HALF_TURN = STEPS_PER_TURN / 2;

const SHAPE_BY_SECTOR = 0x2a77;
const MIRROR_BY_SECTOR = 0x2a87;
const ALTERNATE_POSE_BIT = 2;
const ALTERNATE_POSE_SHAPE_STEP = 8;

/** Bytes the oracle's call bracket leaves below the stack pointer it was entered at. */
const SCRATCH_BYTES = 2;

/** The pair the callers store into the sprite entry, and everything the contract drops. */
const LIVE_OUT = ["b", "c"];
const EXCLUDED = ["a", "f", "d", "e", "h", "l", "sp"];

/** A poison pair, so a twin that delivers nothing is caught rather than accidentally right. */
const POISON = 0xdead;

/** Counter values for the crafted sweep: both animation halves, both neighbouring bits. */
const COUNTERS = [0, 1, 2, 3];

/** The oracle's T-state total, which branches only on the animation half. */
const STRAIGHT_LINE = 145;
const ALTERNATE_POSE_TAIL = 30;
const BASE_POSE_TAIL = 11;
const RET_TSTATES = 10;

const hex4 = (v) => "0x" + u16(v).toString(16).padStart(4, "0");
const show = (d) => (d ? `${d.where}: oracle=${d.oracle} candidate=${d.candidate}` : "identical");

// ── the captured entry ──────────────────────────────────────────────────────────────────────

let entry = null;

/** The contract call, with the entry state harvested off the candidate arm's own clone. */
function gate(candidate) {
  return unitEquivalence(
    makeMachine,
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
  if (entry === null) gate(rewrite);
  return entry;
}

const shapeAt = (sector) => entryState().mem8[SHAPE_BY_SECTOR + sector];
const mirrorAt = (sector) => entryState().mem8[MIRROR_BY_SECTOR + sector];
const sectorOf = (heading) => Math.floor(u8(heading + STEPS_PER_SECTOR / 2) / STEPS_PER_SECTOR);
const pairDiffers = (one, other) =>
  shapeAt(one) !== shapeAt(other) || mirrorAt(one) !== mirrorAt(other);

// ── the comparison ──────────────────────────────────────────────────────────────────────────

/**
 * Every RAM byte that differs, each tagged with whether it lies in the scratch window. The
 * window is derived from `top`, the stack pointer BOTH arms started from, never from a fixed
 * address — a window pinned to a literal would call honest scratch an escape at any other depth,
 * and widening it until it passed is what quietly removes the check.
 */
function ramDiffs(a, b, top) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    const scratch = addr >= u16(top - SCRATCH_BYTES) && addr < top;
    out.push({ where: "ram " + hex4(addr), oracle: da[i], candidate: db[i], scratch });
  }
  return out;
}

/** The comparison with teeth: RAM outside the scratch window, then the pair the callers read. */
function liveOutDiff(a, b, top) {
  const strayed = ramDiffs(a, b, top).filter((d) => !d.scratch);
  if (strayed.length) return strayed[0];
  for (const k of LIVE_OUT) {
    if (a.regs[k] !== b.regs[k]) return { where: k, oracle: a.regs[k], candidate: b.regs[k] };
  }
  return null;
}

/** Both arms from the captured entry exactly as it was found, with the pair poisoned first. */
function atEntry(candidate) {
  const a = entryState().clone();
  const b = entryState().clone();
  a.regs.bc = POISON;
  b.regs.bc = POISON;
  const top = a.regs.sp;
  oracle(a);
  candidate(b);
  return liveOutDiff(a, b, top);
}

// ── the crafted space ───────────────────────────────────────────────────────────────────────

/**
 * Every record the session presents, every heading, four counters. Two machines are reused
 * rather than cloned thousands of times: everything either arm reads is rewritten each pass —
 * including the stack pointer, so the oracle's scratch always lands in the same two bytes — and
 * a clone's frame machinery is already neutralised, so no iteration leaks into the next. The
 * reuse is sound only if neither arm writes elsewhere, which the returned RAM check asserts.
 *
 * Records OTHER than the one under test are given the ANTIPODE of the heading, which is what
 * makes the fixed-slot twin's survivor set exactly stateable.
 */
function sweep(candidate) {
  const records = drivenSession().records;
  const a = entryState().clone();
  const b = entryState().clone();
  const sp = a.regs.sp;
  const pc = a.pc;
  const flags = a.regs.f;
  const cycles = a.cycles;
  let caught = 0;
  let mistimed = 0;
  for (const record of records) {
    for (let heading = 0; heading < STEPS_PER_TURN; heading++) {
      for (const counter of COUNTERS) {
        for (const mm of [a, b]) {
          for (const other of records) {
            mm.mem8[u16(other + HEADING)] = other === record ? heading : u8(heading + HALF_TURN);
          }
          mm.mem8[FRAME_TICK] = counter;
          mm.regs.ix = record;
          mm.regs.bc = POISON;
        }
        a.regs.sp = sp;
        a.pc = pc;
        a.regs.f = flags;
        a.cycles = cycles;
        oracle(a);
        if (a.cycles - cycles !== oracleTStates(a)) mistimed++;
        candidate(b);
        if (LIVE_OUT.some((k) => a.regs[k] !== b.regs[k])) caught++;
      }
    }
  }
  return { caught, mistimed, strayed: ramDiffs(a, b, sp).filter((d) => !d.scratch) };
}

/** How many of those inputs a stated predicate says a twin must be caught on. */
function predicted(pred) {
  let n = 0;
  for (const record of drivenSession().records) {
    for (let heading = 0; heading < STEPS_PER_TURN; heading++) {
      for (const counter of COUNTERS) if (pred(record, heading, counter)) n++;
    }
  }
  return n;
}

const spaceSize = () => drivenSession().records.length * STEPS_PER_TURN * COUNTERS.length;

// ── a whole driven session ──────────────────────────────────────────────────────────────────

function countDiff(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * Every dispatch of a driven session, on the real machine the game produced. The host itself
 * keeps running on the oracle, so the session is never perturbed and the mixed stack leak never
 * accumulates; each candidate runs on its own clone taken before the oracle does.
 *
 * It also MEASURES the scratch window instead of trusting the one sample the captured entry
 * gives: at each dispatch it records the stack pointer, counts any byte the rewrite writes
 * anywhere, and counts any byte the oracle writes outside the two below THAT dispatch's pointer.
 */
let session = null;
function drivenSession() {
  if (session !== null) return session;
  const labels = ["spriteForHeading", ...TWINS.map(([label]) => label)];
  const arms = [rewrite, ...TWINS.map(([, fn]) => fn)];
  const diverged = new Array(arms.length).fill(0);
  const records = new Set();
  const inputs = new Set();
  let dispatches = 0;
  let escaped = 0;
  let rewrote = 0;
  let deepest = 0;
  let lowSp = 0x10000;
  let highSp = 0;

  const snoop = new Map([[TARGET, (mm) => {
    dispatches++;
    records.add(mm.regs.ix);
    const heading = mm.mem8[u16(mm.regs.ix + HEADING)];
    inputs.add(`${mm.regs.ix}/${heading}/${mm.mem8[FRAME_TICK] & ALTERNATE_POSE_BIT}`);
    const top = mm.regs.sp;
    if (top < lowSp) lowSp = top;
    if (top > highSp) highSp = top;

    const tried = arms.map((fn) => {
      const mine = mm.clone();
      mine.regs.bc = POISON;
      const before = mine.dumpState();
      fn(mine);
      return { mine, wrote: countDiff(before, mine.dumpState()) };
    });
    rewrote += tried[0].wrote;

    const before = mm.dumpState();
    const result = oracle(mm);
    const after = mm.dumpState();
    for (let i = 0; i < before.length; i++) {
      if (before[i] === after[i]) continue;
      const depth = top - mm.stateOffsetToAddr(i);
      if (depth > deepest) deepest = depth;
      if (depth <= 0 || depth > SCRATCH_BYTES) escaped++;
    }
    tried.forEach((t, i) => {
      if (LIVE_OUT.some((k) => t.mine.regs[k] !== mm.regs[k])) diverged[i]++;
    });
    return result;
  }]]);

  const host = makeMachine(snoop);
  const frames = host.runFrames(ENTRY_FRAMES);
  session = {
    labels,
    diverged,
    dispatches,
    escaped,
    rewrote,
    deepest,
    lowSp,
    highSp,
    records: [...records].sort((p, q) => p - q),
    inputs: inputs.size,
    frames: frames.length,
    stoppedBy: host.stoppedBy,
  };
  return session;
}

const caughtInPlay = (label) => {
  const s = drivenSession();
  return s.diverged[s.labels.indexOf(label)];
};

// ── substitution: the rewrite actually wired in ─────────────────────────────────────────────

/** The oracle's own total. Its one branch costs more when it steps the shape on. */
function oracleTStates(m) {
  const far = (m.mem8[FRAME_TICK] & ALTERNATE_POSE_BIT) !== 0;
  return STRAIGHT_LINE + (far ? ALTERNATE_POSE_TAIL : BASE_POSE_TAIL);
}

/**
 * Adapt a candidate to the cycle-driven host: pay what the oracle charges, then take the return
 * the caller's push bracket left on the stack. Both belong to the harness, not to the routine,
 * and the EXHAUSTIVE arm checks the total against the oracle over the whole crafted space.
 */
function hosted(candidate) {
  return (mm) => {
    const total = oracleTStates(mm);
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

let baseline = null;
function baselineRun() {
  if (baseline === null) {
    const m = makeMachine();
    const frames = m.runFrames(ENTRY_FRAMES);
    baseline = { frames, stoppedBy: m.stoppedBy, offToAddr: (o) => m.stateOffsetToAddr(o) };
  }
  return baseline;
}

/** A whole driven session with the candidate wired in, diffed per frame against the baseline. */
function substitution(candidate) {
  const base = baselineRun();
  let fired = 0;
  const sub = makeMachine(new Map([[TARGET, (mm) => {
    fired++;
    return hosted(candidate)(mm);
  }]]));
  const subFrames = sub.runFrames(ENTRY_FRAMES);
  const top = drivenSession().lowSp;
  const lastAt = new Map();
  const n = Math.min(base.frames.length, subFrames.length);
  for (let f = 0; f < n; f++) {
    const x = base.frames[f];
    const y = subFrames[f];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) lastAt.set(base.offToAddr(o), f);
  }
  const outside = [...lastAt.entries()].filter(
    ([addr]) => addr < u16(top - SCRATCH_BYTES) || addr >= top,
  );
  return {
    fired,
    frames: n,
    stoppedBy: sub.stoppedBy,
    touched: lastAt.size,
    outside: outside.map(([addr]) => addr).sort((p, q) => p - q),
    lastOutside: Math.max(-1, ...outside.map(([, f]) => f)),
    lastAny: Math.max(-1, ...[...lastAt.values()]),
  };
}

// ── the contract ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: spriteForHeading matches the oracle at the real dispatch", { skip }, () => {
  const r = gate(rewrite);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const top = entryState().regs.sp;
  assert.notEqual(r.ram, null, "the oracle's scratch write vanished — re-derive this whole file");
  assert.ok(
    r.ram.addr >= u16(top - SCRATCH_BYTES) && r.ram.addr < top,
    `RAM diverged OUTSIDE the scratch window, at ${hex4(r.ram.addr)} — that is the routine ` +
      "writing memory, not the known cost of wiring a stackless rewrite into a stacked engine",
  );
  const d = atEntry(rewrite);
  assert.equal(d, null, `the real entry diverged — ${show(d)}`);
  console.log(
    `  CONTRACT: entered within ${ENTRY_FRAMES} frames at record ${hex4(entryState().regs.ix)}; ` +
      `RAM identical outside ${hex4(u16(top - SCRATCH_BYTES))}..${hex4(top - 1)}, pair identical`,
  );
});

test("BLIND: the RAM verdict says the same thing about an empty body", { skip }, () => {
  const real = gate(rewrite);
  const empty = gate(() => {});
  assert.deepEqual(
    empty.ram,
    real.ram,
    "an empty body was expected to produce the IDENTICAL RAM verdict — if it no longer does, " +
      "RAM has become a real gate here and every claim in this file must be re-derived",
  );
  const d = atEntry(() => {});
  assert.notEqual(d, null, "the live-out comparison must catch what the RAM verdict cannot");
  console.log(`  BLIND: an empty body gives the same RAM verdict; the pair catches it — ${show(d)}`);
});

test("EXCLUDED, deliberately: the dropped registers, pc, and two scratch bytes", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  const top = a.regs.sp;
  oracle(a);
  rewrite(b);

  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  for (const k of LIVE_OUT) assert.equal(a.regs[k], b.regs[k], `the live-out ${k} moved`);

  const diffs = ramDiffs(a, b, top);
  assert.ok(diffs.length > 0, "the scratch write vanished, so this test measures nothing");
  assert.deepEqual(diffs.filter((d) => !d.scratch), [], "RAM moved outside the scratch window");
  console.log(
    `  EXCLUDED: registers ${moved.join(", ")} and pc; RAM differs only at ` +
      `${diffs.map((d) => d.where).join(", ")}, below the entry stack pointer ${hex4(top)}`,
  );
});

test("DEGENERATE: half the twins are invisible at the captured entry", { skip }, () => {
  const e = entryState();
  const heading = e.mem8[u16(e.regs.ix + HEADING)];
  const survivors = TWINS.filter(([, twin]) => atEntry(twin) === null).map(([label]) => label);
  assert.deepEqual(
    survivors,
    ["floor-not-nearest", "past-the-end", "alternate-pose-always", "fixed-slot"],
    "the captured entry's blind spot changed shape — the four twins it cannot see are what " +
      "makes the crafted sweep the load-bearing arm, so a change here re-plans this file",
  );
  for (const label of survivors) {
    assert.ok(caughtInPlay(label) > 0, `${label} is invisible in play too, not merely at entry`);
  }
  console.log(
    `  DEGENERATE: heading ${heading}, counter ${e.mem8[FRAME_TICK]}, record ` +
      `${hex4(e.regs.ix)} — ${survivors.join(", ")} all survive it, and all are caught in play`,
  );
});

// ── real traffic ────────────────────────────────────────────────────────────────────────────

test("SESSION: every dispatch of a whole driven session, and the run COMPLETED", { skip }, () => {
  const s = drivenSession();
  assert.equal(s.stoppedBy, null, `the session stopped early: ${s.stoppedBy}`);
  assert.equal(s.frames, ENTRY_FRAMES, "a truncated run finds no divergence and reads as a pass");
  assert.ok(s.dispatches > 0, "vacuous: the session never dispatched the routine");
  assert.equal(caughtInPlay("spriteForHeading"), 0, "the rewrite diverged on a real dispatch");
  assert.ok(s.records.length > 1, "one record only — the fixed-slot twin would be untestable");
  console.log(
    `  SESSION: ${s.dispatches} dispatches over ${s.frames} frames, ${s.inputs} distinct ` +
      `inputs across ${s.records.length} records — every one identical on the pair`,
  );
});

test("WINDOW: the excluded scratch is MEASURED at every dispatch, not assumed", { skip }, () => {
  const s = drivenSession();
  assert.ok(s.dispatches > 0, "vacuous: the session never dispatched the routine");
  assert.equal(s.rewrote, 0, `the rewrite wrote ${s.rewrote} bytes of memory across the session`);
  assert.equal(
    s.escaped,
    0,
    `${s.escaped} byte(s) landed outside the ${SCRATCH_BYTES} below the stack pointer of the ` +
      "dispatch that wrote them — that is an escape, and widening the window would hide it",
  );
  assert.equal(s.deepest, SCRATCH_BYTES, "the scratch depth is not what the exclusion claims");
  assert.equal(
    s.lowSp,
    s.highSp,
    "the stack pointer now varies across dispatches, so the one-sample hole this file states " +
      "is out of date and the window must be re-measured against the deeper end",
  );
  console.log(
    `  WINDOW: every dispatch arrives at ${hex4(s.lowSp)}; every written byte within ` +
      `${s.deepest} of it; the rewrite wrote nothing. HOLE: one depth, so one sample`,
  );
});

// ── the crafted space ───────────────────────────────────────────────────────────────────────

test("EXHAUSTIVE: every record, every heading, both animation halves", { skip }, () => {
  const r = sweep(rewrite);
  assert.deepEqual(r.strayed, [], `RAM moved outside the scratch window — ${show(r.strayed[0])}`);
  assert.equal(r.caught, 0, `${r.caught} of ${spaceSize()} crafted inputs diverged`);
  assert.equal(r.mistimed, 0, `the shim's T-state total is wrong on ${r.mistimed} inputs`);
  console.log(`  EXHAUSTIVE: ${spaceSize()} crafted inputs identical, shim total included`);
});

test("COUNTER: exactly one bit of the counter decides the animation half", { skip }, () => {
  const a = entryState().clone();
  const sp = a.regs.sp;
  const pc = a.pc;
  const cycles = a.cycles;
  const stepped = [];
  for (let counter = 0; counter < STEPS_PER_TURN; counter++) {
    for (let sector = 0; sector < SECTORS; sector++) {
      a.regs.sp = sp;
      a.pc = pc;
      a.cycles = cycles;
      a.mem8[u16(a.regs.ix + HEADING)] = sector * STEPS_PER_SECTOR;
      a.mem8[FRAME_TICK] = counter;
      oracle(a);
      const far = a.regs.b === shapeAt(sector) + ALTERNATE_POSE_SHAPE_STEP;
      assert.ok(far || a.regs.b === shapeAt(sector), `counter ${counter}: neither half was chosen`);
      if (far && sector === 0) stepped.push(counter);
    }
  }
  assert.deepEqual(
    stepped,
    [...Array(STEPS_PER_TURN).keys()].filter((c) => (c & ALTERNATE_POSE_BIT) !== 0),
    "the counter values that step the shape on are no longer exactly the ones with that bit set",
  );
  console.log(`  COUNTER: ${stepped.length} of ${STEPS_PER_TURN} values step the shape on`);
});

test("ANTIPODE: reading the wrong record always shows, and the DATA says why", { skip }, () => {
  const same = [];
  for (let sector = 0; sector < SECTORS; sector++) {
    if (!pairDiffers(sector, (sector + SECTORS / 2) % SECTORS)) same.push(sector);
  }
  assert.deepEqual(
    same,
    [],
    "some sector now looks identical to its antipode, so the fixed-slot twin's survivor set is " +
      "no longer just the captured record and its predicate below is a wrong theory",
  );
  console.log(`  ANTIPODE: all ${SECTORS} sectors differ from the sector half a turn away`);
});

test("SUBSTITUTION: the rewrite wired in leaves only the scratch, and it HEALS", { skip }, () => {
  const r = substitution(rewrite);
  assert.equal(r.stoppedBy, null, `the substituted run stopped early: ${r.stoppedBy}`);
  assert.equal(r.frames, ENTRY_FRAMES, "the substituted run did not complete");
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.outside.map(hex4), [], "the rewrite forked game memory");
  assert.equal(r.touched, SCRATCH_BYTES, "something other than the scratch bytes differed");
  assert.ok(
    r.lastAny < r.frames - 100,
    `the scratch difference was still present at frame ${r.lastAny} of ${r.frames} — it must ` +
      "heal and stay healed, or it is not scratch",
  );
  console.log(
    `  SUBSTITUTION: ${r.fired} dispatches over ${r.frames} frames; only the ${r.touched} ` +
      `scratch bytes ever differed, last at frame ${r.lastAny}`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────
// A gate that cannot fail is worthless. Each twin is a plausible way to get this routine wrong,
// each must be caught by the SAME comparison the real arm passes, and each must be caught on
// exactly the inputs its stated predicate names — a twin caught on the wrong SET is a gate
// agreeing with the wrong theory of why it failed.

const headingOf = (m) => m.mem8[u16(m.regs.ix + HEADING)];
const alternatePoseStep = (m) => ((m.mem8[FRAME_TICK] & ALTERNATE_POSE_BIT) !== 0 ? ALTERNATE_POSE_SHAPE_STEP : 0);

function deliver(m, sector, step) {
  m.regs.b = m.mem8[SHAPE_BY_SECTOR + sector] + step;
  m.regs.c = m.mem8[MIRROR_BY_SECTOR + sector];
}

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: truncates the heading to a sector instead of rounding it to the nearest. */
function brokenFloor(m) {
  deliver(m, Math.floor(headingOf(m) / STEPS_PER_SECTOR), alternatePoseStep(m));
}

/** BUG: rounds up without wrapping, so the last few headings read past the tables. */
function brokenPastEnd(m) {
  deliver(m, Math.floor((headingOf(m) + STEPS_PER_SECTOR / 2) / STEPS_PER_SECTOR), alternatePoseStep(m));
}

/** BUG: never steps the shape on, so every direction is frozen on its near shape. */
function brokenBasePoseAlways(m) {
  deliver(m, sectorOf(headingOf(m)), 0);
}

/** BUG: always steps the shape on, so every direction is frozen on its far shape. */
function brokenAlternatePoseAlways(m) {
  deliver(m, sectorOf(headingOf(m)), ALTERNATE_POSE_SHAPE_STEP);
}

/** BUG: reads the wrong bit of the counter, so the animation runs at twice the rate. */
function brokenWrongBit(m) {
  deliver(m, sectorOf(headingOf(m)), m.mem8[FRAME_TICK] & 1 ? ALTERNATE_POSE_SHAPE_STEP : 0);
}

/** BUG: hands back the two table entries the other way round. */
function brokenSwapped(m) {
  const sector = sectorOf(headingOf(m));
  m.regs.b = m.mem8[MIRROR_BY_SECTOR + sector] + alternatePoseStep(m);
  m.regs.c = m.mem8[SHAPE_BY_SECTOR + sector];
}

/** BUG: hard-codes the record the first captured dispatch happened to arrive on. */
function brokenFixedSlot(m) {
  const heading = m.mem8[u16(entryState().regs.ix + HEADING)];
  deliver(m, sectorOf(heading), alternatePoseStep(m));
}

const poisonShape = u8(POISON >> 8);
const poisonMirror = u8(POISON);
const flooredSector = (h) => Math.floor(h / STEPS_PER_SECTOR);
const unwrappedSector = (h) => Math.floor((h + STEPS_PER_SECTOR / 2) / STEPS_PER_SECTOR);
const isAlternatePose = (counter) => (counter & ALTERNATE_POSE_BIT) !== 0;

/**
 * Each twin with the predicate naming EXACTLY the crafted inputs it must be caught on. Every
 * predicate that depends on the tables reads them rather than restating what they hold, so a
 * table that changed would move the prediction with it instead of silently disagreeing.
 */
const TWINS = [
  ["no-op", brokenNoOp, (_r, h, c) =>
    poisonShape !== shapeAt(sectorOf(h)) + (isAlternatePose(c) ? ALTERNATE_POSE_SHAPE_STEP : 0) ||
    poisonMirror !== mirrorAt(sectorOf(h))],
  ["floor-not-nearest", brokenFloor, (_r, h) => pairDiffers(sectorOf(h), flooredSector(h))],
  ["past-the-end", brokenPastEnd, (_r, h) => pairDiffers(sectorOf(h), unwrappedSector(h))],
  ["base-pose-always", brokenBasePoseAlways, (_r, _h, c) => isAlternatePose(c)],
  ["alternate-pose-always", brokenAlternatePoseAlways, (_r, _h, c) => !isAlternatePose(c)],
  ["wrong-counter-bit", brokenWrongBit, (_r, _h, c) => ((c & 1) !== 0) !== isAlternatePose(c)],
  ["swapped-tables", brokenSwapped, (_r, h) => shapeAt(sectorOf(h)) !== mirrorAt(sectorOf(h))],
  ["fixed-slot", brokenFixedSlot, (record, h) =>
    record !== entryState().regs.ix && pairDiffers(sectorOf(h), sectorOf(u8(h + HALF_TURN)))],
];

for (const [label, twin, pred] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT on exactly the inputs it must be`, { skip }, () => {
    const want = predicted(pred);
    assert.ok(want > 0 && want <= spaceSize(), `the ${label} predicate must name a real set`);
    const r = sweep(twin);
    assert.equal(r.caught, want, `the ${label} twin was caught on ${r.caught}, predicted ${want}`);
    console.log(`  TEETH/${label}: caught on ${r.caught} of ${spaceSize()} crafted inputs`);
  });

  test(`TEETH: the ${label} twin is CAUGHT on real traffic`, { skip }, () => {
    const s = drivenSession();
    const hit = caughtInPlay(label);
    assert.ok(
      hit > 0,
      `the ${label} twin survived every dispatch a driven session presents — it is caught only ` +
        "by the crafted sweep, which the report must say",
    );
    console.log(`  TEETH/${label}: caught on ${hit} of ${s.dispatches} real dispatches`);
  });

  test(`TEETH: the ${label} twin FORKS the substituted session`, { skip }, () => {
    const r = substitution(twin);
    assert.equal(r.frames, ENTRY_FRAMES, "the substituted run did not complete");
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.ok(
      r.outside.length > 0,
      `the ${label} twin left game memory untouched over a whole driven session — the live-out ` +
        "declaration rests on this arm, so a twin it cannot see is a hole in that declaration",
    );
    console.log(
      `  TEETH/${label}: forked ${r.outside.length} game cells, first ${hex4(r.outside[0])}, ` +
        `last differing at frame ${r.lastOutside}`,
    );
  });
}

test("TEETH: the near and far half twins PARTITION every real dispatch", { skip }, () => {
  const s = drivenSession();
  assert.equal(
    caughtInPlay("base-pose-always") + caughtInPlay("alternate-pose-always"),
    s.dispatches,
    "exactly one of the two frozen-half twins must be wrong at every dispatch; if they now " +
      "overlap or leave a gap, the animation half is not a two-way choice",
  );
  console.log(
    `  TEETH: ${caughtInPlay("base-pose-always")} + ${caughtInPlay("alternate-pose-always")} = ` +
      `${s.dispatches} dispatches, no overlap and no gap`,
  );
});
