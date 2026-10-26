// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for updateEnemyActorsAndCycleLaunchFlipAnim (ROM 0x66c5, Pooyan) — "step three enemy-actor records
 * through their state pass, then run the flip-command cadence".
 *
 * updateEnemyActorsAndCycleLaunchFlipAnim is a CALLER: it composes the already-decompiled record dispatcher dispatchEnemyActorState (three
 * records, stride 0x18) and the display-command enqueue enqueueDisplayCommand. This gate imports the idiomatic
 * updateEnemyActorsAndCycleLaunchFlipAnim (which imports the idiomatic dispatchEnemyActorState / enqueueDisplayCommand) and compares it against the translated
 * oracle (which runs the translated dispatchEnemyActorState / enqueueDisplayCommand through m.call) on fresh clones, in
 * RAM (dumpState) minus stack scratch below the entry SP. The composed subtrees are separately gated, so a divergence
 * here is a defect in updateEnemyActorsAndCycleLaunchFlipAnim's own control flow — the loop bound, the post-pass gate, the
 * countdown decrement/reload, the toggle bump, or the command selection.
 *
 * Deterministic branch control: the loop's state-0 handler (advanceEnemyActorToDescentStateOnDelay) is gated by 0x8930, so with
 * 0x8930 = 0 and each scanned record's state byte = 0 the loop is a pure no-op. The scan is pointed
 * at a scratch record region (0x8c48) disjoint from the post-pass cells, so the loop never touches
 * the lead state byte (0x8ae2), the countdown (0x892d) or the flip toggle (0x892f) — all three are
 * poked absolutely and select the post-pass branch.
 *
 * LIVE-OUT: none — memory only. The sole caller (runObjectAndSpawnUpdatePass) reloads IX before its next use (dispatchSpecialObjectRecordState
 * resets IX itself) and reads no result register, so no register is part of the contract.
 *
 * Jobs:
 *   1. EQUAL — lead-state-clear early return; countdown live (decrement); countdown expired with the
 *      toggle bit set (primary command) and clear (alternate command): oracle == module in RAM (−stack).
 *   2. WRITE-SET — the expired/primary path changes exactly {countdown, toggle, ring ptr, two ring
 *      slots}; the early-return path changes nothing.
 *   3. TEETH — a wrong enqueued command byte AND a wrong countdown byte are CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-66c5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_66c5 as oracle } from "../../translated/loc_66c5.js";
import { updateEnemyActorsAndCycleLaunchFlipAnim } from "../updateEnemyActorsAndCycleLaunchFlipAnim.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SCRATCH_IX = 0x8c48; // loop scan base; records at +0/+0x18/+0x30, disjoint from the post-pass cells
const PHASE_GATE = 0x8930; // SHARED_PHASE_GATE — 0 makes the state-0 handler (advanceEnemyActorToDescentStateOnDelay) a no-op
const LEAD_STATE = 0x8ae2; // ENEMY_ACTOR_TABLE + 2 — post-pass gate
const COUNTDOWN = 0x892d; // WAVE_NUMBER — the per-frame countdown updateEnemyActorsAndCycleLaunchFlipAnim steps
const FLIP_TOGGLE = 0x892f; // LAUNCH_FLIP_COUNTDOWN — bumped on expiry; bit0 picks the command
const RING_PTR = 0x88a0; // DISPLAY_CMD_RING_WRITE_PTR
const RING_PAGE = 0x8800;
const RING_START = 0xc0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Sorted changed-RAM addresses (whole dump minus stack scratch below the entry SP) for the WRITE-SET footprint. */
function changedAddrs(m, run) {
  const before = m.dumpState();
  run(m);
  const after = m.dumpState();
  const out = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] === after[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    out.push(addr);
  }
  return out.sort((a, b) => a - b);
}

/**
 * A fresh clone: the state-0 handler neutralised (0x8930 = 0), the three scanned records' state
 * bytes zeroed so the loop no-ops, IX at the scratch base, the display ring set free, and the
 * post-pass selector cells poked.
 */
function craft({ lead = 0x01, count = 0x05, toggle = 0x00 } = {}) {
  const m = BASE.clone();
  m.mem.write8(PHASE_GATE, 0x00);
  for (let i = 0; i < 3; i++) m.mem.write8((SCRATCH_IX + i * 0x18 + 0x02) & 0xffff, 0x00);
  m.mem.write8(LEAD_STATE, lead);
  m.mem.write8(COUNTDOWN, count);
  m.mem.write8(FLIP_TOGGLE, toggle);
  m.mem.write8(RING_PTR, RING_START);
  for (let c = RING_START; c <= 0xff; c++) m.mem.write8(RING_PAGE + c, 0xff); // all ring slots free
  m.regs.ix = SCRATCH_IX;
  m.regs.sp = 0x8ffe; // dead stack: the oracle's exx/rst/call framing touches excluded RAM only
  return m;
}

const CASES = [
  { name: "lead state clear -> early return", opts: { lead: 0x00 } },
  { name: "countdown live -> decrement", opts: { lead: 0x01, count: 0x05 } },
  { name: "countdown expired, toggle bit set -> primary cmd", opts: { lead: 0x01, count: 0x00, toggle: 0x00 } },
  { name: "countdown expired, toggle bit clear -> alt cmd", opts: { lead: 0x01, count: 0x00, toggle: 0x01 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted post-pass branches — updateEnemyActorsAndCycleLaunchFlipAnim == oracle in RAM (−stack)", () => {
  for (const { name, opts } of CASES) {
    const o = craft(opts);
    const c = craft(opts);
    oracle(o);
    updateEnemyActorsAndCycleLaunchFlipAnim(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted branches identical (RAM −stack)`);
});

test("EQUAL/branch: the module actually took each post-pass branch (memory witnesses)", () => {
  // early return: countdown untouched.
  const a = craft({ lead: 0x00, count: 0x05 });
  updateEnemyActorsAndCycleLaunchFlipAnim(a);
  assert.equal(a.mem.read8(COUNTDOWN), 0x05, "early return must not touch the countdown");

  // live: decrement.
  const b = craft({ lead: 0x01, count: 0x05 });
  updateEnemyActorsAndCycleLaunchFlipAnim(b);
  assert.equal(b.mem.read8(COUNTDOWN), 0x04, "live countdown must decrement");

  // expired, toggle bit set after bump -> primary command 0x06:0x12.
  const c1 = craft({ lead: 0x01, count: 0x00, toggle: 0x00 });
  updateEnemyActorsAndCycleLaunchFlipAnim(c1);
  assert.equal(c1.mem.read8(COUNTDOWN), 0x10, "expired countdown must reload to 0x10");
  assert.equal(c1.mem.read8(FLIP_TOGGLE), 0x01, "toggle must bump");
  assert.equal(c1.mem.read8(RING_PAGE + RING_START), 0x06, "primary cmd high byte");
  assert.equal(c1.mem.read8(RING_PAGE + RING_START + 1), 0x12, "primary cmd low byte");

  // expired, toggle bit clear after bump -> alternate command 0x06:0x92.
  const c2 = craft({ lead: 0x01, count: 0x00, toggle: 0x01 });
  updateEnemyActorsAndCycleLaunchFlipAnim(c2);
  assert.equal(c2.mem.read8(FLIP_TOGGLE), 0x02, "toggle must bump");
  assert.equal(c2.mem.read8(RING_PAGE + RING_START + 1), 0x92, "alternate cmd low byte");
  console.log("  BRANCH: early/live/primary/alt witnessed in memory");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: expired/primary changes exactly {countdown, toggle, ring ptr, 2 slots}; early return changes nothing", () => {
  const oracleSet = changedAddrs(craft({ lead: 0x01, count: 0x00, toggle: 0x00 }), oracle);
  const moduleSet = changedAddrs(craft({ lead: 0x01, count: 0x00, toggle: 0x00 }), updateEnemyActorsAndCycleLaunchFlipAnim);
  assert.deepEqual(moduleSet, oracleSet, "module and oracle must change the identical cell set");
  assert.deepEqual(
    oracleSet,
    [COUNTDOWN, FLIP_TOGGLE, RING_PTR, RING_PAGE + RING_START, RING_PAGE + RING_START + 1].sort((a, b) => a - b),
    "expired/primary footprint must be exactly countdown+toggle+ring",
  );
  assert.deepEqual(changedAddrs(craft({ lead: 0x00 }), oracle), [], "early return must change nothing");
  console.log(`  WRITE-SET: expired/primary -> ${oracleSet.length} cells; early return -> 0`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong enqueued command byte is CAUGHT by the RAM diff", () => {
  const o = craft({ lead: 0x01, count: 0x00, toggle: 0x00 });
  const c = craft({ lead: 0x01, count: 0x00, toggle: 0x00 });
  oracle(o);
  updateEnemyActorsAndCycleLaunchFlipAnim(c);
  c.mem.write8(RING_PAGE + RING_START + 1, 0x99); // BUG: primary cmd low byte must be 0x12
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong command byte — it is worthless");
  assert.equal(d.addr, RING_PAGE + RING_START + 1, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/cmd: wrong command byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong countdown byte is CAUGHT by the RAM diff", () => {
  const o = craft({ lead: 0x01, count: 0x05 });
  const c = craft({ lead: 0x01, count: 0x05 });
  oracle(o);
  updateEnemyActorsAndCycleLaunchFlipAnim(c);
  c.mem.write8(COUNTDOWN, 0x00); // BUG: live countdown must land on 0x04, not 0x00
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong countdown byte — it is worthless");
  assert.equal(d.addr, COUNTDOWN, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/countdown: wrong countdown caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
