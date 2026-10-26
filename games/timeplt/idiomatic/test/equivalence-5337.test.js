// SPDX-License-Identifier: GPL-3.0-only
/**
 * queueTileStampForObject — memory-equivalent to the frozen oracle at ROM 0x5337.
 *
 * WHAT IT IS. Two of an object's bytes read as pixel coordinates, turned into a starting cell and
 * into one of sixty-four pre-shifted four-pair records, and four glyph-and-attribute pairs
 * appended to a deferred write list — each as four bytes, each skipped when its glyph is zero.
 * It calls nothing.
 *
 * ★ THE LIST POINTER STEPS WITHOUT LEAVING ITS PAGE. Only the low half is incremented, so a list
 *   that reaches the end of its page wraps onto its own head rather than running on into whatever
 *   follows. No real dispatch gets anywhere near that, so the crafted arms place the pointer four
 *   bytes from the end of its page and the carrying twin is caught only there.
 *
 * ★ THE CELL WALKS WHETHER OR NOT A PAIR IS SKIPPED. A transparent pair still moves the cursor on,
 *   which is what keeps the four pairs on the corners of one block; a twin that only walks when it
 *   writes is the tooth for that.
 *
 * GATE: strict unit-capture, three replayed sessions at every dispatch, a crafted cross over both
 *   coordinates and the list pointer, and a whole-run diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside a measured two-byte scratch window, which is
 *      where the oracle parks its record pointer across each append and the rewrite uses a local.
 *   2. NOT VACUOUS — a no-op FAILS that same diff on a real cell.
 *   3. EXCLUDED — the registers that move over the whole cross, pinned; the object base is HELD.
 *   4. UNIFORM CORPUS — which sessions reach it, how many distinct coordinate pairs they present,
 *      and how many pairs get SKIPPED, which is what says the transparent path is exercised.
 *   5. CORPUS — every dispatch of three sessions.
 *   6. CRAFTED CROSS — a grid over both coordinates that covers every sub-cell offset in both
 *      axes, crossed with list pointers including one at the end of its page.
 *   7. RECORD SELECTION — the sub-cell index is re-derived from the bytes the oracle appends,
 *      rather than asserted from the code: two coordinates in the same cell but different
 *      sub-cells must select different records.
 *   8. WHOLE-MACHINE — an attract session with the rewrite wired, diffed every frame.
 *   9. TEETH — nine twins, each with an exact catch count over the cross, per session, and a
 *      whole-run verdict. The page-wrap twin is caught by NO real dispatch and by no whole run —
 *      no session ever fills the list that far — so the crafted pointers are what hold it.
 *
 * HOLE: the crafted arms vary the two coordinates and the list pointer, not the object base or
 * the contents of the record table, which is program image.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5337.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { queueTileStampForObject } from "../queueTileStampForObject.js";
import { loc_5337 as oracle } from "../../translated/loc_5337.js";
import { DEFERRED_WRITE_CURSOR } from "../names.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x5337;

const FIRST_AXIS = 4;
const SECOND_AXIS = 6;
const PIXEL_BIAS = 7;
const CELLS_PER_ROW = 32;
const PLANE_BASE = 0xa000;
const RECORDS = 0x53d4;
const RECORD_BYTES = 8;
const SUB_CELLS = 8;

/** Measured: the oracle brackets each append with a push/pop of the record pointer. */
const SCRATCH_BYTES = 2;

const MOVED = ["a", "f", "b", "c", "d", "e", "h", "l", "sp"];
const HELD = ["ix", "iy"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 1400;
const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const u8 = (x) => x & 0xff;

function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (const bits of compass) {
    tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const sharedMachine = (overrides) => makeMachine(overrides);
const turningMachine = (overrides) => makeMachine(overrides, { tape: turnTape() });

const SESSIONS = [
  ["attract", attractMachine],
  ["shared", sharedMachine],
  ["turning", turningMachine],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured. */
const DISPATCHES = { attract: 4117, shared: 0, turning: 110 };

// ── the entry, and the comparison ───────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    attractMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) gate(queueTileStampForObject);
  return entry;
}

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

function craft(first, second, listPointer) {
  const m = entryState().clone();
  m.mem8[m.regs.ix + FIRST_AXIS] = first;
  m.mem8[m.regs.ix + SECOND_AXIS] = second;
  if (listPointer !== undefined) m.mem16[DEFERRED_WRITE_CURSOR] = listPointer;
  return m;
}

/** Every sub-cell offset in both axes, plus the wrap of each coordinate. */
const COORDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 127, 128, 200, 248, 249, 250, 252, 254, 255];
/** The real pointer, one near the end of its page so the low-half step wraps, and one at zero. */
function listPointers() {
  const real = entryState().mem16[DEFERRED_WRITE_CURSOR];
  return [real, (real & 0xff00) | 0xf4, (real & 0xff00) | 0xfc, real & 0xff00];
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const first of COORDS) {
    for (const second of COORDS) out.push([first, second, undefined]);
  }
  for (const pointer of listPointers()) {
    for (const first of COORDS) out.push([first, COORDS[3], pointer]);
  }
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  let skipped = 0;
  const pairs = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      const first = u8(mm.mem8[mm.regs.ix + FIRST_AXIS] + PIXEL_BIAS);
      const second = u8(mm.mem8[mm.regs.ix + SECOND_AXIS] + PIXEL_BIAS);
      pairs.add((first << 8) | second);
      const record = RECORDS + ((first & 7) * SUB_CELLS + (second & 7)) * RECORD_BYTES;
      for (let i = 0; i < 4; i++) if (mm.mem8[record + 2 * i] === 0) skipped++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, skipped, pairs };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, queueTileStampForObject) }));
  return sessionCache;
}

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = attractMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

function wholeRunCells(candidate) {
  const base = baseline();
  let fired = 0;
  const host = attractMachine(new Map([[TARGET, (mm) => (fired++, hosted(candidate)(mm))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
    if (host.stoppedBy) threw = String(host.stoppedBy).slice(0, 70);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(base.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = base.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.offsetToAddr(o));
  }
  const live = liveStackDiffs(base.frames, hostFrames, floors, (o) => base.offsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw };
}

/** Over a whole run the entry fires at more than one stack depth; the set is MEASURED. */
const STACK_FLOOR = 0xafc0;
const STACK_TOP = 0xb000;
const WHOLE_RUN_CELLS = [0xafe0, 0xafe1];

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** The correct append, so each twin below breaks ONE decision. */
function place(m, opts) {
  const { mem8, mem16, regs } = m;
  const first = u8(mem8[regs.ix + FIRST_AXIS] + (opts.bias ?? PIXEL_BIAS));
  const second = u8(mem8[regs.ix + SECOND_AXIS] + (opts.bias ?? PIXEL_BIAS));
  let cell = PLANE_BASE + (first >> 3) * (opts.rowStride ?? CELLS_PER_ROW) + (second >> 3);
  const subCell = opts.swapSubCell
    ? (second & 7) * SUB_CELLS + (first & 7)
    : (first & 7) * SUB_CELLS + (second & 7);
  let record = RECORDS + subCell * RECORD_BYTES;
  const walk = opts.walk ?? [1, CELLS_PER_ROW - 1, 1, 0];
  for (const step of walk) {
    const glyph = mem8[record];
    const attribute = mem8[record + 1];
    record += 2;
    if (glyph !== 0 || opts.noSkip) {
      let out = mem16[DEFERRED_WRITE_CURSOR];
      const bytes = opts.bytesSwapped
        ? [cell >> 8, cell & 0xff, glyph, attribute]
        : [cell & 0xff, cell >> 8, glyph, attribute];
      for (const byte of bytes) {
        mem8[out] = byte;
        out = opts.carryingPointer ? (out + 1) & 0xffff : (out & 0xff00) | u8(out + 1);
      }
      mem16[DEFERRED_WRITE_CURSOR] = out;
    } else if (opts.walkOnlyWhenWritten) {
      continue;
    }
    cell = (cell + step) & 0xffff;
  }
}

const twin = (opts) => (m) => place(m, opts);

const TWINS = [
  ["no-op", brokenNoOp, 480, [4117, 0, 110], true],
  ["no-bias", twin({ bias: 0 }), 480, [4117, 0, 110], true],
  ["sub-cell-axes-swapped", twin({ swapSubCell: true }), 406, [3581, 0, 95], true],
  ["row-stride-31", twin({ rowStride: 31 }), 327, [4111, 0, 109], true],
  ["no-skip", twin({ noSkip: true }), 444, [4032, 0, 110], true],
  ["walk-only-when-written", twin({ walkOnlyWhenWritten: true }), 102, [675, 0, 13], true],
  ["carrying-pointer", twin({ carryingPointer: true }), 20, [0, 0, 0], false],
  ["address-bytes-swapped", twin({ bytesSwapped: true }), 466, [4117, 0, 110], true],
  ["walk-in-a-row", twin({ walk: [1, 1, 1, 0] }), 138, [760, 0, 13], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  gate(queueTileStampForObject);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  queueTileStampForObject(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, e.regs.sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  console.log(
    `  EQUAL: entry base ${hex4(e.regs.ix)} coords ${e.mem8[e.regs.ix + FIRST_AXIS]}/` +
      `${e.mem8[e.regs.ix + SECOND_AXIS]} list ${hex4(e.mem16[DEFERRED_WRITE_CURSOR])}; identical`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the RAM diff at the real dispatch", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the RAM diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole cross", { skip }, () => {
  const moved = new Set();
  for (const [first, second, pointer] of cross()) {
    const a = craft(first, second, pointer);
    const b = a.clone();
    oracle(a);
    queueTileStampForObject(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k)), MOVED, "the excluded set changed shape");
  for (const k of HELD) assert.ok(!moved.has(k), `an index register moved (${k})`);
});

test("UNIFORM CORPUS: which sessions reach it, and whether the skip path is exercised", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.pairs.size} coordinate pairs / ${s.skipped} skipped pairs`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const skipped = seen.reduce((n, s) => n + s.skipped, 0);
  assert.ok(skipped > 0, "no real dispatch skips a transparent pair, so the skip path is only " +
    "exercised by the crafted cross");
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, RAM identical on each`);
});

test("CRAFTED: every coordinate pair and list pointer is identical", { skip }, () => {
  for (const [first, second, pointer] of cross()) {
    const d = unitDiff(queueTileStampForObject, craft(first, second, pointer));
    assert.equal(d, null, `coords ${first}/${second} pointer ${pointer}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${cross().length} entries identical`);
});

test("RECORD SELECTION: sub-cells inside ONE cell select different records", { skip }, () => {
  // Eight coordinates that share a cell and differ only in the sub-cell offset. The bytes the
  // oracle appends are read back out of the list, so this is a derivation from memory rather than
  // a restatement of the index arithmetic.
  const appended = [];
  for (let sub = 0; sub < SUB_CELLS; sub++) {
    const m = craft(64 + sub - PIXEL_BIAS, 64 - PIXEL_BIAS, undefined);
    const start = m.mem16[DEFERRED_WRITE_CURSOR];
    oracle(m);
    const end = m.mem16[DEFERRED_WRITE_CURSOR];
    const bytes = [];
    for (let out = start; out !== end; out = (out & 0xff00) | u8(out + 1)) bytes.push(m.mem8[out]);
    appended.push(bytes.join(","));
  }
  const distinct = new Set(appended);
  console.log(`  RECORD SELECTION: ${distinct.size} distinct appends over ${SUB_CELLS} sub-cells`);
  assert.ok(distinct.size > 1, "every sub-cell of one cell appends the same bytes, so nothing " +
    "here shows the low bits of a coordinate select a record at all");
});

test("WHOLE-MACHINE: attract differs only in stack scratch", { skip }, () => {
  const r = wholeRunCells(queueTileStampForObject);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, cells [${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run stopped: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address`);
  }
  assert.deepEqual(r.cells, WHOLE_RUN_CELLS, "the set of dead stack bytes moved");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, candidate, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([f, s2, p]) => unitDiff(candidate, craft(f, s2, p)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, candidate));
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
    for (const [i, r] of counts.entries()) {
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} count moved`);
    }
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(candidate);
    const seen = r.threw !== null || r.cells.some((c) => !WHOLE_RUN_CELLS.includes(c));
    console.log(`  TEETH/${label}: whole machine ${seen ? `catches it (${r.threw ?? r.cells.length + " cells"})` : "is BLIND"}`);
    assert.equal(seen, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}
