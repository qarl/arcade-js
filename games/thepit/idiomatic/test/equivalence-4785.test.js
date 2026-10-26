// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for drawBestScoresTodayLabel (ROM 0x4785) — stamps a fixed edge column:
 * a 32-byte ROM picture strip up one video column, then hands off to the shared
 * colour-column fill (loc_3e1d, still the frozen oracle) to paint 28 cells of
 * colour 1 down the colour column at offset 30.
 *
 * drawBestScoresTodayLabel loads its own source, destination, and count — no live-in register, no
 * work RAM read — so its writes depend on nothing but the fixed ROM strip and the
 * offset/colour it hands the fill. Its declared LIVE-OUT is memory-only (the tile
 * cells + the colour cells the fill writes); the register file it leaves behind is
 * dead ABI.
 *
 * WHY MEMORY-EQUIVALENCE (not pc/SP). The idiomatic routine was dissolved: instead of
 * the oracle's tail-jump through the colour fill (loc_3e1d), it calls the pure-leaf
 * fillColourColumnAt directly. That drops the fill's net `ret`, so the idiomatic routine
 * leaves pc at its entry and SP one word above the oracle's (the oracle's tail ret pops
 * the caller return; the leaf does not). Those are the dissolved routine's dead ABI, not
 * its live-out — so the contract compares the painted RAM ONLY, EXCLUDING the dead
 * [SP-8, SP) stack-scratch window (any dropped return-address ghost lives there), and
 * never pc, SP, or the register file. Modelled on equivalence-47e1 / equivalence-18cf.
 *
 *   1. EQUAL (real dispatch) — capture the true 0x4785 entry in an attract run;
 *      oracle vs idiomatic leave identical painted RAM outside the stack scratch.
 *   2. SENTINEL (crafted) — over a marker-filled colour+video background the oracle
 *      writes its full set of cells (non-vacuous) and the idiomatic routine matches.
 *   3. TEETH — two deliberately-broken twins, each CAUGHT on the sentinel background.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4785.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4785 as oracle } from "../../translated/loc_4785.js";
import { drawBestScoresTodayLabel as idiomatic } from "../drawBestScoresTodayLabel.js";
import { makeMachineFactory } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x4785;
const CAP_FRAMES = 300; // a single attract run reaches the 0x4785 board-setup dispatch (~frame 81)
const COLOUR_CELL = 0x8057; // the fill caches its colour byte here (one work-RAM cell it writes)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

const STACK_SCRATCH = 8; // dead return-address / helper-scratch window just below the entry SP

/**
 * First RAM byte that differs between two machines, EXCLUDING the dead [entrySP-8, entrySP)
 * stack-scratch window (the dropped tail return-address ghost lives there and legitimately
 * differs). Null when otherwise equal.
 */
function firstRamDiff(a, b, entrySP) {
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run a routine on a fresh clone. Both the oracle and the idiomatic routine tail-jump
 * into the colour fill, whose return performs the single net return, so the clone's
 * pc + SP already line up — no extra return is modelled here (that would double-pop).
 */
function runOn(entry, fn) {
  const c = entry.clone();
  fn(c);
  return c;
}

/** Compare candidate vs oracle over painted RAM only, excluding the dead stack scratch.
 *  pc, SP, and the register file are the dissolved routine's dead ABI, not compared. */
function contractDiffs(entry, fn) {
  const entrySP = entry.regs.sp;
  const o = runOn(entry, oracle);
  const c = runOn(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entrySP);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  return diffs;
}

/** Capture the machine at the true 0x4785 dispatch during an attract run (single runFrames — no NMI-timing skew). */
function captureRealDispatch(maxFrames) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (!entry) entry = mm.clone();
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return entry;
}

/** Sentinel-fill the colour (0x8800-0x8BFF) + video (0x9000-0x93FF) RAM plus the fill's colour cell
 *  so every write this routine makes is a real change over the background. */
function sentinelFill(m, val) {
  for (let a = 0x8800; a <= 0x8bff; a++) m.mem.write8(a, val);
  for (let a = 0x9000; a <= 0x93ff; a++) m.mem.write8(a, val);
  m.mem.write8(COLOUR_CELL, val);
}

/** Count how many state-dump cells the ORACLE changes from `entry`. */
function oracleWriteCount(entry) {
  const before = entry.dumpState();
  const after = runOn(entry, oracle).dumpState();
  let n = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) n += 1;
  return n;
}

/** BUG: copies the tile strip one row too high (starts at 0x93de) — the whole picture shifts. */
function teethShiftedStrip(m) {
  const { mem, regs } = m;
  let src = 0x4acb, cell = 0x93de; // BUG: should start at 0x93fe
  for (let i = 0; i < 32; i++) { mem.write8(cell, mem.read8(src)); src += 1; cell -= 32; }
  regs.a = 30;
  regs.c = 1;
  return m.call(0x3e1d);
}

/** BUG: hands the colour fill colour 2 instead of 1 — the 28 colour cells + the cache cell diverge. */
function teethWrongColour(m) {
  const { mem, regs } = m;
  let src = 0x4acb, cell = 0x93fe;
  for (let i = 0; i < 32; i++) { mem.write8(cell, mem.read8(src)); src += 1; cell -= 32; }
  regs.a = 30;
  regs.c = 2; // BUG: colour should be 1
  return m.call(0x3e1d);
}

test("EQUAL: idiomatic drawBestScoresTodayLabel == oracle at the real attract dispatch", () => {
  const real = captureRealDispatch(CAP_FRAMES);
  assert.ok(real, "expected a real 0x4785 dispatch during attract");
  const diffs = contractDiffs(real, idiomatic);
  assert.equal(diffs.length, 0, "real-dispatch entry: " + diffs.join("; "));
  console.log("  EQUAL: real 0x4785 dispatch — identical painted RAM outside the stack scratch");
});

test("SENTINEL (crafted): over a marker background the oracle writes its cells and idiomatic matches", () => {
  const real = captureRealDispatch(CAP_FRAMES);
  assert.ok(real, "need the real dispatch to derive the crafted entry from");

  const w = real.clone();
  sentinelFill(w, 0x5a);

  // Non-vacuous: 32 tile cells + 28 colour cells + the one colour-cache cell = 61 writes,
  // minus any written value that happens to equal the marker. A robust lower bound proves
  // the routine really writes over this background rather than passing vacuously.
  const wrote = oracleWriteCount(w);
  assert.ok(wrote >= 58, `oracle wrote only ${wrote} cells over the sentinel background — suspiciously few`);

  const diffs = contractDiffs(w, idiomatic);
  assert.equal(diffs.length, 0, `sentinel background: ${diffs.join("; ")}`);
  console.log(`  SENTINEL: ${wrote} writes over a marker background — idiomatic identical to the oracle`);
});

test("TEETH: the shifted-strip twin and the wrong-colour twin are CAUGHT", () => {
  const real = captureRealDispatch(CAP_FRAMES);
  assert.ok(real, "need the real dispatch to derive the crafted entry from");

  const w1 = real.clone(); sentinelFill(w1, 0x5a);
  const dShift = contractDiffs(w1, teethShiftedStrip);
  assert.notEqual(dShift.length, 0, "the gate FAILED to catch the shifted-strip twin — it is worthless");

  const w2 = real.clone(); sentinelFill(w2, 0x5a);
  const dColour = contractDiffs(w2, teethWrongColour);
  assert.notEqual(dColour.length, 0, "the gate FAILED to catch the wrong-colour twin — it is worthless");

  console.log(`  TEETH: shifted-strip caught (${dShift[0]}); wrong-colour caught (${dColour[0]})`);
});
