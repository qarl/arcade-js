// SPDX-License-Identifier: GPL-3.0-only
/**
 * requestEraKeyedLaunchSound — memory-equivalent to the frozen oracle at ROM 0x3F93.
 *
 * GATE: strict unit-capture at a real dispatch with ONE exclusion, plus an EXHAUSTIVE sweep of
 *   the one cell the routine reads crossed with the permission the request it makes is subject
 *   to. Those two cells ARE the whole input space of this entry. Holes stated:
 *
 *   1. EQUAL at the real dispatch — everything outside a four-byte dead scratch window below the
 *      entry stack pointer, where the frozen request chain parks values the stack-free rewrite
 *      does not. Every arm PINS the window.
 *   2. EXHAUSTIVE — all 256 values of the deciding cell against three permission values, each
 *      poked identically on both sides.
 *   3. BOTH ARMS REACHED, and shown DISTINGUISHABLE: the two requests differ in the byte they
 *      queue, so the sweep is checked to contain values that queue one and values that queue the
 *      other, and the two bytes are asserted to be different. Without that check a gate could
 *      pass a rewrite that always took the same arm.
 *   4. THE SPLIT POINT IS PINNED — the highest value taking the low arm and the lowest taking the
 *      high one are located inside the sweep and named.
 *   5. CORPUS — every dispatch of a driven session, on a clone taken at the dispatch.
 *   6. TEETH — six twins, each caught on its own exact count over the sweep; two of them
 *      move the split by one and are caught on exactly two entries apiece.
 *
 * HOLE: WHAT the two sounds are is not decidable here; they are bytes handed to another
 * processor. This gate fixes which byte goes out for which value of the deciding cell.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3f93.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { requestEraKeyedLaunchSound } from "../requestEraKeyedLaunchSound.js";
import { loc_3f93 as oracle } from "../../translated/loc_3f93.js";
import { loc_565f } from "../loc_565f.js";
import { loc_5669 } from "../loc_5669.js";
import { ERA_INDEX, PLAY_ACTIVE } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x3f93;

/** The queue the two requests reach, and the cell holding how many codes are waiting in it. */
const QUEUE_LENGTH = 0xac43;
const SPLIT_AT = 3;

/**
 * The dead stack scratch: the frozen request chain brackets its work with pushes the stack-free
 * rewrite does not make. Measured as an upper bound; every arm pins it.
 */
const SCRATCH_BYTES = 4;

/** Dispatches the shared tape produces in the harness budget. Measured; a move is a finding. */
const DISPATCHES = 1;

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

function outsideScratch(a, b, sp) {
  return allDiffs(a, b).filter((d) => d.addr < sp - SCRATCH_BYTES || d.addr >= sp);
}

function compare(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return outsideScratch(a, b, sp)[0] ?? null;
}

let captured = null;

function replay(candidate) {
  let dispatches = 0;
  let caught = 0;
  const eras = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    eras.add(mm.mem8[ERA_INDEX]);
    if (captured === null) captured = mm.clone();
    if (compare(candidate, mm)) caught++;
    return oracle(mm);
  }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  return { dispatches, caught, eras };
}

function entryState() {
  if (captured === null) replay(requestEraKeyedLaunchSound);
  return captured;
}

function craft(era, play, length = 2) {
  const m = entryState().clone();
  m.mem8[ERA_INDEX] = era;
  m.mem8[PLAY_ACTIVE] = play;
  m.mem8[QUEUE_LENGTH] = length;
  return m;
}

const PERMISSIONS = [0x00, 0x01, 0xff];
const SWEEP_SIZE = 256 * PERMISSIONS.length;

function sweepCaught(candidate) {
  let caught = 0;
  for (const play of PERMISSIONS) {
    for (let era = 0; era < 256; era++) if (compare(candidate, craft(era, play))) caught++;
  }
  return caught;
}

/** The byte the frozen routine queues for one value of the deciding cell, or null if none. */
function queuedFor(era) {
  const m = craft(era, 0xff, 2);
  oracle(m);
  return m.mem8[QUEUE_LENGTH] === 3 ? m.mem8[QUEUE_LENGTH + 3] : null;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  const entry = entryState();
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  requestEraKeyedLaunchSound(b);
  assert.deepEqual(
    outsideScratch(a, b, sp),
    [],
    `a divergence escaped the scratch window — ${show(outsideScratch(a, b, sp)[0])}`,
  );
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    ["a", "f", "sp"],
    "the excluded set changed shape: none of these outlives the entry",
  );
  console.log(`  EQUAL: era ${entry.mem8[ERA_INDEX]}, sp ${hex4(sp)}`);
});

test("EXHAUSTIVE: all 256 values of the deciding cell, under three permissions", { skip }, () => {
  for (const play of PERMISSIONS) {
    for (let era = 0; era < 256; era++) {
      const d = compare(requestEraKeyedLaunchSound, craft(era, play));
      assert.equal(d, null, `era=${era} play=${play}: ${show(d)}`);
    }
  }
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} combinations identical`);
});

test("BOTH ARMS REACHED, and they queue DIFFERENT bytes", { skip }, () => {
  const low = queuedFor(0);
  const high = queuedFor(4);
  assert.notEqual(low, null, "the low arm queued nothing, so the sweep cannot discriminate");
  assert.notEqual(high, null, "the high arm queued nothing, so the sweep cannot discriminate");
  assert.notEqual(
    low,
    high,
    "both arms queue the same byte, so nothing here can tell them apart and every twin below " +
      "that only swaps them would pass",
  );
  console.log(`  ARMS: the low arm queues ${low}, the high arm queues ${high}`);
});

test("THE SPLIT POINT IS PINNED at the value the deciding cell reaches", { skip }, () => {
  const low = queuedFor(0);
  const high = queuedFor(255);
  assert.equal(queuedFor(SPLIT_AT - 1), low, "the value below the split no longer takes the low arm");
  assert.equal(queuedFor(SPLIT_AT), high, "the split value no longer takes the high arm");
  console.log(`  SPLIT: below ${SPLIT_AT} queues ${low}, from ${SPLIT_AT} up queues ${high}`);
});

test("CORPUS: every dispatch of a driven session replays identically", { skip }, () => {
  const r = replay(requestEraKeyedLaunchSound);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, `the rewrite diverged on ${r.caught} real dispatches`);
  console.log(`  CORPUS: ${r.dispatches} dispatch identical; eras ${[...r.eras].join(",")}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

const TWINS = [
  ["no-op", () => {}, 512],
  ["always-the-low-arm", (m) => loc_565f(m), 506],
  ["always-the-high-arm", (m) => loc_5669(m), 6],
  ["arms-swapped", (m) => (m.mem8[ERA_INDEX] < SPLIT_AT ? loc_5669(m) : loc_565f(m)), 512],
  [
    "split-one-low",
    (m) => (m.mem8[ERA_INDEX] < SPLIT_AT - 1 ? loc_565f(m) : loc_5669(m)),
    2,
  ],
  [
    "split-one-high",
    (m) => (m.mem8[ERA_INDEX] < SPLIT_AT + 1 ? loc_565f(m) : loc_5669(m)),
    2,
  ],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of the sweep`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${SWEEP_SIZE} sweep entries`);
  });
}
