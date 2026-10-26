// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runActiveGameplayFrame (ROM 0x18af, Pooyan) — the gameplay-state index-4 per-frame
 * coordinator: fourteen sub-handlers in fixed ROM order, then return.
 *
 * SEATING: BALANCED-WIRE, FULLY DISSOLVED. All fourteen callees are lifted this batch, so every call
 * is a direct JS call — the module holds no emulated stack op and marshals no register. The oracle
 * drives the same fourteen through push16/call/ret in STACK_SCRATCH. No seated-then-dispatched tail,
 * so no SP-tooth. LIVE-OUT is memory only — the dispatcher reads no register back.
 *
 * Jobs:
 *   1. EQUAL — on a boot clone every sub-handler runs the same on both sides (each dissolved idiomatic
 *      callee is memory-equivalent to the oracle's translated one), so oracle == runActiveGameplayFrame in RAM
 *      (−stack): the whole fourteen-handler composition is equivalent.
 *   2. TEETH — a wrong byte in the idiomatic result is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-18af.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_18af as oracle } from "../../translated/loc_18af.js";
import { runActiveGameplayFrame } from "../runActiveGameplayFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PHASE_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8fe0; // inside STACK_SCRATCH: the oracle's per-call push/pop lands in dead scratch

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function bootClone() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: boot clone — runActiveGameplayFrame == oracle in RAM (−stack)", () => {
  const o = bootClone();
  oracle(o);
  const c = bootClone();
  runActiveGameplayFrame(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL boot clone: fourteen-handler composition identical (RAM −stack)");
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a wrong byte in the idiomatic result is CAUGHT by the RAM diff", () => {
  const o = bootClone();
  const c = bootClone();
  oracle(o);
  runActiveGameplayFrame(c);
  c.mem8[PHASE_TIMER] = (c.mem8[PHASE_TIMER] ^ 0xff) & 0xff; // BUG: corrupt a live work-RAM cell
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte — it is worthless");
  console.log(`  TEETH/RAM: corrupted byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
