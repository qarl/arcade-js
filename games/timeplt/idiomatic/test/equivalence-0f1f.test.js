// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0f1f — memory-equivalent to the frozen oracle at ROM 0x0F1F.
 *
 * GATE: unit-capture with a MASKED diff, plus a sweep of every arm the table names.
 *
 * WHY MASKED, and exactly what the mask hides. Two effects, both confined to stack bytes
 *   below the pointer the routine leaves, and both established by experiment rather than
 *   assumed:
 *
 *   - The frozen twin reaches its arm through the ROM's restart-vector dispatch, three
 *     nested calls deep. Each pushes a return address just under the slot the arm returns
 *     through and pops it again, leaving it behind as scratch; the rewrite computes the
 *     same arm arithmetically and never writes those bytes. Reproducing exactly those
 *     pushes and pops in a probe twin removed the divergence on every arm but one, which
 *     is what identifies this as the cause rather than a guess about it.
 *   - On that one remaining arm the dispatch's arithmetic also leaves DIFFERENT FLAG BITS,
 *     and a routine inside the arm pushes the flag byte. It is popped back before anything
 *     reads it, so the only trace is one more scratch byte. Cycle count was ruled out
 *     separately: advancing one side by the cycles the rewrite does not charge changes
 *     nothing at all.
 *
 *   WINDOW is the deepest such byte the sweep finds, and the SCRATCH arm asserts the
 *   measured depth against it, so the window cannot silently grow. A mask can blind a
 *   gate, so every twin below is required to be caught OUTSIDE it.
 *
 *   1. DISPATCHED — the tape reaches the routine, repeatedly.
 *   2. EQUAL      — masked RAM identical at the real dispatch.
 *   3. SCRATCH    — the unmasked difference lies wholly inside the dead window, and the
 *                   measured depth is asserted against the window rather than assumed.
 *   4. ARMS       — every table entry runs, each identical, or faulting the same way on
 *                   both sides, which one of them does from a forced selector.
 *   5. SELECTOR   — the selector cell swept over its whole range, not just the low nibble,
 *                   so the mask that discards the high bits is itself under test.
 *   6. IDLE ARM   — the block past the table returns at once while play is active, so
 *                   nothing can tell whether it ran; this arm establishes the state in
 *                   which it does write, and fails if that stops being true.
 *   7. STACK      — both sides leave the same stack pointer, which is what makes the
 *                   window's position meaningful at all.
 *   8. TEETH      — broken twins, each caught outside the window, over both the live
 *                   and the idle state.
 *
 * HOLE: one captured machine. The sweeps force the selector cell, so an arm the tape never
 * selects runs against a state it would not really see; where that faults, the arm is
 * asserted only to fault IDENTICALLY on both sides, not to be correct.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0f1f.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_0f1f } from "../loc_0f1f.js";
import { PLAY_ACTIVE, SEQUENCE_SUBSTEP } from "../names.js";
import { loc_0f1f as oracle } from "../../translated/loc_0f1f.js";

const TARGET = 0x0f1f;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const ARM_TABLE = 0x0f29;
const ARM_MASK = 0x0f;
const ARM_COUNT = ARM_MASK + 1;
const AFTER_ARM = 0x0f54;
/** Bytes below the exit stack pointer the dispatch's dead scratch reaches; measured. */
const WINDOW = 10;
/**
 * The second cell the block past the table tests, after the play flag. With play active
 * that block returns at once and writes nothing, so nothing can tell whether it ran; the
 * IDLE arm clears the play flag and sets this one, which is the state in which it writes.
 * No registry name, so it stays hex here deliberately.
 */
const SECOND_TEST_CELL = 0xa986;

let entry = null;
let dispatches = 0;

function entryState() {
  if (entry === null) {
    const ov = new Map([
      [TARGET, (mm) => {
        dispatches++;
        if (entry === null) entry = mm.clone();
        return oracle(mm);
      }],
    ]);
    makeMachine(ov).runFrames(ENTRY_FRAMES);
    assert.notEqual(entry, null, `0x0f1f never entered within ${ENTRY_FRAMES} frames`);
  }
  return entry;
}

/** Run both sides on clones of the entry with the selector forced, and report everything. */
function run(candidate, index, idle = false) {
  const a = entryState().clone();
  const b = entryState().clone();
  for (const mm of [a, b]) {
    if (index !== undefined) mm.mem8[SEQUENCE_SUBSTEP] = index;
    if (idle) {
      mm.mem8[PLAY_ACTIVE] = 0;
      mm.mem8[SECOND_TEST_CELL] = 1;
    }
  }
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
  return { all, masked: all.filter((d) => !inWindow(d)), spA: exitSp, spB: b.regs.sp };
}

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (ds) =>
  ds.length === 0 ? "identical" : ds.map((d) => `${hex4(d.addr)}(${d.a}/${d.b})`).join(" ");

// ── broken twins ────────────────────────────────────────────────────────────────────────

/** BUG: does nothing — neither the arm nor the block that follows the table. */
function brokenNoOp() {}

/** BUG: takes the next entry of the table. */
function brokenNextArm(m) {
  const i = (m.mem8[SEQUENCE_SUBSTEP] + 1) & ARM_MASK;
  m.push16(AFTER_ARM);
  m.call(m.mem16[ARM_TABLE + 2 * i]);
  m.call(AFTER_ARM);
}

/** BUG: runs the arm and stops, never reaching the block past the table. */
function brokenSkipsAfter(m) {
  const i = m.mem8[SEQUENCE_SUBSTEP] & ARM_MASK;
  m.push16(AFTER_ARM);
  m.call(m.mem16[ARM_TABLE + 2 * i]);
}

/** BUG: masks one bit too wide, so half the selectors index past the table. */
function brokenWideMask(m) {
  const i = m.mem8[SEQUENCE_SUBSTEP] & 0x1f;
  m.push16(AFTER_ARM);
  m.call(m.mem16[ARM_TABLE + 2 * i]);
  m.call(AFTER_ARM);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["next-arm", brokenNextArm],
  ["skips-after", brokenSkipsAfter],
  ["wide-mask", brokenWideMask],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: the tape reaches the routine, repeatedly", { skip }, () => {
  const e = entryState();
  assert.ok(dispatches > 1, `only ${dispatches} dispatch(es): this is not the live path`);
  console.log(
    `  DISPATCHED: ${dispatches} times in ${ENTRY_FRAMES} frames; captured with selector ` +
      `${e.mem8[SEQUENCE_SUBSTEP] & ARM_MASK}`,
  );
});

test("EQUAL at the real dispatch: masked RAM identical", { skip }, () => {
  const r = run(loc_0f1f);
  assert.equal(r.faultA ?? r.faultB, undefined, "the real dispatch must not fault");
  assert.deepEqual(r.masked, [], `RAM diverged outside the dead window — ${show(r.masked)}`);
  console.log(`  EQUAL: masked RAM identical; raw difference ${show(r.all)}`);
});

test("SCRATCH: the whole raw difference lies inside the dead window", { skip }, () => {
  let deepest = 0;
  let seen = 0;
  for (let i = 0; i < ARM_COUNT; i++) {
    const r = run(loc_0f1f, i);
    if (r.faultA || r.faultB) continue;
    for (const d of r.all) {
      assert.ok(d.addr < r.spA, `arm ${i}: ${hex4(d.addr)} is at or above the exit pointer`);
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
    `  SCRATCH: ${seen} differing bytes across the arms, deepest ${deepest} below the exit ` +
      `pointer, window ${WINDOW}`,
  );
});

test("ARMS: every table entry runs identically, or faults identically", { skip }, () => {
  const faulted = [];
  for (let i = 0; i < ARM_COUNT; i++) {
    const r = run(loc_0f1f, i);
    if (r.faultA || r.faultB) {
      assert.equal(r.faultA, r.faultB, `arm ${i}: ${r.faultA} on one side, ${r.faultB} on the other`);
      faulted.push(i);
      continue;
    }
    assert.deepEqual(r.masked, [], `arm ${i}: ${show(r.masked)}`);
  }
  assert.ok(faulted.length < ARM_COUNT, "every arm faulted: this sweep proves nothing");
  console.log(
    `  ARMS: ${ARM_COUNT} entries swept, ${faulted.length} faulting identically on both ` +
      `sides (${faulted.join(", ") || "none"})`,
  );
});

test("SELECTOR: the high nibble is ignored, over the cell's whole range", { skip }, () => {
  let swept = 0;
  for (let v = 0; v < 256; v++) {
    const r = run(loc_0f1f, v);
    if (r.faultA || r.faultB) {
      assert.equal(r.faultA, r.faultB, `selector ${v}: ${r.faultA} vs ${r.faultB}`);
    } else {
      assert.deepEqual(r.masked, [], `selector ${v}: ${show(r.masked)}`);
    }
    swept++;
  }
  assert.equal(swept, 256, "must have swept the whole selector cell");
  console.log(`  SELECTOR: ${swept} values identical — only the low nibble can matter`);
});

test("IDLE ARM: with play inactive the block past the table stops doing nothing", { skip }, () => {
  const busy = run(brokenSkipsAfter, 0, false);
  const idle = run(brokenSkipsAfter, 0, true);
  assert.deepEqual(
    busy.masked,
    [],
    "the block past the table now writes while play is active, so this arm's premise is " +
      "gone and the skips-after twin should be gated on the live entry instead",
  );
  assert.ok(
    idle.masked.length > 0,
    "the block past the table writes nothing even with play inactive, so no state reachable " +
      "from this entry can tell whether it ran",
  );
  console.log(`  IDLE ARM: inert while play is active, live with it clear — ${show(idle.masked)}`);
});

test("STACK: both sides leave the same stack pointer", { skip }, () => {
  for (let i = 0; i < ARM_COUNT; i++) {
    const r = run(loc_0f1f, i);
    if (r.faultA || r.faultB) continue;
    assert.equal(r.spA, r.spB, `arm ${i}: exit pointers ${hex4(r.spA)} and ${hex4(r.spB)}`);
  }
  console.log("  STACK: exit pointer identical on every arm that completes");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT outside the window`, { skip }, () => {
    const caught = [];
    for (const idle of [false, true]) {
      for (let v = 0; v < 256; v++) {
        const r = run(twin, v, idle);
        if (r.faultA || r.faultB) {
          if (r.faultA !== r.faultB) caught.push(`${idle ? "idle " : ""}${v}`);
          continue;
        }
        if (r.masked.length > 0) caught.push(`${idle ? "idle " : ""}${v}`);
      }
    }
    assert.ok(
      caught.length > 0,
      `the masked comparison PASSED the ${label} twin on every selector — either the twin ` +
        "is not broken or the window has swallowed the evidence",
    );
    console.log(`  TEETH/${label}: caught on ${caught.length} selectors, first ${caught[0]}`);
  });
}
