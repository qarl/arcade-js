// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedDisplayListPointersAndVerifyRomSignature (ROM 0x744e) — attract/self-test state 0. Clears the
 * sub-phase tick (0x88b7), seeds the display-list pointer pairs (0x88ba<-0x43e1, 0x8f45<-0x4af0,
 * 0x88b8<-0x8442, 0x8f43<-0x8042), advances the self-test selector (inc 0x8921), then runs a
 * two-stage program-signature check: loop 1 (eight boot bytes vs the copy at 0x749a) and loop 2 (a
 * 0x74-byte window from 0x0092 vs the copy continuing at 0x74a2). Both reference blocks are verbatim
 * copies of the checked code, so on the built image both loops match and the routine returns after
 * the seed writes; a loop-2 divergence would tail into reinitRoundArenaAndPlayfieldIfImageIntact.
 *
 * CYCLE-FREE / memory-equivalence gate. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — a
 * tail-dispatched state handler with no register live-out. pc/SP/cycles are NOT compared. The
 * comparison loops only READ ROM (which the test cannot alter), so the tamper branches are dead on
 * the built image and every case exercises the clean path.
 *
 * The ten written cells are PRE-DIRTIED so each write is visible (and a skipped write is caught).
 *
 * Jobs:
 *   1. EQUAL — seedDisplayListPointersAndVerifyRomSignature == oracle in RAM (−stack) on the built image.
 *   2. WRITE-SET — exactly the ten seed cells change, to their little-endian pointer bytes /
 *      cleared tick / incremented selector.
 *   3. TEETH — a twin with a wrong seed pointer byte and a twin with a non-advanced selector are
 *      both CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-744e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_744e as oracle } from "../../translated/loc_744e.js";
import { seedDisplayListPointersAndVerifyRomSignature } from "../seedDisplayListPointersAndVerifyRomSignature.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TICK = 0x88b7;      // sub-phase tick (cleared to 0)
const SRC_ALT = 0x88ba;   // <- 0x43e1
const SRC = 0x8f45;       // <- 0x4af0
const DST_ALT = 0x88b8;   // <- 0x8442
const DST = 0x8f43;       // <- 0x8042
const SELECTOR = 0x8921;  // incremented
const SELECTOR_SEED = 0x10;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Expected written cell -> value (16-bit seeds split little-endian).
const EXPECT = {
  [TICK]: 0x00,
  [SRC_ALT]: 0xe1, [SRC_ALT + 1]: 0x43,
  [SRC]: 0xf0, [SRC + 1]: 0x4a,
  [DST_ALT]: 0x42, [DST_ALT + 1]: 0x84,
  [DST]: 0x42, [DST + 1]: 0x80,
  [SELECTOR]: (SELECTOR_SEED + 1) & 0xff,
};

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the ten target cells pre-dirtied so every write is observable. */
function craft() {
  const m = BASE.clone();
  for (const addr of [TICK, SRC_ALT, SRC_ALT + 1, SRC, SRC + 1, DST_ALT, DST_ALT + 1, DST, DST + 1]) {
    m.mem.write8(addr, 0xaa);
  }
  m.mem.write8(SELECTOR, SELECTOR_SEED);
  m.regs.sp = 0x8ffe; // dead-stack scratch (oracle's final ret only pops)
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: built image — seedDisplayListPointersAndVerifyRomSignature == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  seedDisplayListPointersAndVerifyRomSignature(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: clean-path RAM identical (−stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: exactly the ten seed cells change to their expected values", () => {
  const c = craft();
  const before = c.dumpState();
  seedDisplayListPointersAndVerifyRomSignature(c);
  const after = c.dumpState();

  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) changed.push(c.stateOffsetToAddr(off));
  }
  const expectedAddrs = Object.keys(EXPECT).map(Number).sort((a, b) => a - b);
  assert.deepEqual(changed.sort((a, b) => a - b), expectedAddrs, `unexpected write footprint: ${changed.map(hx)}`);
  for (const [addr, val] of Object.entries(EXPECT)) {
    assert.equal(c.mem.read8(Number(addr)), val, `cell ${hx(Number(addr))} must be ${hx(val)}`);
  }
  console.log(`  WRITE-SET: ${expectedAddrs.length} seed cells written (tick=0, 4 pointer pairs, selector++)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seed pointer byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  seedDisplayListPointersAndVerifyRomSignature(c);
  c.mem.write8(SRC_ALT, 0x00); // BUG: this cell must be the low byte of 0x43e1 (0xe1)

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seed pointer byte — it is worthless");
  assert.equal(d.addr, SRC_ALT, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seed byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a non-advanced self-test selector is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  seedDisplayListPointersAndVerifyRomSignature(c);
  c.mem.write8(SELECTOR, SELECTOR_SEED); // BUG: selector must be incremented

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-advanced selector — it is worthless");
  assert.equal(d.addr, SELECTOR, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: non-advanced selector caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
