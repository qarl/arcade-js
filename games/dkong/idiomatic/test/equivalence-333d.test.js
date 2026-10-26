// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for driveFireLadderClimb (ROM 0x333D) — the switch between a 0x6400-array object's two
 * travel states and its on-foot state.
 *
 * WHAT IS COMPARED. RAM − the stack scratch below the entry SP, plus the return value. The routine has ONE exit as far
 * as its caller is concerned: its own return and the two unwinds its callees perform (loc_33a1's
 * height skip, findOppositeLadderEnd's table miss) all land at the same continuation, ROM 0x3233, so the
 * idiomatic twin returns `undefined` on every path and the gate asserts that on both sides —
 * a stray `false` would make the seam eat a second stack word. pc/SP are NOT compared: they are
 * the Z80 stack idiom the plain JS return replaces.
 *
 * THE EXCLUSION IS PROVED, NOT ASSUMED. Every case checks the ORACLE's own write footprint and
 * requires each address to be either one of the three record bytes (+0x0d, +0x1d, +0x1f) or
 * inside STACK_SCRATCH — so the excluded window cannot be hiding a real difference.
 *
 *   0. REACHABILITY — 0x333D is dispatched naturally during attract. The test measures the count
 *      and classifies every capture by the arm the ORACLE takes, then asserts WHICH arms attract
 *      reaches and, just as importantly, which it does NOT. Attract enters only with the state
 *      byte 1 or 8, so it reaches four arms (ARMS_ATTRACT_REACHES) and misses seven
 *      (ARMS_ATTRACT_MISSES) — including everything on the descent side and the guard's skip.
 *      Both lists are asserted, so neither can quietly change without this test failing.
 *   1. EQUAL (captured) — EVERY captured dispatch replayed oracle-vs-candidate on fresh clones.
 *      No sampling: the natural dispatch count is small enough to replay in full, and test 0
 *      asserts the capture is complete, so entry-shape coverage of the run is total by
 *      construction rather than by a separate check. The distinct shapes seen are reported.
 *   2. EQUAL (crafted) — the arms attract never reaches, planted on a real machine state: both
 *      arrivals, the +0x19 == 2 mark and its absence, the descent arm that must NOT mark, the
 *      8-bit wrap of the biased Y base, the guard's two outcomes, the table miss, both lookup
 *      tags, a rescan past a non-matching entry, and the Mario comparison at its exact boundary.
 *   3. LIVE (whole attract) — the live-out measurement. The candidate is wired at 0x333D for a
 *      real 4000-frame attract run and the frame trace is diffed against the all-oracle baseline
 *      on every live cell outside the stack scratch below each frame's live SP. A second run repeats it with every register
 *      except the record pointer deliberately clobbered on the way out, which is what makes
 *      "no register live-out" a measurement rather than a reading of the caller.
 *      ★ The oracle's measured cycle cost is restored inside the override. Without that the run
 *      diverges at frame 1080 (at 0x6019) purely because cycle-free code shifts the NMI — a
 *      timing artifact, not a difference in this routine. Test 3 carries that as a teeth case so
 *      the restoration cannot be dropped silently.
 *      COVERAGE: attract only. Gameplay, the other three boards, and every arm listed in test 2
 *      are NOT exercised live — test 2 is what covers those, and it covers them statically.
 *   4. TEETH — eight broken twins, each of which this contract MUST catch.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-333d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_333d as oracle } from "../../translated/loc_333d.js";
import { driveFireLadderClimb } from "../driveFireLadderClimb.js";
import { loc_33a1 } from "../loc_33a1.js";
import { findOppositeLadderEnd } from "../findOppositeLadderEnd.js";
import { Machine } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import { STACK_SCRATCH, BOARD, MARIO_Y, OBJ_STATE, OBJ_ARRAY_64, OBJ_PARAM_TABLE0 } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x333d;

// The record fields, mirrored from the routine under test.
const RECORD_X = 0x0e;
const RECORD_Y_BASE = 0x0f;
const RECORD_MODE = 0x19;
const RECORD_ARRIVAL_MARK = 0x1d;
const RECORD_DESTINATION = 0x1f;
const Y_BASE_BIAS = 8;
const TABLE_ENTRIES = 21;
const STATE_ON_FOOT = 0;
const STATE_DESCEND = 4;
const STATE_ASCEND = 8;

// The only three record bytes the routine may write.
const WRITABLE = [OBJ_STATE, RECORD_ARRIVAL_MARK, RECORD_DESTINATION];

const RECORD = OBJ_ARRAY_64; // record 0 — the one every natural dispatch uses
const RECORD_1 = OBJ_ARRAY_64 + 0x20; // its neighbour, for the record-relative check
const GUARD_OPEN_BOARD = 1; // 25m — loc_33a1's gate is open on boards 1/2/3
const GUARD_CLOSED_BOARD = 4; // 100m — the gate closes, which loc_33a1 reports as "carry on"
const GUARD_MIN_Y = 89; // at or below this the guard lets the routine run (loc_33a1's line)

// A crafted entry's stack: inside STACK_SCRATCH with room for the callees' pushes below and the
// double unwind's pops above.
const SAFE_SP = 0x6bf2;

// findOppositeLadderEnd's paired-slot offsets, and a table filler that matches no key used here.
const NEAR = 0x15;
const FAR = 0x2a;
const FILLER = 0xee;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
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

/**
 * Run the oracle on one clone and a candidate on another, byte-identical one, and report the
 * contract: RAM − the stack scratch below the entry SP, the return value, and the ORACLE's write footprint (so the
 * excluded stack window can be shown not to be hiding anything).
 */
function comparePair(entry, fn) {
  const o = entry.clone();
  const c = entry.clone();

  const writes = [];
  const baseWrite8 = o.mem.write8.bind(o.mem);
  o.mem.write8 = (addr, value) => { writes.push(addr & 0xffff); return baseWrite8(addr, value); };
  const retO = oracle(o);
  o.mem.write8 = baseWrite8;

  let retC, threw = null;
  try {
    retC = fn(c);
  } catch (e) {
    threw = e;
  }

  const record = entry.regs.ix;
  const allowed = new Set(WRITABLE.map((d) => (record + d) & 0xffff));
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const strayWrite = writes.find((a) => !allowed.has(a) && !dead(a));

  return { ram: threw ? null : firstRamDiff(o, c, entry.regs.sp), retO, retC, threw, writes, strayWrite, oracleMachine: o };
}

const mismatched = (r) => r.threw != null || r.ram !== null || r.retO !== r.retC;
const describeMismatch = (r) =>
  r.threw ? `candidate threw: ${r.threw.message}`
    : r.ram ? `RAM@${hx(r.ram.addr)} oracle=${r.ram.a} cand=${r.ram.b}`
      : `return oracle=${r.retO} cand=${r.retC}`;

/** A real, self-consistent machine; clone() neutralises the frame machinery. */
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/**
 * Plant a controlled type-0 object table so findOppositeLadderEnd's outcome is chosen rather than hoped for.
 * `entries` is a list of { off, near, far }: a key byte at OBJ_PARAM_TABLE0+off whose two paired
 * slots hold `near` and `far`. Everything else in the scanned window is filler.
 */
function plantTable(m, key, entries) {
  for (let i = 0; i < 0x60; i++) m.mem.write8((OBJ_PARAM_TABLE0 + i) & 0xffff, FILLER);
  for (const e of entries) {
    m.mem.write8((OBJ_PARAM_TABLE0 + e.off) & 0xffff, key);
    m.mem.write8((OBJ_PARAM_TABLE0 + e.off + NEAR) & 0xffff, e.near);
    m.mem.write8((OBJ_PARAM_TABLE0 + e.off + FAR) & 0xffff, e.far);
  }
}

/**
 * A crafted 0x333D entry on real RAM: board, Mario's row, the record's fields, and (optionally)
 * a planted table keyed to the record's X.
 */
function craft(base, cfg) {
  const {
    board = GUARD_OPEN_BOARD, marioY = 200, ix = RECORD,
    state, x = 0x63, y, mode = 0, mark = 0, destination = 0, entries = null,
  } = cfg;
  const e = base.clone();
  e.regs.sp = SAFE_SP;
  e.push16(0x3233); // the continuation advanceFire pushes — what the oracle's return consumes
  e.regs.ix = ix;
  e.mem.write8(BOARD, board);
  e.mem.write8(MARIO_Y, marioY);
  e.mem.write8((ix + OBJ_STATE) & 0xffff, state);
  e.mem.write8((ix + RECORD_X) & 0xffff, x);
  e.mem.write8((ix + RECORD_Y_BASE) & 0xffff, y);
  e.mem.write8((ix + RECORD_MODE) & 0xffff, mode);
  e.mem.write8((ix + RECORD_ARRIVAL_MARK) & 0xffff, mark);
  e.mem.write8((ix + RECORD_DESTINATION) & 0xffff, destination);
  if (entries) plantTable(e, x, entries);
  return e;
}

/** What the record looks like after a run — the three writable bytes. */
const readRecord = (m, ix = m.regs.ix) => ({
  state: m.mem.read8((ix + OBJ_STATE) & 0xffff),
  mark: m.mem.read8((ix + RECORD_ARRIVAL_MARK) & 0xffff),
  destination: m.mem.read8((ix + RECORD_DESTINATION) & 0xffff),
});

// -- 0/1. real dispatches -----------------------------------------------------

/** Drive attract and clone the machine at every real 0x333D dispatch (up to K). */
function captureDispatches(K, frames) {
  const caps = [];
  let total = 0;
  const ov = new Map([[TARGET, (mm) => {
    total++;
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: ov }).runFrames(frames);
  return { caps, total };
}

const ATTRACT_FRAMES = 4000;
let CAPTURED = null;
const captured = () => (CAPTURED ??= captureDispatches(5000, ATTRACT_FRAMES));

/**
 * Which arm the ORACLE takes on an entry, decided behaviourally: from the state byte, the writes
 * the oracle makes, and whether it ever reaches the table lookup (which separates the guard's skip
 * from a lookup that ran and missed).
 */
function classify(entry) {
  const o = entry.clone();
  const record = o.regs.ix;
  const writes = [];
  const baseWrite8 = o.mem.write8.bind(o.mem);
  o.mem.write8 = (addr, value) => { writes.push(addr & 0xffff); return baseWrite8(addr, value); };
  const calls = [];
  const baseCall = o.call.bind(o);
  o.call = (addr, ...rest) => { calls.push(addr); return baseCall(addr, ...rest); };
  oracle(o);
  const wrote = (d) => writes.includes((record + d) & 0xffff);

  const state = entry.mem.read8((record + OBJ_STATE) & 0xffff);
  if (state === STATE_ASCEND || state === STATE_DESCEND) {
    const kind = state === STATE_ASCEND ? "ascend" : "descend";
    if (!wrote(OBJ_STATE)) return `${kind}:travelling`;
    return wrote(RECORD_ARRIVAL_MARK) ? `${kind}:arrived+mark` : `${kind}:arrived`;
  }
  if (!calls.includes(0x236e)) return "onFoot:guard-skip";
  if (!wrote(RECORD_DESTINATION)) return "onFoot:table-miss";
  if (!wrote(OBJ_STATE)) return "onFoot:near-slot,held-by-mario";
  return o.mem.read8((record + OBJ_STATE) & 0xffff) === STATE_ASCEND
    ? "onFoot:far-slot->ascend"
    : "onFoot:near-slot->descend";
}

// What a 4000-frame attract run reaches, and — the load-bearing half — what it does not.
const ARMS_ATTRACT_REACHES = [
  "ascend:travelling", "ascend:arrived", "onFoot:table-miss", "onFoot:far-slot->ascend",
];
const ARMS_ATTRACT_MISSES = [
  "ascend:arrived+mark", "descend:travelling", "descend:arrived", "descend:arrived+mark",
  "onFoot:guard-skip", "onFoot:near-slot->descend", "onFoot:near-slot,held-by-mario",
];

test("REACHABILITY: 0x333d is dispatched naturally, and attract reaches four of its arms", () => {
  const { caps, total } = captured();
  assert.ok(total > 0, "0x333d should be dispatched during attract (advanceFire at ROM 0x3230)");
  assert.equal(caps.length, total, "every dispatch must be captured — this gate replays all of them");

  const arms = {};
  const shapes = new Set();
  for (const entry of caps) {
    const arm = classify(entry);
    arms[arm] = (arms[arm] ?? 0) + 1;
    shapes.add(`${hx(entry.regs.ix)}/${entry.mem.read8((entry.regs.ix + OBJ_STATE) & 0xffff)}`);
  }

  const reached = new Set(Object.keys(arms));
  for (const arm of ARMS_ATTRACT_REACHES) {
    assert.ok(reached.has(arm), `attract was expected to reach ${arm}, and did not`);
  }
  // The honest hole, asserted so it cannot silently become coverage.
  for (const arm of ARMS_ATTRACT_MISSES) {
    assert.ok(!reached.has(arm),
      `attract was expected NOT to reach ${arm} — if it now does, the header's ` +
      "crafted-carries-these-arms claim needs updating");
  }
  assert.equal(reached.size, ARMS_ATTRACT_REACHES.length, `unclassified arm(s): ${[...reached].join(",")}`);

  console.log(`  REACHABILITY: ${total} natural dispatches in ${ATTRACT_FRAMES} attract frames; ` +
    `arms ${JSON.stringify(arms)}; entry shapes (record/state) ${[...shapes].join(",")}`);
});

test("EQUAL (captured): driveFireLadderClimb == oracle on every real dispatch", () => {
  const { caps, total } = captured();
  assert.ok(caps.length >= 1, "expected at least one real 0x333d dispatch during attract");

  const shapes = new Set();
  for (const entry of caps) {
    shapes.add(`${hx(entry.regs.ix)}/${entry.mem.read8((entry.regs.ix + OBJ_STATE) & 0xffff)}`);
    const r = comparePair(entry, driveFireLadderClimb);
    assert.ok(!mismatched(r), `captured dispatch: ${describeMismatch(r)}`);
    assert.equal(r.strayWrite, undefined,
      r.strayWrite && `the oracle wrote ${hx(r.strayWrite)} — outside both the record bytes and STACK_SCRATCH`);
  }
  console.log(`  EQUAL/captured: ${caps.length} of ${total} real dispatches replayed (all of them), ` +
    `${shapes.size} distinct entry shapes, identical on RAM − the stack scratch below the entry SP + return`);
});

// -- 2. EQUAL (crafted): the arms attract never reaches -----------------------

// A key/table pair that makes findOppositeLadderEnd report the FAR slot (tag 0 -> ascend): the discriminator
// is the object's biased Y base, planted in the far slot; the near slot is the byte handed back.
const farSlotEntry = (y, back) => [{ off: 2, near: back, far: u8(y + Y_BASE_BIAS) }];
// ... and the mirror, reporting the NEAR slot (tag 1 -> descend).
const nearSlotEntry = (y, back) => [{ off: 2, near: u8(y + Y_BASE_BIAS), far: back }];

const CRAFTED = [
  // -- the travelling half --
  { name: "ascend, not yet arrived", cfg: { state: STATE_ASCEND, y: 100, destination: 200 },
    expect: { state: STATE_ASCEND, mark: 0, destination: 200 } },
  { name: "ascend, arrived, mode 2 -> mark", cfg: { state: STATE_ASCEND, y: 100, destination: 108, mode: 2 },
    expect: { state: STATE_ON_FOOT, mark: 1, destination: 108 } },
  { name: "ascend, arrived, mode 0 -> no mark", cfg: { state: STATE_ASCEND, y: 100, destination: 108, mode: 0 },
    expect: { state: STATE_ON_FOOT, mark: 0, destination: 108 } },
  { name: "ascend, arrived, mode 3 -> no mark", cfg: { state: STATE_ASCEND, y: 100, destination: 108, mode: 3 },
    expect: { state: STATE_ON_FOOT, mark: 0, destination: 108 } },
  { name: "descend, not yet arrived", cfg: { state: STATE_DESCEND, y: 100, destination: 200 },
    expect: { state: STATE_DESCEND, mark: 0, destination: 200 } },
  // The twin difference: the descent arrives the same way but never marks, mode 2 or not.
  { name: "descend, arrived, mode 2 -> STILL no mark", cfg: { state: STATE_DESCEND, y: 100, destination: 108, mode: 2 },
    expect: { state: STATE_ON_FOOT, mark: 0, destination: 108 } },
  { name: "descend, arrived, mode 0", cfg: { state: STATE_DESCEND, y: 100, destination: 108, mode: 0 },
    expect: { state: STATE_ON_FOOT, mark: 0, destination: 108 } },
  // The biased Y base is an 8-bit value: 250 + 8 wraps to 2, and that IS an arrival.
  { name: "ascend, arrival through the 8-bit wrap", cfg: { state: STATE_ASCEND, y: 250, destination: 2, mode: 2 },
    expect: { state: STATE_ON_FOOT, mark: 1, destination: 2 } },
  { name: "ascend, biased base wraps to 2 but the destination is 3 -> still travelling",
    cfg: { state: STATE_ASCEND, y: 250, destination: 3 },
    expect: { state: STATE_ASCEND, mark: 0, destination: 3 } },
  { name: "descend, arrival through the 8-bit wrap", cfg: { state: STATE_DESCEND, y: 250, destination: 2, mode: 2 },
    expect: { state: STATE_ON_FOOT, mark: 0, destination: 2 } },

  // -- the on-foot half --
  { name: "guard skips: board 1, Y base above the line", cfg: { state: 1, y: GUARD_MIN_Y - 1, entries: farSlotEntry(GUARD_MIN_Y - 1, 77) },
    expect: { state: 1, mark: 0, destination: 0 } },
  { name: "guard closed on 100m: the routine still runs", cfg: { state: 1, board: GUARD_CLOSED_BOARD, y: 10, entries: farSlotEntry(10, 77) },
    expect: { state: STATE_ASCEND, mark: 0, destination: 77 } },
  { name: "table miss: this X is paired with nothing", cfg: { state: 1, y: 240, entries: [] },
    expect: { state: 1, mark: 0, destination: 0 } },
  { name: "far slot -> ascend", cfg: { state: 1, y: 240, entries: farSlotEntry(240, 213) },
    expect: { state: STATE_ASCEND, mark: 0, destination: 213 } },
  { name: "far slot -> ascend, from state 0", cfg: { state: STATE_ON_FOOT, y: 240, entries: farSlotEntry(240, 213) },
    expect: { state: STATE_ASCEND, mark: 0, destination: 213 } },
  { name: "far slot -> ascend, from state 2", cfg: { state: 2, y: 240, entries: farSlotEntry(240, 213) },
    expect: { state: STATE_ASCEND, mark: 0, destination: 213 } },
  { name: "near slot, object above Mario -> descend", cfg: { state: 1, y: 100, marioY: 200, entries: nearSlotEntry(100, 248) },
    expect: { state: STATE_DESCEND, mark: 0, destination: 248 } },
  { name: "near slot, object below Mario -> held", cfg: { state: 1, y: 200, marioY: 100, entries: nearSlotEntry(200, 248) },
    expect: { state: 1, mark: 0, destination: 248 } },
  // The Mario comparison at its exact boundary: level with him holds, one row above descends.
  { name: "near slot, Y base == Mario's row -> held", cfg: { state: 1, y: 150, marioY: 150, entries: nearSlotEntry(150, 248) },
    expect: { state: 1, mark: 0, destination: 248 } },
  { name: "near slot, Y base one above Mario -> descend", cfg: { state: 1, y: 149, marioY: 150, entries: nearSlotEntry(149, 248) },
    expect: { state: STATE_DESCEND, mark: 0, destination: 248 } },
  // The destination is written BEFORE the Mario test, so it lands even on the held arm above.
  { name: "the far entry is found on a rescan past a non-matching one", cfg: {
    state: 1, y: 240, entries: [{ off: 2, near: 0x11, far: 0x22 }, { off: 5, near: 213, far: u8(240 + Y_BASE_BIAS) }] },
    expect: { state: STATE_ASCEND, mark: 0, destination: 213 } },
];

test("EQUAL (crafted): every arm attract never reaches matches the oracle", () => {
  const base = attractBase();
  for (const c of CRAFTED) {
    const entry = craft(base, c.cfg);
    const r = comparePair(entry, driveFireLadderClimb);
    assert.ok(!mismatched(r), `${c.name}: ${describeMismatch(r)}`);
    assert.equal(r.strayWrite, undefined,
      r.strayWrite && `${c.name}: the oracle wrote ${hx(r.strayWrite)} outside the record bytes and STACK_SCRATCH`);
    // Non-vacuity: the ORACLE really produced the outcome this case targets.
    assert.deepEqual(readRecord(r.oracleMachine, RECORD), c.expect,
      `${c.name}: the oracle did not take the targeted arm`);
  }
  console.log(`  EQUAL/crafted: ${CRAFTED.length} arms — both arrivals, the mark and its absence, ` +
    "the descent that must not mark, the 8-bit wrap, both guard outcomes, the table miss, " +
    "both lookup tags, the rescan, and the Mario boundary");
});

test("RECORD-RELATIVE: the fields follow the record pointer, not a fixed address", () => {
  const base = attractBase();
  // Record 0 has arrived; record 1, same RAM, has not.
  const entry = craft(base, { state: STATE_ASCEND, y: 100, destination: 108, mode: 2 });
  entry.mem.write8((RECORD_1 + OBJ_STATE) & 0xffff, STATE_ASCEND);
  entry.mem.write8((RECORD_1 + RECORD_Y_BASE) & 0xffff, 100);
  entry.mem.write8((RECORD_1 + RECORD_DESTINATION) & 0xffff, 200);
  entry.mem.write8((RECORD_1 + RECORD_ARRIVAL_MARK) & 0xffff, 0);

  const at0 = entry.clone(); at0.regs.ix = RECORD;
  const at1 = entry.clone(); at1.regs.ix = RECORD_1;
  assert.equal(readRecord(comparePair(at0, () => {}).oracleMachine, RECORD).state, STATE_ON_FOOT,
    "record 0 must arrive");
  assert.equal(readRecord(comparePair(at1, () => {}).oracleMachine, RECORD_1).state, STATE_ASCEND,
    "record 1 must still be travelling");
  for (const [name, e] of [["record 0", at0], ["record 1", at1]]) {
    const r = comparePair(e, driveFireLadderClimb);
    assert.ok(!mismatched(r), `${name}: ${describeMismatch(r)}`);
  }
  console.log("  RECORD-RELATIVE: the same RAM gives opposite outcomes for the two record pointers, both matched");
});

// -- 3. LIVE (whole attract): the live-out measurement ------------------------

const LIVE_FRAMES = 4000;

/** The all-oracle baseline frame trace. */
let BASELINE = null;
function baselineFrames() {
  if (!BASELINE) {
    const m = new Machine(ROM);
    const sp = recordFrameSp(m);
    m.runFrames(LIVE_FRAMES);
    BASELINE = Object.assign(m.frames, { sp });
  }
  return BASELINE;
}

/**
 * Run attract with `fn` wired at 0x333D. `charge` restores the oracle's measured cycle cost, which
 * cycle-free code does not spend; `after` runs once the candidate has, for the register probe.
 */
function liveRun(fn, { charge = true, after = null } = {}) {
  let calls = 0;
  const ov = new Map([[TARGET, (mm) => {
    calls++;
    let cost = 0, endPc = mm.pc;
    if (charge) {
      const probe = mm.clone();
      const before = probe.cycles;
      oracle(probe);
      cost = probe.cycles - before;
      endPc = probe.pc;
    }
    fn(mm);
    if (after) after(mm);
    if (charge) mm.step(endPc, cost); // charge the oracle's cycles with a known PC
  }]]);
  const m = new Machine(ROM, { overrides: ov });
  const sp = recordFrameSp(m);
  m.runFrames(LIVE_FRAMES);
  return { frames: Object.assign(m.frames, { sp }), calls };
}

/**
 * The state-offset -> RAM-address table for the trace diff. Built with Array.from, NOT
 * `dumpState().map(...)`: dumpState returns a Uint8Array, whose map truncates every address to a
 * byte and silently reports nonsense (and, worse, mis-classifies which bytes are in STACK_SCRATCH).
 */
function addressTable() {
  const probe = new Machine(ROM);
  return Array.from(probe.dumpState(), (_, i) => probe.stateOffsetToAddr(i));
}

/** First (frame, address) where two traces differ outside the stack scratch below each frame's live SP. */
function firstTraceDiff(a, b, addrOf) {
  const n = Math.min(a.length, b.length);
  const floors = frameFloors(a.sp, b.sp);
  for (let i = 0; i < n; i++) {
    const A = a[i], B = b[i];
    const dead = deadStackBelow(STACK_SCRATCH, floors[i]);
    for (let j = 0; j < A.length; j++) {
      if (A[j] !== B[j] && !dead(addrOf[j])) return { frame: i, addr: addrOf[j], a: A[j], b: B[j] };
    }
  }
  return null;
}

test("LIVE: wired at 0x333d for a whole attract run, the trace is identical to the oracle's", () => {
  const base = baselineFrames();
  const addrOf = addressTable();

  const live = liveRun(driveFireLadderClimb);
  assert.ok(live.calls > 0, "the wired routine must actually be dispatched");
  const diff = firstTraceDiff(base, live.frames, addrOf);
  assert.equal(diff, null,
    diff && `live attract diverged at frame ${diff.frame}, ${hx(diff.addr)}: oracle=${diff.a} cand=${diff.b}`);
  assert.equal(live.frames.length, base.length, "the wired run must reach the same frame budget");

  // The live-out claim, measured: nothing downstream reads a register this routine leaves behind.
  const scrambled = liveRun(driveFireLadderClimb, {
    after: (mm) => {
      const r = mm.regs;
      r.a = 0x5a; r.b = 0xa5; r.c = 0x3c; r.d = 0xc3; r.e = 0x69; r.h = 0x96; r.l = 0x0f; r.f = 0xff;
    },
  });
  const sdiff = firstTraceDiff(base, scrambled.frames, addrOf);
  assert.equal(sdiff, null,
    sdiff && `clobbering the registers on exit changed the run at frame ${sdiff.frame}, ${hx(sdiff.addr)} ` +
      "— so one of them IS live-out and the header is wrong");

  console.log(`  LIVE: ${live.calls} dispatches over ${LIVE_FRAMES} attract frames — identical to the ` +
    "all-oracle baseline, and still identical with every register except the record pointer clobbered on exit");
});

test("LIVE TEETH: dropping the oracle's cycle cost DOES move the trace (so the charge is load-bearing)", () => {
  const base = baselineFrames();
  const addrOf = addressTable();

  const uncharged = liveRun(driveFireLadderClimb, { charge: false });
  const diff = firstTraceDiff(base, uncharged.frames, addrOf);
  assert.notEqual(diff, null,
    "an uncharged cycle-free run was expected to shift the NMI and diverge; it did not, which means " +
    "the LIVE test's cycle restoration is not what is making it pass and the comparison may be inert");
  console.log(`  LIVE TEETH: uncharged, the run diverges at frame ${diff.frame}, ${hx(diff.addr)} ` +
    "— a timing artifact, which is exactly why the LIVE test restores the cost");
});

// -- 4. TEETH -----------------------------------------------------------------

/** The shared on-foot lookup, so each twin below differs from the real routine in ONE place. */
function lookup(m, at) {
  const { regs, mem8 } = m;
  regs.d = u8(mem8[at(RECORD_Y_BASE)] + Y_BASE_BIAS);
  regs.a = mem8[at(RECORD_X)];
  regs.bc = TABLE_ENTRIES;
  return findOppositeLadderEnd(m).hit;
}

/** (a) the twin-merge trap: the descent gets the ascent's arrival mark. */
function brokenDescentMarks(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  const state = mem8[at(OBJ_STATE)];
  if (state === STATE_ASCEND || state === STATE_DESCEND) {
    if (u8(mem8[at(RECORD_Y_BASE)] + Y_BASE_BIAS) !== mem8[at(RECORD_DESTINATION)]) return;
    mem8[at(OBJ_STATE)] = STATE_ON_FOOT;
    if (mem8[at(RECORD_MODE)] === 2) mem8[at(RECORD_ARRIVAL_MARK)] = 1; // BUG: not gated on the ascent
    return;
  }
  if (!loc_33a1(m)) return;
  if (!lookup(m, at)) return;
  mem8[at(RECORD_DESTINATION)] = m.regs.b;
  if (m.regs.a === 0) { mem8[at(OBJ_STATE)] = STATE_ASCEND; return; }
  if (mem8[at(RECORD_Y_BASE)] >= mem8[MARIO_Y]) return;
  mem8[at(OBJ_STATE)] = STATE_DESCEND;
}

/** (b) the arrival test drops the bias, so it fires on the wrong row. */
function brokenNoArrivalBias(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  const state = mem8[at(OBJ_STATE)];
  if (state === STATE_ASCEND || state === STATE_DESCEND) {
    if (mem8[at(RECORD_Y_BASE)] !== mem8[at(RECORD_DESTINATION)]) return; // BUG: no bias
    mem8[at(OBJ_STATE)] = STATE_ON_FOOT;
    if (state === STATE_ASCEND && mem8[at(RECORD_MODE)] === 2) mem8[at(RECORD_ARRIVAL_MARK)] = 1;
    return;
  }
  if (!loc_33a1(m)) return;
  if (!lookup(m, at)) return;
  mem8[at(RECORD_DESTINATION)] = m.regs.b;
  if (m.regs.a === 0) { mem8[at(OBJ_STATE)] = STATE_ASCEND; return; }
  if (mem8[at(RECORD_Y_BASE)] >= mem8[MARIO_Y]) return;
  mem8[at(OBJ_STATE)] = STATE_DESCEND;
}

/** (c) the lookup discriminator drops the bias, so the wrong slot of the pair matches. */
function brokenNoLookupBias(m) {
  const { regs, mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  const state = mem8[at(OBJ_STATE)];
  if (state === STATE_ASCEND || state === STATE_DESCEND) return realTravel(m, at, state);
  if (!loc_33a1(m)) return;
  regs.d = mem8[at(RECORD_Y_BASE)]; // BUG: no bias
  regs.a = mem8[at(RECORD_X)];
  regs.bc = TABLE_ENTRIES;
  if (!findOppositeLadderEnd(m).hit) return;
  mem8[at(RECORD_DESTINATION)] = regs.b;
  if (regs.a === 0) { mem8[at(OBJ_STATE)] = STATE_ASCEND; return; }
  if (mem8[at(RECORD_Y_BASE)] >= mem8[MARIO_Y]) return;
  mem8[at(OBJ_STATE)] = STATE_DESCEND;
}

/** The correct travelling half, shared by the twins whose bug is on the on-foot side. */
function realTravel(m, at, state) {
  const { mem8 } = m;
  if (u8(mem8[at(RECORD_Y_BASE)] + Y_BASE_BIAS) !== mem8[at(RECORD_DESTINATION)]) return;
  mem8[at(OBJ_STATE)] = STATE_ON_FOOT;
  if (state === STATE_ASCEND && mem8[at(RECORD_MODE)] === 2) mem8[at(RECORD_ARRIVAL_MARK)] = 1;
}

/** (d) the lookup tag is read the wrong way round, swapping ascent and descent. */
function brokenTagInverted(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  const state = mem8[at(OBJ_STATE)];
  if (state === STATE_ASCEND || state === STATE_DESCEND) return realTravel(m, at, state);
  if (!loc_33a1(m)) return;
  if (!lookup(m, at)) return;
  mem8[at(RECORD_DESTINATION)] = m.regs.b;
  if (m.regs.a !== 0) { mem8[at(OBJ_STATE)] = STATE_ASCEND; return; } // BUG: inverted
  if (mem8[at(RECORD_Y_BASE)] >= mem8[MARIO_Y]) return;
  mem8[at(OBJ_STATE)] = STATE_DESCEND;
}

/** (e) the Mario comparison is inverted: it sets off downward from below him. */
function brokenMarioInverted(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  const state = mem8[at(OBJ_STATE)];
  if (state === STATE_ASCEND || state === STATE_DESCEND) return realTravel(m, at, state);
  if (!loc_33a1(m)) return;
  if (!lookup(m, at)) return;
  mem8[at(RECORD_DESTINATION)] = m.regs.b;
  if (m.regs.a === 0) { mem8[at(OBJ_STATE)] = STATE_ASCEND; return; }
  if (mem8[at(RECORD_Y_BASE)] < mem8[MARIO_Y]) return; // BUG: inverted
  mem8[at(OBJ_STATE)] = STATE_DESCEND;
}

/** (f) the Mario comparison is off by one at the boundary. */
function brokenMarioBoundary(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  const state = mem8[at(OBJ_STATE)];
  if (state === STATE_ASCEND || state === STATE_DESCEND) return realTravel(m, at, state);
  if (!loc_33a1(m)) return;
  if (!lookup(m, at)) return;
  mem8[at(RECORD_DESTINATION)] = m.regs.b;
  if (m.regs.a === 0) { mem8[at(OBJ_STATE)] = STATE_ASCEND; return; }
  if (mem8[at(RECORD_Y_BASE)] > mem8[MARIO_Y]) return; // BUG: level with Mario now descends
  mem8[at(OBJ_STATE)] = STATE_DESCEND;
}

/** (g) the guard's skip is ignored — the caller-skip idiom dropped (the double-execution class). */
function brokenIgnoresGuard(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  const state = mem8[at(OBJ_STATE)];
  if (state === STATE_ASCEND || state === STATE_DESCEND) return realTravel(m, at, state);
  loc_33a1(m); // BUG: the false return must abandon this routine
  if (!lookup(m, at)) return;
  mem8[at(RECORD_DESTINATION)] = m.regs.b;
  if (m.regs.a === 0) { mem8[at(OBJ_STATE)] = STATE_ASCEND; return; }
  if (mem8[at(RECORD_Y_BASE)] >= mem8[MARIO_Y]) return;
  mem8[at(OBJ_STATE)] = STATE_DESCEND;
}

/** (h) the destination is written only on the ascent arm. */
function brokenDestinationOnAscentOnly(m) {
  const { mem8 } = m;
  const at = (d) => (m.regs.ix + d) & 0xffff;
  const state = mem8[at(OBJ_STATE)];
  if (state === STATE_ASCEND || state === STATE_DESCEND) return realTravel(m, at, state);
  if (!loc_33a1(m)) return;
  if (!lookup(m, at)) return;
  if (m.regs.a === 0) { mem8[at(RECORD_DESTINATION)] = m.regs.b; mem8[at(OBJ_STATE)] = STATE_ASCEND; return; }
  if (mem8[at(RECORD_Y_BASE)] >= mem8[MARIO_Y]) return; // BUG: destination never written here
  mem8[at(RECORD_DESTINATION)] = m.regs.b;
  mem8[at(OBJ_STATE)] = STATE_DESCEND;
}

test("TEETH: eight broken twins are all CAUGHT by the crafted + captured entries", () => {
  const base = attractBase();
  const entries = CRAFTED.map((c) => ({ name: c.name, entry: craft(base, c.cfg) }));
  const { caps } = captured();
  const hunt = (fn) => {
    for (const { name, entry } of entries) {
      const r = comparePair(entry, fn);
      if (mismatched(r)) return { name, r };
    }
    for (const entry of caps) {
      const r = comparePair(entry, fn);
      if (mismatched(r)) return { name: "a real attract dispatch", r };
    }
    return null;
  };

  const twins = {
    "descent-marks": brokenDescentMarks,
    "arrival-bias-dropped": brokenNoArrivalBias,
    "lookup-bias-dropped": brokenNoLookupBias,
    "tag-inverted": brokenTagInverted,
    "mario-inverted": brokenMarioInverted,
    "mario-boundary": brokenMarioBoundary,
    "guard-skip-ignored": brokenIgnoresGuard,
    "destination-on-ascent-only": brokenDestinationOnAscentOnly,
  };
  for (const [label, fn] of Object.entries(twins)) {
    const hit = hunt(fn);
    assert.notEqual(hit, null, `the ${label} twin ESCAPED — the gate proves nothing`);
    console.log(`  TEETH/${label}: caught on ${hit.name} — ${describeMismatch(hit.r)}`);
  }

  // The boundary twin must be caught by the level-with-Mario entry specifically: that is the only
  // input separating ">= Mario" from "> Mario", so this is what pins the comparison itself.
  const levelCfg = CRAFTED.find((c) => c.name === "near slot, Y base == Mario's row -> held").cfg;
  assert.ok(mismatched(comparePair(craft(base, levelCfg), brokenMarioBoundary)),
    "the off-by-one twin must be caught by the entry that is exactly level with Mario");
  const aboveCfg = CRAFTED.find((c) => c.name === "near slot, Y base one above Mario -> descend").cfg;
  assert.ok(!mismatched(comparePair(craft(base, aboveCfg), brokenMarioBoundary)),
    "one row above Mario the off-by-one twin agrees — proving the level entry is what caught it");
});
