// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for configureFlipScreenAndComposeScreen (ROM 0x1459) — the
 * sub-state-0x14 tail that sets the flip-screen latch for the player up, clears the
 * sub-state timer, advances GAME_SUBSTATE, and posts twelve [0x03, 0x0D..0x18] draw
 * tasks onto the ring.
 *
 * loc_1459 WRITES memory (SUBSTATE_TIMER 0x6009, GAME_SUBSTATE 0x600A, the task ring +
 * TASK_TAIL via enqueueTask) and the flip-screen board latch (0x7D82), and READS one
 * live-in register (A, the player key) plus DIP_UPRIGHT (0x6026) and the ring. So it is
 * validated by capture/clone/replay on a FRESH clone per case — never reusing one
 * machine, never the full register file, never cycles. The compared contract is:
 *
 *   RAM (minus the stack scratch below the entry SP)  +  io.flipScreen (the 0x7D82 latch)
 *
 * The flip latch is a board io output, NOT in the RAM dump; comparing io.flipScreen is
 * load-bearing because the A/DIP arms that both leave the latch unchanged differ ONLY
 * there. No live-out registers/flags (the rst-0x28 NMI dispatch consumes none); SP/pc
 * are not compared — the idiomatic layer drops the oracle's per-post push/ret bookkeeping.
 *
 * REACHABILITY. loc_1459 is NOT reached in attract or a 1-player coin+start run: its
 * parent loc_141e (GAME_STATE 3, GAME_SUBSTATE 0x14, reached at game over) scans the
 * five 0x611C object records for a player slot and, finding none (all zero), takes the
 * record-neither -> loc_1475 arm. Both of loc_1459's real entry arms are therefore forced
 * from that REAL loc_141e dispatch by a single-byte upstream nudge — poking one 0x611C
 * record to 1 makes the scan hit and dispatch loc_1459 with A = 0x01; poking it to 3
 * routes through loc_144f and dispatches loc_1459 with A = 0x00. The captured entry is
 * genuine (the ROM's own loc_141e -> loc_1459 dispatch), the only craft being that one
 * upstream record byte — the doc-06 crafted-entry technique.
 *
 *   1. REALISM (both real arms) — capture the true loc_1459 entry for A = 0x01 and
 *      A = 0x00, replay oracle vs candidate on fresh clones, and prove RAM (ex-stack) +
 *      flip identical. Non-vacuous: assert the oracle actually cleared 0x6009, advanced
 *      0x600A (0x14 -> 0x15), advanced the tail by 24 (twelve 2-byte posts), and set the
 *      latch to A|DIP. Candidate leaves SP/pc unchanged (no stack model).
 *
 *   2. CRAFTED (flip matrix + ring arms) — from a captured entry, poke A x DIP_UPRIGHT
 *      identically on both sides across {0,1}x{0,1} (flip = A|DIP: 1/1/1/0), and force
 *      ring states the natural entry does not: FULL (tail slot occupied -> every post
 *      dropped) and WRAP (tail near the top -> the 24-byte batch wraps 0xFF->0xC0). Each
 *      compared oracle vs candidate on RAM (ex-stack) + flip, with the oracle's own flip
 *      outcome asserted so no arm passes vacuously.
 *
 *   3. TEETH — four deliberately-broken twins the diff MUST catch: (a) a flip write that
 *      drops the DIP OR (caught via io.flipScreen on the A=0/DIP=1 arm — the check RAM is
 *      blind to); (b) a skipped GAME_SUBSTATE advance (RAM diff at 0x600A); (c) a wrong
 *      posted task byte (RAM diff in the ring); (d) a skipped SUBSTATE_TIMER clear (RAM
 *      diff at 0x6009, exposed by pre-dirtying it identically on both sides).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1459.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1459 as oracle } from "../../translated/loc_1459.js";
import { loc_141e as oracle141e } from "../../translated/loc_141e.js";
import { configureFlipScreenAndComposeScreen as candidate } from "../configureFlipScreenAndComposeScreen.js";
import { enqueueTask } from "../enqueueTask.js";
import { Machine } from "../../machine.js";
import { DIP_UPRIGHT, SUBSTATE_TIMER, GAME_SUBSTATE, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1459;
const PARENT = 0x141e; // loc_141e — the sub-state-0x14 handler that dispatches loc_1459
const SCAN_RECORD0 = 0x611c; // first of the five stride-0x22 object records loc_141e scans
const FLIPSCREEN = 0x7d82;
const TASK_TAIL = 0x60b0;
const RING_LO = 0xc0; // low byte of the first ring slot / the wrap floor
const FRAMES = 9000; // loc_141e first dispatches (game over) before this; reached by ~8000

// Canonical coin+start tape: pulse the IN2 coin bit then the start1 bit so the ROM's own
// credit/start logic runs a 1-player game; with no further input Mario tops out and the
// game-over path reaches GAME_STATE 3 / GAME_SUBSTATE 0x14 -> loc_141e.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1 (IN2 bit2)
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/**
 * First observable difference between two machines after each ran its routine: a RAM
 * byte (skipping the stack scratch below the entry SP) OR the flip-screen board latch (io.flipScreen —
 * the 0x7D82 output, not in the RAM dump). RAM first, then the latch. Null if identical.
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

// -- entry capture (real loc_141e dispatch, single-byte upstream nudge) --------

/**
 * Drive a coin+start game to the real loc_141e dispatch (game over, state 3 / sub 0x14),
 * nudge one 0x611C object record to `recVal` so loc_141e's scan hits and dispatches
 * loc_1459, and clone the machine at that genuine loc_1459 entry. recVal 1 -> A = 0x01
 * (record==1 arm); recVal 3 -> A = 0x00 (record==3 -> loc_144f arm). The wrappers run the
 * ORACLE so the host game proceeds undisturbed.
 */
function captureEntry(recVal) {
  let entry = null;
  const snap = new Map([
    [PARENT, (mm) => { mm.mem.write8(SCAN_RECORD0, recVal); return oracle141e(mm); }],
    [TARGET, (mm) => { if (entry === null) entry = mm.clone(); return oracle(mm); }],
  ]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(FRAMES);
  return entry;
}

const ENTRY_A1 = ROM_PRESENT ? captureEntry(1) : null; // A = 0x01 (record==1 arm)
const ENTRY_A0 = ROM_PRESENT ? captureEntry(3) : null; // A = 0x00 (record==3 -> loc_144f)

/** Clone an entry and poke A + DIP_UPRIGHT to force one flip arm. */
function craftArm(entry, a, dip) {
  const w = entry.clone();
  w.regs.a = a;
  w.mem.write8(DIP_UPRIGHT, dip);
  return w;
}

/** Clear the whole ring to the empty marker (0xFF) so a craft controls it exactly. */
function clearRing(mm) {
  for (let l = RING_LO; l <= 0xff; l++) mm.mem.write8(0x6000 | l, 0xff);
}

// -- 1. REALISM (both real arms) ----------------------------------------------

test("REALISM: real loc_1459 dispatch on both arms — RAM (ex-stack) + flip match the oracle", () => {
  assert.ok(ENTRY_A1 && ENTRY_A0, "loc_1459 never dispatched via the nudged loc_141e — reachability broke");

  for (const [label, entry, wantA] of [["A=0x01 (record==1)", ENTRY_A1, 0x01], ["A=0x00 (record==3)", ENTRY_A0, 0x00]]) {
    // Document where/how it fired: state 3, sub-state 0x14, the expected player key.
    assert.equal(entry.mem.read8(0x6005), 3, `${label}: reached with GAME_STATE==3 (in game)`);
    assert.equal(entry.mem.read8(GAME_SUBSTATE), 0x14, `${label}: reached at GAME_SUBSTATE==0x14`);
    assert.equal(entry.regs.a & 0xff, wantA, `${label}: entered with the expected A`);

    const d = diffAgainstOracle(entry, candidate);
    assert.equal(d, null, d && `${label}: divergence: ${fmt(d)}`);

    // Non-vacuous: confirm the oracle's own effects on this real entry.
    const o = entry.clone();
    const tail0 = o.mem.read8(TASK_TAIL);
    oracle(o);
    assert.equal(o.mem.read8(SUBSTATE_TIMER), 0, `${label}: oracle clears SUBSTATE_TIMER`);
    assert.equal(
      o.mem.read8(GAME_SUBSTATE),
      (entry.mem.read8(GAME_SUBSTATE) + 1) & 0xff,
      `${label}: oracle advances GAME_SUBSTATE (0x14 -> 0x15)`,
    );
    assert.equal(o.mem.read8(TASK_TAIL), (tail0 + 24) & 0xff, `${label}: oracle posts 12 tasks (tail +24)`);
    assert.equal(
      o.io.flipScreen,
      (wantA | entry.mem.read8(DIP_UPRIGHT)) & 1,
      `${label}: oracle sets flip = A|DIP`,
    );

    // No stack modelling: candidate leaves SP and pc unchanged from entry.
    const c = entry.clone();
    const sp0 = c.regs.sp, pc0 = c.pc;
    candidate(c);
    assert.equal(c.regs.sp, sp0, `${label}: must leave SP unchanged (no stack modelling)`);
    assert.equal(c.pc, pc0, `${label}: must leave pc unchanged (no ret modelling)`);
  }
  console.log("  REALISM: both real arms (A=0x01, A=0x00) — RAM (ex-stack) + flip identical to the oracle");
});

// -- 2. CRAFTED (flip matrix + ring arms) -------------------------------------

test("CRAFTED: the A x DIP flip matrix matches the oracle in RAM + flip", () => {
  assert.ok(ENTRY_A1, "need a captured entry to craft the flip matrix from");

  const arms = [
    { a: 1, dip: 1, flip: 1 },
    { a: 1, dip: 0, flip: 1 },
    { a: 0, dip: 1, flip: 1 },
    { a: 0, dip: 0, flip: 0 }, // the only arm that leaves the latch OFF
  ];
  for (const arm of arms) {
    const w = craftArm(ENTRY_A1, arm.a, arm.dip);

    const d = diffAgainstOracle(w, candidate);
    assert.equal(d, null, d && `A=${arm.a} DIP=${arm.dip}: ${fmt(d)}`);

    const o = w.clone();
    oracle(o);
    assert.equal(o.io.flipScreen, arm.flip, `A=${arm.a} DIP=${arm.dip}: oracle flip = A|DIP`);
  }
  console.log("  CRAFTED/flip-matrix: 4 arms (A x DIP) — RAM (ex-stack) + flip identical; flip = A|DIP pinned");
});

test("CRAFTED: matches the oracle across FULL-ring (all posts dropped) and WRAP arms", () => {
  assert.ok(ENTRY_A1, "need a captured entry to craft ring states from");

  const crafts = [
    // CLEAN base: empty ring from the base slot — the plain no-wrap post arm, isolated.
    ["clean-base", (mm) => { clearRing(mm); mm.mem.write8(TASK_TAIL, RING_LO); }],
    // FULL: tail points at an OCCUPIED slot (bit 7 clear) -> every post dropped, tail
    // untouched; only the latch + timer + sub-state change.
    ["full-ring", (mm) => { clearRing(mm); mm.mem.write8(TASK_TAIL, 0xee); mm.mem.write8(0x60ee, 0x00); }],
    // WRAP: tail near the top so the 24-byte batch runs past 0xFF and wraps to 0xC0.
    ["wrap", (mm) => { clearRing(mm); mm.mem.write8(TASK_TAIL, 0xf4); }],
  ];

  for (const [label, poke] of crafts) {
    const a = ENTRY_A1.clone();
    const b = ENTRY_A1.clone();
    poke(a); poke(b);
    oracle(a);
    candidate(b);
    const d = firstDiffOutsideStack(a, b, ENTRY_A1.regs.sp);
    assert.equal(d, null, d && `${label}: ${fmt(d)}`);
    console.log(`  CRAFTED/${label}: RAM (ex-stack) + flip identical to the oracle`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/** Post the correct 12-message batch [0x03, 0x0D..0x18] via the real enqueueTask. */
function postBatch(m, firstArg = 0x0d) {
  const { regs } = m;
  regs.d = 0x03;
  for (let arg = 0x0d; arg <= 0x18; arg++) {
    regs.e = arg === 0x0d ? firstArg : arg;
    enqueueTask(m);
  }
}

/** Twin (a): writes the flip latch from A alone, dropping the `| DIP_UPRIGHT`. */
function brokenFlip(m) {
  const { regs, mem } = m;
  mem.write8(FLIPSCREEN, regs.a & 0xff); // BUG: no | DIP_UPRIGHT
  mem.write8(SUBSTATE_TIMER, 0x00);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  postBatch(m);
}

/** Twin (b): skips advancing GAME_SUBSTATE — a hung-screen bug. */
function brokenSubstate(m) {
  const { regs, mem } = m;
  mem.write8(FLIPSCREEN, (regs.a | mem.read8(DIP_UPRIGHT)) & 0xff);
  mem.write8(SUBSTATE_TIMER, 0x00);
  // BUG: dropped `inc (0x600A)`.
  postBatch(m);
}

/** Twin (c): posts a wrong first-task argument (0x0E, not 0x0D). */
function brokenTask(m) {
  const { regs, mem } = m;
  mem.write8(FLIPSCREEN, (regs.a | mem.read8(DIP_UPRIGHT)) & 0xff);
  mem.write8(SUBSTATE_TIMER, 0x00);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  postBatch(m, 0x0e); // BUG: first arg should be 0x0D
}

/** Twin (d): skips clearing SUBSTATE_TIMER. */
function brokenTimer(m) {
  const { regs, mem } = m;
  mem.write8(FLIPSCREEN, (regs.a | mem.read8(DIP_UPRIGHT)) & 0xff);
  // BUG: dropped the `ld (0x6009),0` clear.
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  postBatch(m);
}

test("TEETH: flip-drop, skip-advance, wrong-task, and skip-timer twins are all CAUGHT", () => {
  assert.ok(ENTRY_A1 && ENTRY_A0, "need captured entries for the teeth");

  // (a) flip-drop — RAM is identical (A=0/DIP=1 leaves the same memory); only io.flipScreen
  //     tells (oracle 1, twin 0). This is the check the RAM gate cannot make.
  const eFlip = craftArm(ENTRY_A1, 0x00, 0x01); // oracle: flip = 0|1 = 1
  const dFlip = diffAgainstOracle(eFlip, brokenFlip);
  assert.notEqual(dFlip, null, "the gate FAILED to catch a dropped flip-screen DIP OR — it is worthless");
  assert.equal(dFlip.kind, "flip", "flip-drop must be caught via io.flipScreen, not RAM");
  assert.equal(dFlip.a, 1, "oracle sets flip = A|DIP = 1");
  assert.equal(dFlip.b, 0, "broken twin leaves flip = A = 0");

  // (b) skip-advance — caught at GAME_SUBSTATE (RAM).
  const dSub = diffAgainstOracle(ENTRY_A1, brokenSubstate);
  assert.notEqual(dSub, null, "the gate FAILED to catch a skipped GAME_SUBSTATE advance — it is worthless");
  assert.equal(dSub.kind, "ram", "skip-advance must be caught as a RAM diff");
  assert.equal(dSub.addr, GAME_SUBSTATE, `skip-advance must diverge at GAME_SUBSTATE (${hx(GAME_SUBSTATE)})`);

  // (c) wrong-task — caught in the ring at the first task's argument byte.
  const tail = ENTRY_A1.mem.read8(TASK_TAIL);
  const argSlot = 0x6000 | ((tail + 1) & 0xff);
  const dTask = diffAgainstOracle(ENTRY_A1, brokenTask);
  assert.notEqual(dTask, null, "the gate FAILED to catch a wrong posted task byte — it is worthless");
  assert.equal(dTask.kind, "ram", "wrong-task must be caught as a RAM diff");
  assert.equal(dTask.addr, argSlot, `wrong-task must diverge at the first task arg slot (${hx(argSlot)})`);

  // (d) skip-timer — the real entry already has 0x6009 == 0, so a dropped zero-write would
  //     be invisible; pre-dirty it to a sentinel (identically on both sides) so the oracle
  //     clears it and the twin leaves the sentinel.
  const eTimer = ENTRY_A1.clone();
  eTimer.mem.write8(SUBSTATE_TIMER, 0x55);
  const dTimer = diffAgainstOracle(eTimer, brokenTimer);
  assert.notEqual(dTimer, null, "the gate FAILED to catch a skipped SUBSTATE_TIMER clear — it is worthless");
  assert.equal(dTimer.kind, "ram", "skip-timer must be caught as a RAM diff");
  assert.equal(dTimer.addr, SUBSTATE_TIMER, `skip-timer must diverge at SUBSTATE_TIMER (${hx(SUBSTATE_TIMER)})`);

  console.log(
    `  TEETH: flip-drop via flip-screen (${dFlip.a}->${dFlip.b}); skip-advance at ${hx(dSub.addr)}; ` +
      `wrong-task at ${hx(dTask.addr)}; skip-timer at ${hx(dTimer.addr)}`,
  );
});
