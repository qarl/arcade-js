// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceInFlightEnemyAndLand (ROM 0x3e9c) — "in-flight object mover, state 6". It
 * ticks the object's animation, then moves it in one of two modes selected by bit 0 of the
 * record's mode byte (rec+0x01): a waypoint script (dx/dy pairs, 0xee = loop marker) or free
 * flight (velocity + homing-toward-target or a 4-frame drift). Either mode can land the object,
 * which queues the settle animation and flips it to the landing state.
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared, and
 * there is NO register live-out — this is a per-frame state handler reached from a table
 * dispatch, and its whole result lives in the object record. So the gate is RAM-only.
 *
 * All cases are CRAFTED: the whole record (and, for waypoint cases, a small dx/dy script in
 * work RAM) is poked identically on both sides. Each record seats rec+0x0e nonzero so the
 * animation tick just decrements the frame-hold counter (a deterministic, self-contained tick
 * that needs no valid animation stream). The oracle's push/call/ret all land in STACK_SCRATCH.
 *
 * Jobs:
 *   1. EQUAL — over waypoint (plain / borrow+carry / loop marker / land) and free (drift-move /
 *      drift-idle / homing-move / homing-target-reached / free-land) cases, oracle == advanceInFlightEnemyAndLand
 *      in RAM (−stack).
 *   2. WRITE-SET — the plain-waypoint case writes exactly the frame-hold, X-low, Y-low, and
 *      script-pointer-low cells.
 *   3. TEETH — a wrong moved byte (no-land path) and a wrong landing-state byte (land path) are
 *      both caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3e9c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3e9c as oracle } from "../../translated/loc_3e9c.js";
import { advanceInFlightEnemyAndLand } from "../advanceInFlightEnemyAndLand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX_BASE = 0x8c48; // a work-RAM object record (stride 0x18), clear of STACK_SCRATCH
const SCRIPT_BASE = 0x8e00; // work-RAM scratch holding the crafted dx/dy script
const SCRIPT_LO = SCRIPT_BASE & 0xff;
const SCRIPT_HI = SCRIPT_BASE >> 8;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record zeroed (frame-hold defaulted nonzero), overrides applied, optional script. */
function craft(rec, script) {
  const m = BASE.clone();
  for (let off = 0; off <= 0x17; off++) m.mem.write8(IX_BASE + off, 0x00);
  m.mem.write8(IX_BASE + 0x0e, 0x05); // frame-hold: the tick just decrements it
  for (const [off, val] of Object.entries(rec)) m.mem.write8(IX_BASE + Number(off), val & 0xff);
  if (script) script.forEach((b, i) => m.mem.write8(SCRIPT_BASE + i, b & 0xff));
  m.regs.ix = IX_BASE;
  m.regs.sp = 0x8ff0; // in STACK_SCRATCH; oracle push/call/ret stay inside it
  return m;
}

// Waypoint mode: rec+0x01 bit0 set; rec+0x12:0x13 -> the script.
const WP = { 0x01: 0x01, 0x12: SCRIPT_LO, 0x13: SCRIPT_HI };
const CASES = [
  { label: "waypoint plain (no borrow/carry, no land)",
    rec: { ...WP, 0x03: 0x20, 0x04: 0x10, 0x05: 0x40, 0x06: 0x30 }, script: [0x10, 0x08] },
  { label: "waypoint borrow+carry (no land)",
    rec: { ...WP, 0x03: 0x20, 0x04: 0x10, 0x05: 0x10, 0x06: 0x30 }, script: [0x50, 0xf0] },
  { label: "waypoint loop marker 0xee (pointer rewinds)",
    rec: { ...WP, 0x03: 0x20, 0x04: 0x00, 0x05: 0x40, 0x06: 0x30 }, script: [0xee, 0x04, 0x02] },
  { label: "waypoint land (Y high reaches the landing row)",
    rec: { ...WP, 0x03: 0x20, 0x04: 0x1e, 0x05: 0x40, 0x06: 0x30 }, script: [0x10, 0x08] },
  { label: "free drift move (proceeds, no land)",
    rec: { 0x01: 0x00, 0x03: 0x20, 0x04: 0x10, 0x05: 0x40, 0x06: 0x00, 0x08: 0x00, 0x12: 0x08, 0x13: 0x10, 0x16: 0x00 } },
  { label: "free drift idle frame",
    rec: { 0x01: 0x00, 0x03: 0x20, 0x05: 0x40, 0x06: 0x00, 0x08: 0x00, 0x12: 0x08, 0x13: 0x10, 0x16: 0x03 } },
  { label: "free homing move (no land)",
    rec: { 0x01: 0x00, 0x03: 0x40, 0x04: 0x10, 0x05: 0x40, 0x06: 0x00, 0x08: 0x01, 0x12: 0x08, 0x13: 0x10 } },
  { label: "free homing target reached",
    rec: { 0x01: 0x00, 0x05: 0x40, 0x06: 0x00, 0x08: 0x01, 0x12: 0x08, 0x13: 0x01 } },
  { label: "free drift land (trigger column + X in range)",
    rec: { 0x01: 0x00, 0x03: 0x20, 0x04: 0x00, 0x05: 0x40, 0x06: 0x1a, 0x08: 0x00, 0x12: 0x08, 0x13: 0x10, 0x16: 0x00 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted waypoint + free cases — advanceInFlightEnemyAndLand == oracle in RAM (−stack)", () => {
  for (const { label, rec, script } of CASES) {
    const o = craft(rec, script);
    const c = craft(rec, script);
    oracle(o);
    advanceInFlightEnemyAndLand(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} ("${label}")`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the plain-waypoint case writes only frame-hold, X-low, Y-low, script-ptr-low", () => {
  const { rec, script } = CASES[0];
  const before = craft(rec, script);
  const after = craft(rec, script);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(addr)) changed.add(addr);
  }
  const expected = new Set([IX_BASE + 0x0e, IX_BASE + 0x05, IX_BASE + 0x03, IX_BASE + 0x12]);
  assert.deepEqual([...changed].sort((x, y) => x - y), [...expected].sort((x, y) => x - y),
    `unexpected write footprint: ${[...changed].map(hx).join(",")}`);
  console.log(`  WRITE-SET: plain waypoint touches ${[...expected].map(hx).join("/")}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong moved byte (no-land path) is CAUGHT by the RAM diff", () => {
  const { rec, script } = CASES[0]; // plain waypoint: X-low is written to 0x30
  const cell = IX_BASE + 0x05;
  const o = craft(rec, script);
  const c = craft(rec, script);
  oracle(o);
  advanceInFlightEnemyAndLand(c);
  c.mem.write8(cell, 0xff); // BUG: corrupt the moved X-low byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong moved byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/move: wrong X-low byte caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong landing-state byte (land path) is CAUGHT by the RAM diff", () => {
  const landCase = CASES[3]; // waypoint land: rec+0x02 is set to the landing state
  const cell = IX_BASE + 0x02;
  const o = craft(landCase.rec, landCase.script);
  const c = craft(landCase.rec, landCase.script);
  oracle(o);
  advanceInFlightEnemyAndLand(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: the land path is RAM-equal before the twin breaks it");
  assert.equal(c.mem.read8(cell), 0x02, "sanity: the land path set the landing state");
  c.mem.write8(cell, 0x00); // BUG: clobber the landing state the handler set
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong landing-state byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/land: wrong landing-state byte caught at ${hx(d.addr)}`);
});
