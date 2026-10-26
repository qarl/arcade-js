// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for verifyFormationGuardChecksum (ROM 0x3266, Pooyan) — hunter-formation dispatch state 2, a
 * ROM self-check. It sums a fixed 0x20-byte block from FORMATION_GUARD_BASE; an intact ROM sums
 * to 0xdc and it returns, otherwise the frozen code re-enters the guarded region (modelled here as a
 * thrown integrity trap). The routine reads ROM only — it writes no game RAM and has no register
 * live-out — so its observable contract is throw-vs-return parity, not a written cell.
 *
 * (Contract compared: RAM via dumpState, minus stack scratch below the entry SP — trivially equal, both write nothing —
 * PLUS the throw/return behaviour, the load-bearing property. ROM is not writable in a clone, so a
 * corrupt-block arm is impossible; the teeth instead prove the sentinel comparison is real: a twin
 * that expects the WRONG sum throws on the same valid ROM the module accepts.)
 *
 * Jobs:
 *   1. EQUAL — on the real ROM, neither oracle nor module throws, and RAM (−stack) is identical.
 *   2. WRITE-SET — the oracle writes zero game-RAM cells.
 *   3. TEETH — a twin with a wrong sentinel throws where the module returns cleanly; the sum the
 *      module accepts really is 0xdc (a wrong-sum twin is rejected).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3266.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3266 as oracle } from "../../translated/loc_3266.js";
import { verifyFormationGuardChecksum } from "../verifyFormationGuardChecksum.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, FORMATION_GUARD_BASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const GUARD_BLOCK_LEN = 0x20;
const GUARD_SENTINEL = 0xdc;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft() {
  const m = BASE.clone();
  m.regs.sp = 0x8fe0; // the oracle's ret only reads the dead stack region
  return m;
}

// A twin that sums the same block but checks the WRONG sentinel — must throw on a valid ROM.
function brokenTwinWrongSentinel(m) {
  const { mem8 } = m;
  let sum = 0;
  let p = FORMATION_GUARD_BASE;
  for (let i = 0; i < GUARD_BLOCK_LEN; i++) {
    sum = (sum + mem8[p]) & 0xff;
    p = (p + 1) & 0xffff;
  }
  if (sum !== ((GUARD_SENTINEL + 1) & 0xff)) throw new Error("twin: wrong sentinel");
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: on the real ROM both return without throwing; RAM (−stack) identical", () => {
  const o = craft();
  const c = craft();
  assert.doesNotThrow(() => oracle(o), "oracle must not trap on a valid ROM");
  assert.doesNotThrow(() => verifyFormationGuardChecksum(c), "module must not trap on a valid ROM");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log("  EQUAL: no trap, RAM identical (both write nothing)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes zero game-RAM cells", () => {
  const m = craft();
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  let changed = 0;
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed++;
  assert.equal(changed, 0, `expected 0 writes, got ${changed}`);
  console.log("  WRITE-SET: 0 game-RAM cells written");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong-sentinel twin throws where the module returns cleanly", () => {
  const c = craft();
  assert.doesNotThrow(() => verifyFormationGuardChecksum(c), "sanity: the module accepts the real ROM sum (0xdc)");
  const t = craft();
  assert.throws(() => brokenTwinWrongSentinel(t), "the sentinel check must be load-bearing — a wrong sum must trap");
  console.log("  TEETH: module accepts sum 0xdc; a wrong-sentinel twin traps on the same ROM");
});
