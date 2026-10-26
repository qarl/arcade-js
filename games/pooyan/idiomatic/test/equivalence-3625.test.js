// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resolveActorTargetUnlessCommitted — a guard on the actor record at IX.
 *
 * resolveActorTargetUnlessCommitted tests bit 0 of the +0x08 latch cell: when set the actor is already committed and the
 * handler returns immediately with no effect; when clear it delegates to the target-tile resolver
 * (resolveTargetColumnAndArmApproach), which runs in this same tail frame.
 *
 * CYCLE-FREE / memory-equivalence gate. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — a
 * tail-dispatched guard with NO register live-out. pc/SP/cycles are NOT compared. The self-contained
 * arm exercises the GUARD path (bit0 set), where the routine touches no RAM at all; this both proves
 * equivalence and pins the branch — an inverted module would fall through and run the resolver,
 * diverging. The delegated path (bit0 clear) is resolveTargetColumnAndArmApproach's own equivalence responsibility; here it is
 * used only to prove the bit0 decision is load-bearing (the two branches diverge).
 *
 * Jobs:
 *   1. EQUAL — guard path (bit0 set): resolveActorTargetUnlessCommitted == oracle in RAM (−stack).
 *   2. WRITE-SET — the guard path leaves RAM untouched (empty footprint): proof it does NOT delegate.
 *   3. TEETH — a corrupted byte after the guard run is caught by the RAM diff; and the bit0 branch is
 *      load-bearing: the oracle's guard path (A untouched) and delegate path (A = (ix+6) via
 *      resolveTargetColumnAndArmApproach's alternate lane) diverge.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3625.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3625 as oracle } from "../../translated/loc_3625.js";
import { resolveActorTargetUnlessCommitted } from "../resolveActorTargetUnlessCommitted.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80;          // the actor record IX points at
const LATCH = REC + 0x08;    // the guard's latch cell (bit0)
const RESOLVER_MODE = 0x8d79; // resolveTargetColumnAndArmApproach's lead selector; nonzero picks its alternate lane
const SP_SCRATCH = 0x8ff0;   // parked in STACK_SCRATCH so ret/call stack churn drops out of the diff

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SCRATCH);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** bit0 set -> guard path (returns, no effect). */
function craftGuard() {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.a = 0x00;               // sentinel: the guard path leaves A untouched
  m.mem.write8(LATCH, 0x01);     // bit0 set
  m.regs.sp = SP_SCRATCH;
  return m;
}

/** bit0 clear -> delegate path (resolveTargetColumnAndArmApproach runs). */
function craftDelegate() {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.a = 0x00;                   // sentinel: the delegate overwrites A
  m.mem.write8(LATCH, 0x00);         // bit0 clear -> delegate to resolveTargetColumnAndArmApproach
  m.mem.write8(RESOLVER_MODE, 0x03); // nonzero -> resolveTargetColumnAndArmApproach takes its alternate lane
  m.mem.write8(REC + 0x07, 0x00);    // (ix+7) bit2 clear -> resolveTargetColumnAndArmApproach re-reads A from (ix+6)
  m.mem.write8(REC + 0x06, 0x0a);    // (ix+6) < 0x14 -> the alternate lane rets with A = 0x0a
  m.regs.sp = SP_SCRATCH;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: guard path (bit0 set) — resolveActorTargetUnlessCommitted == oracle in RAM (−stack)", () => {
  const o = craftGuard();
  const c = craftGuard();
  oracle(o);
  resolveActorTargetUnlessCommitted(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: guard path RAM identical (−stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the guard path leaves RAM untouched (it does NOT delegate)", () => {
  const c = craftGuard();
  const before = c.dumpState();
  resolveActorTargetUnlessCommitted(c);
  const after = c.dumpState();
  assert.deepEqual([...after], [...before], "the guard path must leave RAM untouched");
  console.log("  WRITE-SET: guard path inert (empty footprint)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted byte after the guard run is CAUGHT by the RAM diff", () => {
  const o = craftGuard();
  const c = craftGuard();
  oracle(o);
  resolveActorTargetUnlessCommitted(c);
  c.mem.write8(LATCH + 1, 0x5a); // BUG: an errant write the guard path would never make

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte — it is worthless");
  assert.equal(d.addr, LATCH + 1, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: corrupted byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: the bit0 decision is load-bearing — guard and delegate branches diverge", () => {
  const g = craftGuard();
  const del = craftDelegate();
  oracle(g);   // guard: A untouched (0x00)
  oracle(del); // delegate: resolveTargetColumnAndArmApproach's alternate lane leaves A = (ix+6) == 0x0a
  assert.notEqual(
    g.regs.a & 0xff,
    del.regs.a & 0xff,
    "bit0 must select between guard (A untouched = 0x00) and delegate (A = (ix+6) = 0x0a) — it is not load-bearing",
  );
  console.log(`  TEETH/decision: guard A=${hx(g.regs.a & 0xff)} != delegate A=${hx(del.regs.a & 0xff)}`);
});
