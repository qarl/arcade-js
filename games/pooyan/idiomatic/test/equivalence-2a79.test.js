// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for verifySignatureThenClearFlipAndAdvance — the 0x8a80 actor state-4 handler (dispatch slot 4).
 *
 * The routine runs a 0x68-byte signature check (a fixed program window read upward vs a stored
 * reference block read upward). On a match it reseats the frame-hold cell (ix+0x11) := 0x30, clears
 * bit 7 of the flag cell (ix+0x10), and increments the state cell (ix+0x02); a mismatch tail-jumps
 * the state-1 handler.
 *
 * CYCLE-FREE / memory-equivalence gate. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — a
 * tail-dispatched state handler with NO register live-out (the shared epilogue reloads every register
 * it consumes). pc/SP/cycles are NOT compared. The signature comparison only READS fixed program
 * bytes the test cannot alter (both blocks are ROM and byte-identical on the built image), so the
 * tamper branch is dead and every case exercises the clean (match) path. The three record cells are
 * seeded so each write is observable.
 *
 * Jobs:
 *   1. EQUAL — verifySignatureThenClearFlipAndAdvance == oracle in RAM (−stack) on the built image.
 *   2. WRITE-SET — exactly the three record cells change: frame-hold := 0x30, flag &= ~0x80,
 *      state incremented.
 *   3. TEETH — a wrong frame-hold byte, a non-advanced state cell, and an uncleared flip bit are
 *      each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2a79.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2a79 as oracle } from "../../translated/loc_2a79.js";
import { verifySignatureThenClearFlipAndAdvance } from "../verifySignatureThenClearFlipAndAdvance.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80;          // the actor record IX points at (dispatch sets IX here)
const HOLD = REC + 0x11;     // frame-hold cell, reseated to 0x30
const FLAG = REC + 0x10;     // flag cell, bit 7 cleared (res 7)
const STATE = REC + 0x02;    // state cell, incremented

const HOLD_SEED = 0xaa;      // != 0x30 so the reseat is visible
const FLAG_SEED = 0x85;      // bit 7 set so the clear is visible -> 0x05
const STATE_SEED = 0x05;     // -> 0x06 after the increment
const RESEED = 0x30;
const FLIP_BIT = 0x80;

const EXPECT = {
  [HOLD]: RESEED,
  [FLAG]: FLAG_SEED & ~FLIP_BIT,
  [STATE]: (STATE_SEED + 1) & 0xff,
};

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with IX at the record and the three target cells seeded so writes are observable. */
function craft() {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.mem.write8(HOLD, HOLD_SEED);
  m.mem.write8(FLAG, FLAG_SEED);
  m.mem.write8(STATE, STATE_SEED);
  m.regs.sp = 0x8ffe; // dead-stack scratch; the oracle's final ret only pops (reads)
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: built image (match path) — verifySignatureThenClearFlipAndAdvance == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  verifySignatureThenClearFlipAndAdvance(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: clean-path RAM identical (−stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: exactly the three record cells change to their expected values", () => {
  const c = craft();
  const before = c.dumpState();
  verifySignatureThenClearFlipAndAdvance(c);
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
  console.log(`  WRITE-SET: ${expectedAddrs.length} cells (frame-hold := 0x30, flag &= ~0x80, state++)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong frame-hold byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  verifySignatureThenClearFlipAndAdvance(c);
  c.mem.write8(HOLD, 0x00); // BUG: the frame-hold cell must be reseated to 0x30

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong frame-hold byte — it is worthless");
  assert.equal(d.addr, HOLD, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong frame-hold caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a non-advanced state cell is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  verifySignatureThenClearFlipAndAdvance(c);
  c.mem.write8(STATE, STATE_SEED); // BUG: the state cell must be incremented

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-advanced state cell — it is worthless");
  assert.equal(d.addr, STATE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: non-advanced state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an uncleared flip bit is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  verifySignatureThenClearFlipAndAdvance(c);
  c.mem.write8(FLAG, FLAG_SEED); // BUG: bit 7 of the flag cell must be cleared

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an uncleared flip bit — it is worthless");
  assert.equal(d.addr, FLAG, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: uncleared flip bit caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
