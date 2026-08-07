// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_46ba — memory-equivalent to the frozen oracle at ROM 0x46BA.
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
 *                   return; the figure is pinned and the stack pointer is asserted to be the ONLY
 *                   register that moves, so the exclusion cannot quietly widen.
 *   5. ★ PARK     — the slot the arm returns through is ASSERTED, not assumed: a twin that
 *                   parks nothing is run on every defined era and its stack pointer must
 *                   end two bytes adrift of the frozen original's. That is what makes the
 *                   park a measured requirement rather than a habit kept from the
 *                   transcription — and what would say so if the arms ever stopped
 *                   returning through the stack.
 *   6. STORES     — the era really selects different stored values, so the sweep is
 *                   separating arms rather than agreeing on one outcome.
 *   7. TEETH      — four broken twins, each caught outside the window.
 *
 * HOLE: the era selector is masked to three bits while the table defines five entries, and
 * indices past the end are NOT exercised. There the two sides also hand the arm different
 * registers, because the frozen dispatch leaves the arm address and a table cursor behind
 * and the rewrite does not; no defined arm reads either, but an undefined one may. The
 * entry is also the walk's dispatch rather than this routine's own, so the surrounding
 * state is one it is never really called with.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-46ba.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_46ba } from "../loc_46ba.js";
import { ERA_INDEX } from "../names.js";
import { loc_46ba as oracle } from "../../translated/loc_46ba.js";
import { loc_3e63 as walk } from "../../translated/loc_3e63.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

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
 * BUG: parks nothing for the arm to return through. It looks tidier than the real thing and
 * leaves the stack adrift on every era. Not one of TWINS: the masked RAM comparison cannot see
 * it, because the byte it fails to write is inside the dead window. The PARK arm judges it.
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
    const r = run(loc_46ba, era);
    assert.equal(r.faultA ?? r.faultB, undefined, `era ${era} faulted: ${r.faultA}/${r.faultB}`);
    assert.deepEqual(r.masked, [], `era ${era}: ${show(r.masked)}`);
  }
  console.log(`  EQUAL: ${DEFINED_ARMS} eras, masked RAM identical on each`);
});

test("SCRATCH: the whole raw difference lies inside the dead window", { skip }, () => {
  let deepest = 0;
  let seen = 0;
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const r = run(loc_46ba, era);
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

test("STACK: the rewrite ends exactly two bytes deeper, and nothing else moves", { skip }, () => {
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const r = run(loc_46ba, era);
    assert.equal(
      r.spA - r.spB,
      DISSOLVED_RET,
      `era ${era}: exit pointers ${hex4(r.spA)} and ${hex4(r.spB)} are ${r.spA - r.spB} bytes ` +
        `apart, not ${DISSOLVED_RET} — the rewrite is moving the stack for some reason other ` +
        "than the one dissolved return",
    );
    assert.deepEqual(
      r.moved,
      ["sp"],
      `era ${era}: a register other than the stack pointer moved — the block past the table ` +
        "writes memory and nothing else, so anything here is a real divergence",
    );
  }
  console.log(`  STACK: exit pointer exactly ${DISSOLVED_RET} bytes deeper on every defined era, sp the only register moved`);
});

test("★ THE PARKED SLOT IS LOAD-BEARING: dropping it leaves the stack two bytes adrift", { skip }, () => {
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const reference = entryState().clone();
    const withoutPark = entryState().clone();
    reference.mem8[ERA_INDEX] = era;
    withoutPark.mem8[ERA_INDEX] = era;
    oracle(reference);
    brokenNoPark(withoutPark);
    assert.equal(
      withoutPark.regs.sp - reference.regs.sp,
      2,
      `era ${era}: dropping the park must leave the stack two bytes adrift. If this is ever ` +
        "zero, the arms no longer return through the stack and the park should go",
    );
  }
  console.log(`  PARK: dropping it is two bytes adrift on all ${DEFINED_ARMS} defined eras`);
});

test("STORES: the era really changes what gets stored", { skip }, () => {
  const seen = new Set();
  for (let era = 0; era < DEFINED_ARMS; era++) {
    const r = run(loc_46ba, era);
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
