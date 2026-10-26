// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for drawTerrainColumn (ROM 0x2fb7, The Pit) — write one vertical strip of
 * tiles up a backdrop column (a strided tile-map blit driven by register inputs), then fall through
 * into the animation phase clock advanceChamberCreatureAnimation.
 *
 * TWO WRINKLES this routine forces, both handled with a crafted entry:
 *
 *   1. drawTerrainColumn's live-ins are REGISTERS (a source pointer, the column's bottom cell, the
 *      one-row-up step, and a run length), not memory, and the blit is never dispatched at this
 *      address in attract (the column-animation step inlines the same body). So a real attract state
 *      is captured at the reachable sibling loc_2f71 and the four blit registers are set to exactly
 *      the values the real setup produces — swept over run lengths, source offsets, and (to drive the
 *      phase clock's three arms) the animation phase.
 *
 *   2. DISSOLVED-FORM CONTRACT. The phase clock and its three continuations are now decompiled, so
 *      the oracle's `m.call`s and the idiomatic direct calls run the SAME real tail. The gate runs the
 *      full chain on both sides and compares work RAM (dumpState) rather than stubbing the
 *      continuations. The object pass a tail reaches can hit the two never-returning transition leaves
 *      (0x031a, 0x01f9), stubbed identically on both clones; the once-per-frame tick is modelled and
 *      the stack scratch below the entry SP excluded.
 *
 * EQUAL is proven over every captured state (standard six-cell blit on real memory + real phase), an
 * exhaustive sweep of source offsets x run lengths x phase (reaching all three phase-clock arms), and
 * a zero-length run that exercises the 256-cell wrap. The teeth twins (corrupted tile code, wrong
 * step) are caught in the tile-map column.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2fb7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2fb7 as oracle } from "../../translated/loc_2fb7.js";
import { drawTerrainColumn as idiomatic } from "../drawTerrainColumn.js";
import { advanceChamberCreatureAnimation } from "../advanceChamberCreatureAnimation.js";
import { loc_2f71 } from "../../translated/loc_2f71.js";
import { makeMachineFactory } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const SIB = 0x2f71;
const PATTERN_TABLE = 0x3048; // ROM base of the tile-pattern table the blit reads from
const COLUMN_BOTTOM = 0x938c; // the column's bottom tile-map cell (the blit's start)
const ROW_STEP = 0xffe0; // -0x20: the step one screen row up the column
const PHASE = 0x80e3; // the animation phase counter the phase clock ticks/reloads
const FLIP_TILE = 0x80dc; // the two-state flip tile cell the phase clock writes
const EXPIRY_LEAVES = [0x031a, 0x01f9];
const WATCHDOG = 0xb800, COUNTDOWN = 0x8009;
const CHAIN_SCRATCH_LO = 0x83e0, CHAIN_SCRATCH_HI = 0x8400;
const CAPTURE_FRAMES = 900, CAPTURE_LIMIT = 64;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

function captureSiblingStates() {
  const states = [];
  const overrides = new Map([[SIB, (mm) => {
    if (states.length < CAPTURE_LIMIT) states.push(mm.clone());
    return loc_2f71(mm);
  }]]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return states;
}
const STATES = ROM_PRESENT ? captureSiblingStates() : [];

// Craft a valid drawTerrainColumn entry: a clone with the four blit registers set the way the oracle
// setup stages them, and optionally a poked phase / flip tile to steer the phase-clock delegation.
function buildEntry(base, { cursor = 0, count = 6, dst = COLUMN_BOTTOM, step = ROW_STEP, phase = null, tile = null } = {}) {
  const e = base.clone();
  e.regs.ix = (PATTERN_TABLE + cursor) & 0xffff;
  e.regs.hl = dst;
  e.regs.de = step;
  e.regs.b = count;
  if (phase !== null) e.mem.write8(PHASE, phase);
  if (tile !== null) e.mem.write8(FLIP_TILE, tile);
  return e;
}

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
function runPair(entry, candidate) {
  const a = runIsolated(entry, oracle);
  const b = runIsolated(entry, candidate);
  return { ram: ramDiff(a, b, entry.regs.sp) };
}

// -- 1. EQUAL: every naturally-occurring captured state -----------------------

test("EQUAL (captured): idiomatic == oracle on a real six-cell blit over every sibling state", () => {
  assert.ok(STATES.length > 0, "captured at least one real attract state at the sibling loc_2f71");
  for (let i = 0; i < STATES.length; i++) {
    const entry = buildEntry(STATES[i], { cursor: (i * 6) & 0xff });
    const r = runPair(entry, idiomatic);
    assert.equal(r.ram, null, r.ram && `state ${i}: RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
  }
  console.log(`  EQUAL/captured: ${STATES.length} real states identical (work RAM, full tail)`);
});

// -- 2. EQUAL: exhaustive over source offset x run length x phase --------------

test("EQUAL (exhaustive): idiomatic == oracle over source offsets x run lengths x phase", () => {
  const base = STATES[0];
  assert.ok(base, "have a base state to poke");
  const cursors = [0, 6, 12, 0x2a, 0x48, 0xf0];
  const counts = [1, 2, 3, 6, 8];
  const phases = [1, 2, 3, 4, 5, 8]; // reload, off-beat, on-beat: all three arms
  for (const cursor of cursors) for (const count of counts) for (const phase of phases) {
    const entry = buildEntry(base, { cursor, count, phase });
    const r = runPair(entry, idiomatic);
    assert.equal(r.ram, null, r.ram && `cursor=${hx(cursor)} count=${count} phase=${phase}: RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
  }
  console.log(`  EQUAL/exhaustive: ${cursors.length}x${counts.length}x${phases.length} inputs identical to the oracle (work RAM, full tail)`);
});

// -- 3. EQUAL: a zero-length run exercises the 256-cell wrap -------------------
// The count is only tested after the first cell, so a zero start writes a full 256 cells. A zero step
// keeps every write in one mapped cell, so the final byte pins the iteration count to the oracle's.

test("EQUAL (wrap): a zero run length runs a full 256-cell loop, identical to the oracle", () => {
  const base = STATES[0];
  assert.ok(base, "have a base state to poke");
  const entry = buildEntry(base, { count: 0, step: 0, phase: 2 });
  const r = runPair(entry, idiomatic);
  assert.equal(r.ram, null, r.ram && `wrap: RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
  console.log("  EQUAL/wrap: zero-length run = full 256-iteration loop, identical to the oracle");
});

// -- 4. TEETH: broken twins the gate MUST catch -------------------------------

// Corrupts the tile code it copies into each cell; the phase-clock tail is run identically.
function brokenData(m) {
  const { regs, mem } = m;
  let src = regs.ix, dst = regs.hl;
  const rowStep = regs.de;
  let remaining = regs.b;
  do {
    mem.write8(dst, mem.read8(src) ^ 0xff); // BUG
    dst = (dst + rowStep) & 0xffff;
    src = (src + 1) & 0xffff;
    remaining = (remaining - 1 + 256) % 256;
  } while (remaining !== 0);
  return advanceChamberCreatureAnimation(m);
}
// Steps the destination by the wrong stride, so every cell past the first lands one address off.
function brokenStep(m) {
  const { regs, mem } = m;
  let src = regs.ix, dst = regs.hl;
  const rowStep = regs.de;
  let remaining = regs.b;
  do {
    mem.write8(dst, mem.read8(src));
    dst = (dst + rowStep - 1) & 0xffff; // BUG
    src = (src + 1) & 0xffff;
    remaining = (remaining - 1 + 256) % 256;
  } while (remaining !== 0);
  return advanceChamberCreatureAnimation(m);
}

test("TEETH: a corrupted tile code is CAUGHT in the tile-map column", () => {
  const entry = buildEntry(STATES[0], { phase: 2 }); // off-beat: isolate the blit from a reload write
  const r = runPair(entry, brokenData);
  assert.notEqual(r.ram, null, "the gate FAILED to catch a corrupted tile code — it is worthless");
  const cells = [0, 1, 2, 3, 4, 5].map((i) => (COLUMN_BOTTOM + i * ROW_STEP) & 0xffff);
  assert.ok(cells.includes(r.ram.addr), `teeth caught ${hx(r.ram.addr)} (expected a written column cell ${cells.map(hx).join(",")})`);
  console.log(`  TEETH: corrupted tile code caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("TEETH: a wrong row step is CAUGHT in the tile-map column", () => {
  const entry = buildEntry(STATES[0], { phase: 2 });
  const r = runPair(entry, brokenStep);
  assert.notEqual(r.ram, null, "the gate FAILED to catch a wrong row step — it is worthless");
  assert.ok(r.ram.addr >= 0x9000 && r.ram.addr <= 0x93ff, `teeth caught ${hx(r.ram.addr)} (expected a tile-map cell 0x9000-0x93ff)`);
  console.log(`  TEETH: wrong row step caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});
