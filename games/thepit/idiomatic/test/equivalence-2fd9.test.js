// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for setChamberCreatureFrame (ROM 0x2fd9, The Pit) — commit the chosen
 * chamber-creature flip tile into 0x80dc, then fall through into the shared animation-update tail at
 * 0x2fe3 (the position step + publish + object pass).
 *
 * DISSOLVED-FORM CONTRACT. The tail 0x2fe3 (and everything below it) is now decompiled, so the
 * oracle's `m.call(0x2fe3)` and the idiomatic direct call run the SAME real tail. The gate therefore
 * runs the full chain on both sides and compares work RAM (dumpState) — it no longer stubs the tail.
 * The object pass the tail reaches can hit the two never-returning transition leaves (0x031a,
 * 0x01f9), so those are stubbed identically on both clones and the once-per-frame tick is modelled so
 * any frame-wait drains; stack scratch below the entry SP is excluded. setChamberCreatureFrame is never
 * dispatched during attract (its whole flip subsystem stays idle), so entries are crafted: a real
 * sibling loc_2f71 state with the tile byte swept, the exact crafted-entry escape hatch for an
 * unreached arm.
 *
 * EQUAL is proven the strong way — an EXHAUSTIVE sweep over all 256 tile bytes. The teeth twins
 * (a wrong committed tile, a dropped tail hand-off) are caught.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2fd9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2fd9 as oracle } from "../../translated/loc_2fd9.js";
import { setChamberCreatureFrame as idiomatic } from "../setChamberCreatureFrame.js";
import { oscillateChamberCreature } from "../oscillateChamberCreature.js";
import { loc_2f71 } from "../../translated/loc_2f71.js";
import { makeMachineFactory } from "../../machine.js";
import { CHAMBER_CREATURE_FRAME, CHAMBER_CREATURE_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const SIB = 0x2f71;
const TILE_CELL = CHAMBER_CREATURE_FRAME; // 0x80dc
const EXPIRY_LEAVES = [0x031a, 0x01f9];
const WATCHDOG = 0xb800, COUNTDOWN = 0x8009;
const CHAIN_SCRATCH_LO = 0x83e0, CHAIN_SCRATCH_HI = 0x8400;
const CAPTURE_FRAMES = 900;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

function captureSiblingState() {
  let entry = null;
  const overrides = new Map([[SIB, (mm) => { if (entry === null) entry = mm.clone(); return loc_2f71(mm); }]]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return entry;
}
const ENTRY = ROM_PRESENT ? captureSiblingState() : null;

function runIsolated(entry, fn) {
  const c = entry.clone();
  for (const a of EXPIRY_LEAVES) c.routines.set(a, () => {});
  const mem = c.mem;
  const orig = mem.read8.bind(mem);
  mem.read8 = (addr) => {
    if (addr === WATCHDOG) { const v = orig(COUNTDOWN); if (v !== 0) mem.write8(COUNTDOWN, v - 1); }
    return orig(addr);
  };
  fn(c);
  return c;
}
function ramDiff(a, b, entrySP) {
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] !== db[i]) {
      const addr = a.stateOffsetToAddr(i);
      if (deadStackBelow({ lo: CHAIN_SCRATCH_LO, hi: CHAIN_SCRATCH_HI }, entrySP)(addr)) continue;
      return { addr, a: da[i], b: db[i] };
    }
  }
  return null;
}

// -- 1. EQUAL: exhaustive over every possible tile byte -----------------------

test("EQUAL (exhaustive): setChamberCreatureFrame == oracle for all 256 tile bytes", () => {
  assert.ok(ENTRY, "captured a real attract state at the sibling loc_2f71");
  for (let tile = 0; tile < 256; tile++) {
    const a = runIsolated(ENTRY, (c) => { c.regs.a = tile; oracle(c); });
    const b = runIsolated(ENTRY, (c) => { c.regs.a = tile; idiomatic(c); });
    const r = ramDiff(a, b, ENTRY.regs.sp);
    assert.equal(r, null, r && `tile=${hx(tile)}: RAM diverged at ${hx(r.addr)} (oracle=${r.a} idiomatic=${r.b})`);
    assert.equal(a.mem.read8(TILE_CELL), tile, `tile=${hx(tile)}: the committed byte must land at ${hx(TILE_CELL)}`);
  }
  console.log("  EQUAL/exhaustive: all 256 tile bytes identical to the oracle (work RAM, full tail)");
});

// -- 2. TEETH: broken twins the gate MUST catch -------------------------------

// Commits the WRONG tile byte, then runs the real tail identically.
function brokenTile(m) {
  m.mem8[TILE_CELL] = m.regs.a ^ 0xff; // BUG
  return oscillateChamberCreature(m);
}
// Commits the right tile but DROPS the tail hand-off entirely.
function brokenNoTail(m) {
  m.mem8[TILE_CELL] = m.regs.a; // right tile...
  // BUG: no tail.
}

test("TEETH: a wrong committed tile is CAUGHT at the tile cell", () => {
  const a = runIsolated(ENTRY, (c) => { c.regs.a = 0x38; oracle(c); });
  const b = runIsolated(ENTRY, (c) => { c.regs.a = 0x38; brokenTile(c); });
  const r = ramDiff(a, b, ENTRY.regs.sp);
  assert.notEqual(r, null, "the gate FAILED to catch a wrong committed tile — it is worthless");
  assert.equal(r.addr, TILE_CELL, `teeth caught ${hx(r.addr)} (expected ${hx(TILE_CELL)})`);
  console.log(`  TEETH: wrong tile caught at ${hx(r.addr)} (oracle=${r.a} broken=${r.b})`);
});

test("TEETH: dropping the tail hand-off is CAUGHT", () => {
  const a = runIsolated(ENTRY, (c) => { c.regs.a = 0x38; oracle(c); });
  const b = runIsolated(ENTRY, (c) => { c.regs.a = 0x38; brokenNoTail(c); });
  const r = ramDiff(a, b, ENTRY.regs.sp);
  assert.notEqual(r, null, "the missing tail must surface as a memory difference");
  // The dropped tail never runs the position step, so the first divergence is the creature's X cell.
  assert.equal(r.addr, CHAMBER_CREATURE_X, `teeth caught ${hx(r.addr)} (expected the position cell ${hx(CHAMBER_CREATURE_X)})`);
  console.log(`  TEETH: dropped hand-off caught at ${hx(r.addr)} (oracle=${r.a} broken=${r.b})`);
});
