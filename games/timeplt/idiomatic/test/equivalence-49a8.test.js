// SPDX-License-Identifier: GPL-3.0-only
/**
 * finishBootSelfTestAndColdStart — memory-equivalent to the frozen oracle at ROM 0x49A8. The routine tiles the character
 * plane and cold-starts, so both arms are run with the foreground loop (0x0b93) severed and compared
 * on RAM minus the stack scratch below the entry SP, the LS259 latch, the sound latch, the watchdog kicks and
 * the handover. Registers are not compared: the dissolved lattice leaves different register residue,
 * and the cold-start tail never returns, so no caller consumes one. The oracle reaches the loop
 * through the routine map and the rewrite by `yield*` into a direct import; _spineSever.js catches
 * the latter at the loop's first act (reading its cursor) from inside the loop's own frame, so both
 * are cut at the same hand-over. The accumulator is not part of it: the loop loads A before reading
 * it. TAMPERED runs the out-of-band frame service on an image whose checked block no longer adds up,
 * and shows the cold start still follows it on both sides. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-49a8.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { finishBootSelfTestAndColdStart as candidate } from "../finishBootSelfTestAndColdStart.js";
import { loc_49a8 as oracle } from "../../translated/loc_49a8.js";
import { tileCharPlaneWithBoxLattice } from "../tileCharPlaneWithBoxLattice.js";
import { enterVerticalBlankService } from "../enterVerticalBlankService.js";
import { petWatchdogThroughStartupDelayThenStartMachine } from "../petWatchdogThroughStartupDelayThenStartMachine.js";
import manifest from "../../manifest.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { COMMAND_READ_CURSOR } from "../names.js";
import { Severed, severAtDirectCall } from "./_spineSever.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x49a8;
const DRAIN = 0x0b93;
const DRAIN_NAME = "runCommandRingDrainLoop";
const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;
const STACK_WINDOW = { lo: STACK_LO, hi: STACK_HI };

const CONFIG_LOW3 = 0xa9c4;
const CONFIG_BIT = 0xa9c6;
const WATCHDOG = 0xc200;
const LS259_LINE = 0xc302;
const LS259_SOURCE = 0x0c3e;
const STORE = 10;
const CHECKSUM_BASE = 0x27de;
const CHECKSUM_SPAN = 0x100;
const CHECKSUM_TOTAL = 0xc5;

const CORPUS_FRAMES = 64;
const SOUND_SEED = 0x5a;
const EXPECTED_KICKS = 1 + (1 + 12 * 256 + 1);
const CONFIG_INPUTS = [0x00, 0x01, 0x0f, 0x33, 0x55, 0x96, 0xaa, 0xff];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? d.k : "identical");
/** Stack scratch below the entry SP `floor` is dead; every cell from the floor up is compared. */
const deadStack = (floor) => deadStackBelow(STACK_WINDOW, floor);

let entry = null;
function entryState() {
  if (entry === null) {
    class Reached extends Error {}
    const host = makeMachine(new Map([[TARGET, (mm) => {
      entry = mm.clone();
      throw new Reached();
    }]]), {});
    try {
      host.runFrames(CORPUS_FRAMES);
    } catch (e) {
      if (!(e instanceof Reached)) throw e;
    }
  }
  return entry;
}

// A clone whose foreground loop is a recorder, installed identically on both arms. It returns an
// iterable so the oracle's plain call and the rewrite's yield* both reach it and count once.
function severed(machine, log) {
  const c = machine.clone();
  if (machine.mem.rom !== c.mem.rom) c.mem.rom = machine.mem.rom;
  const record = (mm) => log.push({ kicks: mm.io.watchdogKicks });
  c.routines = new Map(c.routines);
  c.routines.set(DRAIN, (mm) => {
    record(mm);
    return { [Symbol.iterator]: function* () {} };
  });
  return severAtDirectCall(c, DRAIN_NAME, { reads: [COMMAND_READ_CURSOR] }, record);
}

function drive(fn, m) {
  try {
    const r = fn(m);
    if (!r || typeof r.next !== "function") return r;
    for (let i = 0; i <= 64; i++) {
      const step = r.next();
      if (step.done) return step.value;
    }
  } catch (e) {
    if (e instanceof Severed) return undefined;
    throw e;
  }
  throw new Error("still yielding after the budget; the oracle returned");
}

function craft(a) {
  const m = entryState().clone();
  m.regs.a = a;
  return m;
}

/** A captured entry whose checked block no longer adds up: one byte of its own image copy moved. */
function craftTampered(a, delta) {
  const m = craft(a);
  m.mem.rom = Uint8Array.from(m.mem.rom);
  m.mem.rom[CHECKSUM_BASE] = (m.mem.rom[CHECKSUM_BASE] + delta) & 0xff;
  return m;
}

// The real contract: RAM minus stack scratch below the entry SP, the whole LS259, the sound latch, the KICK COUNT and
// the handover. Registers are excluded for the reasons in the header.
function unitDiff(cand, machine) {
  const logA = [];
  const logB = [];
  const a = severed(machine, logA);
  const b = severed(machine, logB);
  a.io.soundData = SOUND_SEED;
  b.io.soundData = SOUND_SEED;
  drive(oracle, a);
  try {
    drive(cand, b);
  } catch (e) {
    return { k: "threw:" + String(e).slice(0, 40) };
  }
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off),
    deadStack(machine.regs.sp));
  if (ram) return { k: "ram@" + hex4(ram.addr) };
  for (let i = 0; i < a.io.latch.length; i++) {
    if (a.io.latch[i] !== b.io.latch[i]) return { k: "latch" + i };
  }
  if (a.io.soundData !== b.io.soundData) return { k: "sound" };
  if (a.io.watchdogKicks !== b.io.watchdogKicks) return { k: "kicks" };
  if (logA.length !== logB.length) return { k: "handovers" };
  for (const [i, x] of logA.entries()) {
    if (x.kicks !== logB[i].kicks) return { k: "handover" };
  }
  return null;
}

// The two config cells the oracle leaves, read off the frozen side, to prove the decode varies.
function decodePair(a) {
  const log = [];
  const m = severed(craft(a), log);
  drive(oracle, m);
  return (m.mem8[CONFIG_LOW3] << 4) | m.mem8[CONFIG_BIT];
}

function twin(opts) {
  return (m) => {
    const { regs, mem } = m;
    regs.rrca();
    const rolled = regs.a;
    regs.and(0x07);
    mem.write8(CONFIG_LOW3, opts.badLow3 ? (regs.a + 1) & 0x07 : regs.a);
    regs.a = rolled;
    regs.rrca();
    regs.rrca();
    regs.rrca();
    regs.and(0x01);
    mem.write8(CONFIG_BIT, regs.a);
    mem.write8(WATCHDOG, regs.a, STORE);
    regs.a = mem.read8(LS259_SOURCE);
    mem.write8(LS259_LINE, opts.badLs ? regs.a ^ 1 : regs.a, STORE);
    if (!opts.skipLattice) tileCharPlaneWithBoxLattice(m);
    let total = 0;
    for (let i = 0; i < CHECKSUM_SPAN; i++) total = (total + mem.read8((CHECKSUM_BASE + i) & 0xffff)) & 0xff;
    regs.a = (total - CHECKSUM_TOTAL) & 0xff;
    if (opts.derail) return enterVerticalBlankService(m);
    if (opts.skipStart) return undefined;
    return petWatchdogThroughStartupDelayThenStartMachine(m);
  };
}

const ALL = CONFIG_INPUTS.length;
const TWINS = [
  ["no-op", () => {}, ALL],
  ["skip-lattice", twin({ skipLattice: true }), ALL],
  ["wrong-config-low3", twin({ badLow3: true }), ALL],
  ["wrong-ls259", twin({ badLs: true }), ALL],
  ["no-cold-start", twin({ skipStart: true }), ALL],
  ["always-derail", twin({ derail: true }), ALL],
];

function sweepCaught(cand) {
  let caught = 0;
  for (const a of CONFIG_INPUTS) if (unitDiff(cand, craft(a))) caught++;
  return caught;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("WITNESSED: boot really does reach this routine", { skip }, () => {
  assert.notEqual(entryState(), null, "the entry was never dispatched in the corpus");
});

test("EQUAL at the captured entry: RAM, latch, sound, kicks and handover", { skip }, () => {
  assert.equal(show(unitDiff(candidate, entryState())), "identical");
});

test("EXHAUSTIVE over the config byte, and the decode really varies with it", { skip }, () => {
  const pairs = new Set();
  for (const a of CONFIG_INPUTS) {
    assert.equal(show(unitDiff(candidate, craft(a))), "identical", `carried ${hex4(a)}`);
    pairs.add(decodePair(a));
  }
  // ★ Vacuity guard: the config cells must take more than one value across the sweep, or the
  // arm would pass a rewrite that ignored the input byte entirely.
  assert.ok(pairs.size > 1, "the decode wrote the same cells for every input; the sweep is blind");
  console.log(`  EXHAUSTIVE: ${ALL} inputs identical, ${pairs.size} distinct config pairs`);
});

test("KICKS: the whole hold is spun, and the state dump cannot see it", { skip }, () => {
  const log = [];
  const a = severed(entryState(), log);
  const before = a.io.watchdogKicks;
  drive(oracle, a);
  assert.equal(a.io.watchdogKicks - before, EXPECTED_KICKS, "the oracle's kick count moved");
});

const TAMPER_DELTAS = [1, 0x80, 0xff];

test("TAMPERED: a checked block that does not add up runs the frame service, then cold-starts", { skip }, () => {
  let compared = 0;
  for (const delta of TAMPER_DELTAS) {
    for (const a of [CONFIG_INPUTS[0], CONFIG_INPUTS[5]]) {
      const point = craftTampered(a, delta);
      assert.equal(show(unitDiff(candidate, point)), "identical", `delta ${delta} carried ${hex4(a)}`);
      // Non-vacuity: the frozen side really does reach the hand-over on the tampered image.
      const log = [];
      drive(oracle, severed(point, log));
      assert.equal(log.length, 1, "the frozen side no longer cold-starts after the frame service");
      compared++;
    }
  }
  // Teeth: running the frame service and stopping there, never cold-starting, is caught on every
  // tampered point.
  let caught = 0;
  for (const delta of TAMPER_DELTAS) if (unitDiff(twin({ derail: true }), craftTampered(0, delta))) caught++;
  assert.equal(caught, TAMPER_DELTAS.length, "the derail-without-cold-start twin passed a tampered image");
  console.log(`  TAMPERED: ${compared} tampered entries identical; the stopping twin caught on ${caught}`);
});

for (const [name, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${name} twin is caught on an exact count of inputs`, { skip }, () => {
    assert.ok(expected > 0, `the ${name} twin is not caught at all`);
    assert.equal(sweepCaught(brokenTwin), expected, `${name}: caught on the wrong number of inputs`);
  });
}
