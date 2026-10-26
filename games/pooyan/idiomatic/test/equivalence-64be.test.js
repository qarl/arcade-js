// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for verifyTerminatorTableOrCountTamper (ROM 0x64be) — the terminator match-scan guard,
 * a DISSOLVED caller-skip.
 *
 * In the frozen layer BOTH exits of verifyTerminatorTableOrCountTamper end `pop af; ret`: the pop discards the
 * caller's own return so control unwinds to the caller's caller (a skip). There is NO
 * plain-ret path, so the dissolved boolean module ALWAYS returns false (skip taken); the
 * two paths differ only in memory:
 *   - MISMATCH (path B): the first differing byte bumps TAMPER_STRIKES_TERMINATOR (0x8df9).
 *   - SENTINEL (path A): a fetched table byte decrements to zero -> clean, writes nothing.
 *
 * Fidelity contract: RAM (dumpState) minus stack scratch below the entry SP, plus the module's boolean return.
 * No register is a live-out: the frozen skip's `pop af` loads stack scratch into AF and the
 * DE/HL scan cursors are not consumed after the unwind, so registers are NOT compared. The
 * oracle's `pop af; ret` moves SP by +4; we assert that to confirm the skip path ran.
 *
 * Both paths are CRAFTED: src/table point at controllable work RAM seeded per path (a plain
 * boot never seats this guard's inputs directly). The only RAM write either path makes is the
 * strike bump on path B.
 *
 * Jobs:
 *   1. EQUAL — path A and path B: oracle == module in RAM (−stack); module returns false;
 *      the oracle's SP advanced by +4 (the pop-af/ret skip).
 *   2. WRITE-SET — path B changes exactly TAMPER_STRIKES_TERMINATOR (+1); path A changes nothing.
 *   3. TEETH — a twin that reports 'continue' (returns true) is rejected by the boolean check;
 *      a twin that forgets the strike bump is caught by the RAM diff at 0x8df9.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-64be.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_64be as oracle } from "../../translated/loc_64be.js";
import { verifyTerminatorTableOrCountTamper } from "../verifyTerminatorTableOrCountTamper.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TAMPER = 0x8df9; // TAMPER_STRIKES_TERMINATOR
const SRC = 0x8e80; // controllable source pointer (descending)
const TABLE = 0x8ea0; // controllable expected-byte table (ascending)
const SP0 = 0x8fe0; // inside STACK_SCRATCH; pop-af + ret only read
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone seated for the mismatch path (first bytes differ). */
function craftMismatch() {
  const m = BASE.clone();
  m.regs.de = SRC;
  m.regs.hl = TABLE;
  m.regs.sp = SP0;
  m.mem.write8(SRC, 0x05);
  m.mem.write8(TABLE, 0x06); // differs -> tamper strike
  m.mem.write8(TAMPER, 0x00); // start the strike counter from a known value
  return m;
}

/** A fresh clone seated for the sentinel path (first byte matches, next table byte == 1). */
function craftSentinel() {
  const m = BASE.clone();
  m.regs.de = SRC;
  m.regs.hl = TABLE;
  m.regs.sp = SP0;
  m.mem.write8(SRC, 0x05);
  m.mem.write8(TABLE, 0x05); // matches
  m.mem.write8(TABLE + 1, 0x01); // fetched table byte dec's to zero -> clean sentinel
  m.mem.write8(TAMPER, 0x00);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: mismatch path — module == oracle in RAM (−stack), returns false, oracle skips", () => {
  const o = craftMismatch();
  const c = craftMismatch();
  const ret = verifyTerminatorTableOrCountTamper(c);
  oracle(o);

  assert.equal(ret, false, "the guard always skips -> boolean must be false");
  assert.equal(o.regs.sp, (SP0 + 4) & 0xffff, "oracle must take the pop-af/ret skip (SP += 4)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(TAMPER), 1, "mismatch must have bumped the strike counter");
  console.log("  EQUAL mismatch: false, SP+=4, strike bumped, RAM identical");
});

test("EQUAL: sentinel path — module == oracle in RAM (−stack), returns false, no strike", () => {
  const o = craftSentinel();
  const c = craftSentinel();
  const ret = verifyTerminatorTableOrCountTamper(c);
  oracle(o);

  assert.equal(ret, false, "the guard always skips -> boolean must be false");
  assert.equal(o.regs.sp, (SP0 + 4) & 0xffff, "oracle must take the pop-af/ret skip (SP += 4)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(TAMPER), 0, "sentinel path writes nothing — strike counter untouched");
  console.log("  EQUAL sentinel: false, SP+=4, no strike, RAM identical");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: mismatch writes exactly TAMPER_STRIKES_TERMINATOR (+1); sentinel writes nothing", () => {
  // mismatch
  let before = craftMismatch();
  let after = craftMismatch();
  let b0 = before.dumpState();
  oracle(after);
  let a1 = after.dumpState();
  let changed = [];
  for (let off = 0; off < b0.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(addr)) changed.push({ addr, from: b0[off], to: a1[off] });
  }
  assert.equal(changed.length, 1, `mismatch: expected 1 non-stack write, got ${changed.length}`);
  assert.equal(changed[0].addr, TAMPER, `mismatch write must be at ${hx(TAMPER)}`);
  assert.equal(changed[0].to, (changed[0].from + 1) & 0xff, "strike counter must be +1");

  // sentinel
  before = craftSentinel();
  after = craftSentinel();
  b0 = before.dumpState();
  oracle(after);
  a1 = after.dumpState();
  changed = [];
  for (let off = 0; off < b0.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(addr)) changed.push({ addr, from: b0[off], to: a1[off] });
  }
  assert.equal(changed.length, 0, `sentinel: expected 0 non-stack writes, got ${changed.length}`);
  console.log("  WRITE-SET: mismatch -> +1 at 0x8df9; sentinel -> no writes");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a twin that reports 'continue' (returns true) is rejected by the boolean check", () => {
  // A twin with the same memory effect but the WRONG boolean: it claims the caller may continue.
  function brokenContinue(m) {
    verifyTerminatorTableOrCountTamper(m); // real memory effect
    return true; // BUG: every path here skips, so this must be false
  }
  const c = craftMismatch();
  assert.throws(
    () => assert.equal(brokenContinue(c), false),
    "the boolean contract must reject a skip reported as 'continue'",
  );
  console.log("  TEETH/boolean: a returned-true twin is caught");
});

test("TEETH: a twin that forgets the strike bump is caught by the RAM diff at 0x8df9", () => {
  function brokenNoStrike() {
    return false; // BUG: skips but never records the tamper strike
  }
  const o = craftMismatch();
  const c = craftMismatch();
  oracle(o);
  brokenNoStrike();
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a missing strike bump — worthless");
  assert.equal(d.addr, TAMPER, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(TAMPER)})`);
  console.log(`  TEETH/RAM: missing strike caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
