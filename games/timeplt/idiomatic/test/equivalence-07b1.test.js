// SPDX-License-Identifier: GPL-3.0-only
/**
 * probeExpansionThenSettleControlLatch — memory-equivalent to the frozen oracle at ROM 0x07B1.
 *
 * ★ READ THIS FIRST: THE STATE DUMP CANNOT SEE WHAT THIS ROUTINE DOES. Every write it makes goes
 *   to a device — the watchdog and the control latch — and the dump carries colour, video, work
 *   and sprite RAM and nothing else. A gate built out of `firstStateDiff` alone would pass a
 *   rewrite with the body deleted. That is not argued here, it is MEASURED: the LATCH arm runs a
 *   twin that leaves the picture switched off, shows the RAM dump byte-identical, and shows the
 *   device comparison catching it. Every arm below therefore compares the latch, the watchdog
 *   count and the unmapped-access counters alongside the dump.
 *
 * ★ THE CLEARING WALK IS INVISIBLE AT POWER-ON. The latch comes up with every line already low,
 *   so writing zero over it changes nothing observable — a rewrite that skipped the walk would
 *   pass at the one real entry. Two arms exist for that: the TAP compares the ordered list of
 *   device writes, and PRESET drives the lines HIGH first so the clearing has something to undo.
 *
 * ★ IT IS A TRANSFER, NOT A CALL, and the rewrite makes it as a DIRECT call into the cold-start
 *   clear. The routine map cannot see that transfer, so both sides are stopped at it by different
 *   hands at the same place: the frozen side's jump through the map is caught by the map, and the
 *   rewrite's direct call is caught by _spineSever.js the moment the entered routine makes its first
 *   store (its first watchdog kick), before that store lands. The whole-machine arm stops the
 *   rewrite there too and hands the rest of the session to the frozen continuation.
 *
 * ★ THE ACCUMULATOR AND FLAGS ARE DEAD AT THE JUMP, derived from the continuation, so they sit in
 *   the ceiling: the continuation reads A only as the data of its watchdog kicks (the watchdog counts
 *   kicks and ignores the data), then clears A with an xor before anything else reads it; the flags
 *   are rewritten by that xor and nothing reads them first. The rewrite carries the socket answer and
 *   the picture setting in locals and leaves both registers as it found them.
 *
 * ★ ONE DISPATCH A SESSION, at power-on, from the reset vector. The crafted arms are where the
 *   coverage is; the corpus is a single point by nature and the REACH arm says so.
 *
 * What it exercises, holes stated:
 *   1. REACH — dispatch counts under both tapes, with the reset vector as the positive control.
 *   2. SEAM — the captured entry, both sides stopped AT the jump: the dump, the devices, the
 *      counters, the destination and every register outside the declared ceiling.
 *   3. LATCH — the arm described above, with its twin as the in-arm control.
 *   4. TAP — the ordered device writes, compared write for write, with a twin that drops the last
 *      address of the walk as the control that ORDER and LENGTH are really being read.
 *   5. PRESET — the same comparison from entries whose lines are already high.
 *   6. SOCKET — all 256 answers the expansion socket could give. Exactly one refuses, both sides
 *      refuse on it, and the other 255 run.
 *   7. SETTING — the image byte the picture line takes its level from, walked over all 256 values.
 *   8. REGISTERS — the entry register file scrambled, so the ceiling is measured and not guessed.
 *   9. TIME — the entry's own T-states, measured; one value, which the whole-machine arm charges.
 *  10. WHOLE-MACHINE — both tapes, the full frame budget, byte-identical with the rewrite wired.
 *  11. EXCLUDED — measured over the scrambles, with a control twin.
 *  12. TEETH — six twins with their catch counts.
 *  13. HARMLESS — the two stack-seat twins, caught nowhere (SP left the contract, runbook §4 Retiring
 *      SP), each shown to leave SP different from the oracle at the jump.
 *
 * HOLE: the walk's cursor and counter are in the ceiling, which is a statement that nothing
 * downstream reads them. No arm here reads the continuation to check that; what stands behind it
 * is the whole-machine replay, which runs the real session with them left unset and comes back
 * byte-identical, and the twins that show that replay able to go red.
 * HOLE: pc and the cycle count are not compared, the ordinary memory-equivalence drop.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-07b1.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { probeExpansionThenSettleControlLatch } from "../probeExpansionThenSettleControlLatch.js";
import { loc_07b1 as oracle } from "../../translated/loc_07b1.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff, wholeMachineEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { Severed, severAtDirectCall, recordHardwareWrites } from "./_spineSever.js";

const TARGET = 0x07b1;
const CONTINUATION = 0x0069;
/** The continuation as the rewrite reaches it (a direct call), and the store it makes first. */
const CONTINUATION_NAME = "clearWorkRamAndSpriteBanksThenColdInit";
const WATCHDOG = 0xc200;
/** The reset vector, which jumps here; the positive control for the REACH arm. */
const RESET_VECTOR = 0x0000;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const WHOLE_FRAMES = 1400;
const VALUES = 256;

const EXPANSION_SOCKET = 0x6000;
const EXPANSION_FITTED = 0x55;
const PICTURE_ENABLE = 0xc308;
const PICTURE_ENABLE_SETTING = 0x2d4b;
const STORE_BUS_CYCLE = 10;
const LATCH_LINES = 8;

/** Measured by the TIME arm. */
const OWN_TSTATES = 333;

/**
 * The ceiling on register divergence: the cursor and the counter the frozen walk leaves behind, and
 * the accumulator and flags the header derives dead at the jump. The rewrite counts its addresses in
 * a local, carries both values in locals, and leaves all five registers as it found them.
 * sp — the oracle seats the stack at 0xB000 (ld sp,0xb000 at 0x07B8) for its own layer's pushes. The
 * idiomatic layer lays no return words -- every routine is a direct call and the frame interrupt fires
 * as one (runbook §4, Retiring SP) -- so nothing it runs reads SP and the rewrite does not seat it.
 * What stands behind that is the whole-game gate (idiomatic.test.js), which asserts SP stays inert
 * across the whole idiomatic session. The WHOLE-MACHINE arm below hands the rest of a session to the
 * FROZEN continuation, whose pushes do read SP, so that hand-off seats the stack the frozen layer
 * expects (FROZEN_STACK_SEAT) -- a bridge in the test, not a duty of the rewrite.
 * A ceiling and not a demand — the EXCLUDED arm tests a subset, so a closer rewrite still passes.
 */
const MOVED = ["a", "f", "b", "h", "l", "sp"];
const FROZEN_STACK_SEAT = 0xb000;

const TAPES = [
  ["attract", { tape: [] }],
  ["coin-start", {}],
];

/** Line states to arrive with, so the clearing walk has something to undo. */
const LATCH_PATTERNS = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 1, 0, 1, 0, 1, 0],
  [0, 1, 0, 1, 0, 1, 0, 1],
  [1, 1, 0, 0, 0, 1, 1, 1],
];

/** Register files to arrive with; the first is the real one, the rest force the ceiling open. */
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

/** Answer the expansion socket with `value` and nothing else differently. */
function answerSocket(c, value) {
  const real = c.mem.read8.bind(c.mem);
  c.mem.read8 = (addr) => ((addr & 0xffff) === EXPANSION_SOCKET ? value : real(addr));
}

/** Give this clone its own copy of the image so one byte of it can be moved. */
function setPictureSetting(c, value) {
  c.mem.rom = Uint8Array.from(c.mem.rom);
  c.mem.rom[PICTURE_ENABLE_SETTING] = value;
}

function craft(setup) {
  const c = theEntry().clone();
  if (setup) setup(c);
  return c;
}

// ── the seam ────────────────────────────────────────────────────────────────────────────

function stopAtSeam(real, sink) {
  return {
    get(addr) {
      if (addr !== CONTINUATION) return real.get(addr);
      return (mm) => {
        sink.hits++;
        sink.addr = addr;
        sink.regs = Object.fromEntries(REG_FIELDS.map((k) => [k, mm.regs[k]]));
      };
    },
  };
}

/** Everything the state dump does NOT carry — which for this routine is the whole of its output. */
const deviceSignature = (c) =>
  `${[...c.io.latch].join(",")}|wd=${c.io.watchdogKicks}|snd=${c.io.soundData}` +
  `|ur=${c.mem.unmappedReads}|uw=${c.mem.unmappedWrites}`;

const traceOf = (log) => (log ?? []).map((w) => `${hex4(w.addr)}=${w.value}`).join(" ");

const snapshot = (mm) => Object.fromEntries(REG_FIELDS.map((k) => [k, mm.regs[k]]));

function runToSeam(entry, fn, { trace = false } = {}) {
  const c = entry.clone();
  if (entry.mem.rom !== c.mem.rom) c.mem.rom = entry.mem.rom;
  const patched = Object.getOwnPropertyDescriptor(entry.mem, "read8");
  if (patched) Object.defineProperty(c.mem, "read8", patched);
  const sink = { hits: 0, addr: null, regs: null };
  c.routines = stopAtSeam(entry.routines, sink);
  const log = trace ? recordHardwareWrites(c) : null;
  // The rewrite's direct call into the continuation, stopped before the continuation's first store.
  severAtDirectCall(c, CONTINUATION_NAME, { writes: [WATCHDOG] }, (mm) => {
    sink.hits++;
    sink.addr = CONTINUATION;
    sink.regs = snapshot(mm);
  });
  let threw = null;
  try {
    fn(c);
  } catch (e) {
    if (!(e instanceof Severed)) threw = String(e).slice(0, 60);
  }
  delete c.mem.read8;
  delete c.mem.write8;
  return { c, sink, threw, refused: threw !== null, writes: traceOf(log) };
}

function seamDiff(candidate, entry, opts) {
  const a = runToSeam(entry, oracle, opts);
  const b = runToSeam(entry, candidate, opts);
  // WHETHER it refuses, not the wording: the sentence is not machine state and the two sides are
  // entitled to explain themselves differently.
  if (a.refused !== b.refused) return `refused ${a.refused} vs ${b.refused}`;
  if (a.sink.hits !== b.sink.hits) return `reached the jump ${a.sink.hits} vs ${b.sink.hits} times`;
  if (a.sink.addr !== b.sink.addr) return `jumped to ${a.sink.addr} vs ${b.sink.addr}`;
  const d = firstStateDiff(a.c.dumpState(), b.c.dumpState(), (o) => a.c.stateOffsetToAddr(o));
  if (d) return `${hex4(d.addr ?? 0)}: frozen=${d.a} rewrite=${d.b}`;
  if (deviceSignature(a.c) !== deviceSignature(b.c)) {
    return `devices ${deviceSignature(a.c)} vs ${deviceSignature(b.c)}`;
  }
  if (a.writes !== b.writes) return `device writes [${a.writes}] vs [${b.writes}]`;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.sink.regs && a.sink.regs[k] !== b.sink.regs[k]) {
      return `${k}=${a.sink.regs[k]} vs ${b.sink.regs[k]} at the jump`;
    }
    if (a.c.regs[k] !== b.c.regs[k]) return `${k}=${a.c.regs[k]} vs ${b.c.regs[k]} after`;
  }
  return null;
}

const TRACED = { trace: true };

// ── the crafted sweeps ──────────────────────────────────────────────────────────────────

function sweepSocket(candidate) {
  let caught = 0;
  for (let v = 0; v < VALUES; v++) {
    const point = craft((c) => answerSocket(c, v));
    if (seamDiff(candidate, point, TRACED) !== null) caught++;
  }
  return caught;
}

function sweepSetting(candidate) {
  let caught = 0;
  for (let v = 0; v < VALUES; v++) {
    const point = craft((c) => setPictureSetting(c, v));
    if (seamDiff(candidate, point, TRACED) !== null) caught++;
  }
  return caught;
}

function sweepPreset(candidate) {
  let caught = 0;
  for (const pattern of LATCH_PATTERNS) {
    const point = craft((c) => c.io.latch.set(pattern));
    if (seamDiff(candidate, point, TRACED) !== null) caught++;
  }
  return caught;
}

function sweepScrambles(candidate) {
  let caught = 0;
  for (const regs of SCRAMBLES) {
    for (const pattern of LATCH_PATTERNS) {
      const point = craft((c) => {
        Object.assign(c.regs, regs);
        c.io.latch.set(pattern);
      });
      if (seamDiff(candidate, point, TRACED) !== null) caught++;
    }
  }
  return caught;
}

const SWEEP_RUNS = {
  socket: VALUES,
  setting: VALUES,
  preset: LATCH_PATTERNS.length,
  scrambles: SCRAMBLES.length * LATCH_PATTERNS.length,
};

// ── the hosted whole-machine replay ─────────────────────────────────────────────────────

/**
 * The rewrite hosted in the cycle-driven session: run it to the jump, stopping it before the
 * continuation's first store however it gets there (through the map, or by a direct call), charge
 * the entry's own time, and hand the rest of the session to the frozen continuation.
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
    // The frozen continuation pushes through SP; seat it as the oracle leaves it at the jump.
    mm.regs.sp = FROZEN_STACK_SEAT;
    mm.step(CONTINUATION, OWN_TSTATES);
    return mm.call(CONTINUATION);
  };
}

// ── broken twins ────────────────────────────────────────────────────────────────────────

const quiet = (m) => {
  m.mem.write8(0xc200, m.regs.a, STORE_BUS_CYCLE);
};
const clearLines = (m, count) => {
  for (let i = 0; i < count; i++) m.mem.write8(0xc300 + i, 0, 7);
};
const probeSocket = (m) => {
  m.regs.a = m.mem.read8(EXPANSION_SOCKET);
  m.regs.cp(EXPANSION_FITTED);
  if (m.regs.fZ) throw new Error("the expansion socket answered");
};

/** BUG: leaves the picture switched off — invisible to the RAM dump, which is the whole point. */
function brokenLeavesPictureOff(m) {
  probeSocket(m);
  m.regs.sp = 0xb000;
  quiet(m);
  clearLines(m, LATCH_LINES);
  m.regs.a = m.mem.read8(PICTURE_ENABLE_SETTING);
  return m.call(CONTINUATION);
}

/** BUG: walks seven addresses, which settles the same four lines and shows only in the tap. */
function brokenWalksSeven(m) {
  probeSocket(m);
  m.regs.sp = 0xb000;
  quiet(m);
  clearLines(m, LATCH_LINES - 1);
  m.regs.a = m.mem.read8(PICTURE_ENABLE_SETTING);
  m.mem.write8(PICTURE_ENABLE, m.regs.a, STORE_BUS_CYCLE);
  return m.call(CONTINUATION);
}

// The stack-seat twins are HARMLESS now: the stack seat left the contract with SP (see MOVED). A
// rewrite that leaves SP unseated is the correct one, SP staying inert across the idiomatic session is
// asserted by the whole-game gate, and the HARMLESS arm below pins them at caught-nowhere so the change
// of contract stays on record here.

/** Formerly a BUG, now HARMLESS: never seats the stack, so SP stays wherever the caller left it. */
function brokenNoStackSeat(m) {
  probeSocket(m);
  quiet(m);
  clearLines(m, LATCH_LINES);
  m.regs.a = m.mem.read8(PICTURE_ENABLE_SETTING);
  m.mem.write8(PICTURE_ENABLE, m.regs.a, STORE_BUS_CYCLE);
  return m.call(CONTINUATION);
}

/** Formerly a BUG, now HARMLESS: seats the stack one byte low. */
function brokenStackOffByOne(m) {
  probeSocket(m);
  quiet(m);
  clearLines(m, LATCH_LINES);
  m.regs.a = m.mem.read8(PICTURE_ENABLE_SETTING);
  m.mem.write8(PICTURE_ENABLE, m.regs.a, STORE_BUS_CYCLE);
  m.regs.sp = 0xafff;
  return m.call(CONTINUATION);
}

const HARMLESS = [
  ["no-stack-seat", brokenNoStackSeat],
  ["stack-off-by-one", brokenStackOffByOne],
];

/** BUG: never quiets the watchdog. */
function brokenNoWatchdog(m) {
  probeSocket(m);
  m.regs.sp = 0xb000;
  clearLines(m, LATCH_LINES);
  m.regs.a = m.mem.read8(PICTURE_ENABLE_SETTING);
  m.mem.write8(PICTURE_ENABLE, m.regs.a, STORE_BUS_CYCLE);
  return m.call(CONTINUATION);
}

/** BUG: writes the picture line as a literal instead of reading the level out of the image. */
function brokenLiteralPicture(m) {
  probeSocket(m);
  m.regs.sp = 0xb000;
  quiet(m);
  clearLines(m, LATCH_LINES);
  m.regs.a = m.mem.read8(PICTURE_ENABLE_SETTING);
  m.mem.write8(PICTURE_ENABLE, 1, STORE_BUS_CYCLE);
  return m.call(CONTINUATION);
}

/** BUG: never asks the expansion socket, so a fitted board is run over instead of deferred to. */
function brokenIgnoresSocket(m) {
  m.regs.a = m.mem.read8(EXPANSION_SOCKET);
  m.regs.cp(EXPANSION_FITTED);
  m.regs.sp = 0xb000;
  quiet(m);
  clearLines(m, LATCH_LINES);
  m.regs.a = m.mem.read8(PICTURE_ENABLE_SETTING);
  m.mem.write8(PICTURE_ENABLE, m.regs.a, STORE_BUS_CYCLE);
  return m.call(CONTINUATION);
}

/** BUG: does everything and then stops, so power-on never reaches the clearing routine. */
function brokenNeverHandsOn(m) {
  probeSocket(m);
  m.regs.sp = 0xb000;
  quiet(m);
  clearLines(m, LATCH_LINES);
  m.regs.a = m.mem.read8(PICTURE_ENABLE_SETTING);
  m.mem.write8(PICTURE_ENABLE, m.regs.a, STORE_BUS_CYCLE);
}

/** BUG: scribbles on an index register — the control for the EXCLUDED ceiling. */
function brokenMovesIndex(m) {
  m.regs.ix = (m.regs.ix + 1) & 0xffff;
  return probeExpansionThenSettleControlLatch(m);
}

const TWINS = [
  ["leaves-picture-off", brokenLeavesPictureOff],
  ["walks-seven", brokenWalksSeven],
  ["no-watchdog", brokenNoWatchdog],
  ["literal-picture", brokenLiteralPicture],
  ["ignores-socket", brokenIgnoresSocket],
  ["never-hands-on", brokenNeverHandsOn],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REACH: power-on really comes through here, with the vector as the positive control", { skip }, () => {
  const seen = {};
  for (const [label, opts] of TAPES) {
    const real = buildRoutines();
    const counts = { [TARGET]: 0, [RESET_VECTOR]: 0 };
    const overrides = new Map();
    for (const addr of [TARGET, RESET_VECTOR]) {
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
    assert.ok(seen[label][RESET_VECTOR] > 0, `the ${label} tap counted nothing for the vector ` +
      "either, so the instrument is broken and the count below means nothing");
    assert.ok(seen[label][TARGET] > 0, `vacuous: the ${label} tape never reached this entry`);
  }
  const shown = TAPES.map(([l]) => `${l} ${seen[l][TARGET]} (vector ${seen[l][RESET_VECTOR]})`);
  console.log(`  REACH: ${shown.join(", ")}`);
});

test("SEAM: the captured entry agrees at the jump", { skip }, () => {
  for (const [label, opts] of TAPES) {
    const entries = capture(label, opts);
    assert.notEqual(entries[0] ?? null, null, `vacuous: the ${label} tape never reached the routine`);
    for (const e of entries) {
      const d = seamDiff(probeExpansionThenSettleControlLatch, e, TRACED);
      assert.equal(d, null, `${label}: ${d}`);
    }
  }
  const one = runToSeam(theEntry(), probeExpansionThenSettleControlLatch, TRACED);
  console.log(`  SEAM: identical at the jump; the rewrite leaves ${deviceSignature(one.c)}`);
});

test("LATCH: the RAM dump cannot see this routine, and the device comparison can", { skip }, () => {
  const entry = theEntry();
  const good = runToSeam(entry, probeExpansionThenSettleControlLatch);
  const dark = runToSeam(entry, brokenLeavesPictureOff);
  const dumpsAgree = firstStateDiff(good.c.dumpState(), dark.c.dumpState()) === null;
  // The finding, not an aside: a twin that switches the picture off is INVISIBLE to the dump.
  assert.equal(dumpsAgree, true, "the twin that leaves the picture off now moves a RAM byte, so " +
    "the warning this arm exists to carry no longer describes the routine");
  assert.notEqual(deviceSignature(good.c), deviceSignature(dark.c),
    "the device comparison does not notice a twin that leaves the picture off, so every arm in " +
      "this gate is comparing nothing this routine writes");
  assert.equal(good.c.io.latch[4], 1, "the rewrite must leave the picture line high");
  assert.equal(dark.c.io.latch[4], 0, "the control twin must leave it low, or it is not a control");
  console.log(`  LATCH: the dump is identical either way; devices read ${deviceSignature(good.c)} ` +
    `against ${deviceSignature(dark.c)}`);
});

test("TAP: the ordered device writes agree, and a dropped write is seen", { skip }, () => {
  const entry = theEntry();
  const frozen = runToSeam(entry, oracle, TRACED);
  const rewrite = runToSeam(entry, probeExpansionThenSettleControlLatch, TRACED);
  const short = runToSeam(entry, brokenWalksSeven, TRACED);
  assert.equal(rewrite.writes, frozen.writes, "the ordered device writes parted company");
  // The seven-address twin settles the SAME four lines, so only the ordered tap can catch it.
  assert.equal(deviceSignature(short.c), deviceSignature(frozen.c),
    "the seven-address twin now shows in the device state, so it is no longer the control this " +
      "arm needs — find one the tap alone can catch");
  assert.notEqual(short.writes, frozen.writes, "the tap does not notice a dropped write, so the " +
    "write comparison in every arm above is decoration");
  console.log(`  TAP: ${frozen.writes.split(" ").length} writes, identical — [${frozen.writes}]`);
});

test("PRESET: entries whose lines are already high", { skip }, () => {
  assert.equal(sweepPreset(probeExpansionThenSettleControlLatch), 0, "a preset line pattern diverged");
  const high = craft((c) => c.io.latch.set([1, 1, 1, 1, 1, 1, 1, 1]));
  const after = runToSeam(high, probeExpansionThenSettleControlLatch);
  // The walk reaches four lines, not eight, and the ninth address is a fifth line: arriving with
  // everything high, the three lines above the picture one must still be high afterwards.
  assert.deepEqual([...after.c.io.latch], [0, 0, 0, 0, 1, 1, 1, 1],
    "arriving with every line high, the rewrite must clear the four the walk settles, set the " +
      "picture line, and leave the three above it standing");
  console.log(`  PRESET: ${SWEEP_RUNS.preset} line patterns identical, and all-high comes out ` +
    `${[...after.c.io.latch].join(",")}`);
});

test("SOCKET: all 256 answers the expansion socket could give", { skip }, () => {
  assert.equal(sweepSocket(probeExpansionThenSettleControlLatch), 0, "an expansion-socket answer diverged");
  let refused = 0;
  for (let v = 0; v < VALUES; v++) {
    const point = craft((c) => answerSocket(c, v));
    if (runToSeam(point, probeExpansionThenSettleControlLatch).threw !== null) refused++;
  }
  const fitted = craft((c) => answerSocket(c, EXPANSION_FITTED));
  assert.notEqual(runToSeam(fitted, probeExpansionThenSettleControlLatch).threw, null, "the rewrite ran on regardless when " +
    "the socket answered, so the refusal it is supposed to make is not there");
  assert.equal(refused, 1, "exactly one answer must refuse; anything else means the comparison " +
    "the routine makes has moved");
  console.log(`  SOCKET: ${SWEEP_RUNS.socket} answers identical, ${refused} of them refused`);
});

test("SETTING: the image byte the picture line follows, over all 256 values", { skip }, () => {
  assert.equal(sweepSetting(probeExpansionThenSettleControlLatch), 0, "a picture setting diverged");
  const levels = new Set();
  for (let v = 0; v < VALUES; v++) {
    const point = craft((c) => setPictureSetting(c, v));
    levels.add(`${v & 1}->${runToSeam(point, probeExpansionThenSettleControlLatch).c.io.latch[4]}`);
  }
  assert.deepEqual([...levels].sort(), ["0->0", "1->1"], "the picture line no longer follows the " +
    "low bit of the setting, so the sweep is not measuring what this arm says it is");
  console.log(`  SETTING: ${SWEEP_RUNS.setting} settings identical; the line follows the low bit`);
});

test("REGISTERS: scrambled entry register files", { skip }, () => {
  assert.equal(sweepScrambles(probeExpansionThenSettleControlLatch), 0, "a scrambled register file diverged");
  console.log(`  REGISTERS: ${SWEEP_RUNS.scrambles} register-and-line combinations identical`);
});

test("TIME: the entry's own T-states, measured", { skip }, () => {
  const costs = new Set();
  for (const pattern of LATCH_PATTERNS) {
    const c = craft((mm) => mm.io.latch.set(pattern));
    const sink = { hits: 0 };
    c.routines = stopAtSeam(c.routines, sink);
    const before = c.cycles;
    oracle(c);
    assert.equal(sink.hits, 1, "the frozen entry did not reach the jump exactly once");
    costs.add(c.cycles - before);
  }
  console.log(`  TIME: the frozen entry costs ${[...costs].join(", ")} T-states`);
  assert.deepEqual([...costs], [OWN_TSTATES], "the entry's own cost is no longer a single value, " +
    "so the constant the whole-machine arm charges back is wrong");
});

test("WHOLE-MACHINE: both tapes are byte-identical with the rewrite wired", { skip }, () => {
  for (const [label, opts] of TAPES) {
    const mk = (ov) => makeMachine(ov, opts);
    const w = wholeMachineEquivalence(mk, WHOLE_FRAMES, new Map([[TARGET, hosted(probeExpansionThenSettleControlLatch)]]));
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
    const a = runToSeam(point, oracle);
    const b = runToSeam(point, candidate);
    for (const k of REG_FIELDS) if (a.c.regs[k] !== b.c.regs[k]) moved.add(k);
  }
  return moved;
}

test("EXCLUDED: nothing outside the ceiling moves, with a control twin", { skip }, () => {
  const moved = movedOver(probeExpansionThenSettleControlLatch);
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
    const socket = sweepSocket(twin);
    const setting = sweepSetting(twin);
    const preset = sweepPreset(twin);
    const scrambles = sweepScrambles(twin);
    console.log(`  TEETH/${label}: caught on ${socket}/${SWEEP_RUNS.socket} socket answers, ` +
      `${setting}/${SWEEP_RUNS.setting} settings, ${preset}/${SWEEP_RUNS.preset} line patterns, ` +
      `${scrambles}/${SWEEP_RUNS.scrambles} scrambles`);
    assert.ok(socket + setting + preset + scrambles > 0, `every arm PASSED the ${label} twin`);
  });
}

for (const [label, twin] of HARMLESS) {
  test(`HARMLESS: the ${label} twin is caught nowhere (SP left the contract, runbook §4 Retiring SP)`, { skip }, () => {
    const caught = sweepSocket(twin) + sweepSetting(twin) + sweepPreset(twin) + sweepScrambles(twin);
    assert.equal(caught, 0, `the ${label} twin was caught on ${caught} runs, but SP is not in the contract`);
    // Not vacuous: from an entry whose SP is neither seat, the twin reaches the jump with another SP.
    const entry = craft((c) => { c.regs.sp = 0x8000; });
    const a = runToSeam(entry, oracle);
    const b = runToSeam(entry, twin);
    assert.ok(a.sink.regs && b.sink.regs, "a side never reached the jump");
    assert.notEqual(b.sink.regs.sp, a.sink.regs.sp, `the ${label} twin must leave SP different at the jump`);
    console.log(`  HARMLESS/${label}: caught on 0 runs; SP at the jump ${hex4(b.sink.regs.sp)} vs the oracle's ${hex4(a.sink.regs.sp)}`);
  });
}
