// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchLaunchState (ROM 0x2778, Pooyan) — the per-frame launch-sequence
 * dispatcher. It reads the low three bits of the launch state and runs the matching handler from the
 * five-entry table; the selected handler returns to dispatchLaunchState's caller (a tail dispatch).
 *
 * SEATING: BALANCED — the handler returns to this routine's caller (a tail dispatch, no net stack
 * move). The module runs the dispatch through an idiomatic switch; the oracle drives the frozen
 * rst-0x28 trampoline (0x0028, not lifted this batch) and the same handlers, so both walk identical
 * downstream code. Compared
 * on RAM (dumpState) minus stack scratch below the entry SP; the register file is not compared (void dispatch).
 *
 * Cases are CRAFTED: the launch-state byte is poked directly. States 0/1/2 run cleanly from a boot
 * clone; state 3+ needs launch geometry a boot does not seat, so they are out of scope here (their
 * handlers' own gates cover them).
 *
 * Jobs:
 *   1. EQUAL — states 0/1/2: oracle == module in RAM (−stack).
 *   2. OBSERVABLE — states 0/1/2 do not all produce the same RAM (the dispatch really varies by
 *      index, so the equal result is not vacuous).
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; an ignore-index twin (always
 *      dispatches state 0) diverges on states 1 and 2, caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2778.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2778 as oracle } from "../../translated/loc_2778.js";
import { dispatchLaunchState } from "../dispatchLaunchState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { LAUNCH_STATE, STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;
const STATES = [0, 1, 2];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft(state) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.push16(0xabcd); // a return for the handler's ret (dead-stack)
  m.mem.write8(LAUNCH_STATE, state);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatchLaunchState == oracle in RAM (−stack) for each dispatch state", () => {
  for (const s of STATES) {
    const o = craft(s);
    const c = craft(s);
    oracle(o);
    dispatchLaunchState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `state ${s}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${STATES.length} dispatch states identical (RAM −stack)`);
});

// -- 2. OBSERVABLE ------------------------------------------------------------

test("OBSERVABLE: the dispatch varies by index (equal is not vacuous)", () => {
  const s0 = craft(0);
  const s1 = craft(1);
  oracle(s0);
  oracle(s1);
  assert.notEqual(
    firstStateDiff(s0.dumpState(), s1.dumpState(), (off) => s0.stateOffsetToAddr(off), inDeadStack),
    null,
    "states 0 and 1 must dispatch to different handlers (else the equal check proves nothing)",
  );
  console.log("  OBSERVABLE: state 0 and state 1 dispatch differently");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craft(1);
  const c = craft(1);
  oracle(o);
  dispatchLaunchState(c);
  // find a cell the dispatch wrote, corrupt it in the module copy
  const d0 = firstStateDiff(o.dumpState(), BASE.dumpState(), (off) => o.stateOffsetToAddr(off), inDeadStack);
  const target = d0 ? d0.addr : LAUNCH_STATE;
  c.mem.write8(target, (o.mem.read8(target) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, target, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: an ignore-index twin (always state 0) is CAUGHT on states 1 and 2", () => {
  function twin(m) {
    m.regs.a = 0x00; // WRONG: ignores the launch state
    m.push16(0x277e);
    return m.call(0x0028);
  }
  for (const s of [1, 2]) {
    const o = craft(s);
    const t = craft(s);
    oracle(o);
    twin(t);
    const d = ramDiffMinusStack(o, t);
    assert.notEqual(d, null, `state ${s}: the gate FAILED to catch a wrong dispatch index`);
  }
  console.log("  TEETH(index): ignore-index twin caught on states 1 and 2");
});
