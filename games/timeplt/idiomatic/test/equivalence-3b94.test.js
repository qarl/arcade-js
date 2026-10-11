// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceHitSoakingObjectThenAnimateDeath — memory-equivalent to the frozen oracle at ROM 0x3b94.
 * GATE: crafted-entry; no tape dispatches this address (its caller 0x3b5f runs but never takes the
 * branch), so entries are captured at that caller for a real SP and surrounding RAM, then one
 * object's hit count and record head are forced to walk each arm. The frozen side pushes and takes
 * a return the rewrite leaves, so [low, seat) is masked (floor watched off the oracle's own pushes,
 * proved above the data) and the sp drift asserted per arm. Registers are not a live-out here and
 * are not compared; teeth must catch in memory outside the mask.
 * HOLE: the forced entries are crafted states, not ones the cabinet reaches on this tape.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3b94.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { advanceHitSoakingObjectThenAnimateDeath } from "../advanceHitSoakingObjectThenAnimateDeath.js";
import { loc_3b94 as oracle } from "../../translated/loc_3b94.js";
import { BOMBER_HITS_TO_ABSORB } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { requestTwoSounds } from "../requestTwoSounds.js";
import { retireObjectAndHold } from "../retireObjectAndHold.js";
import { driftWithWorldScroll } from "../driftWithWorldScroll.js";
import { postCommand } from "../postCommand.js";
import { fetchTableByte } from "../fetchTableByte.js";

const TARGET = 0x3b94;
const CALLER = 0x3b5f;
const RECORD_BASE = 0xa8c0;
const ENTRY_BASE = 0xaa28;
const FIXED_ENTRY = 0xaa2a;
const RECORD_STRIDE = 16;
const SHAPE_TABLE = 0x3c09;
const DATA_TOP = 0xadff;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

let bases = null;
function captureBases() {
  if (bases) return bases;
  const entries = [];
  const realCaller = TRANSLATED.get(CALLER);
  const m = makeMachine(new Map([[CALLER, (mm) => {
    if (entries.length < 20) entries.push(mm.clone());
    return realCaller(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
  assert.ok(entries.length > 0,
    "vacuous: the caller was never dispatched, so there is no real machine to craft an entry from");
  bases = entries;
  return bases;
}

/** A real machine forced to enter this routine with one object's hits and record head set. */
function craft(hits, head, rich) {
  const c = captureBases()[5].clone();
  c.regs.ix = RECORD_BASE;
  c.regs.iy = ENTRY_BASE;
  c.mem8[BOMBER_HITS_TO_ABSORB] = hits;
  c.mem8[RECORD_BASE] = head;
  c.regs.a = u8(head + 1);
  if (rich) {
    c.mem8[RECORD_BASE + RECORD_STRIDE] = 0x55;
    c.mem8[ENTRY_BASE] = 0x66;
    c.mem8[ENTRY_BASE + 49] = 0x77;
    c.mem8[FIXED_ENTRY] = 0x88;
    c.mem8[FIXED_ENTRY + 49] = 0x99;
    c.mem8[RECORD_BASE + 14] = 0x11;
  }
  return c;
}

/** oracle vs candidate on clones; the whole dump outside the dead stack window, plus the return. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const rvA = oracle(a);
  let rvB;
  try {
    rvB = candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 40) };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  if (rvA !== rvB) return { addr: null, a: `ret ${rvA}`, b: `ret ${rvB}` };
  return null;
}

function maskProbe(machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  advanceHitSoakingObjectThenAnimateDeath(b);
  return { low, seat, spDiff: a.regs.sp - b.regs.sp };
}

function footprint(machine) {
  const before = machine.dumpState().slice();
  const after = machine.clone();
  oracle(after);
  const now = after.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

/** [label, hits, head, rich, expected sp drift]. Every arm ends ret-free in the rewrite while the
 * frozen side pops the return, so each drifts by two bytes. */
const ARMS = [
  ["hits-left", 3, 0x50, false, 2],
  ["reset-and-shape", 0, 0x70, false, 2],
  ["retire", 0, 0x01, true, 2],
  ["post-command", 0, 0x41, false, 2],
  ["below-floor", 0, 0x30, false, 2],
  ["off-boundary", 0, 0x4a, false, 2],
  ["shape-lookup", 0, 0x49, false, 2],
];

// ── broken twins ────────────────────────────────────────────────────────────────────────
function brokenNoOp() {}

function brokenSkipHits(m) {
  const { regs, mem8 } = m;
  if (mem8[BOMBER_HITS_TO_ABSORB] !== 0) { mem8[regs.ix] = 0xff; requestTwoSounds(m); return m.call(0x3b77); }
  return advanceHitSoakingObjectThenAnimateDeath(m);
}

function brokenSkipDrift(m) {
  const { regs, mem8 } = m;
  const record = regs.ix, entry = regs.iy, head = u8(regs.a - 1);
  if (mem8[BOMBER_HITS_TO_ABSORB] !== 0) {
    mem8[BOMBER_HITS_TO_ABSORB] = mem8[BOMBER_HITS_TO_ABSORB] - 1; mem8[record] = 0xff; requestTwoSounds(m); return m.call(0x3b77);
  }
  if (head >= 0x61) { mem8[record] = 0x61; requestTwoSounds(m); mem8[entry + 0x30] = 0x3d; mem8[entry + 0x32] = 0x3d; }
  mem8[record] = mem8[record] - 1;
  if (mem8[record] === 0) return retireObjectAndHold(m, record, entry);
  mem8[entry + 0x33] = mem8[entry + 0x31] + 0x10; mem8[entry + 0x02] = mem8[entry + 0x00];
  return tailFrom(m, record, entry);
}

function brokenShapeOff(m) {
  const { regs, mem8 } = m;
  const record = regs.ix, entry = regs.iy, head = u8(regs.a - 1);
  if (mem8[BOMBER_HITS_TO_ABSORB] !== 0) {
    mem8[BOMBER_HITS_TO_ABSORB] = mem8[BOMBER_HITS_TO_ABSORB] - 1; mem8[record] = 0xff; requestTwoSounds(m); return m.call(0x3b77);
  }
  if (head >= 0x61) { mem8[record] = 0x61; requestTwoSounds(m); mem8[entry + 0x30] = 0x3d; mem8[entry + 0x32] = 0x3d; }
  mem8[record] = mem8[record] - 1;
  if (mem8[record] === 0) return retireObjectAndHold(m, record, entry);
  driftWithWorldScroll(m); mem8[entry + 0x33] = mem8[entry + 0x31] + 0x10; mem8[entry + 0x02] = mem8[entry + 0x00];
  const level = mem8[record];
  if (level === 0x40 || level < 0x40 || ((level - 0x40) & 0x07) !== 0) return level === 0x40 ? postArm(m, entry, record) : undefined;
  regs.hl = SHAPE_TABLE; regs.a = (level - 0x40) >> 3; // BUG: missing the -1
  const shape = fetchTableByte(m); mem8[entry + 0x03] = shape; mem8[entry + 0x01] = shape + 1;
}

function brokenNoRetire(m) {
  const { regs, mem8 } = m;
  const record = regs.ix, entry = regs.iy, head = u8(regs.a - 1);
  if (mem8[BOMBER_HITS_TO_ABSORB] !== 0) {
    mem8[BOMBER_HITS_TO_ABSORB] = mem8[BOMBER_HITS_TO_ABSORB] - 1; mem8[record] = 0xff; requestTwoSounds(m); return m.call(0x3b77);
  }
  if (head >= 0x61) { mem8[record] = 0x61; requestTwoSounds(m); mem8[entry + 0x30] = 0x3d; mem8[entry + 0x32] = 0x3d; }
  mem8[record] = mem8[record] - 1;
  if (mem8[record] === 0) return; // BUG: does not retire
  driftWithWorldScroll(m); mem8[entry + 0x33] = mem8[entry + 0x31] + 0x10; mem8[entry + 0x02] = mem8[entry + 0x00];
  return tailFrom(m, record, entry);
}

function postArm(m, entry, record) {
  const { mem8 } = m;
  postCommand(m, 0x04, 0x0b);
  mem8[entry + 0x03] = 0xfa; mem8[entry + 0x01] = 0xfb; mem8[entry + 0x30] = 0x6c; mem8[entry + 0x32] = 0x6c;
  mem8[record] = mem8[record] - 1;
}

function tailFrom(m, record, entry) {
  const { regs, mem8 } = m;
  const level = mem8[record];
  if (level === 0x40) return postArm(m, entry, record);
  if (level < 0x40) return;
  if (((level - 0x40) & 0x07) !== 0) return;
  regs.hl = SHAPE_TABLE; regs.a = ((level - 0x40) >> 3) - 1;
  const shape = fetchTableByte(m); mem8[entry + 0x03] = shape; mem8[entry + 0x01] = shape + 1;
}

const TWINS = [
  ["no-op", brokenNoOp, 7],
  ["skip-hits-decrement", brokenSkipHits, 1],
  ["skip-drift", brokenSkipDrift, 5],
  ["shape-off-by-one", brokenShapeOff, 2],
  ["no-retire", brokenNoRetire, 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: the tape runs the caller but never branches here, with a live control",
  { skip }, () => {
    const seen = { [TARGET]: 0, [CALLER]: 0 };
    const realCaller = TRANSLATED.get(CALLER);
    const m = makeMachine(new Map([
      [TARGET, (mm) => { seen[TARGET]++; return oracle(mm); }],
      [CALLER, (mm) => { seen[CALLER]++; return realCaller(mm); }],
    ]));
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
    assert.ok(seen[CALLER] > 0,
      "the caller was never dispatched either, so the zero beside it is instrument failure");
    assert.equal(seen[TARGET], 0,
      "the tape DOES reach this address now, so plain dispatches are the better evidence to capture");
    console.log(`  UNREACHED: ${hex4(TARGET)} entered ${seen[TARGET]}, caller ${hex4(CALLER)} ${seen[CALLER]}`);
  });

test("CRAFTED ARMS: the rewrite reproduces the oracle on every arm", { skip }, () => {
  for (const [label, hits, head, rich] of ARMS) {
    const machine = craft(hits, head, rich);
    assert.ok(footprint(machine) > 0, `the ${label} arm makes the oracle write nothing`);
    const d = unitDiff(advanceHitSoakingObjectThenAnimateDeath, machine);
    assert.equal(d, null, `the ${label} arm diverged: ${d && (d.addr == null ? "" : hex4(d.addr) + " ")}${d && d.a}/${d && d.b}`);
  }
  console.log(`  CRAFTED ARMS: ${ARMS.length} arms identical`);
});

test("SP AND SCRATCH: the drift matches per arm and the mask floor stays above the data",
  { skip }, () => {
    for (const [label, hits, head, rich, spDiff] of ARMS) {
      const r = maskProbe(craft(hits, head, rich));
      assert.equal(r.spDiff, spDiff, `the ${label} arm drifted ${r.spDiff}, not ${spDiff}`);
      assert.ok(r.low > DATA_TOP, `the ${label} window ${hex4(r.low)} reached into game data`);
    }
    console.log("  SP AND SCRATCH: per-arm drift and mask floor as expected");
  });

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    let caught = 0;
    for (const [, hits, head, rich] of ARMS) {
      if (unitDiff(twin, craft(hits, head, rich))) caught++;
    }
    assert.ok(caught > 0, `every arm PASSED the ${label} twin`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved to ${caught}`);
    console.log(`  TEETH/${label}: caught on ${caught}/${ARMS.length} arms`);
  });
}
