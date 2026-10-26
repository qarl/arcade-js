// SPDX-License-Identifier: GPL-3.0-only
/**
 * dispatchSeatedSlotByEraIndex — equivalent to the frozen oracle at ROM 0x290E, under the
 * DISSOLVED-DISPATCH contract.
 *
 * WHAT IT IS. Three instructions: read the era index, keep its low three bits, and enter the
 * restart-vector dispatch with the address of the word table that follows. Nothing is pushed for
 * the arm to come back to, so the arm's own return carries this entry's. The rewrite switches on the
 * three bits and calls each slot's idiomatic module DIRECTLY with the seated record; the module
 * PLAIN-RETURNS, so it no longer pops this entry's return slot. Production reaches this entry
 * through the dispatch seam (`withOmittedRet`), which supplies that `ret`, so every candidate here is
 * run THROUGH the seam — and then both sides end with the SAME stack pointer and the SAME program
 * counter, compared exactly. A candidate that left a stray word on the stack makes the seam throw
 * (SP-TOOTH proves it with a mutant).
 *
 * ★ HOW THE LIVE-OUT WAS DERIVED, and it is from the ORACLE. Its exit successor is the ARM,
 *   entered as a jump: whatever the arm writes and whatever it leaves behind is this entry's
 *   product, and nothing of this entry's own survives it. So the live-out is memory plus the arm's,
 *   and every arm below is RUN rather than compared as an address. The registers the dispatch chain
 *   sets up on the way in are the arm's inputs, not this entry's outputs; the EXCLUDED arm measures
 *   which of them survive the arms rather than declaring it.
 *
 * ★ THE COMPARISON IS MASKED BELOW THE EXIT STACK POINTER, and the CAUSE arm establishes the mask
 *   rather than assuming it. The frozen chain pushes and pops three nested return addresses in the
 *   bytes just under the arm's own frame, and hands the arm different flag bits besides; the
 *   rewrite computes the same arm arithmetically and writes none of that. A PROBE TWIN that
 *   reproduces exactly that stack traffic and hand-off over the frozen arms — and nothing else —
 *   leaves ZERO raw difference on every dispatch of both sessions, which identifies the chain's
 *   share of the dead scratch. The rest is the arms': the rewrite runs the idiomatic slot modules,
 *   whose own sub-calls reach the stack to different depths than the frozen ones. That share is
 *   pinned from the other side by DIRECT, which compares the rewrite UNMASKED, register file
 *   included, against the idiomatic module the slot names called straight — so the dispatch adds
 *   nothing of its own, and the mask covers only arm-internal scratch.
 *
 * GATE: strict unit-capture over two sessions, plus crafted selectors off each live arm. What it
 *   exercises, holes stated:
 *
 *   1. DISPATCHED — each session's dispatch count, the exact spread of eras it presents, and how
 *      many of those dispatches are INFORMATIVE. That last is not decoration: the arms walk a table
 *      of object slots and write nothing for an idle one, so about half the dispatches would pass a
 *      candidate that does nothing. The entry kept per era is the first that would NOT.
 *   2. EQUAL at a real dispatch of each live era — masked RAM identical, raw difference reported.
 *   3. NOT VACUOUS — a candidate that does nothing FAILS the same comparison.
 *   4. SCRATCH — across the arms and both corpora, every raw differing byte lies strictly BELOW the
 *      exit pointer and no deeper than the window, both asserted rather than assumed.
 *   5. CAUSE — the probe twin above, which must leave nothing at all.
 *   6. CORPUS — every dispatch of both sessions replayed.
 *   7. ARMS — all eight table entries off each captured entry, identical or faulting identically.
 *   8. SELECTOR — all 256 values of the era cell, so the five ignored bits are measured.
 *   9. STACK — exit pointer and program counter identical on every arm that completes, seated.
 *  10. SP-TOOTH — the seam places the rewrite and refuses a mutant that parks a stray word.
 *  11. DIRECT — the rewrite is byte- and register-identical, UNMASKED, to the named slot module.
 *  12. DEAD AT EXIT — the ceiling, poisoned on the frozen game at every exit of each whole session,
 *      changes nothing, beside a control the same instrument does hear.
 *  13. EXCLUDED — the registers that move against the frozen arms, pinned to a ceiling.
 *  14. TEETH — each twin required to be caught OUTSIDE the window, so the mask cannot be what is
 *      passing it.
 *
 * HOLE: the sessions present eras 0, 1 and 2 and no other. The remaining five selectors are
 * crafted off an entry their era would not really produce; where such an arm faults it is asserted
 * only to fault IDENTICALLY on both sides, never to be correct.
 * HOLE: two of the eight table words address nothing this port has transcribed, and the sweep can
 * say no more about those two than that both sides fault the same way — which is a statement about
 * the dispatch, not about the words.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-290e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { dispatchSeatedSlotByEraIndex } from "../dispatchSeatedSlotByEraIndex.js";
import { ERA_INDEX } from "../names.js";
import { loc_290e as oracle } from "../../translated/loc_290e.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { withOmittedRet } from "../../machine.js";
import { deadStackBelow, seamPlaceable } from "../../../../core/equivalence.js";
import { assertDeadAtExit } from "./_deadAtExit.js";
import { serviceEra0EnemyCraftSlot } from "../serviceEra0EnemyCraftSlot.js";
import { serviceEra1EnemyCraftSlot } from "../serviceEra1EnemyCraftSlot.js";
import { serviceEra2EnemyCraftSlot } from "../serviceEra2EnemyCraftSlot.js";
import { serviceEra3EnemyCraftSlot } from "../serviceEra3EnemyCraftSlot.js";
import { serviceEra4EnemyCraftSlot } from "../serviceEra4EnemyCraftSlot.js";
import { stepRoundWonBandAnimation } from "../stepRoundWonBandAnimation.js";

const TARGET = 0x290e;
const ARM_TABLE = 0x2914;
const ARM_MASK = 0x07;
const ARM_COUNT = ARM_MASK + 1;

/**
 * Bytes below the exit stack pointer the dead scratch reaches — the frozen chain's own, plus the
 * depth the idiomatic slot modules' sub-calls reach differently from the frozen arms; measured.
 */
const WINDOW = 14;

const SHARED_FRAMES = 2000;
const ATTRACT_FRAMES = 6000;

/**
 * Per session: how many dispatches, era -> how many presented it, and era -> how many of those are
 * INFORMATIVE, meaning the arm wrote something a do-nothing candidate would be caught by. About
 * half are not: the arms walk a table of object slots and an idle slot gives them nothing to do.
 * Measured; a move is a finding about which eras the sessions reach, not a tolerance to widen.
 */
const SESSIONS = [
  {
    label: "shared",
    tape: undefined,
    frames: SHARED_FRAMES,
    dispatches: 4186,
    spread: [[0, 4186]],
    informative: [[0, 2085]],
  },
  {
    label: "attract",
    tape: [],
    frames: ATTRACT_FRAMES,
    dispatches: 26131,
    spread: [[1, 21294], [2, 4837]],
    informative: [[1, 11913], [2, 1813]],
  },
];
const LIVE_SELECTORS = [0, 1, 2];

/**
 * Against the FROZEN arms the register file past the arm is the arm's, and the idiomatic slot modules
 * leave the scratch registers differently from their transcriptions; none of these is read across the
 * slot chain (the next seat reloads the record pair and the next dispatch reloads the selector),
 * which DEAD AT EXIT checks on the oracle rather than trusting. A CEILING, measured. What this entry
 * itself must not disturb is HELD, and DIRECT pins the rest.
 */
const MOVED = ["a", "f", "b", "c", "d", "e", "h", "l", "a_"];
/** Named separately so a failure says which: the pointer registers an arm hands on, and the seat. */
const HELD = ["ix", "iy", "sp"];

/** The slot module each of the eight table words names; null where the word addresses no program. */
const SLOT_MODULES = [
  (m) => serviceEra0EnemyCraftSlot(m, m.regs.ix),
  (m) => serviceEra1EnemyCraftSlot(m, m.regs.ix),
  (m) => serviceEra2EnemyCraftSlot(m, m.regs.ix),
  (m) => serviceEra3EnemyCraftSlot(m, m.regs.ix),
  (m) => serviceEra4EnemyCraftSlot(m, m.regs.ix),
  null,
  null,
  (m) => stepRoundWonBandAnimation(m),
];
const SELECTOR_VALUES = 256;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (ds) =>
  ds.length === 0 ? "identical" : ds.slice(0, 6).map((d) => `${hex4(d.addr)}(${d.a}/${d.b})`).join(" ");

// ── the sessions ────────────────────────────────────────────────────────────────────────

/**
 * The entry kept per era is the first INFORMATIVE one — the first at which the arm writes
 * something outside the dead window. A do-nothing candidate passes at an inert dispatch, so an
 * uninformative capture would leave every crafted arm below resting on a comparison with no power,
 * and raising the frame budget could never fix it.
 */
const entries = new Map();
const cache = new Map();

function runSession(spec, candidate) {
  const spread = new Map();
  const informative = new Map();
  const moved = new Set();
  let dispatches = 0;
  let caught = 0;
  let deepest = 0;
  let escaped = 0;
  const opts = spec.tape === undefined ? {} : { tape: spec.tape };
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const selector = mm.mem8[ERA_INDEX] & ARM_MASK;
    spread.set(selector, (spread.get(selector) ?? 0) + 1);
    const r = diffOf(candidate ?? dispatchSeatedSlotByEraIndex, mm);
    if (r.informative) {
      informative.set(selector, (informative.get(selector) ?? 0) + 1);
      if (!entries.has(selector)) entries.set(selector, mm.clone());
    }
    for (const k of r.moved) moved.add(k);
    if (candidate) {
      if (r.caught) caught++;
      for (const d of r.raw) {
        if (d.addr >= r.exitSp) escaped++;
        else deepest = Math.max(deepest, r.exitSp - d.addr);
      }
    }
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(spec.frames);
  assert.equal(m.stoppedBy, null, `the ${spec.label} session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, spec.frames, `the ${spec.label} session ran short`);
  return { dispatches, spread, informative, moved, caught, deepest, escaped };
}

function session(spec, candidate = dispatchSeatedSlotByEraIndex) {
  const key = `${spec.label}/${candidate.name}`;
  if (!cache.has(key)) cache.set(key, runSession(spec, candidate));
  return cache.get(key);
}

function entryFor(selector) {
  for (const spec of SESSIONS) {
    if (entries.has(selector)) break;
    session(spec);
  }
  const e = entries.get(selector);
  assert.notEqual(e, undefined, `no session presents era ${selector} any more`);
  return e;
}

/**
 * Run both sides on clones of one machine and report the raw difference, the masked one, how each
 * side faulted, and whether the comparison has any POWER here — `informative` is the oracle's own
 * masked footprint against the untouched entry, which is exactly what a do-nothing candidate would
 * be caught by. It costs one extra dump rather than a second emulation.
 */
function diffOf(candidate, machine) {
  const before = machine.dumpState();
  const a = machine.clone();
  const b = machine.clone();
  let faultA = null;
  let faultB = null;
  try { oracle(a); } catch (e) { faultA = e.constructor.name; }
  try { withOmittedRet(candidate, TARGET)(b); } catch (e) { faultB = e.constructor.name; }
  const moved = faultA || faultB ? [] : REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);

  const da = a.dumpState();
  const db = b.dumpState();
  const exitSp = a.regs.sp;
  const dead = deadStackBelow({ lo: exitSp - WINDOW, hi: exitSp }, machine.regs.sp); // cut at the entry SP
  const outside = (addr) => !dead(addr);
  const raw = [];
  let informative = false;
  for (let off = 0; off < da.length; off++) {
    const addr = a.stateOffsetToAddr(off);
    if (da[off] !== db[off]) raw.push({ addr, a: da[off], b: db[off] });
    if (da[off] !== before[off] && outside(addr)) informative = true;
  }
  const masked = raw.filter((d) => outside(d.addr));
  const faulted = faultA !== null || faultB !== null;
  return {
    raw,
    masked,
    informative,
    moved,
    exitSp,
    spB: b.regs.sp,
    pcA: a.pc,
    pcB: b.pc,
    faultA,
    faultB,
    faulted,
    caught: faulted ? faultA !== faultB : masked.length > 0 || exitSp !== b.regs.sp || a.pc !== b.pc,
  };
}

function craft(selector, base) {
  const m = base.clone();
  m.mem8[ERA_INDEX] = selector;
  return m;
}

const everySelector = Array.from({ length: SELECTOR_VALUES }, (_unused, v) => v);
const SWEEP_SIZE = LIVE_SELECTORS.length * SELECTOR_VALUES;

function sweepCaught(candidate) {
  let caught = 0;
  for (const live of LIVE_SELECTORS) {
    for (const v of everySelector) if (diffOf(candidate, craft(v, entryFor(live))).caught) caught++;
  }
  return caught;
}

// ── the probe twin that identifies the cause ────────────────────────────────────────────

/**
 * NOT A BROKEN TWIN. This reproduces the frozen chain's stack traffic and register hand-off — the
 * transfer's own push, the two nested calls it makes and their returns, and the arithmetic that
 * leaves the arm's address and the entry pointer where the chain leaves them. If the dead scratch
 * really is the whole of the difference, this must leave none at all.
 */
function probeReproducesTheChain(m) {
  const { regs } = m;
  regs.a = m.mem8[ERA_INDEX];
  regs.and(ARM_MASK);
  m.push16(ARM_TABLE);
  regs.hl = m.pop16();
  m.push16(0x0032);
  regs.add(regs.a);
  m.push16(0x0012);
  const landed = (regs.hl + regs.a) & 0xffff;
  regs.hl = landed;
  regs.a = landed & 0xff;
  m.pop16();
  m.pop16();
  regs.e = m.mem8[regs.hl];
  regs.hl = (regs.hl + 1) & 0xffff;
  regs.d = m.mem8[regs.hl];
  regs.hl = (regs.hl + 1) & 0xffff;
  const arm = regs.de;
  regs.de = regs.hl;
  regs.hl = arm;
  return m.call(arm);
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const armAt = (index) => (m) => m.call(m.mem16[ARM_TABLE + 2 * index]);
const armFrom = (table, mask) => (m) => m.call(m.mem16[table + 2 * (m.mem8[ERA_INDEX] & mask)]);

/** BUG: does nothing — neither the lookup nor the arm. */
function brokenNoOp() {}

/** BUG: takes the next entry of the table. */
function brokenNextArm(m) {
  m.call(m.mem16[ARM_TABLE + 2 * ((m.mem8[ERA_INDEX] + 1) & ARM_MASK)]);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["next-arm", brokenNextArm],
  ["wide-mask", armFrom(ARM_TABLE, 0x0f)],
  ["narrow-mask", armFrom(ARM_TABLE, 0x03)],
  ["fixed-first-arm", armAt(0)],
  ["table-off-by-one-entry", armFrom(ARM_TABLE + 2, ARM_MASK)],
  ["table-misaligned", armFrom(ARM_TABLE + 1, ARM_MASK)],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

for (const spec of SESSIONS) {
  test(`DISPATCHED: the ${spec.label} session reaches this entry with a measured era spread`, { skip }, () => {
    const s = session(spec);
    assert.equal(s.dispatches, spec.dispatches, "the dispatch count moved");
    assert.deepEqual(
      [...s.spread.entries()].sort((a, b) => a[0] - b[0]),
      spec.spread,
      "the spread of eras the session presents moved",
    );
    assert.deepEqual(
      [...s.informative.entries()].sort((a, b) => a[0] - b[0]),
      spec.informative,
      "the share of dispatches at which the arm writes anything moved",
    );
    console.log(
      `  DISPATCHED/${spec.label}: ${s.dispatches} times, eras ` +
        `${[...s.spread].map(([k, v]) => `${k}x${v}`).join(" ")}; informative ` +
        `${[...s.informative].map(([k, v]) => `${k}x${v}`).join(" ")}`,
    );
  });
}

test("EQUAL at a real dispatch of each live era: masked RAM identical", { skip }, () => {
  for (const selector of LIVE_SELECTORS) {
    const r = diffOf(dispatchSeatedSlotByEraIndex, entryFor(selector));
    assert.equal(r.faultA, null, `era ${selector}: the oracle faulted (${r.faultA})`);
    assert.equal(r.faultB, null, `era ${selector}: the rewrite faulted (${r.faultB})`);
    assert.deepEqual(r.masked, [], `era ${selector}: ${show(r.masked)}`);
    console.log(
      `  EQUAL: era ${selector}, exit pointer ${hex4(r.exitSp)}, raw difference ${show(r.raw)}`,
    );
  }
});

test("NOT VACUOUS: a candidate that does nothing FAILS the same comparison", { skip }, () => {
  for (const selector of LIVE_SELECTORS) {
    const r = diffOf(brokenNoOp, entryFor(selector));
    assert.ok(r.caught, `era ${selector}: the comparison passed a candidate that does nothing`);
  }
  const r = diffOf(brokenNoOp, entryFor(LIVE_SELECTORS[0]));
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(r.masked)}`);
});

test("SCRATCH: the whole raw difference lies below the exit pointer, inside the window", { skip }, () => {
  let deepest = 0;
  let seen = 0;
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(dispatchSeatedSlotByEraIndex, craft(i, entryFor(live)));
      for (const d of r.raw) {
        assert.ok(d.addr < r.exitSp, `arm ${i}: ${hex4(d.addr)} is at or above the exit pointer`);
        deepest = Math.max(deepest, r.exitSp - d.addr);
        seen++;
      }
    }
  }
  for (const spec of SESSIONS) {
    const s = session(spec);
    assert.equal(s.escaped, 0, `${spec.label}: a difference reached or passed the exit pointer`);
    deepest = Math.max(deepest, s.deepest);
    seen += s.deepest > 0 ? 1 : 0;
  }
  assert.ok(seen > 0, "no raw difference anywhere: the mask is not measuring anything, so it " +
    "cannot be what makes this gate pass and should be removed");
  assert.equal(
    deepest,
    WINDOW,
    `the deepest difference is ${deepest} bytes below the exit pointer against a ${WINDOW}-byte ` +
      "window — an exact ceiling, so a change is seen here rather than absorbed by the mask",
  );
  console.log(`  SCRATCH: raw differences seen, deepest ${deepest} below the exit pointer, ` +
    `window ${WINDOW}, none at or above it`);
});

test("CAUSE: reproducing the frozen chain's stack traffic leaves NO difference at all", { skip }, () => {
  for (const spec of SESSIONS) {
    const s = session(spec, probeReproducesTheChain);
    assert.equal(s.dispatches, spec.dispatches, `${spec.label}: the dispatch count moved`);
    assert.equal(s.caught, 0, `${spec.label}: the probe diverged outside the window`);
    assert.equal(s.deepest, 0, `${spec.label}: the probe still leaves ${s.deepest} bytes of scratch, ` +
      "so the chain's stack traffic is NOT the whole of the difference and the mask is covering " +
      "something this file has not identified");
    console.log(`  CAUSE/${spec.label}: ${s.dispatches} dispatches, nothing differs, unmasked`);
  }
});

for (const spec of SESSIONS) {
  test(`CORPUS: every dispatch of the ${spec.label} session replays identically`, { skip }, () => {
    const s = session(spec);
    assert.equal(s.caught, 0, "the rewrite diverged on a real dispatch");
    console.log(`  CORPUS/${spec.label}: ${s.dispatches} real dispatches, none diverging`);
  });
}

test("ARMS: every table entry runs identically, or faults identically", { skip }, () => {
  const faulted = new Set();
  let informative = 0;
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(dispatchSeatedSlotByEraIndex, craft(i, entryFor(live)));
      if (r.informative) informative++;
      if (r.faulted) {
        assert.equal(r.faultA, r.faultB, `arm ${i}: ${r.faultA} on one side, ${r.faultB} on the other`);
        faulted.add(`${live}/${i}`);
        continue;
      }
      assert.deepEqual(r.masked, [], `arm ${i}: ${show(r.masked)}`);
    }
  }
  assert.ok(
    faulted.size < ARM_COUNT * LIVE_SELECTORS.length,
    "every arm faulted, on every entry: this sweep proves nothing",
  );
  assert.ok(informative > 0, "no swept arm wrote anything outside the window, so `identical` here " +
    "is a comparison with no power rather than a result");
  console.log(`  ARMS: ${ARM_COUNT} entries off ${LIVE_SELECTORS.length} real entries, ` +
    `${faulted.size} faulting identically on both sides, ${informative} writing anything`);
});

test("SELECTOR: the five high bits are ignored, over the cell's whole range", { skip }, () => {
  let informative = 0;
  for (const live of LIVE_SELECTORS) {
    for (const v of everySelector) {
      const r = diffOf(dispatchSeatedSlotByEraIndex, craft(v, entryFor(live)));
      if (r.informative) informative++;
      if (r.faulted) {
        assert.equal(r.faultA, r.faultB, `selector ${v}: ${r.faultA} vs ${r.faultB}`);
      } else {
        assert.deepEqual(r.masked, [], `selector ${v}: ${show(r.masked)}`);
      }
    }
  }
  assert.ok(informative > 0, "no crafted selector wrote anything outside the window");
  console.log(`  SELECTOR: ${SWEEP_SIZE} crafted selectors identical, ${informative} of them ` +
    "writing something — only three bits can matter");
});

test("STACK: the exit pointer and the program counter are identical", { skip }, () => {
  let completed = 0;
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      const r = diffOf(dispatchSeatedSlotByEraIndex, craft(i, entryFor(live)));
      if (r.faulted) continue;
      assert.equal(r.exitSp, r.spB, `arm ${i}: exit pointers ${hex4(r.exitSp)} and ${hex4(r.spB)}`);
      assert.equal(r.pcA, r.pcB, `arm ${i}: program counters ${hex4(r.pcA)} and ${hex4(r.pcB)}`);
      completed++;
    }
  }
  assert.ok(completed > 0, "no arm completed, so nothing here compared a stack pointer");
  console.log(`  STACK: ${completed} completing arms, exit pointer and program counter identical`);
});

/**
 * SP MUTANT: the rewrite exactly, but with a stray word parked first — the shape of a caller-side
 * return slot the dissolved slot modules no longer pop. It lands in dead scratch, where a memory diff
 * cannot see it; only the seam can.
 */
function mutantParksAStrayWord(m) {
  m.push16(ARM_TABLE);
  return dispatchSeatedSlotByEraIndex(m);
}

test("SP-TOOTH: the seam places the rewrite, and REFUSES one that leaves a stray word", { skip }, () => {
  let placed = 0;
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      if (SLOT_MODULES[i] === null) continue;
      const good = seamPlaceable(withOmittedRet, dispatchSeatedSlotByEraIndex, TARGET, craft(i, entryFor(live)));
      assert.equal(good.placeable, true, `era ${live} slot ${i}: the seam could not place the rewrite — ${good.error}`);
      const bad = seamPlaceable(withOmittedRet, mutantParksAStrayWord, TARGET, craft(i, entryFor(live)));
      assert.equal(bad.placeable, false, `era ${live} slot ${i}: the seam placed a rewrite that leaves a word behind`);
      assert.ok(diffOf(mutantParksAStrayWord, craft(i, entryFor(live))).caught, `slot ${i}: the stray word escaped the gate`);
      placed++;
    }
  }
  console.log(`  SP-TOOTH: ${placed} completing slots placed; the stray-word mutant refused on every one`);
});

test("DIRECT: UNMASKED, registers included, the rewrite is exactly the slot module the table names", { skip }, () => {
  let compared = 0;
  let faults = 0;
  for (const live of LIVE_SELECTORS) {
    for (const v of everySelector) {
      const base = craft(v, entryFor(live));
      const a = base.clone();
      const b = base.clone();
      const expected = SLOT_MODULES[v & ARM_MASK];
      let faultA = null;
      let faultB = null;
      try {
        if (expected === null) throw new Error("no slot module");
        expected(a);
      } catch (e) { faultA = e; }
      try { dispatchSeatedSlotByEraIndex(b); } catch (e) { faultB = e; }
      if (expected === null) {
        assert.notEqual(faultB, null, `selector ${v}: a word that addresses no program did not fault`);
        assert.equal(faultB.constructor.name, "NotImplemented", `selector ${v}: ${faultB}`);
        faults++;
        continue;
      }
      assert.equal(String(faultB), String(faultA), `selector ${v}: the fault differs`);
      if (faultA !== null) { faults++; continue; }
      assert.deepEqual(REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]), [], `selector ${v}: a register differs`);
      const da = a.dumpState();
      const db = b.dumpState();
      let diff = -1;
      for (let off = 0; off < da.length && diff < 0; off++) if (da[off] !== db[off]) diff = off;
      assert.equal(diff, -1, `selector ${v}: memory differs at ${diff < 0 ? "" : hex4(a.stateOffsetToAddr(diff))}`);
      compared++;
    }
  }
  assert.ok(compared > 0, "no selector compared anything");
  // Teeth: the same unmasked comparison refuses a neighbouring module.
  const a = craft(0, entryFor(0));
  const b = a.clone();
  SLOT_MODULES[1](a);
  dispatchSeatedSlotByEraIndex(b);
  const da = a.dumpState();
  const db = b.dumpState();
  assert.ok(da.some((x, off) => x !== db[off]) || REG_FIELDS.some((k) => a.regs[k] !== b.regs[k]),
    "the unmasked comparison cannot tell slot 0 from slot 1, so it is not a gate");
  console.log(`  DIRECT: ${compared} selectors byte- and register-identical, ${faults} faulting identically`);
});

test("DEAD AT EXIT: on the frozen game, every register in the ceiling is dead where this entry hands back", { skip }, () => {
  assertDeadAtExit({
    at: TARGET, poison: MOVED, sessions: SESSIONS,
    controls: [{
      // POSITIVE CONTROL, same instrument: shift the seated record one record on at ENTRY, where the
      // arm reads it. Silence at the exit means something only if this is heard.
      label: "entry", at: TARGET, poison: ["ix"], flip: { ix: 0x10 }, before: true,
    }],
  });
});

test("EXCLUDED, deliberately: the registers that move, over every real dispatch", { skip }, () => {
  const moved = new Set();
  for (const spec of SESSIONS) for (const k of session(spec).moved) moved.add(k);
  for (const live of LIVE_SELECTORS) {
    for (let i = 0; i < ARM_COUNT; i++) {
      for (const k of diffOf(dispatchSeatedSlotByEraIndex, craft(i, entryFor(live))).moved) moved.add(k);
    }
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  // MOVED is a CEILING, not a set the rewrite is required to fill. deepEqual against it
  // would demand the divergence and go RED on a rewrite that became register-exact.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared cap diverged");
  for (const k of HELD) assert.ok(!moved.has(k), `a register the arms hand on moved (${k})`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT outside the window`, { skip }, () => {
    const caught = sweepCaught(twin);
    assert.ok(
      caught > 0,
      `the masked comparison PASSED the ${label} twin on every selector — either the twin is ` +
        "not broken or the window has swallowed the evidence",
    );
    console.log(`  TEETH/${label}: caught on ${caught} of ${SWEEP_SIZE} crafted selectors`);
  });
}
