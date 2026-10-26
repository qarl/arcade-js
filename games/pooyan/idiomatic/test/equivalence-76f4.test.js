// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchAllObjectStates (ROM 0x76f4, Pooyan) — the object-record sweep. It walks the
 * six object records at OBJECT_STATE_RECORD_BASE (stride 0x18) and hands each to the per-object state
 * dispatcher dispatchActiveObjectState.
 *
 * SEATING: the oracle parks its loop counter B / stride DE in the alternate register set (`exx`) so the
 * frozen dispatcher may use BC/DE/HL, and reaches the dispatcher through a per-iteration push16 + the
 * rst-0x28 trampoline; the module replaces the counter/stride with JS locals and calls the idiomatic
 * dispatcher directly. The oracle threads each record pointer through IX (frozen seating), so an IX-setter
 * spy records its sweep; the idiomatic module carries the pointer as a JS local, so we tap the record-header
 * read the dispatcher makes first on every record. LIVE-OUT is memory only.
 *
 * Jobs:
 *   1. EQUAL — on a boot clone the records are inactive, so the dispatcher no-ops on each: oracle ==
 *      module in RAM (−stack), proving the sweep writes nothing spurious and terminates.
 *   2. SWEEP/TEETH — oracle and module both dispatch on exactly the six records in order; a wrong
 *      count/stride/base would break the list.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-76f4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_76f4 as oracle } from "../../translated/loc_76f4.js";
import { dispatchAllObjectStates } from "../dispatchAllObjectStates.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, OBJECT_STATE_RECORD_BASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const EXPECTED = [0, 1, 2, 3, 4, 5].map((i) => (OBJECT_STATE_RECORD_BASE + i * 0x18) & 0xffff);
const SP0 = 0x8fe0; // inside STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Oracle sweep: the frozen path seats each record pointer into IX before dispatching, so spy the setter. */
function sweepOracle(runner) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  const seq = [];
  Object.defineProperty(m.regs, "ix", {
    configurable: true,
    get() { return this._ix; },
    set(v) { this._ix = v & 0xffff; if (EXPECTED.includes(this._ix)) seq.push(this._ix); },
  });
  runner(m);
  return seq;
}

/** Module sweep: the idiomatic path carries the pointer as a JS local, so tap the record-header read the
 *  dispatcher makes first on every record (`mem8[rec+0]`) via a Proxy on the memory array. */
function sweepModule(runner) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  const seq = [];
  m.mem8 = new Proxy(m.mem8, {
    get(t, k) {
      const n = typeof k === "string" ? Number(k) : NaN;
      if (Number.isInteger(n) && EXPECTED.includes(n) && !seq.includes(n)) seq.push(n);
      return t[k];
    },
  });
  runner(m);
  return seq;
}

test("EQUAL: boot clone — module == oracle in RAM (−stack)", () => {
  const o = BASE.clone(); o.regs.sp = SP0;
  const c = BASE.clone(); c.regs.sp = SP0;
  oracle(o);
  dispatchAllObjectStates(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL boot clone: RAM identical");
});

test("SWEEP: oracle and module dispatch on exactly the six records, in order", () => {
  const oSeq = sweepOracle(oracle);
  const cSeq = sweepModule(dispatchAllObjectStates);
  assert.deepEqual(cSeq, EXPECTED, `module swept ${cSeq.map(hx)} (expected ${EXPECTED.map(hx)})`);
  assert.deepEqual(oSeq, EXPECTED, `oracle swept ${oSeq.map(hx)} (expected ${EXPECTED.map(hx)})`);
  assert.deepEqual(cSeq, oSeq, "module and oracle swept different records");
  assert.notDeepEqual(cSeq, EXPECTED.slice(0, 5), "a 5-record sweep must not pass");
  console.log(`  SWEEP: both dispatched on ${cSeq.map(hx).join(", ")}`);
});
