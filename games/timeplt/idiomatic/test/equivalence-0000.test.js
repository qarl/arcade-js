// SPDX-License-Identifier: GPL-3.0-only
/**
 * trampolineToProbeExpansionThenSettleControlLatch — memory-equivalent to the frozen oracle at ROM 0x0000.
 *
 * Three bytes, `jp 0x07B1`, at the address the processor starts from after a reset. It is the one
 * entry in this batch whose whole content is WHERE IT GOES.
 *
 * ★ THE REWRITE IMPORTS ITS DESTINATION INSTEAD OF DISPATCHING IT, which is the house rule for a
 *   callee that has been decompiled — and it has a consequence this gate has to work around: a
 *   recorder wired into the routine map catches the FROZEN path's transfer and cannot catch the
 *   rewrite's, because the rewrite never asks the map. So the two are compared at the NEXT seam
 *   both of them do reach, the jump out of the power-on routine at 0x0069, and this gate is
 *   therefore a gate on the PAIR. The power-on routine makes that jump as a direct call too, so the
 *   rewrite is stopped there by _spineSever.js, before the entered routine's first store. Two arms narrow that back down: CONTRIBUTION shows the frozen
 *   entry adds nothing of its own, and DESTINATION shows the rewrite really goes through the
 *   power-on routine, by the marks only that routine leaves.
 *
 * ★ IT IS A TRANSFER, NOT A CALL. The whole-machine arm stops the rewrite at the jump out, however
 *   it gets there, charges the pair's time, and hands the rest of the session to the frozen 0x0069.
 *
 * ★ THE ACCUMULATOR AND FLAGS ARE DEAD AT THE JUMP OUT, derived from 0x0069: it reads A only as the
 *   data of its watchdog kicks (ignored by the watchdog) and then clears it with an xor, which also
 *   rewrites the flags before anything reads them. So both sit in the ceiling.
 *
 * ★ THE STATE DUMP CANNOT SEE MOST OF WHAT THE PAIR DOES: past this entry, every write is to a
 *   device. So every comparison here reads the control latch, the watchdog count and the
 *   unmapped-access counters alongside the dump, and the DESTINATION arm's control twin is what
 *   shows that reading catching something.
 *
 * What it exercises, holes stated:
 *   1. REACH — dispatch counts under both tapes, with the destination as the positive control.
 *   2. CONTRIBUTION — the frozen entry, stopped AT its jump: nothing written, no register moved,
 *      one transfer, and it goes to 0x07B1. With a scribbling twin as the in-arm control.
 *   3. DESTINATION — the rewrite leaves the three marks only the power-on routine leaves, with a
 *      twin that goes straight to the continuation as the control that they are marks at all.
 *   4. SEAM — the captured entry and four crafted register files, both sides stopped at 0x0069.
 *   5. SOCKET — all 256 answers the expansion socket could give, carried through this entry.
 *   6. SETTING — the image byte the picture line follows, over all 256 values.
 *   7. TIME — this entry's own T-states and the pair's, measured separately at the two seams.
 *   8. WHOLE-MACHINE — both tapes, the full frame budget, byte-identical with the rewrite wired.
 *   9. EXCLUDED — measured, with a control twin.
 *  10. TEETH — six twins with their catch counts.
 *
 * HOLE: arms 4 to 6 cannot attribute a failure to this entry rather than to the power-on routine.
 * That is what the pairing costs, and the power-on routine has a gate of its own.
 * HOLE: pc and the cycle count are not compared, the ordinary memory-equivalence drop.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0000.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { trampolineToProbeExpansionThenSettleControlLatch } from "../trampolineToProbeExpansionThenSettleControlLatch.js";
import { loc_0000 as oracle } from "../../translated/loc_0000.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff, wholeMachineEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { Severed, severAtDirectCall, recordHardwareWrites } from "./_spineSever.js";

const TARGET = 0x0000;
/** Where the jump goes, and the positive control for the REACH arm. */
const DESTINATION = 0x07b1;
/** The next seam both paths reach: the jump out of the power-on routine. */
const CONTINUATION = 0x0069;
/** The continuation as the power-on rewrite reaches it (a direct call), and the store it makes first. */
const CONTINUATION_NAME = "clearWorkRamAndSpriteBank1ThenColdInit";
const WATCHDOG = 0xc200;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const WHOLE_FRAMES = 1400;
const VALUES = 256;

const EXPANSION_SOCKET = 0x6000;
const EXPANSION_FITTED = 0x55;
const PICTURE_ENABLE_SETTING = 0x2d4b;
const PICTURE_LINE = 4;
const STACK_SEAT = 0xb000;

/** Measured by the TIME arm: this entry alone, and this entry plus the routine it hands to. */
const OWN_TSTATES = 10;
const PAIR_TSTATES = 343;

/**
 * The ceiling on register divergence: the cursor and counter the frozen power-on walk leaves
 * behind, which the rewritten walk counts in a local instead, and the accumulator and flags the
 * header derives dead at the jump out. A ceiling and not a demand — the EXCLUDED arm tests a
 * subset, so a closer rewrite still passes.
 */
const MOVED = ["a", "f", "b", "h", "l", "sp"];
// sp: the oracle's power-on routine seats the stack at 0xB000 for its own layer's pushes; the
// idiomatic layer lays no return words (direct calls, the frame interrupt fired as one -- runbook §4,
// Retiring SP), so its power-on routine does not seat it and the whole-game gate asserts SP stays
// inert. The WHOLE-MACHINE hand-off to the FROZEN 0x0069 seats it for that frozen layer (a test
// bridge), and the stack seat is not one of the marks DESTINATION reads.

const TAPES = [
  ["attract", { tape: [] }],
  ["coin-start", {}],
];

const SCRAMBLES = [
  {},
  { a: 0x55, f: 0xff, b: 0x99, c: 0x33, d: 0x44, e: 0x66, h: 0x77, l: 0x88 },
  { a: 0xff, f: 0x00, b: 0x01, c: 0xfe, h: 0xc3, l: 0x08, sp: 0x1234, ix: 0x4321, iy: 0x8765 },
  { b: 0x00, h: 0x00, l: 0x00, sp: 0xffff, a_: 0x11, f_: 0x22, b_: 0x33, c_: 0x44 },
];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

function lean(mm) {
  mm.assets = {};
  mm.video = null;
  return mm;
}

// ── capture ─────────────────────────────────────────────────────────────────────────────

const captured = new Map();

function capture(label, opts) {
  if (captured.has(label)) return captured.get(label);
  const real = buildRoutines();
  const body = real.get(TARGET);
  const entries = [];
  const m = makeMachine(
    new Map([[TARGET, (mm, ...args) => {
      entries.push(lean(mm.clone()));
      return body(mm, ...args);
    }]]),
    opts,
  );
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the ${label} capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, `the ${label} capture run ran short`);
  captured.set(label, entries);
  return entries;
}

const theEntry = () => capture("coin-start", {})[0] ?? null;

// ── crafting an entry ───────────────────────────────────────────────────────────────────

function answerSocket(c, value) {
  const real = c.mem.read8.bind(c.mem);
  c.mem.read8 = (addr) => ((addr & 0xffff) === EXPANSION_SOCKET ? value : real(addr));
}

function setPictureSetting(c, value) {
  c.mem.rom = Uint8Array.from(c.mem.rom);
  c.mem.rom[PICTURE_ENABLE_SETTING] = value;
}

function craft(setup) {
  const c = theEntry().clone();
  if (setup) setup(c);
  return c;
}

// ── running to a seam ───────────────────────────────────────────────────────────────────

function stopAt(real, seam, sink) {
  return {
    get(addr) {
      if (addr !== seam) return real.get(addr);
      return (mm) => {
        sink.hits++;
        sink.addr = addr;
        sink.regs = Object.fromEntries(REG_FIELDS.map((k) => [k, mm.regs[k]]));
      };
    },
  };
}

const deviceSignature = (c) =>
  `${[...c.io.latch].join(",")}|wd=${c.io.watchdogKicks}|snd=${c.io.soundData}` +
  `|ur=${c.mem.unmappedReads}|uw=${c.mem.unmappedWrites}`;

function runTo(entry, fn, seam) {
  const c = entry.clone();
  c.mem.rom = entry.mem.rom;
  const patched = Object.getOwnPropertyDescriptor(entry.mem, "read8");
  if (patched) Object.defineProperty(c.mem, "read8", patched);
  const sink = { hits: 0, addr: null, regs: null };
  c.routines = stopAt(entry.routines, seam, sink);
  const log = recordHardwareWrites(c);
  if (seam === CONTINUATION) {
    // The power-on rewrite's direct call into the continuation, stopped before its first store.
    severAtDirectCall(c, CONTINUATION_NAME, { writes: [WATCHDOG] }, (mm) => {
      sink.hits++;
      sink.addr = CONTINUATION;
      sink.regs = Object.fromEntries(REG_FIELDS.map((k) => [k, mm.regs[k]]));
    });
  }
  let threw = null;
  try {
    fn(c);
  } catch (e) {
    if (!(e instanceof Severed)) threw = String(e).slice(0, 60);
  }
  delete c.mem.read8;
  delete c.mem.write8;
  const writes = log.map((w) => `${hex4(w.addr)}=${w.value}`).join(" ");
  return { c, sink, refused: threw !== null, writes };
}

function seamDiff(candidate, entry) {
  const a = runTo(entry, oracle, CONTINUATION);
  const b = runTo(entry, candidate, CONTINUATION);
  if (a.refused !== b.refused) return `refused ${a.refused} vs ${b.refused}`;
  if (a.sink.hits !== b.sink.hits) return `reached the seam ${a.sink.hits} vs ${b.sink.hits} times`;
  if (a.sink.addr !== b.sink.addr) return `went to ${a.sink.addr} vs ${b.sink.addr}`;
  const d = firstStateDiff(a.c.dumpState(), b.c.dumpState(), (o) => a.c.stateOffsetToAddr(o));
  if (d) return `${hex4(d.addr ?? 0)}: frozen=${d.a} rewrite=${d.b}`;
  if (deviceSignature(a.c) !== deviceSignature(b.c)) {
    return `devices ${deviceSignature(a.c)} vs ${deviceSignature(b.c)}`;
  }
  if (a.writes !== b.writes) return `device writes [${a.writes}] vs [${b.writes}]`;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.sink.regs && a.sink.regs[k] !== b.sink.regs[k]) {
      return `${k}=${a.sink.regs[k]} vs ${b.sink.regs[k]} at the seam`;
    }
    if (a.c.regs[k] !== b.c.regs[k]) return `${k}=${a.c.regs[k]} vs ${b.c.regs[k]} after`;
  }
  return null;
}

/** The three things only the power-on routine leaves behind, read off a finished run. */
const marks = (r, entry) => ({
  probed: r.c.mem.unmappedReads - entry.mem.unmappedReads,
  quieted: r.c.io.watchdogKicks - entry.io.watchdogKicks,
  picture: r.c.io.latch[PICTURE_LINE],
});

// ── the crafted sweeps ──────────────────────────────────────────────────────────────────

function sweepScrambles(candidate) {
  let caught = 0;
  for (const regs of SCRAMBLES) {
    if (seamDiff(candidate, craft((c) => Object.assign(c.regs, regs))) !== null) caught++;
  }
  return caught;
}

function sweepSocket(candidate) {
  let caught = 0;
  for (let v = 0; v < VALUES; v++) {
    if (seamDiff(candidate, craft((c) => answerSocket(c, v))) !== null) caught++;
  }
  return caught;
}

function sweepSetting(candidate) {
  let caught = 0;
  for (let v = 0; v < VALUES; v++) {
    if (seamDiff(candidate, craft((c) => setPictureSetting(c, v))) !== null) caught++;
  }
  return caught;
}

const SWEEP_RUNS = { scrambles: SCRAMBLES.length, socket: VALUES, setting: VALUES };

// ── the hosted whole-machine replay ─────────────────────────────────────────────────────

/**
 * The rewrite hosted in the cycle-driven session: run it to the jump out, stopping it before the
 * continuation's first store however it gets there (through the map, or by a direct call), charge
 * the pair's time, and hand the rest of the session to the frozen continuation.
 */
function hosted(candidate) {
  return (mm) => {
    const real = mm.routines;
    let reached = false;
    mm.routines = {
      get: (addr) =>
        addr === CONTINUATION
          ? () => {
              reached = true;
              throw new Severed(CONTINUATION_NAME);
            }
          : real.get(addr),
    };
    severAtDirectCall(mm, CONTINUATION_NAME, { writes: [WATCHDOG] }, () => {
      reached = true;
    });
    try {
      candidate(mm);
    } catch (e) {
      if (!(e instanceof Severed)) throw e;
    } finally {
      mm.routines = real;
      delete mm.mem.read8;
      delete mm.mem.write8;
    }
    if (!reached) return undefined;
    // The frozen continuation pushes through SP; seat it as the oracle leaves it at the jump out.
    mm.regs.sp = STACK_SEAT;
    mm.step(CONTINUATION, PAIR_TSTATES);
    return mm.call(CONTINUATION);
  };
}

// ── broken twins ────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — the tell that a gate is measuring an idle entry. */
function brokenNoOp() {}

/** BUG: skips the power-on routine and goes straight to the clearing routine. */
function brokenSkipsPowerOn(m) {
  return m.call(CONTINUATION);
}

/** BUG: seats the stack itself and skips the rest, which looks half-right and is not. */
function brokenSeatsAndSkips(m) {
  m.regs.sp = STACK_SEAT;
  return m.call(CONTINUATION);
}

/**
 * BUG: writes a work-RAM byte on the way past — this entry writes nothing.
 *
 * It reaches its destination through the routine map rather than by importing it, which is what
 * lets the CONTRIBUTION arm stop it AT the transfer. A twin that imported the destination would
 * run the whole power-on sequence and then boot the machine, which never comes back.
 */
function brokenScribbles(m) {
  m.mem.write8(0xa800, 0x5a);
  return m.call(DESTINATION);
}

/** BUG: quiets the watchdog on the way past — the control that the device tap can see one. */
function brokenKicksWatchdog(m) {
  m.mem.write8(0xc200, 0, 10);
  return trampolineToProbeExpansionThenSettleControlLatch(m);
}

/** BUG: goes to the power-on routine twice, so the second run sees an already-seated machine. */
function brokenGoesTwice(m) {
  m.call(DESTINATION);
  return trampolineToProbeExpansionThenSettleControlLatch(m);
}

/** BUG: scribbles on an index register — the control for the EXCLUDED ceiling. */
function brokenMovesIndex(m) {
  m.regs.ix = (m.regs.ix + 1) & 0xffff;
  return trampolineToProbeExpansionThenSettleControlLatch(m);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["skips-power-on", brokenSkipsPowerOn],
  ["seats-and-skips", brokenSeatsAndSkips],
  ["scribbles", brokenScribbles],
  ["kicks-watchdog", brokenKicksWatchdog],
  ["goes-twice", brokenGoesTwice],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REACH: the machine really starts here, with the destination as the control", { skip }, () => {
  const seen = {};
  for (const [label, opts] of TAPES) {
    const real = buildRoutines();
    const counts = { [TARGET]: 0, [DESTINATION]: 0 };
    const overrides = new Map();
    for (const addr of [TARGET, DESTINATION]) {
      const body = real.get(addr);
      overrides.set(addr, (mm, ...args) => {
        counts[addr]++;
        return body(mm, ...args);
      });
    }
    const m = makeMachine(overrides, opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} reach run stopped early: ${m.stoppedBy}`);
    seen[label] = counts;
  }
  for (const [label] of TAPES) {
    assert.ok(seen[label][DESTINATION] > 0, `the ${label} tap counted nothing for the destination ` +
      "either, so the instrument is broken and the count below means nothing");
    assert.ok(seen[label][TARGET] > 0, `vacuous: the ${label} tape never reached this entry`);
  }
  const shown = TAPES.map(([l]) => `${l} ${seen[l][TARGET]} (destination ${seen[l][DESTINATION]})`);
  console.log(`  REACH: ${shown.join(", ")}`);
});

test("CONTRIBUTION: the frozen entry adds nothing of its own", { skip }, () => {
  const entry = theEntry();
  const inert = (r) =>
    r.sink.hits === 1 &&
    r.sink.addr === DESTINATION &&
    r.writes === "" &&
    deviceSignature(r.c) === deviceSignature(entry) &&
    firstStateDiff(r.c.dumpState(), entry.dumpState()) === null &&
    REG_FIELDS.every((k) => r.c.regs[k] === entry.regs[k]);
  const frozen = runTo(entry, oracle, DESTINATION);
  const control = runTo(entry, brokenScribbles, DESTINATION);
  // The clean reading is evidence only because the same predicate REJECTS a twin that writes.
  assert.equal(inert(control), false, "the predicate calls a twin that writes a work-RAM byte " +
    "inert, so calling the frozen entry inert says nothing");
  assert.equal(inert(frozen), true, "the frozen entry is not a bare transfer after all");
  console.log(`  CONTRIBUTION: the frozen entry transfers once, to ${hex4(frozen.sink.addr)}, ` +
    "having written nothing and moved no register");
});

test("DESTINATION: the rewrite really goes through the power-on routine", { skip }, () => {
  const entry = theEntry();
  const frozen = marks(runTo(entry, oracle, CONTINUATION), entry);
  const rewrite = marks(runTo(entry, trampolineToProbeExpansionThenSettleControlLatch, CONTINUATION), entry);
  const skipped = marks(runTo(entry, brokenSkipsPowerOn, CONTINUATION), entry);
  assert.deepEqual(rewrite, frozen, "the rewrite's marks differ from the frozen path's");
  // Marks only if their absence shows: the twin that skips the routine must leave none of them.
  assert.notDeepEqual(skipped, frozen, "a twin that never enters the power-on routine leaves the " +
    "same marks, so these are not marks of it and this arm proves nothing");
  assert.equal(rewrite.probed, 1, "the socket must be asked exactly once");
  assert.equal(rewrite.quieted, 1, "the watchdog must be quieted exactly once");
  assert.equal(rewrite.picture, 1, "the picture line must be set");
  console.log(`  DESTINATION: rewrite ${JSON.stringify(rewrite)}; the skipping twin ` +
    `${JSON.stringify(skipped)}`);
});

test("SEAM: the captured entry and four register files agree at the jump out", { skip }, () => {
  for (const [label, opts] of TAPES) {
    const entries = capture(label, opts);
    assert.notEqual(entries[0] ?? null, null, `vacuous: the ${label} tape never reached the routine`);
    for (const e of entries) {
      const d = seamDiff(trampolineToProbeExpansionThenSettleControlLatch, e);
      assert.equal(d, null, `${label}: ${d}`);
    }
  }
  assert.equal(sweepScrambles(trampolineToProbeExpansionThenSettleControlLatch), 0, "a scrambled register file diverged");
  console.log(`  SEAM: the captured entry under both tapes and ${SWEEP_RUNS.scrambles} register ` +
    "files, identical at the jump out");
});

test("SOCKET: all 256 answers the expansion socket could give", { skip }, () => {
  assert.equal(sweepSocket(trampolineToProbeExpansionThenSettleControlLatch), 0, "an expansion-socket answer diverged");
  let refused = 0;
  for (let v = 0; v < VALUES; v++) {
    if (runTo(craft((c) => answerSocket(c, v)), trampolineToProbeExpansionThenSettleControlLatch, CONTINUATION).refused) refused++;
  }
  assert.equal(refused, 1, "exactly one answer must carry a refusal through this entry");
  const fitted = craft((c) => answerSocket(c, EXPANSION_FITTED));
  assert.equal(runTo(fitted, trampolineToProbeExpansionThenSettleControlLatch, CONTINUATION).refused, true,
    "the answer that refuses is not the one the comparison downstream is made against");
  console.log(`  SOCKET: ${SWEEP_RUNS.socket} answers identical, ${refused} of them refused`);
});

test("SETTING: the image byte the picture line follows, over all 256 values", { skip }, () => {
  assert.equal(sweepSetting(trampolineToProbeExpansionThenSettleControlLatch), 0, "a picture setting diverged");
  const levels = new Set();
  for (let v = 0; v < VALUES; v++) {
    const r = runTo(craft((c) => setPictureSetting(c, v)), trampolineToProbeExpansionThenSettleControlLatch, CONTINUATION);
    levels.add(`${v & 1}->${r.c.io.latch[PICTURE_LINE]}`);
  }
  assert.deepEqual([...levels].sort(), ["0->0", "1->1"], "the picture line no longer follows the " +
    "low bit of the setting, so this sweep is not measuring what it says it is");
  console.log(`  SETTING: ${SWEEP_RUNS.setting} settings identical; the line follows the low bit`);
});

test("TIME: this entry's own T-states and the pair's, measured at the two seams", { skip }, () => {
  const cost = (seam) => {
    const c = craft(null);
    const sink = { hits: 0 };
    c.routines = stopAt(c.routines, seam, sink);
    const before = c.cycles;
    oracle(c);
    assert.equal(sink.hits, 1, `the frozen path did not reach ${hex4(seam)} exactly once`);
    return c.cycles - before;
  };
  const own = cost(DESTINATION);
  const pair = cost(CONTINUATION);
  console.log(`  TIME: this entry costs ${own} T-states, the pair ${pair}`);
  assert.equal(own, OWN_TSTATES, "this entry's own cost moved");
  assert.equal(pair, PAIR_TSTATES, "the pair's cost moved, so the constant the whole-machine arm " +
    "charges back is wrong");
});

test("WHOLE-MACHINE: both tapes are byte-identical with the rewrite wired", { skip }, () => {
  for (const [label, opts] of TAPES) {
    const mk = (ov) => makeMachine(ov, opts);
    const w = wholeMachineEquivalence(mk, WHOLE_FRAMES, new Map([[TARGET, hosted(trampolineToProbeExpansionThenSettleControlLatch)]]));
    assert.ok(w.invocations.get(TARGET) > 0, `vacuous: the override never dispatched under ${label}`);
    assert.equal(w.framesCompared, WHOLE_FRAMES, `the ${label} replay ran short`);
    assert.equal(w.equal, true, `${label} forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
    console.log(`  WHOLE-MACHINE/${label}: ${w.framesCompared} frames, ` +
      `${w.invocations.get(TARGET)} dispatch, identical`);
  }
});

function movedOver(candidate) {
  const moved = new Set();
  for (const regs of SCRAMBLES) {
    const point = craft((c) => Object.assign(c.regs, regs));
    const a = runTo(point, oracle, CONTINUATION);
    const b = runTo(point, candidate, CONTINUATION);
    for (const k of REG_FIELDS) if (a.c.regs[k] !== b.c.regs[k]) moved.add(k);
  }
  return moved;
}

test("EXCLUDED: nothing outside the ceiling moves, with a control twin", { skip }, () => {
  const moved = movedOver(trampolineToProbeExpansionThenSettleControlLatch);
  const control = movedOver(brokenMovesIndex);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
    "the control twin scribbles on an index register and this measurement did not notice, so a " +
      "clean reading below is worth nothing");
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ") || "none"}` +
    ` — ceiling ${MOVED.join(", ")}; the control also moves ` +
    `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const scrambles = sweepScrambles(twin);
    const socket = sweepSocket(twin);
    const setting = sweepSetting(twin);
    console.log(`  TEETH/${label}: caught on ${scrambles}/${SWEEP_RUNS.scrambles} register files, ` +
      `${socket}/${SWEEP_RUNS.socket} socket answers, ${setting}/${SWEEP_RUNS.setting} settings`);
    assert.ok(scrambles + socket + setting > 0, `every arm PASSED the ${label} twin`);
  });
}
