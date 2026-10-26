// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for noopHighStateHandler (ROM 0x4378, Pooyan) — a PHANTOM NO-OP: the frozen routine
 * is a lone `ret` with no memory effect (a called stub). The idiomatic rewrite must leave RAM
 * (dumpState, minus stack scratch below the entry SP) byte-identical to the oracle, which also just returns. pc/SP are
 * NOT compared; there is no register live-out.
 *
 * This is a dissolve candidate: the routine should ultimately vanish into its caller. Until then a
 * minimal module + this gate document that it does nothing.
 *
 * Jobs:
 *   1. NO-OP EQUAL — over boot-state clones, oracle == noopHighStateHandler in RAM(−stack).
 *   2. WRITE-SET — the oracle changes ZERO cells.
 *   3. TEETH — a twin that writes one work-RAM byte MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-4378.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4378 as oracle } from "../../translated/loc_4378.js";
import { noopHighStateHandler } from "../noopHighStateHandler.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const TEETH_CELL = 0x8880; // arbitrary work-RAM cell inside dumpState
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with SP parked in dead scratch (the oracle's ret only pops, never writes). */
function craft() {
  const m = BASE.clone();
  m.regs.sp = 0x8fe0;
  return m;
}

// -- 1. NO-OP EQUAL -----------------------------------------------------------

test("NO-OP EQUAL: oracle == noopHighStateHandler in RAM(−stack) across clones", () => {
  for (let i = 0; i < 4; i++) {
    const o = craft();
    const c = craft();
    oracle(o);
    noopHighStateHandler(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log("  NO-OP EQUAL: 4 clones identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle changes ZERO cells", () => {
  const before = craft();
  const after = craft();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  let changed = 0;
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off] && !inDeadStack(after.stateOffsetToAddr(off))) changed++;
  }
  assert.equal(changed, 0, `expected zero writes, got ${changed}`);
  console.log("  WRITE-SET: 0 cells changed");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a single stray work-RAM write is caught", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  noopHighStateHandler(c);
  c.mem.write8(TEETH_CELL, (c.mem.read8(TEETH_CELL) ^ 0xaa) & 0xff); // BUG: a no-op must write nothing
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a stray write — it is worthless");
  assert.equal(d.addr, TEETH_CELL, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: stray write caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
