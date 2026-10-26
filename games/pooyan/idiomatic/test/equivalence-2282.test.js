// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for loadPhaseMotionParamsAndAdvancePhase (ROM 0x2282, Pooyan) — "load the phase's motion params".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and loadPhaseMotionParamsAndAdvancePhase on the other, compared on RAM (dumpState, minus stack scratch below the entry SP).
 * loadPhaseMotionParamsAndAdvancePhase has no register live-out — the caller reads the three loaded slots back out of memory —
 * so only RAM is compared; pc/SP/cycles are deliberately not compared.
 *
 * INPUTS: the phase index at 0x8f0f, plus the three ROM tables (byte 0x2712 via the rst-0x20
 * lookup, words 0x271c/0x2730 via the fetchWordFromTableIndex lookup) which the real ROM supplies to both sides.
 *
 * The routine's own footprint is 0x8f0e (byte), 0x8f10 + 0x8f12 (two words) and the stepped phase
 * at 0x8f0f; the nested lookups' pushes land in STACK_SCRATCH and drop out of the diff. The leaf is
 * not reached in a plain boot, so every case is CRAFTED: the phase byte is poked on both clones.
 *
 * Jobs:
 *   1. EQUAL — crafted phase cases spanning the mid range, the 9->8 clamp and the 0 wrap, oracle
 *      == loadPhaseMotionParamsAndAdvancePhase in RAM (−stack).
 *   2. WRITE-SET — the three loaded slots hold the oracle's values and the phase steps to the
 *      contract value (mid + 1; 8 held at 8 after the clamp).
 *   3. TEETH — a wrong loaded byte and a not-clamped phase twin are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2282.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2282 as oracle } from "../../translated/loc_2282.js";
import { loadPhaseMotionParamsAndAdvancePhase } from "../loadPhaseMotionParamsAndAdvancePhase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PHASE = 0x8f0f;
const PARAM_BYTE = 0x8f0e;
const PARAM_WORD_X = 0x8f10;
const PARAM_WORD_Y = 0x8f12;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the phase byte seated and the stack parked in STACK_SCRATCH. */
function craft(phase) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // nested lookup pushes live in STACK_SCRATCH
  m.mem8[PHASE] = phase & 0xff;
  return m;
}

const CASES = [
  { name: "phase 3 -> 4", phase: 0x03, next: 0x04 },
  { name: "phase 8 -> 9 -> clamp 8", phase: 0x08, next: 0x08 },
  { name: "phase 0 -> 1", phase: 0x00, next: 0x01 },
  { name: "phase 7 -> 8", phase: 0x07, next: 0x08 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted phase cases — loadPhaseMotionParamsAndAdvancePhase == oracle in RAM (−stack)", () => {
  for (const spec of CASES) {
    const o = craft(spec.phase);
    oracle(o);
    const c = craft(spec.phase);
    loadPhaseMotionParamsAndAdvancePhase(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted phase cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the three loaded slots + the stepped phase hold the contract values", () => {
  for (const spec of CASES) {
    const o = craft(spec.phase);
    oracle(o);
    const byte = o.mem8[PARAM_BYTE];
    const wordX = o.mem.read16(PARAM_WORD_X);
    const wordY = o.mem.read16(PARAM_WORD_Y);

    const c = craft(spec.phase);
    loadPhaseMotionParamsAndAdvancePhase(c);
    assert.equal(c.mem8[PARAM_BYTE], byte, `[${spec.name}] 0x8f0e byte`);
    assert.equal(c.mem.read16(PARAM_WORD_X), wordX, `[${spec.name}] 0x8f10 word`);
    assert.equal(c.mem.read16(PARAM_WORD_Y), wordY, `[${spec.name}] 0x8f12 word`);
    assert.equal(c.mem8[PHASE], spec.next, `[${spec.name}] phase steps to ${hx(spec.next)}`);
  }
  console.log("  WRITE-SET: byte + two words loaded; phase stepped/clamped per contract");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong loaded byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x03);
  const c = craft(0x03);
  oracle(o);
  loadPhaseMotionParamsAndAdvancePhase(c);
  c.mem8[PARAM_BYTE] = (o.mem8[PARAM_BYTE] ^ 0xff) & 0xff; // BUG: wrong loaded param byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong loaded byte — it is worthless");
  assert.equal(d.addr, PARAM_BYTE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong 0x8f0e caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a phase-not-clamped twin is CAUGHT by the RAM diff", () => {
  const o = craft(0x08); // oracle clamps 9 -> 8
  const c = craft(0x08);
  oracle(o);
  loadPhaseMotionParamsAndAdvancePhase(c);
  c.mem8[PHASE] = 0x09; // BUG: a twin that stepped to 9 without clamping

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing 9->8 clamp");
  assert.equal(d.addr, PHASE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: un-clamped phase caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
