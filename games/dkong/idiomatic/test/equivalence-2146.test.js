// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2146 (ROM 0x2146) — the object re-launch arm ROM 0x2118 branches to
 * while the object's Y is still above the 0xE0 line: run the fixed-point subtract, re-seed the
 * object's two step fields, snapshot its Y into record byte +0x19, and enter the shared
 * zero-fill tail at ROM 0x2153 with the result register cleared.
 *
 * WHAT THIS GATE ACTUALLY COVERS, stated plainly:
 *
 *   1. REALISM (captured, ATTRACT ONLY). 0x2146 is reachable without input: hooking it through
 *      a plain 12000-frame attract run captured 34 real dispatches when this gate was written,
 *      at three different object records, and the demo produces TWO of the four velocity-source
 *      arms there (the level arm, mode latch clear; and the random arm, latch set at difficulty
 *      1). EVERY capture is replayed — there is no sampling — and the run prints the count and
 *      the arms seen, so a future narrowing of the demo shows up rather than hiding. Credited
 *      gameplay, boards 2/3/4 and two-player are NOT covered by this part.
 *
 *   2. EQUAL (crafted, on real captures). The two velocity-source arms attract never reaches —
 *      difficulty 3/4 and difficulty 5 — are driven by poking the mode latch and DIFFICULTY on a
 *      real captured entry, together with a LEVEL sweep through the mode-latch-clear arm. The
 *      crafted entries are proved NON-VACUOUS: the test asserts on the ORACLE side that the five
 *      difficulties really do land on three different sources (the random arm and the toward-
 *      player arms write distinguishable record bytes) and that the level arm's magnitude byte
 *      actually changes with LEVEL. Each dispatched arm is exhaustively proven by its own gate;
 *      this one proves only that this routine reaches them unchanged.
 *
 *   3. EQUAL (crafted, exhaustive over the snapshotted byte). The routine's own memory effect is
 *      a copy of record +0x05 into +0x19, so that byte is swept over all 256 values on a real
 *      captured entry. The sweep deliberately includes values at or above 0xE0, which the
 *      CALLER's gate would have diverted to its own arm — this routine does not test the byte,
 *      so the full range is the honest input space for it.
 *
 *   4. TEETH — five broken twins, each of which the suite MUST catch:
 *      (a) dropped snapshot          — +0x19 never written.
 *      (b) snapshot from +0x04       — the neighbouring record byte instead of OBJ_Y.
 *      (c) snapshot written to +0x18 — one byte low.
 *      (d) dropped velocity seed     — loc_22cb never called.
 *      (e) tail entered uncleared    — the snapshot value handed to ROM 0x2153 instead of zero.
 *
 * CONTRACT: RAM MINUS the stack scratch below the entry SP [0x6BE0,0x6C00), plus the propagated return value. Both
 * sides run the WHOLE tail chain (0x2153 -> 0x21BA -> the 0x1F72 object loop), so a wrong byte
 * anywhere along it surfaces in the diff. The oracle's two dissolved call brackets (for ROM
 * 0x2407 and ROM 0x22CB) land inside the excluded stack region, and the test MEASURES that the
 * exclusion is load-bearing: it counts the replays whose only difference is inside it and
 * asserts the count is non-zero (28 of 34 when written). pc is NOT compared — the rewrite is
 * cycle-free and does not maintain it. The return value IS asserted, but it propagates as
 * `undefined` on every path observed here, so that assertion is weak on its own and the RAM diff
 * is what carries this gate.
 *
 * ROM 0x2153 is still the frozen oracle on BOTH sides (it is being decompiled in the same batch),
 * so this gate says nothing about it beyond the register value handed to it — which twin (e)
 * pins.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2146.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2146 as oracle } from "../../translated/loc_2146.js";
import { loc_2146 } from "../loc_2146.js";
import { loc_2407 } from "../loc_2407.js"; // direct callee, reused to build faithful broken twins
import { loc_22cb } from "../loc_22cb.js"; // direct callee, reused to build faithful broken twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, OBJ_Y, DIFFICULTY, LEVEL } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2146;
const ATTRACT_FRAMES = 12000;

// The record byte this routine writes, and the two the velocity seed writes. None is named in
// names.js; they are addressed off the object-record pointer.
const OBJ_Y_SNAPSHOT = 0x19;
const OBJ_STEP_DIR = 0x10;
const OBJ_STEP_MAG = 0x11;

// The velocity-source mode latch loc_22cb dispatches on. Multiplexed across readers, so it has
// no names.js name and stays hex here, exactly as it does in loc_22cb.js.
const VELOCITY_MODE_LATCH = 0x6348;

// The four velocity-source arms loc_22cb can dispatch to, by ROM address.
const VELOCITY_ARMS = [
  [0x22e1, "level"],
  [0x22f6, "random"],
  [0x2303, "toward3/4"],
  [0x231a, "toward5"],
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The frozen walk's loop-back into the per-slot step, stubbed on both clones so each side publishes
// exactly the slot under test and stops. The dissolved idiomatic chain returns after one slot
// (publishBarrelSprite no longer loops back), so the oracle is cut to the same one slot.
const WALK_LOOPBACK = 0x1f83;

// The staging cursor the walk owns as a plain value: sprite page and low byte, parked in the
// alternate bank at entry (the motion arm exchanged it out). The dissolved chain takes it as `cur`.
const cursorOf = (m) => ({ page: m.regs.h_ * 256, cursor: m.regs.l_ });

// -- diff plumbing ------------------------------------------------------------

/** First RAM byte that differs, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** First RAM byte that differs INCLUDING the stack — proves the exclusion is load-bearing. */
function firstAnyRamDiff(a, b) {
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] !== db[i]) return { addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run the oracle and a candidate on two FRESH, byte-identical clones of the same entry and
 * report every contract difference. `prep` (optional) is applied identically to both clones.
 */
function contractDiffs(entry, fn, prep) {
  const a = entry.clone(), b = entry.clone();
  const aFloor = a.regs.sp;
  if (prep) { prep(a); prep(b); }
  a.routines.set(WALK_LOOPBACK, () => {});
  b.routines.set(WALK_LOOPBACK, () => {});
  const oracleReturn = oracle(a);
  const candidateReturn = fn(b, cursorOf(b));

  const diffs = [];
  const ram = firstRamDiff(a, b, aFloor);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (oracleReturn !== candidateReturn) {
    diffs.push(`return oracle=${String(oracleReturn)} cand=${String(candidateReturn)}`);
  }
  return diffs;
}

/** True when oracle and candidate differ ONLY inside the stack scratch below the entry SP on this entry. */
function differsOnlyInStack(entry, fn) {
  const a = entry.clone(), b = entry.clone();
  a.routines.set(WALK_LOOPBACK, () => {});
  b.routines.set(WALK_LOOPBACK, () => {});
  oracle(a);
  fn(b, cursorOf(b));
  const any = firstAnyRamDiff(a, b);
  return any !== null && deadStackBelow(STACK_SCRATCH, entry.regs.sp)(any.addr);
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x2146 through a plain attract run and clone the machine at every dispatch. The run is
 * done ONCE and its captures shared by all four tests — every consumer clones before touching a
 * capture, so they cannot leak state into one another.
 */
let CAPTURES = null;
function captureAttractDispatches() {
  if (CAPTURES === null) {
    const caps = [];
    const overrides = new Map([[TARGET, (mm) => {
      caps.push(mm.clone());
      return oracle(mm);
    }]]);
    const host = new Machine(ROM, { overrides });
    host.runFrames(ATTRACT_FRAMES);
    CAPTURES = caps;
  }
  return CAPTURES;
}

/** Which velocity-source arm the ORACLE dispatches to from this entry. */
function velocityArm(entry, prep) {
  const c = entry.clone();
  if (prep) prep(c);
  let seen = "none";
  for (const [addr, name] of VELOCITY_ARMS) {
    const base = c.routines.get(addr);
    c.routines.set(addr, (mm, ...args) => { if (seen === "none") seen = name; return base(mm, ...args); });
  }
  oracle(c);
  return seen;
}

/** Entry shape: what a reader can see about the dispatch before it runs. */
const entryShape = (m) =>
  `record=${hx(m.regs.ix)} latch=${m.mem.read8(VELOCITY_MODE_LATCH)} ` +
  `difficulty=${m.mem.read8(DIFFICULTY)} level=${m.mem.read8(LEVEL)}`;

// -- 1. REALISM (captured, attract only) --------------------------------------

test("REALISM: every real captured 0x2146 attract dispatch — loc_2146 matches the oracle chain", () => {
  const caps = captureAttractDispatches();
  assert.ok(caps.length >= 1, "expected at least one real 0x2146 dispatch during attract");

  const arms = caps.map((c) => velocityArm(c));
  const shapes = new Set(caps.map(entryShape));

  let stackOnly = 0;
  for (let i = 0; i < caps.length; i++) {
    const diffs = contractDiffs(caps[i], loc_2146);
    assert.equal(diffs.length, 0, `captured dispatch #${i} (${entryShape(caps[i])}): ${diffs.join("; ")}`);
    if (differsOnlyInStack(caps[i], loc_2146)) stackOnly++;
  }
  assert.ok(
    stackOnly > 0,
    "no replayed dispatch differed only inside STACK_SCRATCH — the exclusion would be vacuous",
  );

  const armCounts = [...new Set(arms)].map((a) => `${a}=${arms.filter((x) => x === a).length}`).join(", ");
  console.log(
    `  REALISM: ALL ${caps.length} real 0x2146 dispatches replayed (no sampling) over ${ATTRACT_FRAMES} ` +
    `attract frames, ${shapes.size} distinct entry shapes; velocity arms taken: ${armCounts}; ` +
    `${stackOnly} replays differed ONLY in STACK_SCRATCH`,
  );
});

// -- 2. EQUAL (crafted, on real captures) -------------------------------------

test("EQUAL (crafted): the velocity-source arms attract never reaches match the oracle", () => {
  const caps = captureAttractDispatches();
  const latched = caps.find((c) => c.mem.read8(VELOCITY_MODE_LATCH) !== 0) ?? caps[0];
  const clear = caps.find((c) => c.mem.read8(VELOCITY_MODE_LATCH) === 0) ?? caps[0];
  assert.ok(latched && clear, "expected real captures to craft from");

  // Difficulty 1..5 with the mode latch set. NON-VACUITY FIRST: on the ORACLE side the five
  // difficulties must actually reach three different sources, and leave distinguishable bytes.
  const record = latched.regs.ix;
  const byDifficulty = new Map();
  for (const difficulty of [1, 2, 3, 4, 5]) {
    const prep = (m) => { m.mem.write8(VELOCITY_MODE_LATCH, 1); m.mem.write8(DIFFICULTY, difficulty); };
    const probe = latched.clone(); prep(probe); oracle(probe);
    byDifficulty.set(difficulty, {
      arm: velocityArm(latched, prep),
      dir: probe.mem.read8(record + OBJ_STEP_DIR),
      mag: probe.mem.read8(record + OBJ_STEP_MAG),
    });
  }
  const armsSeen = new Set([...byDifficulty.values()].map((v) => v.arm));
  assert.deepEqual(
    [...armsSeen].sort(),
    ["random", "toward3/4", "toward5"],
    `the crafted difficulties must reach three distinct velocity sources, got ${[...armsSeen]}`,
  );
  assert.notEqual(
    `${byDifficulty.get(1).dir},${byDifficulty.get(1).mag}`,
    `${byDifficulty.get(3).dir},${byDifficulty.get(3).mag}`,
    "difficulty 1 and 3 must leave different record bytes, or the crafted arms prove nothing",
  );
  assert.notEqual(
    `${byDifficulty.get(3).dir},${byDifficulty.get(3).mag}`,
    `${byDifficulty.get(5).dir},${byDifficulty.get(5).mag}`,
    "difficulty 3 and 5 must leave different record bytes, or the crafted arms prove nothing",
  );

  for (const difficulty of [1, 2, 3, 4, 5]) {
    const prep = (m) => { m.mem.write8(VELOCITY_MODE_LATCH, 1); m.mem.write8(DIFFICULTY, difficulty); };
    const diffs = contractDiffs(latched, loc_2146, prep);
    assert.equal(diffs.length, 0, `difficulty ${difficulty}: ${diffs.join("; ")}`);
  }

  // The mode-latch-clear arm, swept over LEVEL. Non-vacuity: the magnitude byte must move.
  const clearRecord = clear.regs.ix;
  const magnitudes = new Set();
  for (let level = 0; level < 256; level++) {
    const prep = (m) => { m.mem.write8(VELOCITY_MODE_LATCH, 0); m.mem.write8(LEVEL, level); };
    const probe = clear.clone(); prep(probe); oracle(probe);
    magnitudes.add(probe.mem.read8(clearRecord + OBJ_STEP_MAG));
    const diffs = contractDiffs(clear, loc_2146, prep);
    assert.equal(diffs.length, 0, `level ${level}: ${diffs.join("; ")}`);
  }
  assert.ok(magnitudes.size >= 3, `the level sweep must move the magnitude byte, saw ${magnitudes.size} value(s)`);

  const summary = [...byDifficulty.entries()].map(([d, v]) => `${d}->${v.arm}`).join(", ");
  console.log(
    `  EQUAL/crafted: difficulty 1..5 with the mode latch set (${summary}) and all 256 LEVEL values ` +
    `with it clear (${magnitudes.size} distinct magnitude bytes) — identical to the oracle`,
  );
});

// -- 3. EQUAL (crafted, exhaustive over the snapshotted byte) ------------------

test("EQUAL (exhaustive): all 256 values of the snapshotted record byte match the oracle", () => {
  const caps = captureAttractDispatches();
  const entry = caps[0];
  const record = entry.regs.ix;

  for (let y = 0; y < 256; y++) {
    const prep = (m) => { m.mem.write8((m.regs.ix + OBJ_Y) & 0xffff, y); };
    const diffs = contractDiffs(entry, loc_2146, prep);
    assert.equal(diffs.length, 0, `record Y ${y}: ${diffs.join("; ")}`);
  }

  // Non-vacuity: the sweep must actually be moving the snapshot on the oracle side.
  const snapshots = new Set();
  for (const y of [0, 0x40, 0x9f, 0xe0, 0xff]) {
    const probe = entry.clone();
    probe.mem.write8((probe.regs.ix + OBJ_Y) & 0xffff, y);
    oracle(probe);
    snapshots.add(probe.mem.read8(record + OBJ_Y_SNAPSHOT));
  }
  assert.equal(snapshots.size, 5, "the snapshot must track the swept byte, or the sweep proves nothing");

  console.log(
    "  EQUAL/exhaustive: 256 values of record +0x05 (including the >=0xE0 values the CALLER's own " +
    "gate would divert — this routine does not test the byte) identical to the oracle",
  );
});

// -- 4. TEETH ------------------------------------------------------------------

/**
 * A faithful re-implementation of loc_2146 with a single switchable bug, so each twin is the
 * real routine minus one correct behaviour (it reuses the real, gated loc_2407 / loc_22cb).
 */
function brokenLoc2146(m, bug) {
  const { regs, mem8 } = m;

  loc_2407(m);
  if (bug !== "noSeed") loc_22cb(m); // BUG(noSeed): the velocity seed never runs

  const record = regs.ix;
  if (bug === "noSnapshot") {
    // BUG: +0x19 never written
  } else if (bug === "snapshotWrongSource") {
    mem8[record + OBJ_Y_SNAPSHOT] = mem8[record + OBJ_Y - 1]; // BUG: the neighbouring byte, not OBJ_Y
  } else if (bug === "snapshotWrongTarget") {
    mem8[record + OBJ_Y_SNAPSHOT - 1] = mem8[record + OBJ_Y]; // BUG: one byte low
  } else {
    mem8[record + OBJ_Y_SNAPSHOT] = mem8[record + OBJ_Y];
  }

  // BUG(tailUncleared): the tail at ROM 0x2153 is handed the snapshot instead of zero.
  regs.a = bug === "tailUncleared" ? mem8[record + OBJ_Y] : 0;
  return m.call(0x2153);
}

test("TEETH: five broken twins are all CAUGHT on real captured dispatches", () => {
  const caps = captureAttractDispatches();

  // Sanity: the correct routine passes every capture, so a caught twin is a real defect signal.
  for (let i = 0; i < caps.length; i++) {
    assert.equal(contractDiffs(caps[i], loc_2146).length, 0, `the correct routine must pass capture #${i}`);
  }

  const cases = [
    ["dropped snapshot", "noSnapshot"],
    ["snapshot from the neighbouring byte", "snapshotWrongSource"],
    ["snapshot written one byte low", "snapshotWrongTarget"],
    ["dropped velocity seed", "noSeed"],
    ["tail entered uncleared", "tailUncleared"],
  ];

  const caught = [];
  for (const [name, bug] of cases) {
    let first = null, hits = 0;
    for (let i = 0; i < caps.length; i++) {
      const diffs = contractDiffs(caps[i], (mm) => brokenLoc2146(mm, bug));
      if (diffs.length > 0) { hits++; first ??= `#${i}: ${diffs[0]}`; }
    }
    assert.ok(hits > 0, `the "${name}" twin escaped every one of ${caps.length} captures — the gate is worthless`);
    caught.push(`${name} on ${hits}/${caps.length} captures (${first})`);
  }
  console.log(`  TEETH: ${caught.length} caught — ${caught.join("; ")}`);
});
