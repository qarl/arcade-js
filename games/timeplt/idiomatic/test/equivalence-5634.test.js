// SPDX-License-Identifier: GPL-3.0-only
/**
 * enqueueTransitionSoundStops — memory-equivalent to the frozen oracle at ROM 0x5634.
 *
 * WHAT IT IS. Seven requests queued back to back through a shared body that is ALREADY DECOMPILED,
 * so the rewrite calls it directly and dissolving those seven transfers belongs to this caller's
 * unit. Six of the seven codes are fetched out of the program image rather than carried as
 * immediates, and the seventh is computed from the era index.
 *
 * GATE: strict unit-capture at the one real dispatch of the shared coin -> start tape, plus an
 *   image-poke arm, an exhaustive era sweep, and teeth.
 *
 * What it exercises, with the holes stated:
 *   1. EQUAL at the real dispatch — identical outside an eight-byte scratch window.
 *   2. THE SCRATCH WINDOW IS THE ONE EXCLUSION, pinned to [SP-8, SP): each of the seven transfers
 *      brackets its work with pushed pairs and the rewrite models no stack. Every arm walks the
 *      whole dump and asserts nothing escapes the window; it is an upper bound, not a prediction.
 *   3. NOT VACUOUS — a candidate that does nothing fails the same comparison, on a real cell.
 *   4. EXCLUDED, deliberately — the register set that may differ is pinned by measurement.
 *   5. SEVEN LAND, IN ORDER — the queue's own length cell is read before and after, and the seven
 *      appended bytes are read out of the queue in the order they arrived.
 *   6. IT READS THE IMAGE — a twin that bakes the six fixed codes in as constants is identical on
 *      an untouched image, so one source byte is POKED and both sides re-run. That twin's
 *      blindness without the poke is asserted, so its agreement is never read as reassurance.
 *   7. EXHAUSTIVE — all 256 era values, which is the only input the seventh code has.
 *   8. TEETH — six twins with exact catch counts over the era sweep.
 *
 * HOLE: WHAT any of the seven codes ASKS FOR. They are bytes handed to a second processor; nothing
 * on this side can say. The gate fixes which bytes are queued, in which order, and under no
 * permission test at all.
 * HOLE: the corpus is a single dispatch, so everything about the era arm rests on the sweep.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5634.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { enqueueTransitionSoundStops } from "../enqueueTransitionSoundStops.js";
import { enqueueSoundUnconditional } from "../enqueueSoundUnconditional.js";
import { ERA_INDEX } from "../names.js";
import { loc_5634 as oracle } from "../../translated/loc_5634.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x5634;
const FRAMES = 1500;
const DISPATCHES = 1;

const QUEUE_LENGTH = 0xac43;
const FIXED_CODE_SOURCES = [0x167c, 0x0a9c, 0x1484, 0x0c78, 0x07d3, 0x33b4];
const ERA_CODE_BASE = 140;
const REQUESTS = FIXED_CODE_SOURCES.length + 1;

const SCRATCH_BYTES = 8;
const EXCLUDED = ["a", "f", "sp"];

const ERAS = Array.from({ length: 256 }, (_unused, i) => i);
const POKED_CODE = 0x5e;
const POKED_SOURCE = FIXED_CODE_SOURCES[2];

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
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

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

let entry = null;

function replay(candidate) {
  let dispatches = 0;
  let caught = 0;
  const eras = new Set();
  const host = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (entry === null) entry = mm.clone();
    eras.add(mm.mem8[ERA_INDEX]);
    const sp = mm.regs.sp;
    const b = mm.clone();
    candidate(b);
    const r = oracle(mm);
    if (allDiffs(mm, b).some((d) => !inScratch(d.addr, sp))) caught++;
    return r;
  }]]));
  const frames = host.runFrames(FRAMES);
  assert.equal(host.stoppedBy, null, `session stopped early: ${host.stoppedBy}`);
  assert.equal(frames.length, FRAMES, "session ran short");
  return { dispatches, caught, eras };
}

function entryState() {
  if (entry === null) replay(enqueueTransitionSoundStops);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** A real captured machine with the era forced and the queue emptied, so appends are readable. */
function craft(era) {
  const m = entryState().clone();
  m.mem8[ERA_INDEX] = era;
  m.mem8[QUEUE_LENGTH] = 0;
  return m;
}

function sweepCaught(candidate) {
  let caught = 0;
  for (const era of ERAS) if (unitDiff(candidate, craft(era))) caught++;
  return caught;
}

/** Run `body` with one program-image byte forced, then put it back whatever happens. */
function withPokedImage(m, addr, value, body) {
  const image = m.mem.rom;
  const was = image[addr];
  image[addr] = value;
  try {
    return body();
  } finally {
    image[addr] = was;
  }
}

/** The bytes a candidate appends, read out of the queue in arrival order. */
function appended(candidate, era) {
  const m = craft(era);
  candidate(m);
  const n = m.mem8[QUEUE_LENGTH];
  return Array.from({ length: n }, (_unused, i) => m.mem8[QUEUE_LENGTH + 1 + i]);
}

// ── twins ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: one request short. */
function brokenSixRequests(m) {
  for (const source of FIXED_CODE_SOURCES) enqueueSoundUnconditional(m, m.mem8[source]);
}

/**
 * The six codes SNAPSHOT the image once and never look again. A clone shares its program image
 * with the machine it came from, so a twin that re-reads would follow a poke and be no twin at
 * all; the snapshot is taken before the poking arm runs and asserted to be non-empty there.
 */
let bakedCodes = null;
function bakeCodes(m) {
  if (bakedCodes === null) bakedCodes = FIXED_CODE_SOURCES.map((source) => m.mem8[source]);
  return bakedCodes;
}

/** BUG: bakes the six fixed codes in instead of reading them out of the image. */
function brokenBakedCodes(m) {
  for (const code of bakeCodes(m)) enqueueSoundUnconditional(m, code);
  enqueueSoundUnconditional(m, (m.mem8[ERA_INDEX] + ERA_CODE_BASE) & 0xff);
}

/** BUG: queues the six the other way round, so the order on the queue is reversed. */
function brokenReversedOrder(m) {
  for (const source of [...FIXED_CODE_SOURCES].reverse()) enqueueSoundUnconditional(m, m.mem8[source]);
  enqueueSoundUnconditional(m, (m.mem8[ERA_INDEX] + ERA_CODE_BASE) & 0xff);
}

/** BUG: the era code forgets its base, so every era asks for the wrong thing. */
function brokenNoBase(m) {
  for (const source of FIXED_CODE_SOURCES) enqueueSoundUnconditional(m, m.mem8[source]);
  enqueueSoundUnconditional(m, m.mem8[ERA_INDEX]);
}

/** BUG: the era code ignores the era, so it is the same in every one. */
function brokenIgnoresEra(m) {
  for (const source of FIXED_CODE_SOURCES) enqueueSoundUnconditional(m, m.mem8[source]);
  enqueueSoundUnconditional(m, ERA_CODE_BASE);
}

/** Each twin's exact catch count over the 256 crafted eras. Measured; a move is a finding. */
const TWINS = [
  ["no-op", brokenNoOp, 256],
  ["six-requests", brokenSixRequests, 256],
  ["baked-codes", brokenBakedCodes, 0],
  ["reversed-order", brokenReversedOrder, 256],
  ["era-code-without-base", brokenNoBase, 256],
  ["era-code-ignores-era", brokenIgnoresEra, 255],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: enqueueTransitionSoundStops == oracle outside the scratch window", { skip }, () => {
  const r = replay(enqueueTransitionSoundStops);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, "the rewrite diverged at a real dispatch");

  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  enqueueTransitionSoundStops(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  console.log(`  EQUAL: ${r.dispatches} dispatch at era ${[...r.eras]}, sp=${hex4(sp)}`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(2));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: a pinned register set, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  enqueueTransitionSoundStops(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded register set changed shape",
  );
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")}`);
});

test("SEVEN LAND, IN ORDER: the queue grows by seven and holds the right bytes", { skip }, () => {
  const era = 3;
  const got = appended(enqueueTransitionSoundStops, era);
  assert.equal(got.length, REQUESTS, "the queue must grow by exactly seven");
  const image = entryState().mem.rom;
  const want = [...FIXED_CODE_SOURCES.map((s) => image[s]), (era + ERA_CODE_BASE) & 0xff];
  assert.deepEqual(got, want, "the seven queued bytes, in arrival order");
  assert.equal(new Set(want).size, REQUESTS, "vacuous: two of the seven codes are the same byte");
  console.log(`  SEVEN: ${got.map((v) => hex4(v).slice(2)).join(" ")}`);
});

test("IT READS THE IMAGE: a poked source moves the queued byte, a baked twin does not", { skip }, () => {
  const base = entryState();
  const snapshot = bakeCodes(base);
  assert.equal(snapshot.length, FIXED_CODE_SOURCES.length, "the twin's snapshot is empty");
  assert.equal(unitDiff(brokenBakedCodes, base), null, "the baked twin must be invisible here");

  const which = FIXED_CODE_SOURCES.indexOf(POKED_SOURCE);
  const followed = withPokedImage(base, POKED_SOURCE, POKED_CODE, () => appended(enqueueTransitionSoundStops, 1)[which]);
  assert.equal(followed, POKED_CODE, "the rewrite baked a code in instead of reading it");

  const caught = withPokedImage(base, POKED_SOURCE, POKED_CODE, () =>
    unitDiff(brokenBakedCodes, base));
  assert.notEqual(caught, null, "with the image poked, the baked twin must be caught");
  console.log(`  IMAGE: source ${which} poked to ${POKED_CODE}; baked twin caught — ${show(caught)}`);
});

test("EXHAUSTIVE: all 256 crafted eras behave as the oracle", { skip }, () => {
  assert.equal(sweepCaught(enqueueTransitionSoundStops), 0, "the rewrite diverged somewhere in the crafted space");
  const last = new Set(ERAS.map((era) => appended(enqueueTransitionSoundStops, era)[REQUESTS - 1]));
  assert.equal(last.size, ERAS.length, "the era code must be distinct for every era value");
  console.log(`  EXHAUSTIVE: ${ERAS.length} eras identical, ${last.size} distinct era codes`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of eras`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's catch count moved`);
    console.log(
      `  TEETH/${label}: caught on ${craftedCaught} of ${ERAS.length} eras` +
        (craftedCaught === 0 ? " — BLIND on an untouched image, as recorded" : ""),
    );
  });
}
