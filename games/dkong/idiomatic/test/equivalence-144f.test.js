// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for selectPlayer2AndComposeScreen (ROM 0x144F) — the record==3
 * arm of loc_141E that makes player 2 the current player, then delegates to the shared
 * compose tail loc_1459 with the player key A = 0.
 *
 * loc_144F WRITES memory — CURRENT_PLAYER (0x600D) and its companion 0x600E to 1, plus
 * (via the loc_1459 subtree) SUBSTATE_TIMER (0x6009), GAME_SUBSTATE (0x600A), and the task
 * ring + TASK_TAIL — and the flip-screen board latch (0x7D82). It has NO register live-in
 * that reaches its output (loc_141E enters it with A = 3, the search key, which loc_144F
 * overwrites). So it is validated by capture/clone/replay on a FRESH clone per case — never
 * reusing one machine, never the full register file, never cycles. The compared contract is:
 *
 *   RAM (minus the stack scratch below the entry SP)  +  io.flipScreen (the 0x7D82 latch)
 *
 * The flip latch is a board io output, NOT in the RAM dump; comparing io.flipScreen is
 * load-bearing because it is the only place the player-key A value (0 here, forced) surfaces
 * when the cabinet DIP is off. SP/pc are NOT compared — the idiomatic layer drops the
 * oracle's per-post push/ret bookkeeping (its residue lands only in STACK_SCRATCH); the
 * candidate is instead asserted to leave SP/pc untouched, proving it models no stack.
 *
 * REACHABILITY. loc_144F is NOT reached in attract or a 1-player coin+start run: its parent
 * loc_141E (GAME_STATE 3, GAME_SUBSTATE 0x14, reached at game over) scans the five 0x611C
 * object records for an active player slot and, finding none (all zero), takes the
 * record-neither -> loc_1475 arm. The real entry is therefore forced from that REAL loc_141E
 * dispatch by a single-byte upstream nudge — poking one 0x611C record to 3 makes loc_141E's
 * second scan hit and dispatch loc_144F. The captured entry is genuine (the ROM's own
 * loc_141E -> loc_144F dispatch), the only craft being that one upstream record byte — the
 * doc-06 crafted-entry technique, identical to equivalence-1459's ENTRY_A0 setup.
 *
 *   1. REALISM — capture the true loc_144F entry, replay oracle vs candidate on fresh
 *      clones, and prove RAM (ex-stack) + flip identical. Non-vacuous: assert the entry has
 *      the player index cleared (0x600D == 0x600E == 0) and that the oracle SETS both to 1,
 *      clears SUBSTATE_TIMER, advances GAME_SUBSTATE (0x14 -> 0x15), posts twelve tasks
 *      (tail +24), and sets flip = 0 | DIP. Candidate leaves SP/pc unchanged (no stack model).
 *
 *   2. CRAFTED (DIP matrix) — from the captured entry, poke DIP_UPRIGHT to 0 and 1
 *      identically on both sides. Because loc_144F forces the player key A = 0, the flip
 *      outcome is exactly DIP (0 -> latch off, 1 -> latch on) — the one arm the natural
 *      entry's single DIP value cannot exercise both of. Ring-edge behaviour (full/wrap) is
 *      the shared loc_1459 subtree, covered by equivalence-1459.
 *
 *   3. TEETH — four deliberately-broken twins the diff MUST catch: (a) skips the
 *      CURRENT_PLAYER write (RAM diff at 0x600D — the "select player 2" logic); (b) skips
 *      the 0x600E companion write (RAM diff at 0x600E); (c) enters the compose tail with
 *      A = 1 instead of 0 (the record==1 arm's key), caught via io.flipScreen on the DIP=0
 *      arm — the check RAM is blind to; (d) skips the compose delegation entirely (GAME_SUBSTATE
 *      never advances), proving the delegated subtree is present and gated.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-144f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_144f as oracle } from "../../translated/loc_144f.js";
import { loc_141e as oracle141e } from "../../translated/loc_141e.js";
import { selectPlayer2AndComposeScreen as candidate } from "../selectPlayer2AndComposeScreen.js";
import { configureFlipScreenAndComposeScreen } from "../configureFlipScreenAndComposeScreen.js";
import { Machine } from "../../machine.js";
import { CURRENT_PLAYER, DIP_UPRIGHT, SUBSTATE_TIMER, GAME_SUBSTATE, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x144f;
const PARENT = 0x141e; // loc_141e — the sub-state-0x14 handler that dispatches loc_144f
const SCAN_RECORD0 = 0x611c; // first of the five stride-0x22 object records loc_141e scans
const PLAYER_INDEX_COMPANION = 0x600e; // companion of CURRENT_PLAYER (0x600d) in loc_141e's player index
const FLIPSCREEN = 0x7d82;
const TASK_TAIL = 0x60b0;
const FRAMES = 9000; // loc_141e first dispatches (game over) before this; reached by ~8000

// Canonical coin+start tape: pulse the IN2 coin bit then the start1 bit so the ROM's own
// credit/start logic runs a 1-player game; with no further input Mario tops out and the
// game-over path reaches GAME_STATE 3 / GAME_SUBSTATE 0x14 -> loc_141e.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1 (IN2 bit2)
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

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

/**
 * Drive a coin+start game to the real loc_141e dispatch (game over, state 3 / sub 0x14),
 * nudge one 0x611C object record to 3 so loc_141e's second scan hits and dispatches
 * loc_144f, and clone the machine at that genuine loc_144f entry. The wrappers run the
 * ORACLE so the host game proceeds undisturbed to a clean stop.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([
    [PARENT, (mm) => { mm.mem.write8(SCAN_RECORD0, 3); return oracle141e(mm); }],
    [TARGET, (mm) => { if (entry === null) entry = mm.clone(); return oracle(mm); }],
  ]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(FRAMES);
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Clone the captured entry and poke DIP_UPRIGHT to force one flip arm. */
function craftDip(dip) {
  const w = ENTRY.clone();
  w.mem.write8(DIP_UPRIGHT, dip);
  return w;
}

test("REALISM: real loc_144f dispatch — RAM (ex-stack) + flip match the oracle", () => {
  assert.ok(ENTRY, "loc_144f never dispatched via the nudged loc_141e — reachability broke");

  // Document where/how it fired: state 3, sub-state 0x14, player index cleared to 0.
  assert.equal(ENTRY.mem.read8(0x6005), 3, "reached with GAME_STATE==3 (in game)");
  assert.equal(ENTRY.mem.read8(GAME_SUBSTATE), 0x14, "reached at GAME_SUBSTATE==0x14");
  assert.equal(ENTRY.mem.read8(CURRENT_PLAYER), 0, "entry: CURRENT_PLAYER cleared by loc_141e");
  assert.equal(ENTRY.mem.read8(PLAYER_INDEX_COMPANION), 0, "entry: 0x600E cleared by loc_141e");

  const d = diffAgainstOracle(ENTRY, candidate);
  assert.equal(d, null, d && `divergence: ${fmt(d)}`);

  // Non-vacuous: confirm the oracle's own effects on this real entry.
  const o = ENTRY.clone();
  const tail0 = o.mem.read8(TASK_TAIL);
  const dip = o.mem.read8(DIP_UPRIGHT);
  oracle(o);
  assert.equal(o.mem.read8(CURRENT_PLAYER), 1, "oracle selects player 2 (CURRENT_PLAYER = 1)");
  assert.equal(o.mem.read8(PLAYER_INDEX_COMPANION), 1, "oracle sets the 0x600E companion = 1");
  assert.equal(o.mem.read8(SUBSTATE_TIMER), 0, "oracle clears SUBSTATE_TIMER (via loc_1459)");
  assert.equal(
    o.mem.read8(GAME_SUBSTATE),
    (ENTRY.mem.read8(GAME_SUBSTATE) + 1) & 0xff,
    "oracle advances GAME_SUBSTATE (0x14 -> 0x15)",
  );
  assert.equal(o.mem.read8(TASK_TAIL), (tail0 + 24) & 0xff, "oracle posts 12 tasks (tail +24)");
  assert.equal(o.io.flipScreen, (0x00 | dip) & 1, "oracle sets flip = A(0)|DIP");

  // No stack modelling: candidate leaves SP and pc unchanged from entry.
  const c = ENTRY.clone();
  const sp0 = c.regs.sp, pc0 = c.pc;
  candidate(c);
  assert.equal(c.regs.sp, sp0, "candidate must leave SP unchanged (no stack modelling)");
  assert.equal(c.pc, pc0, "candidate must leave pc unchanged (no ret modelling)");

  console.log("  REALISM: real loc_144f entry — RAM (ex-stack) + flip identical; oracle sets index=1, flip=DIP");
});

test("CRAFTED: flip = A(0)|DIP matches the oracle across DIP in {0,1}", () => {
  assert.ok(ENTRY, "need a captured entry to craft the DIP matrix from");

  for (const dip of [0, 1]) {
    const w = craftDip(dip);

    const d = diffAgainstOracle(w, candidate);
    assert.equal(d, null, d && `DIP=${dip}: ${fmt(d)}`);

    // Pin the oracle's flip outcome so no arm passes vacuously: A is forced 0, so flip = DIP.
    const o = w.clone();
    oracle(o);
    assert.equal(o.io.flipScreen, dip & 1, `DIP=${dip}: oracle flip = A(0)|DIP = ${dip & 1}`);
  }
  console.log("  CRAFTED/DIP-matrix: DIP=0 -> flip off, DIP=1 -> flip on; RAM (ex-stack) + flip identical");
});

/** Twin (a): skips the CURRENT_PLAYER (0x600D) write — player 2 is never selected. */
function brokenSkipCurrentPlayer(m) {
  const { regs, mem } = m;
  mem.write8(PLAYER_INDEX_COMPANION, 0x01);
  // BUG: dropped `ld (0x600D),1` — CURRENT_PLAYER stays at loc_141e's cleared 0.
  regs.a = 0x00;
  configureFlipScreenAndComposeScreen(m);
}

/** Twin (b): skips the 0x600E companion write. */
function brokenSkipCompanion(m) {
  const { regs, mem } = m;
  // BUG: dropped `ld (0x600E),1`.
  mem.write8(CURRENT_PLAYER, 0x01);
  regs.a = 0x00;
  configureFlipScreenAndComposeScreen(m);
}

/** Twin (c): enters the compose tail with A = 1 (the record==1 arm's key, not record==3's). */
function brokenPlayerKey(m) {
  const { regs, mem } = m;
  mem.write8(PLAYER_INDEX_COMPANION, 0x01);
  mem.write8(CURRENT_PLAYER, 0x01);
  regs.a = 0x01; // BUG: should be 0x00 — forces the flip bit on regardless of DIP.
  configureFlipScreenAndComposeScreen(m);
}

/** Twin (d): does the player-index writes but skips the compose delegation entirely. */
function brokenSkipCompose(m) {
  const { mem } = m;
  mem.write8(PLAYER_INDEX_COMPANION, 0x01);
  mem.write8(CURRENT_PLAYER, 0x01);
  // BUG: never enters configureFlipScreenAndComposeScreen — timer/sub-state/ring/flip untouched.
}

test("TEETH: skip-current-player, skip-companion, wrong-key, and skip-compose twins are all CAUGHT", () => {
  assert.ok(ENTRY, "need a captured entry for the teeth");

  // (a) skip-current-player — caught at CURRENT_PLAYER (RAM): oracle 1, twin 0.
  const dCur = diffAgainstOracle(ENTRY, brokenSkipCurrentPlayer);
  assert.notEqual(dCur, null, "the gate FAILED to catch a skipped CURRENT_PLAYER write — it is worthless");
  assert.equal(dCur.kind, "ram", "skip-current-player must be caught as a RAM diff");
  assert.equal(dCur.addr, CURRENT_PLAYER, `skip-current-player must diverge at CURRENT_PLAYER (${hx(CURRENT_PLAYER)})`);
  assert.equal(dCur.a, 1, "oracle selects player 2 (CURRENT_PLAYER = 1)");
  assert.equal(dCur.b, 0, "twin leaves CURRENT_PLAYER = 0");

  // (b) skip-companion — caught at 0x600E (RAM).
  const dComp = diffAgainstOracle(ENTRY, brokenSkipCompanion);
  assert.notEqual(dComp, null, "the gate FAILED to catch a skipped 0x600E write — it is worthless");
  assert.equal(dComp.kind, "ram", "skip-companion must be caught as a RAM diff");
  assert.equal(dComp.addr, PLAYER_INDEX_COMPANION, `skip-companion must diverge at ${hx(PLAYER_INDEX_COMPANION)}`);

  // (c) wrong-key — RAM is identical (both write the index; A only reaches the flip latch),
  //     so only io.flipScreen tells. Force DIP=0 so flip = A: oracle 0, twin 1.
  const eKey = craftDip(0);
  const dKey = diffAgainstOracle(eKey, brokenPlayerKey);
  assert.notEqual(dKey, null, "the gate FAILED to catch a wrong player key — it is worthless");
  assert.equal(dKey.kind, "flip", "wrong-key must be caught via io.flipScreen, not RAM");
  assert.equal(dKey.a, 0, "oracle enters with A=0 -> flip = 0|0 = 0");
  assert.equal(dKey.b, 1, "twin enters with A=1 -> flip = 1|0 = 1");

  // (d) skip-compose — the delegated subtree never runs; GAME_SUBSTATE is not advanced.
  const dCompose = diffAgainstOracle(ENTRY, brokenSkipCompose);
  assert.notEqual(dCompose, null, "the gate FAILED to catch a skipped compose delegation — it is worthless");
  const co = ENTRY.clone(); oracle(co);
  const ct = ENTRY.clone(); brokenSkipCompose(ct);
  assert.equal(
    co.mem.read8(GAME_SUBSTATE), (ENTRY.mem.read8(GAME_SUBSTATE) + 1) & 0xff,
    "oracle advances GAME_SUBSTATE",
  );
  assert.equal(ct.mem.read8(GAME_SUBSTATE), ENTRY.mem.read8(GAME_SUBSTATE), "twin leaves GAME_SUBSTATE unadvanced");

  console.log(
    `  TEETH: skip-current-player at ${hx(dCur.addr)} (${dCur.a}->${dCur.b}); skip-companion at ` +
      `${hx(dComp.addr)}; wrong-key via flip-screen (${dKey.a}->${dKey.b}); skip-compose caught (${fmt(dCompose)})`,
  );
});
