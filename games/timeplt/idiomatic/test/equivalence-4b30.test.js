// SPDX-License-Identifier: GPL-3.0-only
/**
 * copyThreeTilemapCellsFromBothPlanes — memory-equivalent to the frozen oracle at ROM 0x4B30.
 *
 * WHAT IT IS. Three records of (source, destination) taken from a table in the program image; each
 * source cell is read twice, a fixed distance apart, and the pair is filed in two bytes at the
 * destination, second read first. Nothing else.
 *
 * ★ THE TABLE IS IN THE PROGRAM IMAGE, SO TWO OF THIS ROUTINE'S DECISIONS CANNOT BE OBSERVED HERE
 *   AND THE FILE SAYS SO RATHER THAN PRETENDING OTHERWISE. Both of its address steps are narrow —
 *   the plane distance is added to the source's high half alone, and the destination is stepped in
 *   its low half alone — so each would wrap inside a page rather than carry out of it. Neither can
 *   be made to happen: the table's three sources sit far from a page end and so do its three
 *   destinations. Two DECLARED-BLIND twins do exactly the wide-arithmetic thing, and their catch
 *   counts are asserted to be ZERO. That is a statement about the reach of this gate, not a pass.
 *
 * GATE: strict unit-capture at the one real dispatch, a crafted sweep of the six source bytes, and
 *   a whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM byte-identical with nothing masked.
 *   2. NOT VACUOUS — a candidate that does nothing FAILS somewhere in the crafted space.
 *   3. EXCLUDED, DELIBERATELY — the union of every register that differs anywhere in the crafted
 *      space, asserted to stay INSIDE the declared set rather than to equal it, so a rewrite that
 *      leaves one MORE register alone than the original passes. The declared set includes the
 *      SHADOW accumulator, which the oracle parks a byte in and does not put back; nothing reads
 *      it, and the whole-machine arm is what holds that.
 *   4. CORPUS — the real dispatches replayed, with the count asserted.
 *   5. CRAFTED — 256 patterns over the six bytes this entry copies, so every one of the three
 *      records and both of its reads are varied independently of the others.
 *   6. WHOLE-MACHINE — the shared session with the rewrite wired through the omitted-return seam.
 *   7. TEETH — five live twins with exact counts, plus the two declared-blind ones above.
 *
 * HOLE: the destinations are three fixed cells and the sources three more. Nothing here varies
 * WHICH cells are copied, because the table that decides that is not writable.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4b30.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { copyThreeTilemapCellsFromBothPlanes } from "../copyThreeTilemapCellsFromBothPlanes.js";
import { loc_4b30 as oracle } from "../../translated/loc_4b30.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x4b30;

const RECORDS = 0x0d1b;
const CELLS = 3;
const PLANE_GAP_HIGH = 4;

const EXCLUDED = ["a", "d", "e", "h", "l", "sp", "a_", "f_"];
const CORPUS_FRAMES = 2000;
const DISPATCHES = 1;

/** The only cells a whole session leaves differing: where the frame interrupt pushes. Measured. */
const SESSION_SCRATCH = [0xaffd, 0xaffe];

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b)[0] ?? null;
}

function replaySession(candidate) {
  let dispatches = 0;
  let caught = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught };
}

let cache = null;
const session = () => (cache ??= replaySession(copyThreeTilemapCellsFromBothPlanes));

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** The six cells the entry reads, taken from the table rather than assumed. */
function sourceCells(m) {
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const source = m.mem16[RECORDS + 4 * i];
    cells.push(source, ((source >> 8) + PLANE_GAP_HIGH) * 256 + (source & 0xff));
  }
  return cells;
}

/** A real captured machine with all six copied bytes forced to one pattern. */
function craft(seed) {
  const m = entryState().clone();
  sourceCells(m).forEach((addr, i) => {
    m.mem8[addr] = (seed + i * 37) & 0xff;
  });
  return m;
}

const SEEDS = Array.from({ length: 256 }, (_unused, s) => s);

function sweepCaught(candidate) {
  let caught = 0;
  for (const seed of SEEDS) if (unitDiff(candidate, craft(seed))) caught++;
  return caught;
}

function movedRegisters(candidate) {
  const moved = new Set();
  for (const seed of SEEDS) {
    const machine = craft(seed);
    const a = machine.clone();
    const b = machine.clone();
    oracle(a);
    candidate(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return REG_FIELDS.filter((k) => moved.has(k));
}

function wholeRunCells(candidate) {
  const base = makeMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(base.stateOffsetToAddr(o));
    }
  }
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => base.stateOffsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** The shape every twin varies, so each differs in exactly one decision. */
function copy(m, { records = CELLS, gapHigh = PLANE_GAP_HIGH, swap = false, wideKeep = false, wideSource = false }) {
  const { mem8, mem16 } = m;
  let record = RECORDS;
  for (let i = 0; i < records; i++) {
    const source = mem16[record];
    const keep = mem16[(record + 2) & 0xffff];
    record = (record + 4) & 0xffff;
    const first = mem8[source];
    const other = wideSource
      ? (source + gapHigh * 256) & 0xffff
      : (((source >> 8) + gapHigh) & 0xff) * 256 + (source & 0xff);
    const second = mem8[other];
    const next = wideKeep ? (keep + 1) & 0xffff : (keep & 0xff00) | ((keep + 1) & 0xff);
    mem8[keep] = swap ? first : second;
    mem8[next] = swap ? second : first;
  }
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the pair is filed the other way round. */
const brokenSwapped = (m) => copy(m, { swap: true });

/** BUG: only two of the three records are copied. */
const brokenTwoRecords = (m) => copy(m, { records: 2 });

/** BUG: the second read comes from one plane too far. */
const brokenWrongGap = (m) => copy(m, { gapHigh: PLANE_GAP_HIGH + 1 });

/** BUG: only the first byte of each pair is filed. */
function brokenFirstByteOnly(m) {
  const { mem8, mem16 } = m;
  for (let i = 0; i < CELLS; i++) {
    const source = mem16[RECORDS + 4 * i];
    const keep = mem16[RECORDS + 4 * i + 2];
    const other = ((source >> 8) + PLANE_GAP_HIGH) * 256 + (source & 0xff);
    mem8[keep] = mem8[other];
  }
}

/** DECLARED BLIND: steps the destination as a whole address instead of its low half alone. */
const blindWideKeep = (m) => copy(m, { wideKeep: true });

/** DECLARED BLIND: adds the plane distance to the whole source instead of its high half alone. */
const blindWideSource = (m) => copy(m, { wideSource: true });

const TWINS = [
  ["no-op", brokenNoOp, 256, 1],
  ["swapped", brokenSwapped, 256, 1],
  ["two-records", brokenTwoRecords, 256, 1],
  ["wrong-gap", brokenWrongGap, 256, 1],
  ["first-byte-only", brokenFirstByteOnly, 256, 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: copyThreeTilemapCellsFromBothPlanes == oracle on the WHOLE dump", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  copyThreeTilemapCellsFromBothPlanes(b);
  assert.deepEqual(allDiffs(a, b), [], "RAM diverged with nothing masked");
  console.log(`  EQUAL: sources ${sourceCells(entryState()).map(hex4).join(" ")}; identical`);
});

test("NOT VACUOUS: a no-op candidate FAILS in the crafted space", { skip }, () => {
  assert.ok(sweepCaught(brokenNoOp) > 0, "the diff passed a candidate that does nothing, everywhere");
  console.log(`  NOT VACUOUS: the empty candidate is caught ${sweepCaught(brokenNoOp)} times`);
});

test("EXCLUDED, deliberately: measured over the whole crafted space", { skip }, () => {
  const moved = movedRegisters(copyThreeTilemapCellsFromBothPlanes);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc — the shadow accumulator included`);
});

test("CORPUS: the real dispatches replay identically", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(s.caught, 0, "the rewrite diverged on a real dispatch");
  console.log(`  CORPUS: ${s.dispatches} real dispatch, identical`);
});

test("CRAFTED: 256 patterns over the six bytes this entry copies", { skip }, () => {
  assert.equal(sweepCaught(copyThreeTilemapCellsFromBothPlanes), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  CRAFTED: ${SEEDS.length} patterns identical`);
});

test("WHOLE-MACHINE: the session differs only where the interrupt pushes", { skip }, () => {
  const r = wholeRunCells(copyThreeTilemapCellsFromBothPlanes);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the interrupt's own push");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

test("DECLARED BLIND: neither wide-arithmetic twin can be caught, and here is why", { skip }, () => {
  const m = entryState();
  for (let i = 0; i < CELLS; i++) {
    const source = m.mem16[RECORDS + 4 * i];
    const keep = m.mem16[RECORDS + 4 * i + 2];
    assert.ok((source >> 8) + PLANE_GAP_HIGH <= 0xff, `source ${hex4(source)} would carry after all`);
    assert.notEqual(keep & 0xff, 0xff, `destination ${hex4(keep)} sits at a page end after all`);
  }
  assert.equal(sweepCaught(blindWideKeep), 0, "the wide destination step is now visible");
  assert.equal(sweepCaught(blindWideSource), 0, "the wide plane add is now visible");
  console.log("  DECLARED BLIND: both wide-arithmetic twins caught 0 times, as the table forces");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, realCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted patterns`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SEEDS.length} patterns`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const r = replaySession(twin);
    assert.equal(r.dispatches, DISPATCHES, "the session's dispatch count moved");
    assert.equal(r.caught, realCaught, `the ${label} twin's real catch count moved`);
    console.log(`  TEETH/${label}: the real session catches ${r.caught} of ${r.dispatches}`);
  });
}
