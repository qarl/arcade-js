// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for selectPlayerScreenOrAttract (ROM 0x141E) — the sub-state-0x14
 * handler that redraws the credit line, holds on the sub-state timer, then (on expiry)
 * blanks the screen, clears the two-byte player index, and scans the five 0x611C
 * player-context records to compose player 1's screen (record==1 -> 0x1459, A=1),
 * player 2's (record==3 -> 0x144f), or return to attract (neither -> 0x1475).
 *
 * loc_141e WRITES memory (the credit VRAM, the tilemap + sprite buffer, SUBSTATE_TIMER,
 * the player index 0x600D/0x600E, and — via the tail dispatches — GAME_SUBSTATE, the
 * flip latch, the task ring, GAME_STATE, ATTRACT) and has a data-dependent branch, so it
 * is validated by capture/clone/replay on a FRESH clone per case — never one shared
 * machine, never the full register file, never cycles. The compared contract is:
 *
 *   RAM (minus the stack scratch below the entry SP)  +  io.flipScreen (the 0x7D82 board latch)
 *
 * The flip latch is a board io output, NOT in the RAM dump; comparing io.flipScreen is
 * load-bearing because the tail arms drive it (attract sets 1; compose sets A|DIP). No
 * live-out registers/flags (the rst-0x28 NMI dispatch and every tail dispatch consume
 * none); SP/pc are not compared — the idiomatic layer drops the oracle's push/ret model.
 *
 * REACHABILITY. loc_141e is reached at game over (GAME_STATE 3, GAME_SUBSTATE 0x14). In a
 * 1-player coin+start game it dispatches exactly once, already at expiry (SUBSTATE_TIMER=1)
 * with all records zero — so the single natural dispatch takes the neither -> attract arm.
 * The other arms are forced from that real entry by identical-both-sides nudges (the doc-06
 * crafted-entry technique): raise SUBSTATE_TIMER for the timer-hold early-return, and force
 * expiry (SUBSTATE_TIMER=1) + poke one 0x611C record to 1 / 3 for the two compose arms.
 *
 *   1. REALISM (real dispatch) — capture every real loc_141e entry during the driven game
 *      and replay oracle vs candidate on fresh clones; RAM (ex-stack) + flip must be
 *      identical on each. Non-vacuous: assert the natural dispatch drove the oracle down the
 *      expiry -> attract arm (GAME_STATE 1 / ATTRACT 1).
 *
 *   2. CRAFTED (all four arms) — from the real entry, identical-both-sides nudges force each
 *      arm; oracle vs candidate must match and the oracle's own arm is asserted so no case
 *      passes vacuously: early-return (SUBSTATE_TIMER 5 -> stays GAME_STATE 3 / sub 0x14,
 *      timer decremented, nothing cleared); record==1 (composes -> sub 0x14->0x15, GAME_STATE
 *      stays 3); record==3 (also sets CURRENT_PLAYER=1); neither (attract -> GAME_STATE 1).
 *
 *   3. TEETH — three deliberately-broken twins the diff MUST catch: (a) skipping the
 *      player-index clear (RAM diff at 0x600D/0x600E, exposed by pre-dirtying them);
 *      (b) inverting the timer gate (runs the whole clear+scan on a NON-expiry frame the
 *      oracle early-returns from — a large RAM diff); (c) scanning for the wrong record
 *      value (2 not 1), so a crafted record==1 entry falls through to attract instead of
 *      composing (RAM diff at GAME_STATE / GAME_SUBSTATE).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-141e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_141e as oracle } from "../../translated/loc_141e.js";
import { selectPlayerScreenOrAttract as candidate } from "../selectPlayerScreenOrAttract.js";
import { Machine } from "../../machine.js";
import { CURRENT_PLAYER, SUBSTATE_TIMER, GAME_STATE, GAME_SUBSTATE, ATTRACT, STACK_SCRATCH } from "../names.js";

// the idiomatic callees the twins reuse (so a twin differs from the candidate by exactly
// its one injected bug, nothing else)
import { drawCreditDisplay } from "../drawCreditDisplay.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { clearPlayfieldAndSprites } from "../clearPlayfieldAndSprites.js";
import { configureFlipScreenAndComposeScreen } from "../configureFlipScreenAndComposeScreen.js";
import { selectPlayer2AndComposeScreen } from "../selectPlayer2AndComposeScreen.js";
import { enterAttractMode } from "../enterAttractMode.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x141e;
const PLAYER_INDEX_COMPANION = 0x600e; // CURRENT_PLAYER's companion (loc_141e's player index pair)
const PLAYER_RECORDS = 0x611c; // first of the five stride-0x22 scanned records
const RECORD_STRIDE = 0x22;
const RECORD_COUNT = 5;
const FLIPSCREEN = 0x7d82;
const FRAMES = 9000; // loc_141e first dispatches (game over) by ~8000

// Canonical coin+start tape: pulse the IN2 coin bit then the start1 bit so the ROM's own
// credit/start logic runs a 1-player game; with no further input Mario tops out and the
// game-over path reaches GAME_STATE 3 / GAME_SUBSTATE 0x14 -> loc_141e.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin   (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1 (IN2 bit2)
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** True if any of the five records holds `value` (mirrors the candidate's scan). */
function anyRecordEquals(mem, value) {
  let addr = PLAYER_RECORDS;
  for (let i = 0; i < RECORD_COUNT; i++, addr = (addr + RECORD_STRIDE) & 0xffff) {
    if (mem.read8(addr) === value) return true;
  }
  return false;
}

// -- comparison plumbing ------------------------------------------------------

/**
 * First observable difference between two machines after each ran its routine: a RAM byte
 * (skipping the stack scratch below the entry SP) OR the flip-screen board latch (io.flipScreen — the
 * 0x7D82 output, not in the RAM dump). RAM first, then the latch. Null if identical.
 */
function firstDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { kind: "ram", addr, a: da[i], b: db[i] };
  }
  if (a.io.flipScreen !== b.io.flipScreen) {
    return { kind: "flip", addr: FLIPSCREEN, a: a.io.flipScreen, b: b.io.flipScreen };
  }
  return null;
}

const fmt = (d) =>
  d && (d.kind === "flip"
    ? `flip-screen(${hx(d.addr)}) oracle=${d.a} cand=${d.b}`
    : `RAM ${hx(d.addr)} oracle=${d.a} cand=${d.b}`);

/** Run the oracle and `cand` on two FRESH clones of `entry` and diff (ex-stack + flip). */
function diffAgainstOracle(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  cand(b);
  return firstDiffOutsideStack(a, b, entry.regs.sp);
}

// -- entry capture (real loc_141e dispatches, the driven game-over hold) --------

/**
 * Drive a coin+start game to game over and clone the machine at EVERY real loc_141e
 * dispatch (the hold is a finite burst of frames). The wrapper runs the ORACLE so the
 * host game proceeds undisturbed.
 */
function captureEntries(maxCaps, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < maxCaps) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  return caps;
}

const ENTRIES = ROM_PRESENT ? captureEntries(600, FRAMES) : [];
// A real entry to craft from: prefer one that is NOT already at expiry so we can force it.
const BASE = ENTRIES.length ? ENTRIES[0] : null;

/** Clone a real entry, force the timer to expire this call, and poke record 0 to `recVal`. */
function craftScan(recVal) {
  const w = BASE.clone();
  w.mem.write8(SUBSTATE_TIMER, 0x01); // dec -> 0 : expiry, so the scan runs
  w.mem.write8(PLAYER_RECORDS, recVal & 0xff);
  return w;
}

// -- 1. REALISM (real dispatches) ---------------------------------------------

test("REALISM: every real loc_141e dispatch — RAM (ex-stack) + flip match the oracle", () => {
  assert.ok(ENTRIES.length >= 1, "loc_141e never dispatched in the driven game — reachability broke");

  let sawAttractArm = false; // oracle drives GAME_STATE 1 / ATTRACT 1 (neither-found)

  for (const entry of ENTRIES) {
    assert.equal(entry.mem.read8(GAME_STATE), 3, "captured with GAME_STATE==3 (in game)");
    assert.equal(entry.mem.read8(GAME_SUBSTATE), 0x14, "captured at GAME_SUBSTATE==0x14");

    const d = diffAgainstOracle(entry, candidate);
    assert.equal(d, null, d && `divergence on a real dispatch: ${fmt(d)}`);

    const o = entry.clone();
    oracle(o);
    if (o.mem.read8(GAME_STATE) === 1 && o.mem.read8(ATTRACT) === 1) sawAttractArm = true;
  }

  assert.ok(sawAttractArm, "the natural dispatch did not take the expiry -> attract arm");
  console.log(
    `  REALISM: ${ENTRIES.length} real loc_141e dispatch(es) — RAM (ex-stack) + flip identical; ` +
      "natural game-over dispatch takes the attract arm",
  );
});

// -- 2. CRAFTED (record arms) -------------------------------------------------

test("CRAFTED: the early-return / record==1 / record==3 / neither arms match the oracle", () => {
  assert.ok(BASE, "need a captured entry to craft the arms from");

  // early-return -> timer still counting (5): draw credit + tick, then stop. Nothing
  // cleared, GAME_STATE/GAME_SUBSTATE unchanged, SUBSTATE_TIMER decremented by 1.
  {
    const w = BASE.clone();
    w.mem.write8(SUBSTATE_TIMER, 0x05);
    const d = diffAgainstOracle(w, candidate);
    assert.equal(d, null, d && `early-return: ${fmt(d)}`);
    const o = w.clone();
    oracle(o);
    assert.equal(o.mem.read8(GAME_STATE), 3, "early-return: oracle stays in game");
    assert.equal(o.mem.read8(GAME_SUBSTATE), 0x14, "early-return: oracle does NOT advance the sub-state");
    assert.equal(o.mem.read8(SUBSTATE_TIMER), 0x04, "early-return: oracle decremented SUBSTATE_TIMER (5->4)");
    console.log("  CRAFTED/early-return: timer-hold, nothing cleared — RAM (ex-stack) + flip identical");
  }

  // record==1 -> compose player 1's screen (A=1): advances GAME_SUBSTATE, stays in game.
  {
    const w = craftScan(0x01);
    const d = diffAgainstOracle(w, candidate);
    assert.equal(d, null, d && `record==1: ${fmt(d)}`);
    const o = w.clone();
    oracle(o);
    assert.equal(o.mem.read8(GAME_STATE), 3, "record==1: oracle stays in game (not attract)");
    assert.equal(o.mem.read8(GAME_SUBSTATE), 0x15, "record==1: oracle advances GAME_SUBSTATE 0x14->0x15");
    assert.equal(o.mem.read8(CURRENT_PLAYER), 0x00, "record==1: player 1 stays up (CURRENT_PLAYER 0)");
    console.log("  CRAFTED/record==1: composes player 1's screen — RAM (ex-stack) + flip identical");
  }

  // record==3 -> select player 2 then compose (A=0): sets CURRENT_PLAYER=1, advances sub.
  {
    const w = craftScan(0x03);
    const d = diffAgainstOracle(w, candidate);
    assert.equal(d, null, d && `record==3: ${fmt(d)}`);
    const o = w.clone();
    oracle(o);
    assert.equal(o.mem.read8(GAME_STATE), 3, "record==3: oracle stays in game (not attract)");
    assert.equal(o.mem.read8(GAME_SUBSTATE), 0x15, "record==3: oracle advances GAME_SUBSTATE 0x14->0x15");
    assert.equal(o.mem.read8(CURRENT_PLAYER), 0x01, "record==3: oracle selects player 2 (CURRENT_PLAYER 1)");
    console.log("  CRAFTED/record==3: selects player 2 + composes — RAM (ex-stack) + flip identical");
  }

  // neither (record 0 -> a value the scan ignores) -> attract.
  {
    const w = craftScan(0x00);
    const d = diffAgainstOracle(w, candidate);
    assert.equal(d, null, d && `neither: ${fmt(d)}`);
    const o = w.clone();
    oracle(o);
    assert.equal(o.mem.read8(GAME_STATE), 1, "neither: oracle returns to attract (GAME_STATE 1)");
    assert.equal(o.mem.read8(ATTRACT), 1, "neither: oracle sets ATTRACT 1");
    console.log("  CRAFTED/neither: returns to attract — RAM (ex-stack) + flip identical");
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): skips clearing the two-byte player index (0x600E/0x600D). */
function brokenSkipClearIndex(m) {
  const { regs, mem } = m;
  drawCreditDisplay(m);
  if (!tickSubstateTimer(m)) return;
  clearPlayfieldAndSprites(m);
  // BUG: dropped the two `ld (0x600E/0x600D),a` clears.
  if (anyRecordEquals(mem, 0x01)) { regs.a = 0x01; configureFlipScreenAndComposeScreen(m); return; }
  if (anyRecordEquals(mem, 0x03)) { selectPlayer2AndComposeScreen(m); return; }
  enterAttractMode(m);
}

/** Twin (b): inverts the timer gate — runs the body while counting, skips it on expiry. */
function brokenInvertedGate(m) {
  const { regs, mem } = m;
  drawCreditDisplay(m);
  if (tickSubstateTimer(m)) return; // BUG: polarity flipped
  clearPlayfieldAndSprites(m);
  mem.write8(PLAYER_INDEX_COMPANION, 0x00);
  mem.write8(CURRENT_PLAYER, 0x00);
  if (anyRecordEquals(mem, 0x01)) { regs.a = 0x01; configureFlipScreenAndComposeScreen(m); return; }
  if (anyRecordEquals(mem, 0x03)) { selectPlayer2AndComposeScreen(m); return; }
  enterAttractMode(m);
}

/** Twin (c): scans the first pass for value 2 instead of 1 — a wrong record key. */
function brokenWrongScan(m) {
  const { regs, mem } = m;
  drawCreditDisplay(m);
  if (!tickSubstateTimer(m)) return;
  clearPlayfieldAndSprites(m);
  mem.write8(PLAYER_INDEX_COMPANION, 0x00);
  mem.write8(CURRENT_PLAYER, 0x00);
  if (anyRecordEquals(mem, 0x02)) { regs.a = 0x01; configureFlipScreenAndComposeScreen(m); return; } // BUG: 0x02 not 0x01
  if (anyRecordEquals(mem, 0x03)) { selectPlayer2AndComposeScreen(m); return; }
  enterAttractMode(m);
}

test("TEETH: skip-clear-index, inverted-gate, and wrong-scan twins are all CAUGHT", () => {
  assert.ok(BASE, "need a captured entry for the teeth");

  // (a) skip-clear-index — on an expiry/attract entry, pre-dirty the index bytes; the
  //     oracle clears them to 0, the twin leaves the sentinels.
  const eIdx = craftScan(0x00); // neither -> attract arm, but the index clear runs first
  eIdx.mem.write8(CURRENT_PLAYER, 0x55);
  eIdx.mem.write8(PLAYER_INDEX_COMPANION, 0xaa);
  const dIdx = diffAgainstOracle(eIdx, brokenSkipClearIndex);
  assert.notEqual(dIdx, null, "the gate FAILED to catch a skipped player-index clear — it is worthless");
  assert.equal(dIdx.kind, "ram", "skip-clear-index must be caught as a RAM diff");
  assert.ok(
    dIdx.addr === CURRENT_PLAYER || dIdx.addr === PLAYER_INDEX_COMPANION,
    `skip-clear-index must diverge at the player index (${hx(CURRENT_PLAYER)}/${hx(PLAYER_INDEX_COMPANION)}), got ${hx(dIdx.addr)}`,
  );

  // (b) inverted-gate — craft a NON-expiry entry (timer 5): the oracle early-returns
  //     after only drawing credit + ticking; the twin runs the whole clear+scan+attract.
  const eGate = BASE.clone();
  eGate.mem.write8(SUBSTATE_TIMER, 0x05);
  const dGate = diffAgainstOracle(eGate, brokenInvertedGate);
  assert.notEqual(dGate, null, "the gate FAILED to catch an inverted timer gate — it is worthless");
  assert.equal(dGate.kind, "ram", "inverted-gate must be caught as a RAM diff");

  // (c) wrong-scan — a crafted record==1 entry: the oracle composes (stays GAME_STATE 3,
  //     advances GAME_SUBSTATE); the twin misses value 1, misses 3, and falls to attract.
  const eScan = craftScan(0x01);
  const dScan = diffAgainstOracle(eScan, brokenWrongScan);
  assert.notEqual(dScan, null, "the gate FAILED to catch a wrong scan value — it is worthless");
  assert.equal(dScan.kind, "ram", "wrong-scan must be caught as a RAM diff");

  console.log(
    `  TEETH: skip-clear-index at ${hx(dIdx.addr)} (${dIdx.a}->${dIdx.b}); ` +
      `inverted-gate at ${hx(dGate.addr)}; wrong-scan at ${hx(dScan.addr)}`,
  );
});
