// SPDX-License-Identifier: GPL-3.0-only
/**
 * petWatchdogThroughStartupDelayThenStartMachine — memory-equivalent to the frozen oracle at ROM 0x32EB, and KICK-equivalent to it.
 *
 * GATE: crafted-entry, with the ring drain SEVERED on both arms. What it exercises, holes stated:
 *
 *   1. ★ THE KICK COUNT IS THE POINT OF THIS FILE. The rewrite COLLAPSES a pure-delay spin: inside
 *      each of 12x256 ticks the ROM winds a register from zero back to zero, touching no cell, no
 *      port and no lasting flag, and this layer reproduces memory rather than time. What it must
 *      NOT collapse is the tick itself, because every tick writes 0xC200 and the count of those
 *      writes is real state the board acts on. `dumpState()` is colour, video, work and sprite RAM
 *      — it holds no io — so a RAM comparison passes a rewrite that kicks 13 times instead of 3073.
 *      That is measured below, not assumed: the fewer-ticks twin is caught HERE and by nothing else.
 *   2. WHY THE DRAIN, AND NOT 0x00A8, IS THE SEVER POINT. The two arms reach the foreground by
 *      different routes and that is deliberate: the oracle tail-calls 0x00A8 through the routine
 *      map, while the rewrite IMPORTS its successor directly, a rewrite-to-rewrite hand-off that
 *      owes no `ret`. Severing 0x00A8 would therefore stop the oracle one routine EARLIER than the
 *      candidate and compare two different amounts of work. Both routes converge on the drain:
 *      translated loc_00a8 jumps there through the map, where a recorder catches it, and the
 *      imported rewrite enters it by `yield*` into a direct import, which _spineSever.js catches at
 *      the drain's first act (reading its cursor) from inside the drain's own frame — so both arms
 *      are cut at the same place, after exactly the same work.
 *   2a. NO REGISTER CROSSES THE HAND-OVER, derived from the drain: it loads H, L and A before reading
 *      any of them, loads B and C from the ring before reading either, and seats DE before it
 *      dispatches. So the counter, pointer and accumulator the frozen side leaves behind are dead,
 *      the rewrite leaves them unset, and they are not compared. The interrupt-enable setting the
 *      frozen side carries in A is still compared — as the latch line it drives.
 *   3. ONLY STACK SCRATCH BELOW THE ENTRY SP IS EXCLUDED. The oracle pushes a return slot before
 *      its sound call where the rewrite's direct import pushes nothing, so the TWO bytes of that
 *      slot -- 0xAFFE and 0xAFFF, holding the pushed 0x3305 -- differ by construction. The window
 *      comes from the manifest, cut at the entry SP, not from a number typed here.
 *   4. TEETH — one twin per way the collapse could have been taken too far, each with the exact
 *      count of crafted entries it is caught on. This does NOT claim to catch every wrong
 *      collapse; it claims each listed twin is caught.
 *
 * HOLE: the routine never returns, so no arm here runs the foreground loop; the handover is
 * witnessed as "reached the drain once", not as anything the drain then does.
 * HOLE: the watchdog is modelled as a COUNT, so no arm can tell one kick from another — an
 * equal count is not proof the kicks fell at the same moments.
 * HOLE: the audio-attention line is pulsed high and back low, ending where it started, so no
 * end-state comparison can witness the pulse. Only the byte left in the sound latch is compared.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-32eb.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { petWatchdogThroughStartupDelayThenStartMachine } from "../petWatchdogThroughStartupDelayThenStartMachine.js";
import { loc_32eb as oracle } from "../../translated/loc_32eb.js";
import manifest from "../../manifest.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { SEQUENCE_DELAY, COMMAND_READ_CURSOR } from "../names.js";
import { Severed, severAtDirectCall } from "./_spineSever.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x32eb;
const DRAIN = 0x0b93;
const DRAIN_NAME = "runCommandRingDrainLoop";
const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;
const STACK_WINDOW = { lo: STACK_LO, hi: STACK_HI };

const EXPECTED_KICKS = 1 + 12 * 256 + 1;

const SOUND_SEED = 0x5a;

/** Boot reaches this routine long before any tape input; the capture only has to get past reset. */
const CORPUS_FRAMES = 64;
const CARRIED = [0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

let entry = null;
let witnessed = null;

function entryState() {
  if (entry === null) {
    class Reached extends Error {}
    const host = makeMachine(
      new Map([[TARGET, (mm) => {
        entry = mm.clone();
        witnessed = { value: mm.regs.a, kicks: mm.io.watchdogKicks };
        throw new Reached();
      }]]),
      {},
    );
    try {
      host.runFrames(CORPUS_FRAMES);
    } catch (e) {
      if (!(e instanceof Reached)) throw e;
    }
  }
  return entry;
}

/**
 * A clone whose ring drain is a recorder, installed identically on both arms.
 *
 * ★ PLAIN function, ITERABLE return, and it has to be both. The rewrite's successor reaches the
 * drain with `yield*`, which demands an iterable; the frozen oracle reaches it with a plain call
 * and would never drive a generator. A generator recorder would record on one arm and silently
 * record nothing on the other, making the arms incomparable exactly where they are compared.
 */
function severed(machine, log) {
  const c = machine.clone();
  const record = (mm) => log.push({ latch: mm.io.latch[0], kicks: mm.io.watchdogKicks });
  c.routines = new Map(c.routines);
  c.routines.set(DRAIN, (mm) => {
    record(mm);
    return { [Symbol.iterator]: function* () {} };
  });
  return severAtDirectCall(c, DRAIN_NAME, { reads: [COMMAND_READ_CURSOR] }, record);
}

const YIELD_BUDGET = 64;

function drive(fn, m, ...args) {
  try {
    const r = fn(m, ...args);
    if (!r || typeof r.next !== "function") return r;
    for (let i = 0; i <= YIELD_BUDGET; i++) {
      const step = r.next();
      if (step.done) return step.value;
    }
  } catch (e) {
    if (e instanceof Severed) return undefined;
    throw e;
  }
  throw new Error(`still yielding after ${YIELD_BUDGET} resumptions; the oracle returned`);
}

/** Stack scratch below the entry SP `floor` is dead; every cell from the floor up is compared. */
const deadStack = (floor) => deadStackBelow(STACK_WINDOW, floor);

/** The real contract: RAM minus stack scratch below the entry SP, the whole LS259, the KICK COUNT, the untouched
 *  registers, and the handover. */
function unitDiff(candidate, machine, carried) {
  const logA = [];
  const logB = [];
  const a = severed(machine, logA);
  const b = severed(machine, logB);
  a.io.soundData = SOUND_SEED;
  b.io.soundData = SOUND_SEED;
  if (carried !== undefined) {
    a.regs.a = carried;
    b.regs.a = carried;
  }
  drive(oracle, a);
  try {
    drive(candidate, b);
  } catch (e) {
    return { addr: null, a: "completed", b: String(e).slice(0, 60) };
  }

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off),
    deadStack(machine.regs.sp));
  if (ram) return ram;

  for (let i = 0; i < a.io.latch.length; i++) {
    if (a.io.latch[i] !== b.io.latch[i]) return { addr: null, a: `latch[${i}]=${a.io.latch[i]}`, b: b.io.latch[i] };
  }
  if (a.io.soundData !== b.io.soundData) {
    return { addr: null, a: `soundData=${a.io.soundData}`, b: `soundData=${b.io.soundData}` };
  }
  // The assertion the state dump cannot make, and the reason this file exists.
  if (a.io.watchdogKicks !== b.io.watchdogKicks) {
    return { addr: null, a: `${a.io.watchdogKicks} kicks`, b: `${b.io.watchdogKicks} kicks` };
  }
  // Neither side moves DE, IX, IY or the stack seat; the rest are dead at the hand-over (2a above).
  for (const k of ["de", "ix", "iy", "sp"]) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  if (logA.length !== logB.length) {
    return { addr: null, a: `${logA.length} handovers`, b: `${logB.length} handovers` };
  }
  for (const [i, x] of logA.entries()) {
    for (const k of ["latch", "kicks"]) {
      if (x[k] !== logB[i][k]) return { addr: null, a: `handover ${k}=${x[k]}`, b: `${logB[i][k]}` };
    }
  }
  return null;
}

/** How many of the crafted entries a twin is caught on. */
function sweepCaught(candidate) {
  let caught = 0;
  for (const value of CARRIED) if (unitDiff(candidate, entryState(), value)) caught++;
  return caught;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const WATCHDOG = 0xc200;
const STORE = 10;

function brokenFewerTicks(m, value = m.regs.a) {
  const { regs, mem, mem8 } = m;
  mem.write8(WATCHDOG, value, STORE);
  regs.hl = SEQUENCE_DELAY;
  mem8[SEQUENCE_DELAY] = 0x0c;
  for (let pass = 0x0c; pass > 0; pass--) {
    mem.write8(WATCHDOG, value, STORE);
    mem8[SEQUENCE_DELAY] = pass - 1;
  }
  regs.bc = 0;
  regs.xor(regs.a);
  m.call(0x55f8);
  regs.a = mem.read8(0x4c87);
  return m.call(0x00a8);
}

/** BUG: drops the tick loop entirely — the delay is gone AND so are its kicks. */
function brokenNoTicks(m, value = m.regs.a) {
  const { regs, mem, mem8 } = m;
  mem.write8(WATCHDOG, value, STORE);
  regs.hl = SEQUENCE_DELAY;
  mem8[SEQUENCE_DELAY] = 0;
  regs.bc = 0;
  regs.xor(regs.a);
  m.call(0x55f8);
  regs.a = mem.read8(0x4c87);
  return m.call(0x00a8);
}

/** BUG: leaves the pass cell holding its start value instead of counting it down to zero. */
function brokenLeavesPassCell(m, value = m.regs.a) {
  const { regs, mem, mem8 } = m;
  mem.write8(WATCHDOG, value, STORE);
  regs.hl = SEQUENCE_DELAY;
  mem8[SEQUENCE_DELAY] = 0x0c;
  for (let pass = 0x0c; pass > 0; pass--) {
    for (let t = 0x100; t > 0; t--) mem.write8(WATCHDOG, value, STORE);
  }
  regs.bc = 0;
  regs.xor(regs.a);
  m.call(0x55f8);
  regs.a = mem.read8(0x4c87);
  return m.call(0x00a8);
}

/** BUG: never tells the audio processor to go quiet. */
function brokenNoSoundCommand(m, value = m.regs.a) {
  const { regs, mem, mem8 } = m;
  mem.write8(WATCHDOG, value, STORE);
  regs.hl = SEQUENCE_DELAY;
  mem8[SEQUENCE_DELAY] = 0x0c;
  for (let pass = 0x0c; pass > 0; pass--) {
    for (let t = 0x100; t > 0; t--) mem.write8(WATCHDOG, value, STORE);
    mem8[SEQUENCE_DELAY] = pass - 1;
  }
  regs.bc = 0;
  regs.xor(regs.a);
  regs.a = mem.read8(0x4c87);
  return m.call(0x00a8);
}

/** BUG: hands the successor a stale A instead of the interrupt-enable byte from ROM. */
function brokenWrongInterruptSource(m, value = m.regs.a) {
  const { regs, mem, mem8 } = m;
  mem.write8(WATCHDOG, value, STORE);
  regs.hl = SEQUENCE_DELAY;
  mem8[SEQUENCE_DELAY] = 0x0c;
  for (let pass = 0x0c; pass > 0; pass--) {
    for (let t = 0x100; t > 0; t--) mem.write8(WATCHDOG, value, STORE);
    mem8[SEQUENCE_DELAY] = pass - 1;
  }
  regs.bc = 0;
  regs.xor(regs.a);
  m.call(0x55f8);
  return m.call(0x00a8);
}

/** BUG: does all the work and then never hands over. */
function brokenNoHandover(m, value = m.regs.a) {
  const { regs, mem, mem8 } = m;
  mem.write8(WATCHDOG, value, STORE);
  regs.hl = SEQUENCE_DELAY;
  mem8[SEQUENCE_DELAY] = 0x0c;
  for (let pass = 0x0c; pass > 0; pass--) {
    for (let t = 0x100; t > 0; t--) mem.write8(WATCHDOG, value, STORE);
    mem8[SEQUENCE_DELAY] = pass - 1;
  }
  regs.bc = 0;
  regs.xor(regs.a);
  m.call(0x55f8);
  regs.a = mem.read8(0x4c87);
}

const ALL = CARRIED.length;
const TWINS = [
  ["fewer-ticks", brokenFewerTicks, ALL],
  ["no-ticks", brokenNoTicks, ALL],
  ["leaves-the-pass-cell", brokenLeavesPassCell, ALL],
  ["no-sound-command", brokenNoSoundCommand, ALL],
  ["wrong-interrupt-source", brokenWrongInterruptSource, ALL],
  ["no-handover", brokenNoHandover, ALL],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("WITNESSED: boot really does reach this routine", { skip }, () => {
  entryState();
  assert.ok(witnessed, "the entry was never dispatched in the corpus");
});

test("★ THE STATE DUMP IS BLIND: a rewrite that under-kicks passes a RAM comparison", { skip }, () => {
  const a = severed(entryState(), []);
  const b = severed(entryState(), []);
  drive(oracle, a);
  drive(brokenFewerTicks, b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off),
    deadStack(entryState().regs.sp));
  assert.ok(
    ram === null,
    "expected the fewer-ticks twin to be INVISIBLE to RAM; if this fails the gate below proves less than it claims",
  );
  assert.notEqual(a.io.watchdogKicks, b.io.watchdogKicks, "and yet the kick counts must differ");
});

test("EQUAL at the captured entry: RAM, latch, kicks, registers and handover", { skip }, () => {
  assert.equal(show(unitDiff(petWatchdogThroughStartupDelayThenStartMachine, entryState())), "identical");
});

test("the collapse keeps every kick the oracle makes", { skip }, () => {
  const a = severed(entryState(), []);
  const b = severed(entryState(), []);
  const before = a.io.watchdogKicks;
  drive(oracle, a);
  drive(petWatchdogThroughStartupDelayThenStartMachine, b);
  assert.equal(a.io.watchdogKicks - before, EXPECTED_KICKS, "the ORACLE's kick count moved");
  assert.equal(b.io.watchdogKicks - before, EXPECTED_KICKS, "the rewrite's kick count moved");
});

test("EXHAUSTIVE over the carried value: the byte in A reaches only the ignored watchdog data", { skip }, () => {
  for (const value of CARRIED) {
    assert.equal(show(unitDiff(petWatchdogThroughStartupDelayThenStartMachine, entryState(), value)), "identical", `carried 0x${value.toString(16)}`);
  }
});

for (const [name, twin, expected] of TWINS) {
  test(`TEETH: the ${name} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `${name}: caught on the wrong number of entries`);
  });
}
