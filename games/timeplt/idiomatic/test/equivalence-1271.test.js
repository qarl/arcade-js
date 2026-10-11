// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceRoundWhenFieldCleared — memory-equivalent to the frozen oracle at ROM 0x1271.
 * GATE: strict unit-capture at real dispatches (all blocked by the first guard), plus crafted
 *   entries that isolate each guard and drive both arms, an SP-balance arm, and teeth. Compared on
 *   work RAM outside an 8-byte-plus stack-scratch window; the routine leaves no register live-out.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { advanceRoundWhenFieldCleared } from "../advanceRoundWhenFieldCleared.js";
import { enqueueTransitionSoundStops } from "../enqueueTransitionSoundStops.js";
import { loc_1271 as oracle } from "../../translated/loc_1271.js";

const TARGET = 0x1271;
const REAL_DISPATCHES = 122;
const SCRATCH_BYTES = 16;

const MODE = 0xad02;
const ARM = 0xacc6;
const SLOTS = 0xa810;
const SLOT_COUNT = 15;
const SLOT_STRIDE = 0x10;
const RESET_SEL = 0xad30;
const BANK_SEL = 0xad32;

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

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
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

function spMoved(candidate, machine) {
  const seat = machine.regs.sp;
  const b = machine.clone();
  candidate(b);
  return b.regs.sp !== seat;
}

let base = null;
function captureBase() {
  if (base) return base;
  const host = makeMachine(new Map([[TARGET, (mm) => {
    if (base === null) base = mm.clone();
    return oracle(mm);
  }]]));
  host.runFrames(ENTRY_FRAMES);
  assert.notEqual(base, null, "vacuous: the tape never reached the routine");
  return base;
}

function clearSlots(c) {
  for (let i = 0; i < SLOT_COUNT; i++) c.mem8[SLOTS + i * SLOT_STRIDE] = 0;
}

/** A real captured machine nudged to isolate one guard, or to drive one arm. */
function craft(name) {
  const c = captureBase().clone();
  c.mem8[MODE] = name === "G1" ? 1 : 0;
  c.mem8[ARM] = name === "G2" ? 0 : 1;
  clearSlots(c);
  if (name === "G3") c.mem8[SLOTS + SLOT_STRIDE] = 0xff;
  c.mem8[RESET_SEL] = name === "armB10" || name === "armB20" ? 5 : 0;
  c.mem8[BANK_SEL] = name === "armB20" ? 7 : 0;
  return c;
}

const ARMS = ["G1", "G2", "G3", "armA", "armB10", "armB20"];

// ── the routine, reimplemented with injectable bugs, for the teeth only ────────────────────
function arm(m, mut = {}) {
  const { mem8 } = m;
  if (!mut.ig1 && mem8[MODE] !== 0) return;
  if (!mut.ig2 && mem8[ARM] === 0) return;
  if (!mut.ig3) {
    for (let i = 0; i < SLOT_COUNT; i++) if (mem8[SLOTS + i * SLOT_STRIDE] !== 0) return;
  }
  if (!mut.skipSound) enqueueTransitionSoundStops(m);
  if (mem8[RESET_SEL] === 0) {
    mem8[ARM] = mem8[0x07d1];
    if (!mut.omit) m.push16(0x12c4);
    m.call(0x15b6);
    mem8[RESET_SEL] = 0;
    mem8[BANK_SEL] = 0;
    mem8[0xa9ab] = mem8[0x16d3];
    mem8[0xa9ac] = mut.phase ? 1 : 0;
    return;
  }
  if (!mut.noClear) for (let i = 0; i < 23; i++) mem8[0xaa43 + i * 2] = 0;
  if (!mut.omit) m.push16(0x12a0);
  m.call(0x2db8);
  let dest = mem8[BANK_SEL] === 0 ? 0xad10 : 0xad20;
  if (mut.wrongDest) dest = mem8[BANK_SEL] === 0 ? 0xad20 : 0xad10;
  for (let i = 0; i < 16; i++) mem8[dest + i] = mem8[0xad00 + i];
  mem8[0xa9ac] = mut.phase ? 0 : mem8[0x4a35];
}

const MEM_TWINS = [
  ["no-op", () => {}, ["armA", "armB10", "armB20"]],
  ["skip-sound", (m) => arm(m, { skipSound: 1 }), ["armA", "armB10", "armB20"]],
  ["wrong-dest", (m) => arm(m, { wrongDest: 1 }), ["armB10", "armB20"]],
  ["no-clear", (m) => arm(m, { noClear: 1 }), ["armB10", "armB20"]],
  ["wrong-phase", (m) => arm(m, { phase: 1 }), ["armA", "armB10", "armB20"]],
  ["ignore-guard1", (m) => arm(m, { ig1: 1 }), ["G1"]],
  ["ignore-guard2", (m) => arm(m, { ig2: 1 }), ["G2"]],
  ["ignore-guard3", (m) => arm(m, { ig3: 1 }), ["G3"]],
];
// ★ the parked pushes leave no memory trace, so this twin is invisible to the RAM diff and is
//   caught only by the SP-balance arm.
const SP_TWIN = ["omit-push", (m) => arm(m, { omit: 1 }), ["armA", "armB10", "armB20"]];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at real dispatches: advanceRoundWhenFieldCleared == oracle outside the scratch window", { skip }, () => {
  let dispatches = 0;
  let caught = 0;
  let pastGuard1 = 0;
  const host = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (mm.mem8[MODE] === 0) pastGuard1++;
    const sp = mm.regs.sp;
    const b = mm.clone();
    advanceRoundWhenFieldCleared(b);
    const r = oracle(mm);
    if (allDiffs(mm, b).some((d) => !inScratch(d.addr, sp))) caught++;
    return r;
  }]]));
  const frames = host.runFrames(ENTRY_FRAMES);
  assert.equal(host.stoppedBy, null, `session stopped early: ${host.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "session ran short");
  assert.equal(dispatches, REAL_DISPATCHES, "the real dispatch count moved");
  assert.equal(caught, 0, "the rewrite diverged at a real dispatch");
  assert.equal(pastGuard1, 0, "a real dispatch now passes the first guard, so the arms are no " +
    "longer crafted-only — capture plain entries for them");
  console.log(`  EQUAL: ${dispatches} real dispatches, all blocked by the first guard, identical`);
});

test("CRAFTED ARMS EQUAL: each guard and both arms match the oracle", { skip }, () => {
  for (const a of ARMS) {
    const d = unitDiff(advanceRoundWhenFieldCleared, craft(a));
    assert.equal(d, null, `the ${a} arm diverged — ${show(d)}`);
  }
  console.log(`  CRAFTED: ${ARMS.length} arms identical outside the scratch window`);
});

test("SP BALANCES: the rewrite returns the stack to its seat on every path", { skip }, () => {
  for (const a of ARMS) {
    assert.equal(spMoved(advanceRoundWhenFieldCleared, craft(a)), false, `the ${a} arm left the stack unbalanced`);
  }
  console.log("  SP BALANCES: every crafted path returns SP to its seat");
});

test("NOT VACUOUS: a no-op candidate FAILS on a real cell", { skip }, () => {
  const d = unitDiff(() => {}, craft("armB10"));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

for (const [label, twin, expected] of MEM_TWINS) {
  test(`TEETH: the ${label} twin is caught on exactly ${expected.join(",")}`, { skip }, () => {
    const got = ARMS.filter((a) => unitDiff(twin, craft(a)));
    assert.deepEqual(got, expected, `the ${label} twin's caught set moved`);
    console.log(`  TEETH/${label}: caught on ${got.join(", ")}`);
  });
}

test(`TEETH: the ${SP_TWIN[0]} twin is caught only by SP on ${SP_TWIN[2].join(",")}`, { skip }, () => {
  const [, twin, expected] = SP_TWIN;
  const byMem = ARMS.filter((a) => unitDiff(twin, craft(a)));
  const bySp = ARMS.filter((a) => spMoved(twin, craft(a)));
  assert.deepEqual(byMem, [], "the omit-push twin left a memory trace it should not");
  assert.deepEqual(bySp, expected, "the omit-push twin's SP-caught set moved");
  console.log(`  TEETH/${SP_TWIN[0]}: invisible to RAM, caught by SP on ${bySp.join(", ")}`);
});
