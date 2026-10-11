// SPDX-License-Identifier: GPL-3.0-only
/**
 * pulseSlot1CoinCounter — memory-equivalent to the frozen oracle at ROM 0x4984.
 *
 * GATE: strict unit-capture, a corpus replay of a whole driven session, and an EXHAUSTIVE crafted
 *   cross over the two bytes the routine reads. Those two bytes ARE its whole input space, so the
 *   cross is complete rather than a sample. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — the state dump agrees byte for byte, the stack scratch
 *      included, so this file names NO exclusion and asserts the empty one.
 *   2. THE DRIVEN LINE IS A LIVE-OUT AND IT IS NOT IN THE STATE DUMP. Driving it reaches a
 *      device, not memory, so every RAM arm here is blind to it. Each side is therefore run with
 *      device writes RECORDED and the two recordings compared in order — the LEVEL alone is not
 *      enough, because driving a line to the level it already holds leaves the level unchanged.
 *      Two of the twins below differ in nothing else, so the blindness cannot pass for coverage.
 *   3. EXHAUSTIVE — the full cross of four debt values against all 256 timer values, RAM and the
 *      recorded device writes compared on each.
 *   4. EVERY ARM REACHED, asserted rather than assumed: the cross is shown to contain entries
 *      that do nothing, entries that start a pulse, entries that drop the line, entries that pay
 *      a debt off, and entries that only count.
 *   5. CORPUS — every dispatch of a driven session, on a clone taken at the dispatch, with the
 *      arms the session actually reached reported rather than assumed.
 *   6. TEETH — six twins, each caught on its own exact count over the cross.
 *
 * HOLE: this gate says nothing about what the driven line DOES. It is one bit of an output latch
 * and nothing on this processor can read it back; the arm below compares the model's own record of
 * what was driven, which fixes the sequence and the timing and claims no more than that.
 * HOLE: the corpus never sees a debt above one, which the arm reports; multi-pulse behaviour is
 * covered only by the crafted cross.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4984.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { pulseSlot1CoinCounter } from "../pulseSlot1CoinCounter.js";
import { loc_4984 as oracle } from "../../translated/loc_4984.js";
import { COIN_COUNTER_PULSES_OWED, COIN_PULSE_TIMER } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { recordHardwareWrites } from "./_spineSever.js";

const TARGET = 0x4984;
const COUNTER_LINE_BIT = 5;

/** Dispatches the shared tape produces in the harness budget. Measured; a move is a finding. */
const DISPATCHES = 1166;

const skip = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The bit of the output latch this routine drives, as the machine's model holds it. */
const latch = (m) => m.io.latch[COUNTER_LINE_BIT];

/** Run one side with device writes recorded, and hand back what it drove, in order. */
function driven(fn, machine) {
  const log = recordHardwareWrites(machine);
  fn(machine);
  delete machine.mem.write8;
  return log.map((w) => `${hex4(w.addr)}=${w.value}`);
}

/**
 * Oracle vs candidate on two clones: RAM first, then the DEVICE WRITES, in order. Comparing the
 * latch LEVEL is not enough — driving a line to the level it already holds is invisible in the
 * level and visible in the trace, and two of the twins below are exactly that.
 */
function compare(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const droveA = driven(oracle, a);
  const droveB = driven(candidate, b);
  const ram = allDiffs(a, b)[0];
  if (ram) return ram;
  if (droveA.join(" ") !== droveB.join(" ")) {
    return { addr: null, a: droveA.join(" ") || "nothing", b: droveB.join(" ") || "nothing" };
  }
  return null;
}

let captured = null;
let realDebts = null;

function replay(candidate) {
  let dispatches = 0;
  let caught = 0;
  const debts = new Set();
  const timers = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    debts.add(mm.mem8[COIN_COUNTER_PULSES_OWED]);
    timers.add(mm.mem8[COIN_PULSE_TIMER]);
    if (captured === null) captured = mm.clone();
    if (compare(candidate, mm)) caught++;
    return oracle(mm);
  }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  realDebts = debts;
  return { dispatches, caught, timers };
}

function entryState() {
  if (captured === null) replay(pulseSlot1CoinCounter);
  return captured;
}

/** A real captured machine with the debt and the pulse timer forced. */
function craft(debt, timer) {
  const m = entryState().clone();
  m.mem8[COIN_COUNTER_PULSES_OWED] = debt;
  m.mem8[COIN_PULSE_TIMER] = timer;
  return m;
}

const DEBTS = [0, 1, 2, 255];

function crossCaught(candidate) {
  let caught = 0;
  for (const debt of DEBTS) {
    for (let timer = 0; timer < 256; timer++) if (compare(candidate, craft(debt, timer))) caught++;
  }
  return caught;
}

const CROSS_SIZE = DEBTS.length * 256;

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: every byte identical, the stack scratch included", { skip }, () => {
  const entry = entryState();
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  pulseSlot1CoinCounter(b);
  assert.deepEqual(allDiffs(a, b), [], `a byte diverged — ${show(allDiffs(a, b)[0])}`);
  assert.equal(latch(a), latch(b), "the latched line diverged at the real dispatch");
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    ["f", "sp"],
    "the excluded set changed shape: neither of these outlives the entry",
  );
  console.log(
    `  EQUAL: debt ${entry.mem8[COIN_COUNTER_PULSES_OWED]}, timer ${entry.mem8[COIN_PULSE_TIMER]}; identical`,
  );
});

test("EXHAUSTIVE: the full debt x timer cross agrees in RAM and on the line", { skip }, () => {
  for (const debt of DEBTS) {
    for (let timer = 0; timer < 256; timer++) {
      const d = compare(pulseSlot1CoinCounter, craft(debt, timer));
      assert.equal(d, null, `debt=${debt} timer=${timer}: ${show(d)}`);
    }
  }
  console.log(`  EXHAUSTIVE: ${CROSS_SIZE} debt x timer combinations identical`);
});

test("EVERY ARM REACHED: the cross contains all five outcomes", { skip }, () => {
  const arms = { inert: 0, starts: 0, drops: 0, pays: 0, counts: 0 };
  for (const debt of DEBTS) {
    for (let timer = 0; timer < 256; timer++) {
      const before = craft(debt, timer);
      const after = before.clone();
      oracle(after);
      const moved = allDiffs(before, after).length;
      if (debt === 0) {
        assert.equal(moved, 0, `debt=0 timer=${timer} moved a byte; the idle arm is not inert`);
        arms.inert++;
      } else if (timer === 0) {
        assert.equal(after.mem8[COIN_PULSE_TIMER], 48, "an idle timer must be reloaded to full length");
        assert.equal(latch(after), 1, "starting a pulse must drive the line high");
        arms.starts++;
      } else if (timer === 1) {
        assert.equal(after.mem8[COIN_COUNTER_PULSES_OWED], debt - 1, "the debt must fall as the pulse ends");
        arms.pays++;
      } else if (timer === 25) {
        assert.equal(latch(after), 0, "the line must drop at the half-way count");
        arms.drops++;
      } else {
        arms.counts++;
      }
    }
  }
  for (const [name, n] of Object.entries(arms)) assert.ok(n > 0, `no cross entry reached ${name}`);
  console.log(`  ARMS: ${Object.entries(arms).map(([k, v]) => `${k} ${v}`).join(", ")}`);
});

test("CORPUS: every dispatch of a driven session replays identically", { skip }, () => {
  const r = replay(pulseSlot1CoinCounter);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, `the rewrite diverged on ${r.caught} real dispatches`);
  assert.ok(realDebts.has(0), "vacuous: the session never presented the idle arm");
  assert.ok(realDebts.has(1), "the session never owed a pulse, so no live arm was exercised");
  assert.ok(
    ![...realDebts].some((d) => d > 1),
    "the session now owes more than one pulse, so the hole this file records is stale",
  );
  console.log(
    `  CORPUS: ${r.dispatches} dispatches identical; debts ${[...realDebts].join(",")}, ` +
      `${r.timers.size} distinct timer values`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
const brokenNoOp = () => {};

/** BUG: runs the pulse whether or not anything is owed. */
function brokenIgnoresTheDebt(m) {
  const was = m.mem8[COIN_COUNTER_PULSES_OWED];
  m.mem8[COIN_COUNTER_PULSES_OWED] = was === 0 ? 1 : was;
  pulseSlot1CoinCounter(m);
  if (was === 0) m.mem8[COIN_COUNTER_PULSES_OWED] = 0;
}

/** BUG: drops the line one count late, so the pulse is a frame longer than it should be. */
function brokenDropsLate(m) {
  const remaining = m.mem8[COIN_PULSE_TIMER];
  if (m.mem8[COIN_COUNTER_PULSES_OWED] !== 0 && remaining !== 0 && remaining - 1 === 23) {
    m.mem8[COIN_PULSE_TIMER] = remaining - 1;
    m.mem.write8(0xc30a, 0, 10);
    return;
  }
  if (m.mem8[COIN_COUNTER_PULSES_OWED] !== 0 && remaining - 1 === 24) {
    m.mem8[COIN_PULSE_TIMER] = remaining - 1;
    return;
  }
  pulseSlot1CoinCounter(m);
}

/** BUG: never drops the line, which no RAM comparison can see. */
function brokenNeverDropsTheLine(m) {
  const remaining = m.mem8[COIN_PULSE_TIMER];
  if (m.mem8[COIN_COUNTER_PULSES_OWED] !== 0 && remaining !== 0 && remaining - 1 === 24) {
    m.mem8[COIN_PULSE_TIMER] = remaining - 1;
    return;
  }
  pulseSlot1CoinCounter(m);
}

/** BUG: pays the debt off as the pulse starts instead of when it finishes. */
function brokenPaysEarly(m) {
  if (m.mem8[COIN_COUNTER_PULSES_OWED] === 0) return;
  if (m.mem8[COIN_PULSE_TIMER] === 0) {
    m.mem8[COIN_COUNTER_PULSES_OWED] = m.mem8[COIN_COUNTER_PULSES_OWED] - 1;
    m.mem8[COIN_PULSE_TIMER] = 48;
    m.mem.write8(0xc30a, 1, 10);
    return;
  }
  const left = m.mem8[COIN_PULSE_TIMER] - 1;
  m.mem8[COIN_PULSE_TIMER] = left;
  if (left === 24) m.mem.write8(0xc30a, 0, 10);
}

/** BUG: the pulse is half as long. */
function brokenShortPulse(m) {
  pulseSlot1CoinCounter(m);
  if (m.mem8[COIN_PULSE_TIMER] === 48) m.mem8[COIN_PULSE_TIMER] = 24;
}

const TWINS = [
  ["no-op", brokenNoOp, 768],
  ["ignores-the-debt", brokenIgnoresTheDebt, 256],
  ["drops-late", brokenDropsLate, 6],
  ["never-drops-the-line", brokenNeverDropsTheLine, 3],
  ["pays-early", brokenPaysEarly, 6],
  ["short-pulse", brokenShortPulse, 7],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of the cross`, { skip }, () => {
    assert.equal(crossCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${CROSS_SIZE} cross entries`);
  });
}
