// SPDX-License-Identifier: GPL-3.0-only
/**
 * setMotherShipVelocityFromHeading — memory-equivalent to the frozen oracle at ROM 0x46BA.
 *
 * GATE: crafted-entry with a MASKED diff. Two things force that shape.
 *
 *   CRAFTED, because the shared coin -> start tape never dispatches 0x46BA — the UNREACHED
 *   arm runs the whole tape with a counting hook and asserts zero. So the entry is a REAL
 *   machine taken at a live dispatch of the per-record walk at 0x3E63, which leaves the
 *   index register on one of the object records this routine writes through, and the era
 *   selector is then forced across the entries the table defines.
 *
 *   MASKED, because the frozen twin reaches its arm through the ROM's restart-vector
 *   dispatch. That dispatch is nested calls deep; each pushes a return address into the
 *   stack bytes just below the slot the arm returns through and pops it again, leaving it
 *   as dead scratch, and the rewrite computes the same arm arithmetically without writing
 *   them. Every one of those bytes is BELOW the stack pointer both sides leave; WINDOW is
 *   the deepest the sweep finds and the SCRATCH arm asserts it, so the window cannot
 *   silently grow.
 *
 *   1. UNREACHED  — the tape really does not dispatch this address.
 *   2. EQUAL      — masked RAM identical on every era the table defines.
 *   3. SCRATCH    — the unmasked difference lies wholly inside the dead window.
 *   4. STACK      — the rewrite ends exactly one word deeper than the frozen twin, because it
 *                   calls the block past the table directly and that block's `ret` becomes a JS
 *                   return; the figure is pinned. Besides the stack pointer only the arm's own
 *                   walking scratch (a/f/h/l) may differ: the frozen arms walk the table in them,
 *                   the rewrite's arms hand back only the pair. The continuation reloads a and
 *                   the flags before reading them. h/l are not read either: the caller's tail
 *                   saves and restores them, they pass unread out through 0x43B7, and the round
 *                   service's next call overwrites them (0x28A1 -> 0x290E, rst 0x30, pop hl). The set is pinned
 *                   and cannot quietly widen.
 *   5. ★ LIVE     — against the dispatch the live game ran before this rewrite, the table word
 *                   dispatched through the seam into the lifted arms with a slot parked for it:
 *                   every register, the stack pointer included, and all RAM outside that dead
 *                   slot are identical, so calling the arms directly changes nothing the game sees.
 *   6. ★ SEAM     — the rewrite is seam-placeable on every defined era and a direct call leaves
 *                   the stack where it found it; a control that parks a word nothing lifts is
 *                   refused, and one that dispatches the arm without a park drifts the stack.
 *   7. PAST       — the three indices past the table fault on both sides: two name no routine
 *                   and fault alike; on the last the frozen twin runs the six-digit painter into a
 *                   ROM write the board refuses, while the rewrite stops before it with NotImplemented.
 *   8. STORES     — the era really selects different stored values, so the sweep is
 *                   separating arms rather than agreeing on one outcome.
 *   9. TEETH      — four broken twins, each caught outside the window.
 *
 * HOLE: past the table only the fault is compared, not what each side wrote before faulting.
 * The entry is also the walk's dispatch rather than this routine's own, so the surrounding
 * state is one it is never really called with.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-46ba.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { setMotherShipVelocityFromHeading } from "../setMotherShipVelocityFromHeading.js";
import { ERA_INDEX } from "../names.js";
import { loc_46ba as oracle } from "../../translated/loc_46ba.js";
import { loc_3e63 as walk } from "../../translated/loc_3e63.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { withOmittedRet } from "../../machine.js";
import { loc_5942 } from "../loc_5942.js";
import { loc_594e } from "../loc_594e.js";
import { loc_5965 } from "../loc_5965.js";
import { loc_596b } from "../loc_596b.js";
import { paintSixDigitFieldSuppressingLeadingZeros } from "../paintSixDigitFieldSuppressingLeadingZeros.js";
import { fileTwoPairsIntoObjectRecordHighByteFirst } from "../fileTwoPairsIntoObjectRecordHighByteFirst.js";

const TARGET = 0x46ba;
const WALK = 0x3e63;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const ARM_TABLE = 0x46c4;
const AFTER_ARM = 0x46ce;
/** Entries the table actually defines; the selector mask admits more than this. */
const DEFINED_ARMS = 5;
/** Bytes below the exit stack pointer the dispatch's dead scratch reaches; measured. */
const WINDOW = 8;
/**
 * The rewrite calls the block past the table directly instead of dispatching its address, so that
 * block's closing `ret` becomes a JS return and the two bytes it would have popped stay on the
 * stack. One dissolved return, one word: the STACK arm pins the figure so the cost cannot grow.
 */
const DISSOLVED_RET = 2;
/** The frozen arms' table-walking scratch, which the rewrite's arms do not reproduce. */
const ARM_SCRATCH = ["a", "f", "h", "l"];
/** The routines the live game had lifted at each table word, keyed by the word. */
const LIFTED_ARMS = [
  [0x5942, loc_5942], [0x594e, loc_594e], [0x5965, loc_5965], [0x596b, loc_596b],
  [0x0d73, paintSixDigitFieldSuppressingLeadingZeros],
];
/** Indices the mask admits past the table's defined arms. */
const PAST_THE_TABLE = [5, 6, 7];
/** The index whose word names the six-digit painter. */
const PAINTER_ARM = 7;
/** Where the block past the table parks the two pairs the arm hands back. */
const STORED_AT = [0x0c, 0x0d, 0x1c, 0x1d];

let entry = null;

/** A real machine, taken at a live dispatch of the per-record walk. */
function entryState() {
  if (entry === null) {
    const ov = new Map([
      [WALK, (mm) => {
        if (entry === null) entry = mm.clone();
        return walk(mm);
      }],
    ]);
    makeMachine(ov).runFrames(ENTRY_FRAMES);
    assert.notEqual(entry, null, `the walk at 0x3e63 never dispatched in ${ENTRY_FRAMES}`);
  }
  return entry;
}

function run(candidate, era) {
  const a = entryState().clone();
  const b = entryState().clone();
  a.mem8[ERA_INDEX] = era;
  b.mem8[ERA_INDEX] = era;
  let fa = null;
  let fb = null;
  try { oracle(a); } catch (e) { fa = e.constructor.name; }
  try { candidate(b); } catch (e) { fb = e.constructor.name; }
  if (fa || fb) return { faultA: fa, faultB: fb };

  const da = a.dumpState();
  const db = b.dumpState();
  const all = [];
  for (let off = 0; off < da.length; off++) {
    if (da[off] !== db[off]) all.push({ addr: a.stateOffsetToAddr(off), a: da[off], b: db[off] });
  }
  const exitSp = a.regs.sp;
  const inWindow = (d) => d.addr >= exitSp - WINDOW && d.addr < exitSp;
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  return { all, masked: all.filter((d) => !inWindow(d)), spA: exitSp, spB: b.regs.sp, moved, after: a };
}

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (ds) =>
  ds.length === 0 ? "identical" : ds.map((d) => `${hex4(d.addr)}(${d.a}/${d.b})`).join(" ");

// ── broken twins ────────────────────────────────────────────────────────────────────────

/** BUG: does nothing — neither the arm nor the block that follows the table. */
function brokenNoOp() {}

/** BUG: takes the next entry of the table. */
function brokenNextArm(m) {
  const i = (m.mem8[ERA_INDEX] + 1) & 0x07;
  m.push16(AFTER_ARM);
  m.call(m.mem16[ARM_TABLE + 2 * i]);
  m.call(AFTER_ARM);
}

/** BUG: ignores the era and always takes the first entry. */
function brokenFirstArm(m) {
  m.push16(AFTER_ARM);
  m.call(m.mem16[ARM_TABLE]);
  m.call(AFTER_ARM);
}

/**
 * BUG: sends the table word through the call seam with nothing parked, so the arm's return lifts
 * a word nothing laid down. Not one of TWINS: the masked RAM comparison cannot see it, because the
 * byte it fails to write is inside the dead window. The SEAM arm judges it.
 */
function brokenNoPark(m) {
  const i = m.mem8[ERA_INDEX] & 0x07;
  m.call(m.mem16[ARM_TABLE + 2 * i]);
  m.call(AFTER_ARM);
}

/** BUG: runs the arm and stops, so nothing the arm produced is ever stored. */
function brokenSkipsAfter(m) {
  const i = m.mem8[ERA_INDEX] & 0x07;
  m.push16(AFTER_ARM);
  m.call(m.mem16[ARM_TABLE + 2 * i]);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["next-arm", brokenNextArm],
  ["first-arm", brokenFirstArm],
  ["skips-after", brokenSkipsAfter],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: the shared tape never dispatches this address", { skip }, () => {
  let hits = 0;
  let walkHits = 0;
  const ov = new Map([
    [TARGET, (mm) => { hits++; return oracle(mm); }],
    [WALK, (mm) => { walkHits++; return walk(mm); }],
  ]);
  makeMachine(ov).runFrames(ENTRY_FRAMES);
  assert.ok(walkHits > 0, "the counting hook is not wired: even the walk shows no hits");
  assert.equal(hits, 0, "the tape DOES reach this entry now — capture it instead of crafting");
  console.log(`  UNREACHED: 0 dispatches in ${ENTRY_FRAMES} frames (walk: ${walkHits})`);
});

test("EQUAL: masked RAM identical on every era the table defines", { skip }, () => {
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const r = run(setMotherShipVelocityFromHeading, era);
    assert.equal(r.faultA ?? r.faultB, undefined, `era ${era} faulted: ${r.faultA}/${r.faultB}`);
    assert.deepEqual(r.masked, [], `era ${era}: ${show(r.masked)}`);
  }
  console.log(`  EQUAL: ${DEFINED_ARMS} eras, masked RAM identical on each`);
});

test("SCRATCH: the whole raw difference lies inside the dead window", { skip }, () => {
  let deepest = 0;
  let seen = 0;
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const r = run(setMotherShipVelocityFromHeading, era);
    for (const d of r.all) {
      assert.ok(d.addr < r.spA, `era ${era}: ${hex4(d.addr)} is at or above the exit pointer`);
      deepest = Math.max(deepest, r.spA - d.addr);
      seen++;
    }
  }
  assert.ok(seen > 0, "no raw difference at all: the mask is not measuring anything");
  assert.ok(
    deepest <= WINDOW,
    `the deepest difference is ${deepest} bytes below the exit pointer, past the ${WINDOW}-` +
      "byte window this file masks — widen it deliberately, do not let it drift",
  );
  console.log(
    `  SCRATCH: ${seen} differing bytes across the eras, deepest ${deepest} below the exit ` +
      `pointer, window ${WINDOW}`,
  );
});

test("STACK: the rewrite ends exactly two bytes deeper, and only the arm scratch differs", { skip }, () => {
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const r = run(setMotherShipVelocityFromHeading, era);
    assert.equal(
      r.spA - r.spB,
      DISSOLVED_RET,
      `era ${era}: exit pointers ${hex4(r.spA)} and ${hex4(r.spB)} are ${r.spA - r.spB} bytes ` +
        `apart, not ${DISSOLVED_RET} — the rewrite is moving the stack for some reason other ` +
        "than the one dissolved return",
    );
    assert.ok(r.moved.includes("sp"), `era ${era}: the stack pointer did not move`);
    const stray = r.moved.filter((k) => k !== "sp" && !ARM_SCRATCH.includes(k));
    assert.deepEqual(stray, [], `era ${era}: a register outside the arm's walking scratch moved`);
  }
  console.log(`  STACK: exit pointer exactly ${DISSOLVED_RET} bytes deeper on every defined era; only sp and ${ARM_SCRATCH.join("/")} differ`);
});

/** The dispatch the live game ran before this rewrite: park the block's address, send the table
 *  word through the call seam into whatever the machine holds there, then run the block. */
function previousDispatch(m) {
  const i = m.mem8[ERA_INDEX] & 0x07;
  m.push16(AFTER_ARM);
  m.call(m.mem16[ARM_TABLE + 2 * i]);
  fileTwoPairsIntoObjectRecordHighByteFirst(m);
}

/** The entry on a machine that holds the lifted arms, as the live game does. */
function liveRouted(era) {
  const m = entryState().clone();
  m.routines = new Map(m.routines);
  for (const [addr, fn] of LIFTED_ARMS) m.routines.set(addr, withOmittedRet(fn, addr));
  m.mem8[ERA_INDEX] = era;
  return m;
}

test("★ LIVE: identical to the seam-routed dispatch into the lifted arms, registers included", { skip }, () => {
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const a = liveRouted(era);
    const b = liveRouted(era);
    const sp = a.regs.sp;
    previousDispatch(a);
    setMotherShipVelocityFromHeading(b);
    const da = a.dumpState();
    const db = b.dumpState();
    for (let off = 0; off < da.length; off++) {
      if (da[off] === db[off]) continue;
      const addr = a.stateOffsetToAddr(off);
      assert.ok(addr >= sp - 2 && addr < sp, `era ${era}: ${hex4(addr)} differs outside the parked slot`);
    }
    const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
    assert.deepEqual(moved, [], `era ${era}: a register differs from the live dispatch`);
  }
  // ★ control: the same comparison sees an arm taken from the wrong table word.
  const a = liveRouted(1);
  const b = liveRouted(1);
  previousDispatch(a);
  b.mem8[ERA_INDEX] = 3;
  setMotherShipVelocityFromHeading(b);
  b.mem8[ERA_INDEX] = 1;
  const differs = REG_FIELDS.some((k) => a.regs[k] !== b.regs[k]) ||
    a.dumpState().some((v, i) => v !== b.dumpState()[i] && a.stateOffsetToAddr(i) >= a.regs.sp);
  assert.ok(differs, "the live comparison passed an arm taken from the wrong word");
  console.log(`  LIVE: ${DEFINED_ARMS} eras identical to the seam-routed dispatch, every register included`);
});

test("★ SEAM: placed on every defined era, SP-neutral when called directly; both controls caught", { skip }, () => {
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const e = entryState().clone();
    e.mem8[ERA_INDEX] = era;
    const direct = e.clone();
    setMotherShipVelocityFromHeading(direct);
    assert.equal(direct.regs.sp, e.regs.sp, `era ${era}: a direct call moved the stack pointer`);
    const r = seamPlaceable(withOmittedRet, setMotherShipVelocityFromHeading, TARGET, e.clone());
    assert.equal(r.placeable, true, `era ${era}: the seam cannot place the rewrite: ${r.error}`);
    const strayWord = (m) => { m.push16(AFTER_ARM); setMotherShipVelocityFromHeading(m); };
    assert.equal(seamPlaceable(withOmittedRet, strayWord, TARGET, e.clone()).placeable, false,
      `era ${era}: the seam placed a rewrite that parks a word nothing lifts`);
    const unparked = e.clone();
    brokenNoPark(unparked);
    // The unparked twin's arm lifts a word nothing laid down, and its dispatched block lifts another.
    assert.equal(unparked.regs.sp - e.regs.sp, 4, `era ${era}: an unparked table dispatch no longer lifts its words`);
  }
  console.log(`  SEAM: ${DEFINED_ARMS} eras placed and SP-neutral; the stray park is refused, the unparked dispatch drifts`);
});

test("PAST: the indices past the table fault on both sides", { skip }, () => {
  for (const era of PAST_THE_TABLE) {
    const r = run(setMotherShipVelocityFromHeading, era);
    assert.ok(r.faultA, `era ${era}: the frozen twin did not fault`);
    if (era === PAINTER_ARM) {
      assert.equal(r.faultA, "UnmappedAccess", `era ${era}: the frozen twin faulted as ${r.faultA}, not on the painter's ROM write`);
      assert.equal(r.faultB, "NotImplemented", `era ${era}: the rewrite faulted as ${r.faultB}`);
    } else {
      assert.equal(r.faultB, r.faultA, `era ${era}: the rewrite faulted as ${r.faultB}, the frozen twin as ${r.faultA}`);
    }
  }
  console.log(`  PAST: eras ${PAST_THE_TABLE.join(", ")} fault identically on both sides`);
});

test("STORES: the era really changes what gets stored", { skip }, () => {
  const seen = new Set();
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const r = run(setMotherShipVelocityFromHeading, era);
    const record = r.after.regs.ix;
    seen.add(STORED_AT.map((d) => r.after.mem8[record + d]).join(","));
  }
  assert.ok(
    seen.size > 1,
    "every era stored the same bytes, so this sweep cannot tell the arms apart and the " +
      "comparison is agreeing on one outcome rather than five",
  );
  console.log(`  STORES: ${seen.size} distinct stored quadruples across ${DEFINED_ARMS} eras`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT outside the window`, { skip }, () => {
    const caught = [];
    for (let era = 0; era < DEFINED_ARMS; era++) {
      const r = run(twin, era);
      if (r.faultA || r.faultB) {
        if (r.faultA !== r.faultB) caught.push(era);
        continue;
      }
      if (r.masked.length > 0) caught.push(era);
    }
    assert.ok(
      caught.length > 0,
      `the masked comparison PASSED the ${label} twin on every era — either the twin is not ` +
        "broken or the window has swallowed the evidence",
    );
    console.log(`  TEETH/${label}: caught on eras ${caught.join(", ")}`);
  });
}
