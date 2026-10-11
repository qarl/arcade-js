// SPDX-License-Identifier: GPL-3.0-only
/**
 * enqueueFixedCommandOnRing — memory-equivalent to the frozen oracle at ROM 0x0B46.
 *
 * GATE: strict unit-capture with ONE exclusion, a replayed corpus from three tapes, an exhaustive
 *   crafted sweep of the ring priors, a whole-run masked diff, and teeth. What it exercises, with
 *   the holes stated:
 *   1. EQUAL at the real dispatch — RAM identical, and the command pair the rewrite leaves behind
 *      identical too. AT THE CAPTURED ENTRY THE EXCLUSION OF 2 BUYS NOTHING: the pushed bytes
 *      happen to equal what was already below the stack pointer, so the raw comparison is
 *      identical as well, and the test asserts that rather than the coincidence of a dirty window.
 *   2. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, and it is load-bearing over a session rather
 *      than at that one dispatch. The oracle's callee brackets its work with a push/pop of the
 *      address pair, so the two popped bytes below the stack pointer can hold that pair; the
 *      rewrite models no stack. The window is exactly [SP-2, SP) and every arm PINS it — each
 *      walks the whole dump and asserts no divergence escapes it, so it cannot quietly widen.
 *   3. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and bounded by {a, f, sp} — a register outside
 *      that set fails, a rewrite that clobbers fewer of them does not. The command pair is NOT in
 *      that set: it is a live-out, see 7.
 *   4. UNIFORM CORPUS, AND THIS ONE REALLY IS UNIFORM. Every dispatch of all three tapes presents
 *      a FREE ring cell, one guard byte, and seventeen even cursors that never reach the last
 *      slot. So the DROP branch and the ring WRAP never happen on real data at this entry, and
 *      the test asserts those sets rather than merely reporting them.
 *   5. CORPUS — every dispatch of three sessions replayed, not a deduplicated sample.
 *   6. EXHAUSTIVE — all 256 cursors against four guard bytes, which is the only arm that reaches
 *      the drop branch, the ring wrap and the eight-bit wrap of the argument cell.
 *   7. THE COMMAND PAIR IS A LIVE-OUT, and that is MEASURED rather than argued. Two whole driven
 *      sessions are diffed frame by frame: with the pair written back, the only cells that ever
 *      differ are the two scratch bytes of 2; with the pair dropped, two further cells appear.
 *      That is why the rewrite writes the pair into the registers as well as passing it.
 *   8. WHOLE-MACHINE — the same masked diff over all three tapes, the rewrite wired through a shim.
 *      The shim pays the oracle's T-states and takes its return, because the host engine is
 *      cycle-driven and every path in arrives by a tail transfer; without it the stack creeps
 *      until an unrelated routine writes through a corrupted address. Test 9 checks the shim's
 *      total against the oracle over the crafted space instead of assuming it, and one twin below
 *      is the shim removed, which dies exactly that way.
 *   9. The shim's branch-dependent total, checked against the oracle.
 *  10. TEETH — eight twins at eight distinct behaviours, each declaring the EXACT arms that catch
 *      it. Two are invisible to every real dispatch and are caught only by the crafted sweep.
 * HOLE: the corpus presents ONE guard byte and seventeen cursors, identically on all three tapes,
 * so the real data discriminates almost nothing here — the crafted sweep is the load-bearing arm
 * and the per-twin catch counts say so explicitly.
 * HOLE: no tape drives this entry into a state where the ring is congested, so "the drop is
 * silent" is exercised only by crafted priors.
 * HOLE: every dispatch any of the three tapes produces sits in the FIRST era, which the corpus arm
 * asserts. This entry reads no era cell, so what it does cannot depend on one — but nothing here
 * speaks for the states a later era dispatches it in, because none was reached.
 * HOLE: THE WHOLE-RUN ARM IS BLIND TO THE APPEND'S GUARD AND CURSOR. The ignores-guard and
 * cursor-runs-on twins leave no more differing cells than the scratch window holds, so it is the
 * unit arms, not the whole-run one, that hold this entry to the append it transfers to. The
 * per-twin verdicts are measured and asserted individually rather than summarised, so a twin that
 * changes side fails loudly.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0b46.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { enqueueFixedCommandOnRing } from "../enqueueFixedCommandOnRing.js";
import { postCommand } from "../postCommand.js";
import { loc_0b46 as oracle } from "../../translated/loc_0b46.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { COMMAND_RING, ERA_INDEX } from "../names.js";

const TARGET = 0x0b46;

const RING_CELLS = 64;
const LAST_SLOT = RING_CELLS - 2;
const WRITE_CURSOR = 0xa9b2;

/** The pair this entry exists to choose. */
const COMMAND = 1;
const ARGUMENT = 31;

const SCRATCH_BYTES = 2;
const EXCLUDED = ["a", "f", "sp"];

const CORPUS_FRAMES = 2000;

/**
 * T-states: this entry's two instructions plus the whole of the append it transfers to, its
 * return included. The append is shorter when it drops the pair, so the total is a branch.
 */
const QUEUED_TSTATES = 140;
const DROPPED_TSTATES = 99;
const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const COIN = 0x01;
const START = 0x08;
const LEFT = 0x01;
const RIGHT = 0x02;
const UP = 0x04;
const DOWN = 0x08;
const FIRE = 0x10;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/**
 * ★ THE SHARED TAPE PRESSES ONLY COIN 1 AND 1 PLAYER START. IT NEVER FIRES AND NEVER STEERS, so
 * a second tape walks the stick round the compass with the trigger held, and a third runs the
 * undriven attract demo. For THIS entry all three turn out to present the same seventeen inputs,
 * which is a finding the corpus arm asserts rather than a coverage claim.
 */
function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: COIN, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: START, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: FIRE, dur: CORPUS_FRAMES },
  ];
  const compass = [
    LEFT, LEFT | UP, UP, UP | RIGHT, RIGHT, RIGHT | DOWN,
    DOWN, DOWN | LEFT, LEFT, UP, RIGHT, DOWN,
  ];
  let frame = TURN_FIRST_FRAME;
  for (const bits of compass) {
    tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const TAPES = [
  ["shared", {}],
  ["turning", { tape: turnTape() }],
  ["attract", { tape: [] }],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { shared: 103, turning: 103, attract: 257 };

/** The cursors real play presents at this entry, on every tape. Measured, and asserted as a set. */
const REAL_CURSORS = [0, 4, 8, 10, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60];

// ── the entry, and the masked comparison ────────────────────────────────────────────────

let entry = null;

/** The required contract call, with the entry state harvested off the candidate arm's clone. */
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
  if (entry === null) gate(enqueueFixedCommandOnRing);
  return entry;
}

/** The window the callee's scratch push dirties: the bytes just below the entry stack pointer. */
function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/** Every differing byte of two dumps, as {addr, a, b} — the scratch window included. */
function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** Oracle vs candidate on clones of one machine: masked RAM first, then the command pair. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (a.regs.d !== b.regs.d) return { addr: null, a: a.regs.d, b: b.regs.d };
  if (a.regs.e !== b.regs.e) return { addr: null, a: a.regs.e, b: b.regs.e };
  return null;
}

/** A real captured machine with the ring priors forced, which is the crafted-entry idiom. */
function craft(cursor, guard) {
  const m = entryState().clone();
  m.mem8[WRITE_CURSOR] = cursor;
  m.mem8[COMMAND_RING + cursor] = guard;
  return m;
}

const GUARDS = [0xff, 0x80, 0x7f, 0x00];
const CURSORS = Array.from({ length: 256 }, (_unused, c) => c);
const SWEEP_SIZE = GUARDS.length * CURSORS.length;

/** How many of the crafted cursor x guard comparisons a candidate gets wrong. */
function sweepCaught(candidate) {
  let caught = 0;
  for (const guard of GUARDS) {
    for (const cursor of CURSORS) if (unitDiff(candidate, craft(cursor, guard))) caught++;
  }
  return caught;
}

// ── replaying whole sessions, one dispatch at a time ────────────────────────────────────

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  let free = 0;
  const cursors = new Set();
  const guards = new Set();
  const incoming = new Set();
  const eras = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      const cursor = mm.mem8[WRITE_CURSOR];
      cursors.add(cursor);
      guards.add(mm.mem8[COMMAND_RING + cursor]);
      incoming.add(mm.regs.de);
      eras.add(mm.mem8[ERA_INDEX]); // read only to attribute the corpus to a game state
      if (mm.mem8[COMMAND_RING + cursor] & 0x80) free++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, free, cursors, guards, incoming, eras };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, enqueueFixedCommandOnRing) }));
  return sessionCache;
}

// ── the cycle shim, and the whole-run masked diff ───────────────────────────────────────

const oracleTStates = (m) =>
  (m.mem8[COMMAND_RING + m.mem8[WRITE_CURSOR]] & 0x80) === 0 ? DROPPED_TSTATES : QUEUED_TSTATES;

/** Adapt a candidate to the cycle-driven host: pay the oracle's total, then take the return. */
function hosted(candidate) {
  return (mm) => {
    const total = oracleTStates(mm);
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

const baselines = new Map();
function baselineFrames(key, opts) {
  if (!baselines.has(key)) {
    const base = makeMachine(undefined, opts);
    const frames = base.runFrames(CORPUS_FRAMES);
    baselines.set(key, { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o), stopped: base.stoppedBy });
  }
  return baselines.get(key);
}

/**
 * Every cell that EVER differs between an all-oracle run and a run with the candidate wired, over
 * a whole session. A first-difference helper cannot express "differs only inside the scratch
 * window", so this walks the lot and hands back the set.
 */
function wholeRunCells(candidate, key, opts) {
  const base = baselineFrames(key, opts);
  let fired = 0;
  const host = makeMachine(new Map([[TARGET, (mm) => (fired++, candidate(mm))]]), opts);
  let hostFrames = [];
  let threw = null;
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
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
  return {
    cells: [...cells].sort((a, b) => a - b),
    frames: n,
    fired,
    threw,
    stopped: base.stopped ?? host.stoppedBy ?? null,
  };
}

/** The scratch window as ADDRESSES, for the whole-run arms, taken from the real entry. */
const scratchWindow = () => {
  const sp = entryState().regs.sp;
  return Array.from({ length: SCRATCH_BYTES }, (_unused, i) => sp - SCRATCH_BYTES + i);
};

// ── the twins ───────────────────────────────────────────────────────────────────────────
// Eight ways to get a two-instruction entry wrong. The first five are about WHICH pair goes out,
// which is the whole of what this entry decides; the next two break the append it transfers to;
// the last drops the register copy, which no unit comparison can see.

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: the argument is one out, which is the smallest wrong pair there is. */
function brokenArgumentOffByOne(m) {
  m.regs.d = COMMAND;
  m.regs.e = ARGUMENT + 1;
  postCommand(m, COMMAND, ARGUMENT + 1);
}

/** BUG: the command selector is one out, so a different thing is asked for. */
function brokenCommandOffByOne(m) {
  m.regs.d = COMMAND + 1;
  m.regs.e = ARGUMENT;
  postCommand(m, COMMAND + 1, ARGUMENT);
}

/** BUG: the pair goes out the other way round, so the argument is read as the command. */
function brokenSwapsPair(m) {
  m.regs.d = ARGUMENT;
  m.regs.e = COMMAND;
  postCommand(m, ARGUMENT, COMMAND);
}

/** BUG: forwards whatever the caller was holding instead of overriding it. */
function brokenForwardsCallersPair(m) {
  postCommand(m);
}

/** BUG: posts unconditionally, so a pair overwrites an entry that has not been taken yet. */
function brokenIgnoresGuard(m) {
  const { mem8 } = m;
  m.regs.d = COMMAND;
  m.regs.e = ARGUMENT;
  const cursor = mem8[WRITE_CURSOR];
  mem8[COMMAND_RING + cursor] = COMMAND;
  mem8[COMMAND_RING + ((cursor + 1) & 0xff)] = ARGUMENT;
  mem8[WRITE_CURSOR] = (cursor + 2) % RING_CELLS;
}

/** BUG: lets the cursor run past the end of the ring instead of wrapping inside it. */
function brokenCursorRunsOn(m) {
  const { mem8 } = m;
  m.regs.d = COMMAND;
  m.regs.e = ARGUMENT;
  const cursor = mem8[WRITE_CURSOR];
  if ((mem8[COMMAND_RING + cursor] & 0x80) === 0) return;
  mem8[COMMAND_RING + cursor] = COMMAND;
  mem8[COMMAND_RING + ((cursor + 1) & 0xff)] = ARGUMENT;
  mem8[WRITE_CURSOR] = (cursor + 2) & 0xff;
}

/** BUG: queues the right pair and leaves the registers holding whatever the caller had. */
function brokenDropsThePair(m) {
  postCommand(m, COMMAND, ARGUMENT);
}

/**
 * Per twin: its exact catch count over the crafted sweep, its catch count in each session, and
 * whether the whole-run masked diff sees it. Every number is measured and asserted as an
 * equality, so a twin caught on the WRONG set fails as loudly as one not caught at all.
 */
const TWINS = [
  ["no-op", brokenNoOp, 1024, [103, 103, 257], true],
  ["argument-off-by-one", brokenArgumentOffByOne, 1024, [103, 103, 257], true],
  ["command-off-by-one", brokenCommandOffByOne, 1024, [103, 103, 257], true],
  ["swaps-pair", brokenSwapsPair, 1024, [103, 103, 257], true],
  ["forwards-callers-pair", brokenForwardsCallersPair, 1024, [103, 103, 257], true],
  ["ignores-guard", brokenIgnoresGuard, 512, [0, 0, 0], false],
  ["cursor-runs-on", brokenCursorRunsOn, 384, [0, 0, 0], false],
  ["drops-the-pair", brokenDropsThePair, 1024, [103, 103, 257], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: enqueueFixedCommandOnRing == oracle outside the scratch window", { skip }, () => {
  const r = gate(enqueueFixedCommandOnRing);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");

  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  enqueueFixedCommandOnRing(b);

  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the two-byte scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.d, b.regs.d, "the command byte left behind");
  assert.equal(a.regs.e, b.regs.e, "the argument byte left behind");

  // AT THIS ENTRY THE WINDOW IS EMPTY. The pushed pair happens to equal the bytes already sitting
  // below the stack pointer, so the raw unmasked comparison is identical too and the exclusion
  // buys nothing here. It is load-bearing over a session and in the crafted space, not at the
  // captured dispatch, and asserting the window is dirty here would be asserting a coincidence.
  assert.equal(r.ram, null, "the raw comparison found a divergence the masked one did not");
  const dirty = allDiffs(a, b).map((d) => d.addr);
  assert.equal(dirty.length, 0, "the scratch window is dirty at this entry after all");
  console.log(
    `  EQUAL: entry cursor=${entryState().mem8[WRITE_CURSOR]} sp=${hex4(sp)} holding ` +
      `${hex4(entryState().regs.de)}; identical, the scratch window included`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(
    d,
    null,
    "the masked diff passed a candidate that does nothing, so RAM is NOT this gate at the real " +
      "dispatch and the whole file must be re-derived",
  );
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell, not on the pair alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers, pc and the scratch push, and nothing outside", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  enqueueFixedCommandOnRing(b);

  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(
    moved.filter((k) => !EXCLUDED.includes(k)),
    [],
    "a register outside the declared excluded set diverged: only the accumulator, the flag byte " +
      "and the stack pointer may differ — the command pair is a live-out and the address pair " +
      "is push/pop balanced",
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.sp - b.regs.sp, SCRATCH_BYTES, "the oracle returns; the rewrite does not");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc, plus the two scratch bytes`);
});

test("UNIFORM CORPUS: one guard byte, seventeen cursors, the same on all three tapes", { skip }, () => {
  const seen = sessions();
  assert.equal(seen.length, TAPES.length, "vacuous: a session is missing from the corpus");
  for (const s of seen) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} tape never reached the routine`);
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.free, s.dispatches, `the ${s.label} tape found the ring congested somewhere`);
    assert.deepEqual([...s.guards], [0xff], `the ${s.label} tape presented a second guard byte`);
    assert.deepEqual(
      [...s.cursors].sort((x, y) => x - y),
      REAL_CURSORS,
      `the ${s.label} tape's cursor set moved, so the crafted sweep covers the wrong hole`,
    );
    assert.ok(!s.cursors.has(LAST_SLOT), "a real dispatch now reaches the wrapping slot");
  }
  const eras = new Set(seen.flatMap((s) => [...s.eras]));
  assert.deepEqual([...eras], [0], "the corpus now spans more than the first era, so the hole " +
    "this file records about which game states drive this entry has to be re-derived");
  const incoming = new Set(seen.flatMap((s) => [...s.incoming]));
  assert.ok(!incoming.has((COMMAND << 8) | ARGUMENT), "a caller now arrives already holding the " +
    "pair, so forwarding it would be invisible at every real dispatch");
  console.log(
    `  UNIFORM CORPUS: ${seen.map((s) => `${s.label} ${s.dispatches}`).join(", ")} dispatches, ` +
      `all with a free cell; cursors ${REAL_CURSORS.length}, guards 1, incoming pairs ` +
      `${[...incoming].map(hex4).join(",")}; era ${[...eras]}`,
  );
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches over three sessions, identical on each`);
});

test("EXHAUSTIVE: all 256 cursors against four guard bytes behave as the oracle", { skip }, () => {
  assert.equal(sweepCaught(enqueueFixedCommandOnRing), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} cursor x guard comparisons identical`);
});

test("EXHAUSTIVE: the shim charges exactly what the oracle charges", { skip }, () => {
  for (const guard of GUARDS) {
    for (const cursor of CURSORS) {
      const m = craft(cursor, guard);
      const predicted = oracleTStates(m);
      const before = m.cycles;
      oracle(m);
      assert.equal(m.cycles - before, predicted, `cursor ${cursor} guard ${guard}: shim total wrong`);
    }
  }
  console.log("  EXHAUSTIVE: the shim's T-state total matches the oracle on every prior");
});

test("THE PAIR IS A LIVE-OUT: dropping it disturbs cells that keeping it does not", { skip }, () => {
  const kept = wholeRunCells(hosted(enqueueFixedCommandOnRing), "shared", {});
  const dropped = wholeRunCells(hosted(brokenDropsThePair), "shared", {});
  assert.equal(kept.stopped, null, `a run stopped early (${kept.stopped})`);
  assert.ok(kept.fired > 0, "vacuous: the instrument never reached the routine");
  assert.deepEqual(kept.cells, scratchWindow(), "keeping the pair must disturb the scratch window " +
    "and nothing else");
  assert.ok(
    dropped.cells.length > kept.cells.length,
    "dropping the command pair left the whole session identical, so the pair is NOT a live-out " +
      "and the rewrite should stop writing it back",
  );
  console.log(
    `  LIVE-OUT: keeping the pair disturbs ${kept.cells.map(hex4).join(" ")}; dropping it ` +
      `disturbs ${dropped.cells.map(hex4).join(" ")}`,
  );
});

for (const [label, opts] of TAPES) {
  test(`WHOLE-MACHINE: the ${label} session differs only in the scratch window`, { skip }, () => {
    const r = wholeRunCells(hosted(enqueueFixedCommandOnRing), label, opts);
    assert.equal(r.threw, null, `the run threw: ${r.threw}`);
    assert.equal(r.stopped, null, `a run stopped early (${r.stopped})`);
    assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
    assert.ok(r.fired > 0, "vacuous: the override never dispatched");
    assert.deepEqual(r.cells, scratchWindow(), "a divergence escaped the scratch window");
    console.log(
      `  WHOLE-MACHINE/${label}: ${r.frames} frames, ${r.fired} dispatches, only ` +
        `${r.cells.map(hex4).join(" ")} differ`,
    );
  });
}

test("TEETH: removing the shim's return kills the run, so the shim is load-bearing", { skip }, () => {
  const r = wholeRunCells((mm) => enqueueFixedCommandOnRing(mm), "shared", {});
  assert.ok(
    r.threw !== null || r.stopped !== null,
    "the run COMPLETED without the shim, so the callers of this address no longer expect a " +
      "return and every whole-machine arm above should drop the shim rather than keep it",
  );
  console.log(`  TEETH/shim: the unshimmed rewrite dies — ${r.threw ?? r.stopped}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = TAPES.map(([, opts]) => replaySession(opts, twin));
    for (const [i, r] of counts.entries()) {
      assert.equal(r.dispatches, DISPATCHES[TAPES[i][0]], "the session's dispatch count moved");
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${TAPES[i][0]} catch count moved`);
    }
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
  });

  test(`TEETH: the whole-run masked diff sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(hosted(twin), "shared", {});
    const seen = r.threw !== null || r.cells.length > scratchWindow().length;
    assert.equal(seen, wholeRunSees, `the whole-run arm's verdict on the ${label} twin changed`);
    console.log(
      `  TEETH/${label}: whole-run ${seen ? "catches it" : "is BLIND, as recorded"} — ` +
        `${r.threw ?? r.cells.map(hex4).join(" ")}`,
    );
  });
}
