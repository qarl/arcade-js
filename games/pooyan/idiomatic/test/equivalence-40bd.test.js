// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchFormationObjectStates (ROM 0x40bd, Pooyan) — the formation-record sweep. It
 * walks four fixed-stride records and hands each to the object-state dispatcher.
 *
 * SEATING: BALANCED-WIRE. dispatchObjectStateHandler is now lifted (idiomatic), so the module DIRECT-CALLS it (the
 * seated-return push16 the frozen dispatcher's ret used to consume is dropped) — the module ends on
 * a plain return (net SP 0). The oracle parks its loop counter/stride in the alt register set (exx)
 * purely to survive the call, which the module replaces with JS locals — the dispatcher reads only
 * IX, never the parked B/DE. LIVE-OUT is memory only.
 *
 * The module differs from the oracle ONLY in loop mechanics, so the substance is the record sequence
 * handed to the dispatcher. The module now passes each record as an argument (no IX seat), so the
 * dispatch sequence is observed mechanism-agnostically: both runs read each record's lead byte in the
 * dispatcher's active-check, so a spy on read8 at the four record bases records the sweep for BOTH
 * (the frozen m.call and the idiomatic direct call alike).
 *
 * Jobs:
 *   1. EQUAL — on a boot clone the records are inactive, so the dispatcher no-ops: oracle ==
 *      module in RAM (−stack), proving the sweep writes nothing spurious and terminates.
 *   2. SWEEP/TEETH — oracle and module both dispatch on exactly the four records
 *      {0x8c30,0x8c48,0x8c60,0x8c78} in order; a wrong count/stride/base would break the list.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-40bd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_40bd as oracle } from "../../translated/loc_40bd.js";
import { dispatchFormationObjectStates } from "../dispatchFormationObjectStates.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const EXPECTED = [0x8c30, 0x8c48, 0x8c60, 0x8c78]; // FORMATION_TABLE + i*0x18, i=0..3
const SP0 = 0x8fe0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Run `runner`, returning the record bases dispatched, in order (the sweep sequence). Works for the
 *  frozen oracle (m.call(0x40d0)) and the idiomatic module (direct dispatchObjectStateHandler) alike: both read each
 *  record's lead byte through read8 during the dispatcher's active-check, which we spy on the instance.
 *  First-occurrence-in-order collapses the repeated reads within one record's dispatch. */
function sweepIx(runner) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  const seq = [];
  const seen = new Set();
  const orig = m.mem.read8.bind(m.mem);
  m.mem.read8 = (addr) => {
    const a = addr & 0xffff;
    if (EXPECTED.includes(a) && !seen.has(a)) {
      seen.add(a);
      seq.push(a); // first read of a record base = its dispatch
    }
    return orig(a);
  };
  runner(m);
  return seq;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: boot clone — module == oracle in RAM (−stack)", () => {
  const o = BASE.clone();
  o.regs.sp = SP0;
  const c = BASE.clone();
  c.regs.sp = SP0;
  oracle(o);
  dispatchFormationObjectStates(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL boot clone: RAM identical");
});

// -- 2. SWEEP / TEETH ---------------------------------------------------------

test("SWEEP: oracle and module dispatch on exactly the four records, in order", () => {
  const oSeq = sweepIx(oracle);
  const cSeq = sweepIx(dispatchFormationObjectStates);
  assert.deepEqual(oSeq, EXPECTED, `oracle swept ${oSeq.map(hx)} (expected ${EXPECTED.map(hx)})`);
  assert.deepEqual(cSeq, EXPECTED, `module swept ${cSeq.map(hx)} (expected ${EXPECTED.map(hx)})`);
  assert.deepEqual(cSeq, oSeq, "module and oracle swept different records");
  // Teeth: a short/wrong sweep would not match the exact list.
  assert.notDeepEqual(cSeq, EXPECTED.slice(0, 3), "a 3-record sweep must not pass");
  console.log(`  SWEEP: both dispatched on ${cSeq.map(hx).join(", ")}`);
});
