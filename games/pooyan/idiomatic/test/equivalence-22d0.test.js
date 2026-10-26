// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for foldTargetPresenceBits (ROM 0x22d0) — "rotate-fold the
 * presence bit of the two I-parity enemy-target records into A": seed A = 0, then for each
 * of the two stride-0x18 records whose byte-0 bit-0 is set, rotate A left one place.
 *
 * The routine WRITES NO RAM, so its only go-forward contract is the value it returns in A.
 * Both sides run on fresh clones; they must agree on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) — trivially, since neither writes — AND the
 *     returned accumulator, derived from the ORACLE clone's regs.a (never the module).
 *
 * Jobs:
 *   1. CAPTURE — hook 0x22d0 in a real run; every real dispatch must agree in RAM and A.
 *   2. CRAFTED — seed the two records with every bit-0 combination; A matches the oracle.
 *   3. WRITE-SET — the oracle writes NO RAM at all (positive control for "memory-only").
 *   4. TEETH — a twin seeded with the wrong accumulator MUST be caught by the A check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-22d0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_22d0 as oracle } from "../../translated/loc_22d0.js";
import { foldTargetPresenceBits } from "../foldTargetPresenceBits.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_TARGET_REC0 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x22d0;
const STRIDE = 0x18;
const REC1 = (ENEMY_TARGET_REC0 + STRIDE) & 0xffff;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Seed the two record byte-0s and pre-dirty a window around them so any stray write shows. */
function craft(b0, b1) {
  const m = new Machine(ROM);
  for (let i = 0; i < 0x30; i++) m.mem.write8((ENEMY_TARGET_REC0 + i) & 0xffff, 0xaa);
  m.mem.write8(ENEMY_TARGET_REC0, b0);
  m.mem.write8(REC1, b1);
  return m;
}

// Every bit-0 combination, plus high bits set to prove only bit 0 gates the rotate.
const CASES = [
  { b0: 0x00, b1: 0x00 },
  { b0: 0x01, b1: 0x00 },
  { b0: 0x00, b1: 0x01 },
  { b0: 0x01, b1: 0x01 },
  { b0: 0xff, b1: 0xfe }, // b0 bit0=1, b1 bit0=0 (high bits must not matter)
  { b0: 0xfe, b1: 0xff }, // b0 bit0=0, b1 bit0=1
];

// -- 1. CAPTURE ---------------------------------------------------------------

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

test("CAPTURE: real 0x22d0 dispatches — foldTargetPresenceBits == oracle in RAM (−stack) + A", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x22d0 dispatch in the run window");
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const acc = foldTargetPresenceBits(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(acc, o.regs.a, `A live-out: module ${hx(acc)} != oracle ${hx(o.regs.a)}`);
    assert.equal(c.regs.a, o.regs.a, `module must SET A (side effect) for the translated cp 0x03: c ${hx(c.regs.a)} != o ${hx(o.regs.a)}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: every bit-0 combination — RAM identical + A matches the oracle", () => {
  for (const cs of CASES) {
    const o = craft(cs.b0, cs.b1);
    const c = craft(cs.b0, cs.b1);
    oracle(o);
    const acc = foldTargetPresenceBits(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(
      d, null,
      d && `case ${JSON.stringify(cs)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`,
    );
    assert.equal(acc, o.regs.a, `case ${JSON.stringify(cs)}: A ${hx(acc)} != oracle ${hx(o.regs.a)}`);
    assert.equal(c.regs.a, o.regs.a, `case ${JSON.stringify(cs)}: module must SET A (side effect): c ${hx(c.regs.a)} != o ${hx(o.regs.a)}`);
  }
  console.log(`  CRAFTED: ${CASES.length} bit-0 combinations agree in RAM + A`);
});

// -- 3. WRITE-SET (positive control: memory-only) -----------------------------

test("WRITE-SET: the oracle writes NO RAM", () => {
  for (const cs of CASES) {
    const before = craft(cs.b0, cs.b1);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      assert.fail(`case ${JSON.stringify(cs)}: oracle wrote ${hx(after.stateOffsetToAddr(off))}`);
    }
  }
  console.log("  WRITE-SET: no RAM write on any case");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: seeds the accumulator 1 instead of 0 — must diverge from the oracle's A. */
function brokenFold(m) {
  const { mem8 } = m;
  let acc = 1; // BUG: wrong accumulator seed
  let rec = ENEMY_TARGET_REC0;
  for (let i = 0; i < 2; i++) {
    if (mem8[rec] & 0x01) acc = ((acc << 1) | (acc >> 7)) & 0xff;
    rec += STRIDE;
  }
  return acc;
}

test("TEETH: a wrong accumulator seed is CAUGHT by the A check", () => {
  let caught = false;
  for (const cs of CASES) {
    const o = craft(cs.b0, cs.b1);
    const c = craft(cs.b0, cs.b1);
    oracle(o);
    const bad = brokenFold(c);
    if (bad !== o.regs.a) { caught = true; break; }
  }
  assert.ok(caught, "the A check FAILED to catch a wrong accumulator seed — it is worthless");
  console.log("  TEETH: a wrong accumulator seed differs from the oracle's A");
});
