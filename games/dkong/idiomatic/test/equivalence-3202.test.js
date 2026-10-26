// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceFire (ROM 0x3202) — service one record of the 0x6400 object array:
 * route it through the state machine its state selects, then publish its working position into
 * the drawn OBJ_X/OBJ_Y.
 *
 * WHAT THIS GATE ACTUALLY COVERS, stated before the tests so a green run is not over-read:
 *
 *   • ATTRACT ONLY. Every real dispatch replayed here comes from the boot+attract sequence.
 *     0x3202 is first dispatched at frame 870 and fires 481 times in 3000 frames. No gameplay
 *     board is covered, on either side.
 *   • Attract produces 16 distinct entry shapes (record base x insert-requested x OBJ_STATE x
 *     the +0x19 field x the RANDOM low-bit gate) — all of them on record base 0x6400, with
 *     OBJ_STATE only ever 0, 1 or 8 and the +0x19 field always 0. Sampled per the batch policy:
 *     every 20th capture PLUS the first capture at each distinct shape; test 1 asserts the
 *     sample covers every shape the run saw, and prints how many of how many were replayed.
 *   • Attract NEVER reaches three arms, measured across 3000 attract frames by counting callee
 *     dispatches inside 0x3202: the +0x19 timer branch (loc_32d6, 0 of 481 dispatches), the
 *     out-of-band reverse at ROM 0x3297 (0 of 481 — settleFireOnGirderSlope fires exactly as often as walkFireOneStep,
 *     i.e. only as its fall-through tail), and the HIGH working-X edge (0 of 481; the LOW edge
 *     does fire, on 2). Those, plus the OBJ_STATE values attract never shows (2, 3, 4, 131, 132,
 *     255), are CRAFTED on a real captured dispatch and poked identically on both sides. The
 *     insert-requested arm (32 of 481) and the table-index reload (57 of 481) ARE covered by
 *     real captures, and are crafted as well.
 *
 * THE COMPARED CONTRACT is RAM minus the stack scratch below the entry SP, plus the return value. pc and SP
 * are NOT compared: the idiomatic routine replaces the Z80 stack with the JS call stack and
 * emits no per-instruction pc, so neither can be preserved. The oracle's push16/ret churn is
 * exactly what the STACK_SCRATCH exclusion covers, and test 4 proves that exclusion is not
 * hiding a live cell.
 *
 * ORACLE BOUNDARY: the movement/collision state machine at ROM 0x333D has no idiomatic twin in
 * ROUTINES yet, so both sides reach it through the registry and run the identical subtree.
 *
 * THE LIVE-OUT DERIVATION, cross-file and therefore here rather than in the routine: 0x3202 has
 * exactly ONE caller in the whole frozen layer — ROM 0x31CD inside advanceLiveFires — and its very next
 * instruction reloads the accumulator from its loop counter and recomputes the flags from it, so
 * the oracle's residual registers and the flags live at its 0x3279 exit are dead ABI. The record
 * register is dead too: the loop re-reads its pointer from OBJ_ITER_PTR. This live-out is DERIVED;
 * there is no live-wire arm in this file to corroborate it.
 *
 *   1. REACHABILITY + EQUAL (captured) — hook 0x3202 in a real attract run, clone at the
 *      sampled dispatches, and confirm advanceFire == oracle on every one.
 *   2. EQUAL (crafted) — the arms attract cannot supply, on a real captured base.
 *   3. ARM COVERAGE — assert, by counting callee dispatches on the oracle side, that the
 *      captured + crafted corpus together fire every arm this routine has.
 *   4. EXCLUSION IS EXACT — without the stack exclusion the only diffs lie inside STACK_SCRATCH.
 *   5. TEETH — five deliberately-broken twins the corpus MUST catch.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3202.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3202 as oracle } from "../../translated/loc_3202.js";
import { advanceFire } from "../advanceFire.js";
import { Machine } from "../../machine.js";
import { ORACLE_ROUTINES } from "../../routines.js";
import { STACK_SCRATCH } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3202;
const ATTRACT_FRAMES = 3000; // 0x3202 is first dispatched at frame 870
const SAMPLE_STRIDE = 20;

// Record fields the routine reads or writes.
const INSERT = 0x18, STATE = 0x0d, WORKING_X = 0x0e, WORKING_Y = 0x0f, INDEX = 0x13, FIELD_19 = 0x19;
const OBJ_X_OFF = 0x03, OBJ_Y_OFF = 0x05;
const RANDOM_CELL = 0x6018;
const ITER_PTR = 0x63c8;

// Every routine 0x3202 can reach directly. Counting their dispatches on the ORACLE side is how
// arm coverage is attributed: the oracle reaches all of them through `m.call`, so an override
// that delegates to the frozen routine counts without changing behaviour.
const CALLEES = [0x32bd, 0x32d6, 0x330f, 0x333d, 0x33ad, 0x298c, 0x33e7, 0x33c3];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const isHighState = (s) => (u8(s - 4) & 0x80) === 0;

// -- machinery ----------------------------------------------------------------

// Counters for the callee-dispatch attribution. Populated by the overrides every Machine in
// this file is built with (clone() rebuilds from the same options bag, so clones count too).
let counts = new Map();
const resetCounts = () => { counts = new Map(); };
const countOf = (addr) => counts.get(addr) ?? 0;

let capturing = false;
let onCapture = null;

/**
 * A Machine wired with the counting overrides plus the 0x3202 capture hook. Every clone taken
 * from it inherits the same wiring, which is what lets the replays attribute arms.
 */
function makeHost() {
  const ov = new Map();
  for (const addr of CALLEES) {
    const frozen = ORACLE_ROUTINES.get(addr);
    ov.set(addr, (mm, ...args) => {
      counts.set(addr, (counts.get(addr) ?? 0) + 1);
      return frozen(mm, ...args);
    });
  }
  ov.set(TARGET, (mm) => {
    if (capturing && onCapture) onCapture(mm);
    return oracle(mm);
  });
  return new Machine(ROM, { overrides: ov });
}

/** First RAM byte that differs, skipping the stack scratch below `liveFloor` (an entry SP) when given. */
function firstRamDiff(a, b, { liveFloor = null } = {}) {
  const dead = liveFloor === null ? () => false : deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the oracle on a fresh clone, counting the callees it dispatched. */
function runOracle(entry) {
  const c = entry.clone();
  resetCounts();
  const ret = oracle(c);
  return { m: c, ret, arms: new Map(counts) };
}

/** Run a candidate on a fresh clone. It models no Z80 stack, so it performs no terminal ret. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  return { m: c, ret };
}

/** The contract: RAM − the stack scratch below the entry SP, plus the return value. Returns a list of complaints. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o.m, c.m, { liveFloor: entry.regs.sp });
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.ret !== c.ret) diffs.push(`return oracle=${String(o.ret)} cand=${String(c.ret)}`);
  return diffs;
}

/** The entry shape the sampling policy keys on — the whole routing decision at entry. */
function shapeOf(m) {
  const rec = m.mem.read16(ITER_PTR);
  const f = (off) => m.mem.read8((rec + off) & 0xffff);
  return `base${hx(rec)}|ins${f(INSERT)}|st${f(STATE)}|f19${f(FIELD_19)}|rlow${m.mem.read8(RANDOM_CELL) & 0x03}`;
}

/**
 * Capture real 0x3202 dispatches from an attract run, keeping every SAMPLE_STRIDE-th one PLUS
 * the first at each distinct entry shape. Shapes are computed without cloning, so only the
 * sampled dispatches cost a clone.
 */
function captureAttract() {
  const kept = [];
  const seen = new Map(); // shape -> total dispatches at that shape
  let n = 0;
  capturing = true;
  onCapture = (mm) => {
    const shape = shapeOf(mm);
    const isNewShape = !seen.has(shape);
    seen.set(shape, (seen.get(shape) ?? 0) + 1);
    if (isNewShape || n % SAMPLE_STRIDE === 0) kept.push({ shape, m: mm.clone() });
    n++;
  };
  const host = makeHost();
  host.runFrames(ATTRACT_FRAMES);
  capturing = false;
  onCapture = null;
  return { kept, seen, total: n };
}

/** A real captured dispatch to craft on: the last one of the attract run. */
function craftBase() {
  let last = null;
  capturing = true;
  onCapture = (mm) => { last = mm.clone(); };
  const host = makeHost();
  host.runFrames(ATTRACT_FRAMES);
  capturing = false;
  onCapture = null;
  assert.ok(last, "no 0x3202 dispatch captured to craft on");
  return last;
}

/** Poke one crafted entry onto a clone of a real captured dispatch. */
function craft(base, patch) {
  const m = base.clone();
  const rec = m.mem.read16(ITER_PTR);
  for (const [off, val] of Object.entries(patch)) {
    if (off === "random") m.mem.write8(RANDOM_CELL, val);
    else m.mem.write8((rec + Number(off)) & 0xffff, val);
  }
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

/**
 * The crafted corpus. Three focused sweeps rather than one cross product: routing (which of the
 * entry branches is taken), the working-X edges and the out-of-band reverse, and the table index.
 */
function craftedCases(base) {
  const cases = [];
  const add = (why, patch) => cases.push({ why, patch });

  // The working-Y row to craft on, and the working-X values that probe out of band on it —
  // both DERIVED from the base by running the oracle's own 0x298C, never assumed.
  const { row, out, inBand } = pickRow(base);

  // 1. ROUTING: the insert gate, the +0x19 timer branch, the RANDOM gate, and every state on
  //    both sides of the ROM's bit-7 split (4..131 high; 0..3 and 132..255 low).
  for (const insert of [0, 1, 2]) {
    for (const state of [0, 1, 2, 3, 4, 8, 131, 132, 255]) {
      for (const field19 of [0, 2]) {
        for (const random of [0, 1, 3]) {
          add(`route ins=${insert} st=${state} f19=${field19} rnd=${random}`, {
            [INSERT]: insert, [STATE]: state, [FIELD_19]: field19, random,
            [WORKING_Y]: row, [WORKING_X]: inBand,
          });
        }
      }
    }
  }

  // 2. EDGES: both travel states stepped across the low edge (16) and the high edge (240) on a
  //    row where the probe stays IN band, so the edge test — not the reverse — is what runs.
  for (const state of [0, 1, 2]) {
    for (const x of [0, 1, 14, 15, 16, 17, 238, 239, 240, 241, 246, 247]) {
      add(`edge st=${state} wx=${x}`, {
        [INSERT]: 0, [STATE]: state, [FIELD_19]: 0, random: 1, [WORKING_Y]: row, [WORKING_X]: x,
      });
    }
  }

  // 3. REVERSE: the out-of-band positions, which undo the step and flip the travel direction.
  for (const state of [0, 1, 2]) {
    for (const x of out) {
      add(`reverse st=${state} wx=${x}`, {
        [INSERT]: 0, [STATE]: state, [FIELD_19]: 0, random: 1, [WORKING_Y]: row, [WORKING_X]: x,
      });
    }
  }

  // 4. TABLE INDEX: the reload at 0, the ordinary step down, and the top of the byte.
  for (const index of [0, 1, 2, 17, 18, 128, 255]) {
    add(`index=${index}`, {
      [INSERT]: 0, [STATE]: 0, [FIELD_19]: 0, random: 1, [INDEX]: index,
      [WORKING_Y]: row, [WORKING_X]: inBand,
    });
  }

  return cases;
}

/** Does turnFireAtGroundEdge accept the tile the given working position probes? Uses the frozen 0x298C. */
function probeInBand(base, row, x) {
  const frozen298c = ORACLE_ROUTINES.get(0x298c);
  const rec = base.mem.read16(ITER_PTR);
  const c = base.clone();
  c.mem.write8((rec + WORKING_Y) & 0xffff, row);
  c.mem.write8((rec + WORKING_X) & 0xffff, x);
  frozen298c(c);
  return c.regs.a === 0;
}

/**
 * Pick the working-Y row the crafted sweeps run on: one where BOTH working-X edges probe inside
 * turnFireAtGroundEdge's accepted band (so the edge arms are reachable at all) and which still carries
 * out-of-band positions (so the reverse arm is reachable too). Searched, not assumed — the band
 * is a property of the tilemap the captured base happens to hold.
 */
function pickRow(base) {
  for (let row = 0; row < 256; row++) {
    if (!probeInBand(base, row, 15)) continue;   // reached by stepping DOWN across the low edge
    if (!probeInBand(base, row, 240)) continue;  // reached by stepping UP across the high edge
    const out = [];
    for (let x = 255; x >= 0 && out.length < 6; x--) if (!probeInBand(base, row, x)) out.push(x);
    if (out.length === 0) continue;
    const inBand = 100;
    assert.ok(probeInBand(base, row, inBand), "the chosen row must have a mid-range in-band X");
    return { row, out, inBand };
  }
  throw new Error("no working-Y row exposes both working-X edges AND an out-of-band probe");
}

// -- 1. REACHABILITY + EQUAL (captured) ---------------------------------------

let capturedOnce = null;
function captured() {
  if (!capturedOnce) capturedOnce = captureAttract();
  return capturedOnce;
}

test("EQUAL (captured): advanceFire == oracle on the sampled real attract dispatches", () => {
  const { kept, seen, total } = captured();
  assert.ok(total > 0, "0x3202 was never dispatched — the capture is vacuous");
  assert.ok(kept.length > 0, "no dispatch was sampled");

  // The sample must cover every shape the run produced (the batch sampling policy).
  const sampledShapes = new Set(kept.map((k) => k.shape));
  for (const shape of seen.keys()) {
    assert.ok(sampledShapes.has(shape), `entry shape ${shape} occurred but was never sampled`);
  }

  for (const { shape, m } of kept) {
    const diffs = contractDiffs(m, advanceFire);
    assert.equal(diffs.length, 0, `captured dispatch ${shape}: ${diffs.join("; ")}`);
  }
  console.log(
    `  EQUAL/captured: ${kept.length} of ${total} real attract dispatches replayed identical ` +
      `(${seen.size} distinct entry shapes, all sampled)`,
  );
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

let craftedOnce = null;
function craftedCorpus() {
  if (!craftedOnce) {
    const base = craftBase();
    craftedOnce = { base, cases: craftedCases(base) };
  }
  return craftedOnce;
}

test("EQUAL (crafted): advanceFire == oracle on the arms attract never reaches", () => {
  const { base, cases } = craftedCorpus();
  let ran = 0;
  for (const { why, patch } of cases) {
    const entry = craft(base, patch);
    const diffs = contractDiffs(entry, advanceFire);
    assert.equal(diffs.length, 0, `crafted ${why}: ${diffs.join("; ")}`);
    ran++;
  }
  console.log(`  EQUAL/crafted: ${ran} crafted entries identical to the oracle`);
});

// -- 3. ARM COVERAGE ----------------------------------------------------------

test("ARM COVERAGE: the corpus fires every arm 0x3202 has", () => {
  const { kept } = captured();
  const { base, cases } = craftedCorpus();

  const totals = new Map();
  let reverseArm = 0, lowEdge = 0, highEdge = 0, indexReload = 0, publishes = 0;

  const account = (entry) => {
    const o = runOracle(entry);
    for (const [addr, n] of o.arms) totals.set(addr, (totals.get(addr) ?? 0) + n);
    // The reverse arm at ROM 0x3297 is the ONLY site that dispatches 0x33C3 on its own; every
    // other 0x33C3 dispatch is walkFireOneStep's fall-through tail. So the excess is the reverse count.
    const reversed = Math.max(0, (o.arms.get(0x33c3) ?? 0) - (o.arms.get(0x33ad) ?? 0));
    reverseArm += reversed;
    // The published fields tell the rest: what the index did, and where the working X ended.
    // The edge arms are counted only when the reverse arm did NOT run, because reverseTravel
    // writes the same state field and would otherwise be double-counted as an edge.
    const rec = entry.mem.read16(ITER_PTR);
    const before = (off) => entry.mem.read8((rec + off) & 0xffff);
    const after = (off) => o.m.mem.read8((rec + off) & 0xffff);
    if (after(OBJ_X_OFF) === after(WORKING_X) && before(INSERT) !== 1) publishes++;
    if (before(INDEX) === 0 && after(INDEX) === 17) indexReload++;
    if (reversed === 0 && (o.arms.get(0x33ad) ?? 0) > 0 && !isHighState(before(STATE))) {
      if (after(WORKING_X) < 16 && after(STATE) === 1) lowEdge++;
      if (after(WORKING_X) >= 240 && after(STATE) === 2) highEdge++;
    }
  };

  for (const { m } of kept) account(m);
  for (const { patch } of cases) account(craft(base, patch));

  const need = { 0x32bd: "insert->walker", 0x32d6: "+0x19 timer branch", 0x330f: "periodic tick",
    0x333d: "movement state machine", 0x33ad: "one-pixel X step", 0x298c: "tile band probe",
    0x33e7: "high-state animation", 0x33c3: "girder re-snap" };
  for (const [addr, what] of Object.entries(need)) {
    assert.ok((totals.get(Number(addr)) ?? 0) > 0, `arm never fired: ${what} (${hx(Number(addr))})`);
  }
  assert.ok(reverseArm > 0, "the out-of-band reverse arm (ROM 0x3297) never fired");
  assert.ok(lowEdge > 0, "the low working-X edge never re-armed the travel direction");
  assert.ok(highEdge > 0, "the high working-X edge never re-armed the travel direction");
  assert.ok(indexReload > 0, "the table index never reloaded from 0");
  assert.ok(publishes > 0, "the position was never published");

  console.log(
    "  ARM COVERAGE: " + Object.entries(need).map(([a, w]) => `${w}=${totals.get(Number(a)) ?? 0}`).join(", ") +
      `, reverse=${reverseArm}, lowEdge=${lowEdge}, highEdge=${highEdge}, indexReload=${indexReload}`,
  );
});

// -- 4. EXCLUSION IS EXACT ----------------------------------------------------

test("EXCLUSION: the only un-excluded diffs are the dissolved call brackets, inside STACK_SCRATCH", () => {
  const { kept } = captured();
  const entry = kept[kept.length - 1].m;
  const o = runOracle(entry);
  const c = runCandidate(entry, advanceFire);

  assert.equal(firstRamDiff(o.m, c.m, { liveFloor: entry.regs.sp }), null, "a live (non-stack) cell diverged");
  const withStack = firstRamDiff(o.m, c.m);
  assert.ok(withStack !== null, "expected the oracle's dissolved push16 bracket to show as a stack diff");
  assert.ok(
    deadStackBelow(STACK_SCRATCH, entry.regs.sp)(withStack.addr),
    `the un-excluded diff at ${hx(withStack.addr)} is NOT in the stack scratch below the entry SP — the exclusion hides a live cell`,
  );
  console.log(`  EXCLUSION: only diff at ${hx(withStack.addr)} — inside STACK_SCRATCH, exactly the dissolved bracket`);
});

// -- 5. TEETH -----------------------------------------------------------------

/**
 * A copy of the real routine with exactly one defect switched on. Each `bug` is a plausible
 * decompiler slip, and the corpus above must catch every one of them.
 */
function brokenTwin(bug) {
  return function twin(m) {
    const { regs, mem8, mem16 } = m;
    const loadRecord = () => { regs.ix = mem16[ITER_PTR]; };
    const field = (off) => (regs.ix + off) & 0xffff;
    const high = bug === "unsignedState"
      ? (s) => s >= 4              // BUG: unsigned, so 132..255 take the wrong path
      : isHighState;

    function publishPosition() {
      const index = mem8[field(INDEX)];
      const reload = bug === "indexReload" ? 16 : 17; // BUG: reloads to 16
      const next = index === 0 ? reload : index - 1;
      mem8[field(INDEX)] = next;
      mem8[field(OBJ_X_OFF)] = mem8[field(WORKING_X)];
      mem8[field(OBJ_Y_OFF)] = mem8[0x3a7a + next] + mem8[field(WORKING_Y)];
    }

    function reverseTravel() {
      loadRecord();
      if (mem8[field(STATE)] === 1) {
        if (bug !== "reverseNoUndo") mem8[field(WORKING_X)] = mem8[field(WORKING_X)] - 1;
        mem8[field(STATE)] = 2;
      } else {
        if (bug !== "reverseNoUndo") mem8[field(WORKING_X)] = mem8[field(WORKING_X)] + 1;
        mem8[field(STATE)] = 1;
      }
      ORACLE_ROUTINES.get(0x33c3)(m);
      publishPosition();
    }

    function stepMovement() {
      if (high(mem8[field(STATE)])) {
        ORACLE_ROUTINES.get(0x33e7)(m);
        publishPosition();
        return;
      }
      ORACLE_ROUTINES.get(0x33ad)(m);
      ORACLE_ROUTINES.get(0x298c)(m);
      if (regs.a === 1) { reverseTravel(); return; }
      loadRecord();
      const workingX = mem8[field(WORKING_X)];
      const lowState = bug === "swapEdges" ? 2 : 1;  // BUG: the two edges re-arm the wrong way
      const highState = bug === "swapEdges" ? 1 : 2;
      if (workingX < 16) mem8[field(STATE)] = lowState;
      else if (workingX >= 240) mem8[field(STATE)] = highState;
      publishPosition();
    }

    loadRecord();
    if (mem8[field(INSERT)] === 1) { ORACLE_ROUTINES.get(0x32bd)(m); return; }

    if (!high(mem8[field(STATE)])) {
      if (mem8[field(FIELD_19)] === 2) {
        ORACLE_ROUTINES.get(0x32d6)(m);
      } else {
        ORACLE_ROUTINES.get(0x330f)(m);
        const gate = bug === "randomGate"
          ? (mem8[RANDOM_CELL] & 0x03) === 0   // BUG: inverted
          : (mem8[RANDOM_CELL] & 0x03) !== 0;
        if (gate) { stepMovement(); return; }
      }
      if (mem8[field(STATE)] === 0) { publishPosition(); return; }
    }

    m.push16(0x3233);
    m.call(0x333d);
    stepMovement();
  };
}

const BUGS = ["indexReload", "swapEdges", "reverseNoUndo", "randomGate", "unsignedState"];

test("TEETH: every broken twin is CAUGHT by the captured + crafted corpus", () => {
  const { kept } = captured();
  const { base, cases } = craftedCorpus();
  const entries = [...kept.map((k) => k.m), ...cases.map((c) => craft(base, c.patch))];

  const caught = [];
  for (const bug of BUGS) {
    const twin = brokenTwin(bug);
    let first = null;
    for (const entry of entries) {
      const diffs = contractDiffs(entry, twin);
      if (diffs.length > 0) { first = diffs[0]; break; }
    }
    assert.ok(first, `the "${bug}" twin escaped the whole corpus — the gate is worthless`);
    caught.push(`${bug}: ${first}`);
  }
  console.log("  TEETH: " + caught.join(" | "));
});
