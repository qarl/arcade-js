// SPDX-License-Identifier: GPL-3.0-only
/**
 * seedGameConfigFromDipSwitches — memory-equivalent to the frozen oracle at ROM 0x52AA. The routine seeds the settings
 * block from the two switch banks and tail-jumps into the DIP-unpack chain, which cold-starts and
 * hands the machine to the foreground loop. The chain's generator-engine tail returns a COROUTINE rather than
 * dispatching through the registry, so a stub inside it no longer stops the rewrite; both arms are
 * run with the foreground loop (0x0B93) SEVERED to an empty coroutine, reached by the frozen side's
 * plain call and the rewrite's `yield*` alike, with `drive` iterating the rewrite to that handover.
 * What is compared there is RAM minus the stack scratch below the entry SP, the LS259 latch, the sound latch
 * and the watchdog kicks — the live-out. DSW inputs are crafted on the Io both sides read through.
 * Registers are not compared: the dissolved chain scrambles them and the cold-start tail never returns.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-52aa.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { seedGameConfigFromDipSwitches as candidate } from "../seedGameConfigFromDipSwitches.js";
import { loc_52aa as oracle } from "../../translated/loc_52aa.js";
import { unpackCoinage } from "../unpackCoinage.js";
import { unpackTheFirstThreeSwitchSettings } from "../unpackTheFirstThreeSwitchSettings.js";
import { COINAGE_SETTINGS, KILL_QUOTA } from "../names.js";
import manifest from "../../manifest.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { u8 } from "../../../../core/int.js";
import { COMMAND_READ_CURSOR } from "../names.js";
import { Severed, severAtDirectCall } from "./_spineSever.js";

const TARGET = 0x52aa;
const DRAIN = 0x0b93; // the foreground loop, severed so both arms stop at the same handover
const DRAIN_NAME = "runCommandRingDrainLoop";
const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;
const STACK_WINDOW = { lo: STACK_LO, hi: STACK_HI };

const BOOT_BYTE_A = 0x08c9;
const BOOT_BYTE_B = 0x0874;
const SEEDED_CELL = 0xa98d;
const SWITCH_BANK_0 = 0xc360;
const SWITCH_BANK_1 = 0xc200;
const LIVES_CELL = 0xa9c1;
const COIN_1_CELL = 0xa9c9;
const VALUES = 256;
const SOUND_SEED = 0x5a;
const EXPECTED_DISPATCHES = 1; // the routine is boot-time; it runs once

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? d.k : "identical");
/** Stack scratch below the entry SP `floor` is dead; every cell from the floor up is compared. */
const deadStack = (floor) => deadStackBelow(STACK_WINDOW, floor);

// ── the rig: capture the boot entry, sever the foreground, drive the coroutine ────────────

let entry = null;
let dispatches = 0;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      dispatches++;
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    const frames = m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
    assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  }
  return entry;
}

/** A clone with both switch banks set on the Io both sides read through. */
function craft(dsw0, dsw1) {
  const m = entryState().clone();
  m.mem.io.dsw0 = dsw0;
  m.mem.io.dsw1 = dsw1;
  return m;
}

/** A clone whose foreground loop is a recorder returning an empty iterable, reached by the frozen
 *  side's plain call and the rewrite's `yield*` alike. */
// The frozen side reaches the loop through the routine map; the rewritten spine enters it by `yield*`
// into a direct import, which _spineSever.js catches at the loop's first act (reading its cursor) from
// inside the loop's own frame. Both record the same hand-over. The accumulator is not part of it: the
// loop loads A from its cursor before anything reads it.
function severed(machine, log) {
  const c = machine.clone();
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
  throw new Error("still yielding after the budget; the tail returned");
}

/** The live-out at the severed handover: RAM minus stack scratch below the entry SP, the LS259, the sound latch, the
 *  watchdog kick count and the handover. */
function diff(cand, machine) {
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

/** One game-data cell after the frozen side runs to the severed handover, at a crafted switch pair. */
function cellAfterOracle(dsw0, dsw1, cell) {
  const log = [];
  const m = severed(craft(dsw0, dsw1), log);
  drive(oracle, m);
  return m.mem8[cell];
}

// ── broken twins: the rewrite with one deliberate defect each ────────────────────────────────

function twin({ fold = true, cpl1 = true, coinage = true, seedA = SEEDED_CELL, handoff = true }) {
  return (m) => {
    const { mem8, regs } = m;
    mem8[seedA] = mem8[BOOT_BYTE_A];
    mem8[KILL_QUOTA] = mem8[BOOT_BYTE_B];
    mem8[COINAGE_SETTINGS] = u8(~mem8[SWITCH_BANK_0]);
    if (coinage) unpackCoinage(m);
    const bank1 = cpl1 ? u8(~mem8[SWITCH_BANK_1]) : mem8[SWITCH_BANK_1];
    const lives = (bank1 & 0x03) + 3;
    regs.a = fold && lives === 6 ? 0xff : lives;
    regs.c = bank1;
    if (handoff) return unpackTheFirstThreeSwitchSettings(m);
    return undefined;
  };
}

const TWINS = [
  ["no-op", () => {}],
  ["no-fold", twin({ fold: false })],
  ["no-complement-bank1", twin({ cpl1: false })],
  ["skip-coinage", twin({ coinage: false })],
  ["wrong-seed-source", twin({ seedA: KILL_QUOTA })],
  ["skip-handoff", twin({ handoff: false })],
];

function sweepDsw1(cand) {
  let caught = 0;
  const base = entryState().mem.io.dsw0;
  for (let v = 0; v < VALUES; v++) if (diff(cand, craft(base, v))) caught++;
  return caught;
}

// ── the gate ─────────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: boot reaches the routine once under both tapes, and both replay", { skip }, () => {
  entryState();
  assert.equal(dispatches, EXPECTED_DISPATCHES, "the dispatch count moved");
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    let seen = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => {
      seen++;
      assert.equal(show(diff(candidate, mm)), "identical", `${label}: a real dispatch diverged`);
      return oracle(mm);
    }]]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    assert.equal(seen, EXPECTED_DISPATCHES, `${label} dispatch count moved`);
    console.log(`  DISPATCHED: ${label} — ${seen} dispatch, replayed identical`);
  }
});

test("EQUAL at the real dispatch: RAM, latch, sound, kicks and handover", { skip }, () => {
  assert.equal(show(diff(candidate, entryState())), "identical");
  console.log("  EQUAL: the boot entry replays identically to the severed handover");
});

test("DSW SWEEP: all 256 of each switch bank agree, and the sweep bites", { skip }, () => {
  const base0 = entryState().mem.io.dsw0;
  const base1 = entryState().mem.io.dsw1;
  for (let v = 0; v < VALUES; v++) {
    assert.equal(show(diff(candidate, craft(v, base1))), "identical", `dsw0=${v}`);
    assert.equal(show(diff(candidate, craft(base0, v))), "identical", `dsw1=${v}`);
  }
  // ★ vacuity: the coin cell must move with bank 0 and the lives cell with bank 1, or the sweep
  // never reaches the decisions these bytes drive and every equality above is decoration.
  const coins = new Set([0x00, 0x11, 0xff].map((v) => cellAfterOracle(v, base1, COIN_1_CELL)));
  const lives = new Set([0x00, 0x01, 0x03].map((v) => cellAfterOracle(base0, v, LIVES_CELL)));
  assert.ok(coins.size > 1, "the coin cell never moved across bank 0; the sweep is decoration");
  assert.ok(lives.size > 1, "the lives cell never moved across bank 1; the sweep is decoration");
  console.log(`  DSW SWEEP: 256+256 identical; coin took ${coins.size}, lives ${lives.size} values`);
});

test("SEMANTICS: the frozen side seeds the lives cell folded and the coinage cell complemented",
  { skip }, () => {
    const base0 = entryState().mem.io.dsw0;
    const base1 = entryState().mem.io.dsw1;
    for (let v = 0; v < VALUES; v++) {
      const lives = (u8(~v) & 0x03) + 3;
      assert.equal(cellAfterOracle(base0, v, LIVES_CELL), lives === 6 ? 0xff : lives,
        `dsw1=${v}: the lives cell is not the folded count`);
      assert.equal(cellAfterOracle(v, base1, COINAGE_SETTINGS), u8(~v),
        `dsw0=${v}: the coinage cell is not the complemented bank`);
    }
    console.log("  SEMANTICS: lives cell is 3/4/5-or-0xff, coinage cell is ~bank0, across all values");
  });

for (const [label, brokenTwin] of TWINS) {
  test(`TEETH: the ${label} twin is caught over the sweep`, { skip }, () => {
    const c = sweepDsw1(brokenTwin);
    assert.ok(c > 0, `every sweep PASSED the ${label} twin`);
    console.log(`  TEETH/${label}: caught on ${c}/${VALUES}`);
  });
}
