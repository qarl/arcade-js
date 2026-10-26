// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stampSecondScrollColumn (ROM 0x1d0d, Pooyan) — the second scroll column's tile stamp.
 * It writes tile 0x01 to the column top (0x8740) then re-emits stampCappedTileColumnUp's shared tail: 0x25 one row
 * up (0x8720), 0x20 two rows up (0x8700). Fixed addresses/values -> no input registers.
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). No register live-out — callers read only memory back (the `add hl,de` stride
 * preserves the Z flag the caller's own compare set).
 *
 * Jobs:
 *   1. EQUAL — module == oracle in RAM (−stack).
 *   2. WRITE-SET — the three column cells land at 0x01 / 0x25 / 0x20.
 *   3. TEETH — a corrupted post-run byte is caught; a twin that skips a write diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1d0d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d0d as oracle } from "../../translated/loc_1d0d.js";
import { stampSecondScrollColumn } from "../stampSecondScrollColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TOP = 0x8740; //  column top cell
const MID = 0x8720; //  one row up
const BOT = 0x8700; //  two rows up
const SP0 = 0x8ff0; //  inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the three column cells pre-dirtied so each write is observable. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  for (const cell of [TOP, MID, BOT]) m.mem.write8(cell, 0xaa);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: stampSecondScrollColumn == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  stampSecondScrollColumn(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: column-stamp identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the three column cells land at 0x01 / 0x25 / 0x20", () => {
  const c = craft();
  stampSecondScrollColumn(c);
  assert.equal(c.mem.read8(TOP), 0x01, "top cell = 0x01");
  assert.equal(c.mem.read8(MID), 0x25, "mid cell = 0x25");
  assert.equal(c.mem.read8(BOT), 0x20, "bottom cell = 0x20");
  console.log("  WRITE-SET: 0x01 / 0x25 / 0x20 stamped");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  stampSecondScrollColumn(c);
  c.mem.write8(MID, (o.mem.read8(MID) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, MID, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the bottom write diverges from the oracle", () => {
  const o = craft();
  const c = craft(); // twin: never runs stampSecondScrollColumn -> the pre-dirty 0xaa filler survives
  oracle(o);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped write must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
