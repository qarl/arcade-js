// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for revealTerrainColumn (ROM 0x2f88, The Pit) — reveal the next column of
 * the Pit sliding-floor backdrop on its per-column frame gate, then fall through into the animation
 * phase clock advanceChamberCreatureAnimation.
 *
 * WRINKLES, both handled with a crafted entry:
 *
 *   1. revealTerrainColumn is never dispatched at its own address in attract (the monolith loc_2f71
 *      inlines the body), so a real attract state is captured at the monolith and the target is run on
 *      clones — a real state with surgical nudges (the gate/cursor/phase) to steer each arm.
 *
 *   2. DISSOLVED-FORM CONTRACT. The phase clock and its continuations are now decompiled, so the
 *      oracle's `m.call`s and the idiomatic direct calls run the SAME real tail. The gate runs the
 *      full chain on both sides and compares work RAM (dumpState) rather than stubbing the
 *      continuations. The object pass a tail reaches can hit the two never-returning transition leaves
 *      (0x031a, 0x01f9), stubbed identically on both clones; the once-per-frame tick is modelled and
 *      the stack scratch below the entry SP excluded.
 *
 * EQUAL is proven over every naturally-occurring captured state AND an exhaustive sweep of the reveal
 * gate (all 256 entry values) crossed with representative cursor and phase values, reaching all three
 * arms (nothing-to-reveal, table-exhausted, stamp-a-column) plus every downstream phase route. The
 * teeth twins (wrong gate reload, corrupted stamped tile, dropped hand-off) are caught.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2f88.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2f88 as oracle } from "../../translated/loc_2f88.js";
import { revealTerrainColumn as idiomatic } from "../revealTerrainColumn.js";
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
const GATE = 0x80e5; // the per-column reveal gate revealTerrainColumn ticks/reloads
const PERIOD = 0x80e4; // the gate's reload period
const CURSOR = 0x80e6; // the pattern-table cursor revealTerrainColumn steps back
const POINTER = 0x80e1; // the stashed pattern pointer (16-bit)
const PHASE = 0x80e3; // the phase counter the hand-off ticks
const COLUMN_BOTTOM = 0x938c; // bottom video-RAM cell of the stamped column
const PATTERN_TABLE = 0x3048;
const EXPIRY_LEAVES = [0x031a, 0x01f9];
const WATCHDOG = 0xb800, COUNTDOWN = 0x8009;
const CHAIN_SCRATCH_LO = 0x83e0, CHAIN_SCRATCH_HI = 0x8400;
const CAPTURE_FRAMES = 900, CAPTURE_LIMIT = 96;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

function captureMonolithStates() {
  const states = [];
  const overrides = new Map([[SIB, (mm) => {
    if (states.length < CAPTURE_LIMIT) states.push(mm.clone());
    return loc_2f71(mm);
  }]]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return states;
}
const STATES = ROM_PRESENT ? captureMonolithStates() : [];

/** Which of revealTerrainColumn's three arms an entry state drives, from its gate + cursor. */
function armOf(entry) {
  const gate = (entry.mem.read8(GATE) - 1 + 256) % 256;
  if (gate !== 0) return "nothing-to-reveal";
  return entry.mem.read8(CURSOR) < 6 ? "table-exhausted" : "stamp-a-column";
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
  return { ram: ramDiff(a, b, entry.regs.sp), arm: armOf(entry) };
}

// -- 1. EQUAL: every naturally-occurring captured state -----------------------

test("EQUAL (captured): idiomatic == oracle on every real monolith state", () => {
  assert.ok(STATES.length > 0, "captured at least one real attract state at the monolith loc_2f71");
  const arms = new Set();
  for (const entry of STATES) {
    const r = runPair(entry, idiomatic);
    assert.equal(r.ram, null, r.ram && `arm=${r.arm}: RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
    arms.add(r.arm);
  }
  console.log(`  EQUAL/captured: ${STATES.length} real monolith states identical (work RAM, full tail); arms hit: ${[...arms].sort().join(", ")}`);
});

// -- 2. EQUAL: exhaustive over the gate x cursor x phase ----------------------

test("EQUAL (exhaustive): idiomatic == oracle over all 256 gate values x cursor x phase", () => {
  const base = STATES[0];
  assert.ok(base, "have a base state to poke");
  const cursors = [0, 5, 6, 7, 12, 66, 255];
  const phases = [1, 3, 5]; // reload frame, off-beat frame, on-beat frame downstream
  const arms = new Set();
  for (let g = 0; g < 256; g++) for (const c of cursors) for (const p of phases) {
    const entry = base.clone();
    entry.mem.write8(GATE, g);
    entry.mem.write8(CURSOR, c);
    entry.mem.write8(PHASE, p);
    const r = runPair(entry, idiomatic);
    assert.equal(r.ram, null, r.ram && `g=${hx(g)} c=${hx(c)} p=${hx(p)}: RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
    arms.add(r.arm);
  }
  assert.ok(
    arms.has("nothing-to-reveal") && arms.has("table-exhausted") && arms.has("stamp-a-column"),
    `all three arms must be exercised, got: ${[...arms].join(", ")}`,
  );
  console.log(`  EQUAL/exhaustive: 256 x ${cursors.length} x ${phases.length} inputs identical to the oracle; arms: ${[...arms].sort().join(", ")}`);
});

// -- 3. TEETH: broken twins the gate MUST catch -------------------------------
// Each twin runs the SAME real hand-off (advanceChamberCreatureAnimation) as the routine, so its bug
// is the only difference — except brokenHandoff, whose bug IS the dropped hand-off.

function brokenReload(m) {
  const { mem } = m;
  const gate = (mem.read8(GATE) - 1 + 256) % 256;
  mem.write8(GATE, gate);
  if (gate !== 0) return advanceChamberCreatureAnimation(m);
  mem.write8(GATE, (mem.read8(PERIOD) + 1) & 0xff); // BUG: off-by-one gate reload
  const cursor = mem.read8(CURSOR) - 6;
  if (cursor < 0) return advanceChamberCreatureAnimation(m);
  mem.write8(CURSOR, cursor);
  const source = PATTERN_TABLE + cursor;
  mem.write16(POINTER, source);
  let cell = COLUMN_BOTTOM;
  for (let i = 0; i < 6; i++) { mem.write8(cell, mem.read8(source + i)); cell -= 32; }
  return advanceChamberCreatureAnimation(m);
}
function brokenStamp(m) {
  const { mem } = m;
  const gate = (mem.read8(GATE) - 1 + 256) % 256;
  mem.write8(GATE, gate);
  if (gate !== 0) return advanceChamberCreatureAnimation(m);
  mem.write8(GATE, mem.read8(PERIOD));
  const cursor = mem.read8(CURSOR) - 6;
  if (cursor < 0) return advanceChamberCreatureAnimation(m);
  mem.write8(CURSOR, cursor);
  const source = PATTERN_TABLE + cursor;
  mem.write16(POINTER, source);
  let cell = COLUMN_BOTTOM;
  for (let i = 0; i < 6; i++) { mem.write8(cell, (mem.read8(source + i) ^ 0xff) & 0xff); cell -= 32; } // BUG
  return advanceChamberCreatureAnimation(m);
}
function brokenHandoff(m) {
  const { mem } = m;
  const gate = (mem.read8(GATE) - 1 + 256) % 256;
  mem.write8(GATE, gate);
  if (gate !== 0) return undefined; // BUG: never delegates to the phase clock
  mem.write8(GATE, mem.read8(PERIOD));
  const cursor = mem.read8(CURSOR) - 6;
  if (cursor < 0) return undefined; // BUG
  mem.write8(CURSOR, cursor);
  const source = PATTERN_TABLE + cursor;
  mem.write16(POINTER, source);
  let cell = COLUMN_BOTTOM;
  for (let i = 0; i < 6; i++) { mem.write8(cell, mem.read8(source + i)); cell -= 32; }
  return undefined; // BUG
}

test("TEETH: a wrong gate reload is CAUGHT at the reveal gate", () => {
  const entry = STATES[0].clone();
  entry.mem.write8(GATE, 1); // -> gate hits 0, the reveal frame
  entry.mem.write8(CURSOR, 66); // >= 6 so it reaches the reload
  const r = runPair(entry, brokenReload);
  assert.notEqual(r.ram, null, "the gate FAILED to catch a wrong gate reload — it is worthless");
  assert.equal(r.ram.addr, GATE, `teeth caught ${hx(r.ram.addr)} (expected the reveal gate ${hx(GATE)})`);
  console.log(`  TEETH: wrong gate reload caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("TEETH: a corrupted stamped tile is CAUGHT in the video-RAM column", () => {
  const entry = STATES[0].clone();
  entry.mem.write8(GATE, 1);
  entry.mem.write8(CURSOR, 66);
  const r = runPair(entry, brokenStamp);
  assert.notEqual(r.ram, null, "the gate FAILED to catch a corrupted stamped tile — it is worthless");
  const inColumn = [0x938c, 0x936c, 0x934c, 0x932c, 0x930c, 0x92ec].includes(r.ram.addr);
  assert.ok(inColumn, `teeth caught ${hx(r.ram.addr)} (expected a cell of the stamped column 0x92ec..0x938c)`);
  console.log(`  TEETH: corrupted tile caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("TEETH: a dropped hand-off is CAUGHT", () => {
  const entry = STATES[0].clone();
  entry.mem.write8(GATE, 5); // gate stays non-zero -> nothing-to-reveal, but must still hand off
  const r = runPair(entry, brokenHandoff);
  // The dropped hand-off skips the entire phase clock + object pass, so many cells diverge; assert it
  // is caught (the phase clock's work is missing) without pinning a single first-diff address.
  assert.notEqual(r.ram, null, "the gate FAILED to catch a dropped hand-off — it is worthless");
  console.log(`  TEETH: dropped hand-off caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});
