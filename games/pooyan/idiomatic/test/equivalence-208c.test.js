// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for verifyRomSignature (ROM 0x208c) — "anti-tamper ROM signature
 * check": compares the 16-byte reference table (SIGNATURE_REFERENCE_TABLE) against every eighth byte
 * of the sampled code region (SIGNATURE_SAMPLE_BASE, sample += 8, reference += 1). On the
 * first differing byte it raises SIGNATURE_MISMATCH_FLAG = 1 and stops; a clean pass leaves
 * the flag untouched.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine's only output is memory (the flag), so each
 * case runs on a FRESH clone per side and the contract is:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * No register/flag survives for the caller (repaintScrollColumnsElseVerifySignature immediately returns after the call), so the
 * flag write is the whole contract. Because both tables live in ROM (read-only), the mismatch and
 * match branches are exercised by building machines from MUTATED ROM copies (reads still hit
 * this.rom), forcing the sampled bytes to differ from / equal the reference bytes.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x208c in a real run; any dispatch must agree in RAM.
 *   2. MATCH — ROM forced so all 16 sampled bytes equal the reference: flag left untouched.
 *   3. MISMATCH — ROM forced to differ at step 0 and (separately) mid-loop: flag set to 1 on both.
 *   4. TEETH — a twin that raises the flag to the WRONG value MUST be caught at the flag.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-208c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_208c as oracle } from "../../translated/loc_208c.js";
import { verifyRomSignature } from "../verifyRomSignature.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SIGNATURE_SAMPLE_BASE,
  SIGNATURE_REFERENCE_TABLE,
  SIGNATURE_MISMATCH_FLAG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x208c;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** A machine built from a (possibly mutated) ROM, with the flag pre-dirtied to 0xAA. */
function build(rom) {
  const m = new Machine(rom);
  m.mem.write8(SIGNATURE_MISMATCH_FLAG, 0xaa);
  return m;
}

/** ROM copy where every sampled byte equals its reference byte (a forced clean pass). */
function romMatched() {
  const r = new Uint8Array(ROM);
  for (let k = 0; k < 0x10; k++) r[(SIGNATURE_SAMPLE_BASE + 8 * k) & 0xffff] = r[(SIGNATURE_REFERENCE_TABLE + k) & 0xffff];
  return r;
}

/** ROM copy forced to differ from the reference at sample step `k` (a forced mismatch). */
function romMismatchAt(k) {
  const r = romMatched();
  const s = (SIGNATURE_SAMPLE_BASE + 8 * k) & 0xffff;
  r[s] = r[s] ^ 0xff; // guaranteed to differ from the (now-equal) reference byte
  return r;
}

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(32, 4000) : [];

test("CAPTURE: real 0x208c dispatches — verifyRomSignature == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    verifyRomSignature(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. MATCH -----------------------------------------------------------------

test("MATCH: a clean signature leaves the flag untouched — RAM identical", () => {
  const rom = romMatched();
  const o = build(rom);
  const c = build(rom);
  oracle(o);
  verifyRomSignature(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(SIGNATURE_MISMATCH_FLAG), 0xaa, "clean pass must leave the flag untouched");
  console.log("  MATCH: clean signature — flag untouched on both");
});

// -- 3. MISMATCH --------------------------------------------------------------

test("MISMATCH: a differing byte raises the flag to 1 — identical for step 0 and mid-loop", () => {
  for (const k of [0x00, 0x07, 0x0f]) {
    const rom = romMismatchAt(k);
    const o = build(rom);
    const c = build(rom);
    oracle(o);
    verifyRomSignature(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `step ${k}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.mem.read8(SIGNATURE_MISMATCH_FLAG), 1, `step ${k}: flag must be 1`);
    assert.equal(o.mem.read8(SIGNATURE_MISMATCH_FLAG), 1, `step ${k}: oracle flag must be 1`);
  }
  console.log("  MISMATCH: flag == 1 on both (step 0, 7, 15)");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: raises the flag to the wrong value (2, not 1). */
function brokenVerify(m) {
  verifyRomSignature(m);
  if (m.mem.read8(SIGNATURE_MISMATCH_FLAG) === 1) m.mem.write8(SIGNATURE_MISMATCH_FLAG, 2); // BUG
}

test("TEETH: a wrong flag value is CAUGHT at the flag cell", () => {
  const rom = romMismatchAt(0x03);
  const o = build(rom);
  const c = build(rom);
  oracle(o);
  brokenVerify(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong flag value — it is worthless");
  assert.equal(d.addr, SIGNATURE_MISMATCH_FLAG & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong flag caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
