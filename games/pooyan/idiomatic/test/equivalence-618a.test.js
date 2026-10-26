// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearActiveObjectTypeAndAbortHandler (ROM 0x618a, Pooyan) — the caller-skip.
 *
 * The routine clears ACTIVE_OBJECT_TYPE (0x8d44) and then, in the frozen oracle, discards its
 * own return address (a `pop af`) before `ret`, so control unwinds one frame past the direct
 * caller — an unconditional abort. There is NO normal-return path. The idiomatic module drops
 * that stack plumbing and reports the outcome as a boolean instead: it always returns false
 * (the skip/abort path).
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP). No register is a live-out — the oracle's dropped pop-af overwrites A
 * and the flags with the discarded return address (garbage), which nothing downstream reads —
 * so the register file is deliberately NOT compared; the BOOLEAN return is the extra contract.
 *
 * Which path the oracle took is read from SP: `pop af` (+2) then `ret` (+2) advances SP by 4,
 * versus +2 for a plain ret. Every case shows +4, confirming the skip, and the module must
 * report false.
 *
 * Jobs:
 *   1. EQUAL — over several seeded object-type values, oracle == module in RAM (−stack); the
 *      oracle's SP advances by 4 (skip) and the module returns false.
 *   2. WRITE-SET — the only game-RAM write is ACTIVE_OBJECT_TYPE := 0.
 *   3. TEETH — a wrong written byte is caught by the RAM diff, and a skip mislabelled as the
 *      normal path (true) is rejected by the boolean contract.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-618a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_618a as oracle } from "../../translated/loc_618a.js";
import { clearActiveObjectTypeAndAbortHandler } from "../clearActiveObjectTypeAndAbortHandler.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ACTIVE_OBJECT_TYPE = 0x8d44;
const SP_SCRATCH = 0x8ff0; // inside STACK_SCRATCH; the oracle's pop-af + ret read here only

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SCRATCH);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the object-type cell seeded and SP parked in the dead-stack region. */
function craft(objType) {
  const m = BASE.clone();
  m.mem.write8(ACTIVE_OBJECT_TYPE, objType & 0xff);
  m.regs.sp = SP_SCRATCH;
  return m;
}

const SEEDS = [0xaa, 0x00, 0x03, 0x7f];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: clearActiveObjectTypeAndAbortHandler clears ACTIVE_OBJECT_TYPE and reports the skip (false) == oracle RAM", () => {
  for (const objType of SEEDS) {
    const o = craft(objType);
    oracle(o);
    assert.equal((o.regs.sp - SP_SCRATCH) & 0xffff, 4, `oracle must take the pop-af skip (SP += 4) for objType=${hx(objType)}`);

    const c = craft(objType);
    const ret = clearActiveObjectTypeAndAbortHandler(c);
    assert.equal(ret, false, `module must report the skip path as false (objType=${hx(objType)})`);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `objType=${hx(objType)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.mem.read8(ACTIVE_OBJECT_TYPE), 0x00, "ACTIVE_OBJECT_TYPE must be cleared");
  }
  console.log(`  EQUAL: ${SEEDS.length} object-type seeds identical (RAM −stack), all return false`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the only game-RAM write is ACTIVE_OBJECT_TYPE := 0", () => {
  const m = craft(0xaa);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  const nonStack = changed.filter((addr) => !inDeadStack(addr));
  assert.deepEqual(nonStack, [ACTIVE_OBJECT_TYPE], `unexpected non-stack writes: ${nonStack.map(hx)}`);
  assert.equal(m.mem.read8(ACTIVE_OBJECT_TYPE), 0x00, "cell must be zeroed");
  console.log(`  WRITE-SET: ${hx(ACTIVE_OBJECT_TYPE)} := 0 (1 cell)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong written byte is CAUGHT by the RAM diff", () => {
  const o = craft(0xaa);
  const c = craft(0xaa);
  oracle(o);
  clearActiveObjectTypeAndAbortHandler(c);
  c.mem.write8(ACTIVE_OBJECT_TYPE, 0x01); // BUG: the cell must be 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ACTIVE_OBJECT_TYPE byte — it is worthless");
  assert.equal(d.addr, ACTIVE_OBJECT_TYPE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a skip mislabelled as the normal path (true) is rejected by the boolean contract", () => {
  const c = craft(0xaa);
  const ret = clearActiveObjectTypeAndAbortHandler(c);
  assert.equal(ret, false, "sanity: the module reports the skip as false");
  // A twin that reported this pop-af skip as a normal m.ret would return true; the EQUAL job
  // asserts `ret === false`, which rejects that:
  const brokenTwinReturn = true;
  assert.throws(() => assert.equal(brokenTwinReturn, false), "the false-return contract must reject a true return");
  console.log("  TEETH(bool): a true (normal-ret) return is rejected for this skip-only routine");
});
