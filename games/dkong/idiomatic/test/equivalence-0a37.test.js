// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for composeScreenAndAdvanceSubstate (ROM 0x0A37) — in-game
 * sub-state 5: post a fixed four-message task batch, advance GAME_SUBSTATE (0x600A),
 * and stamp player 1's "1UP" marker (the sub_0a53 fall-through tail).
 *
 * loc_0a37 is a credited-game (GAME_STATE 3) sub-state handler — NOT reached in plain
 * attract (attract holds GAME_STATE 0) — and it WRITES memory (task ring, sub-state
 * byte, video RAM) via two decompiled callees. So it is gated by MEMORY-equivalence
 * against the frozen oracle (RAM − the stack scratch below the entry SP), with a FRESH clone per case, never
 * the full register file and never cycles:
 *
 *   1. REALISM (captured driven dispatch) — drive a coin+start into a credited game so
 *      the intro sequence reaches sub-state 5, hook 0x0A37, and clone the machine at
 *      the real dispatch. Run the ORACLE on one clone and the idiomatic routine on
 *      another and prove game-visible RAM (everything outside the stack scratch below the entry SP)
 *      is byte-identical. The real dispatch has an empty ring (tail 0xEE, slots 0xFF),
 *      so it exercises the plain no-wrap post arm. The idiomatic routine models no
 *      stack, so it must also leave SP and pc unchanged from entry (the oracle's four
 *      `call`s + `ret` leave only push residue inside STACK_SCRATCH).
 *
 *   2. CRAFTED (ring states the run never reaches) — from the real entry, poke the ring
 *      IDENTICALLY on both sides into arms attract/one-shot never mint:
 *        - FULL: occupy the tail slot (bit 7 clear) so every post is dropped and the
 *          tail is left untouched — only the sub-state + marker change.
 *        - WRAP: set TASK_TAIL near the top (0xFC) so the 8-byte batch wraps 0xFF→0xC0
 *          mid-batch, pinning enqueueTask's wrap math across the whole batch.
 *      Each compared oracle vs idiomatic on RAM − the stack scratch below the entry SP.
 *
 *   3. TEETH — two deliberately-broken twins the diff MUST catch: (a) one that skips the
 *      GAME_SUBSTATE advance (a hung-intro bug), caught at 0x600A; (b) one that posts a
 *      wrong task byte, caught in the ring. A gate a real corruption slips through is
 *      worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0a37.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a37 as oracle } from "../../translated/loc_0a37.js";
import { composeScreenAndAdvanceSubstate } from "../composeScreenAndAdvanceSubstate.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0a37;
const GAME_SUBSTATE = 0x600a;
const TASK_TAIL = 0x60b0;
const RING_BASE = 0x60c0; // low byte 0xC0
const CELL_1 = 0x7740, CELL_U = 0x7720, CELL_P = 0x7700; // the "1UP" marker cells

// A coin+start tape: coin on IN2 bit7 at frame 10, start1 on IN2 bit2 at frame 30.
// This credits + starts a game so GAME_STATE reaches 3 and the intro sequence walks
// through sub-state 5 (loc_0a37) once.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM (work + sprite + video). Returns the first game-visible
 * difference (outside the stack scratch below the entry SP — a real failure) or null, plus a count of bytes
 * that differed inside the dead stack scratch (the oracle's `call`/`ret` push residue,
 * which the idiomatic routine does not model — expected, tolerated, excluded).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry state through the oracle and a candidate on independent FRESH
 *  clones (the routine writes RAM), and return the diff + both post-run machines. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Drive a coin+start game and clone the machine at each real 0x0A37 dispatch (capped at
 * K). The wrapper clones the entry, then runs the oracle so the host game proceeds to a
 * clean stop; capturing is gated off afterwards so the isolated replays cannot pollute it.
 */
function captureDrivenDispatches(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// -- 1. REALISM (captured driven dispatch) ------------------------------------

test("REALISM: composeScreenAndAdvanceSubstate == oracle on the real in-game dispatch", () => {
  const caps = captureDrivenDispatches(8, 1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x0A37 dispatch during a credited game");

  for (const entry of caps) {
    const { b, bad } = replay(entry, composeScreenAndAdvanceSubstate);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );

    // No stack modelling: SP and pc unchanged from the captured entry.
    const c = entry.clone();
    const sp0 = c.regs.sp, pc0 = c.pc;
    composeScreenAndAdvanceSubstate(c);
    assert.equal(c.regs.sp, sp0, "must leave SP unchanged (no stack modelling)");
    assert.equal(c.pc, pc0, "must leave pc unchanged (no ret modelling)");

    // EQUAL is not vacuous: it actually advanced the sub-state and stamped the marker.
    assert.equal(
      b.mem.read8(GAME_SUBSTATE),
      (entry.mem.read8(GAME_SUBSTATE) + 1) & 0xff,
      "GAME_SUBSTATE must be incremented",
    );
    assert.equal(b.mem.read8(CELL_1), 0x01, "marker cell 0x7740 should be '1'");
    assert.equal(b.mem.read8(CELL_U), 0x25, "marker cell 0x7720 should be 'U'");
    assert.equal(b.mem.read8(CELL_P), 0x20, "marker cell 0x7700 should be 'P'");
  }
  console.log(`  REALISM: ${caps.length} real dispatch(es) — game-visible RAM identical to the oracle`);
});

// -- 2. CRAFTED (ring states the run never reaches) ---------------------------

test("CRAFTED: matches the oracle across FULL-ring (all posts dropped) and WRAP arms", () => {
  const caps = captureDrivenDispatches(1, 1200);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  // Clear the whole ring to the empty marker (0xFF) so each craft controls it exactly.
  const clearRing = (mm) => { for (let l = 0xc0; l <= 0xff; l++) mm.mem.write8(0x6000 | l, 0xff); };

  const crafts = [
    // FULL: tail points at an OCCUPIED slot (bit 7 clear) → every post is dropped, tail
    // untouched; only the sub-state advance + the marker stamp change.
    ["full-ring", (mm) => { clearRing(mm); mm.mem.write8(TASK_TAIL, 0xee); mm.mem.write8(0x60ee, 0x00); }],
    // WRAP: tail near the top so the 8-byte batch runs past 0xFF and wraps to 0xC0.
    ["wrap", (mm) => { clearRing(mm); mm.mem.write8(TASK_TAIL, 0xfc); }],
    // Clean ring from the base, for good measure (the plain write arm, isolated).
    ["clean-base", (mm) => { clearRing(mm); mm.mem.write8(TASK_TAIL, RING_BASE & 0xff); }],
  ];

  for (const [label, poke] of crafts) {
    const a = entry.clone(); const b = entry.clone();
    poke(a); poke(b);
    oracle(a);
    composeScreenAndAdvanceSubstate(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(`  CRAFTED/${label}: game-visible RAM identical to the oracle`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin A: does everything EXCEPT advance the sub-state — the hung-intro bug.
 *  Reuses the real routine's structure by cloning its body minus the inc. */
function brokenSkipAdvance(m) {
  const { regs, mem } = m;
  for (const [op, arg] of [[0x03, 0x04], [0x02, 0x02], [0x02, 0x00], [0x06, 0x00]]) {
    regs.d = op; regs.e = arg;
    // inline enqueueTask to stay independent of the module under test
    const tail = mem.read8(TASK_TAIL);
    const slot = 0x6000 | tail;
    if ((mem.read8(slot) & 0x80) === 0) continue;
    mem.write8(slot, regs.d);
    mem.write8(0x6000 | ((tail + 1) & 0xff), regs.e);
    let next = (tail + 2) & 0xff;
    if (next < 0xc0) next = 0xc0;
    mem.write8(TASK_TAIL, next);
  }
  // BUG: skip `inc (0x600A)`.
  mem.write8(CELL_1, 0x01); mem.write8(CELL_U, 0x25); mem.write8(CELL_P, 0x20);
}

/** Broken twin B: posts a wrong argument on the first task ([0x03,0x05] not [0x03,0x04]),
 *  otherwise identical — caught in the ring at the argument byte. */
function brokenWrongTask(m) {
  const { regs, mem } = m;
  for (const [op, arg] of [[0x03, 0x05], [0x02, 0x02], [0x02, 0x00], [0x06, 0x00]]) {
    regs.d = op; regs.e = arg;
    const tail = mem.read8(TASK_TAIL);
    const slot = 0x6000 | tail;
    if ((mem.read8(slot) & 0x80) === 0) continue;
    mem.write8(slot, regs.d);
    mem.write8(0x6000 | ((tail + 1) & 0xff), regs.e);
    let next = (tail + 2) & 0xff;
    if (next < 0xc0) next = 0xc0;
    mem.write8(TASK_TAIL, next);
  }
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  mem.write8(CELL_1, 0x01); mem.write8(CELL_U, 0x25); mem.write8(CELL_P, 0x20);
}

test("TEETH: the skip-advance twin is CAUGHT and names 0x600A", () => {
  const caps = captureDrivenDispatches(1, 1200);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");
  const { bad } = replay(caps[0], brokenSkipAdvance);
  assert.notEqual(bad, null, "the gate FAILED to catch a skipped sub-state advance — it is worthless");
  assert.equal(bad.addr, GAME_SUBSTATE, `expected the caught diff at ${hx(GAME_SUBSTATE)}, got ${hx(bad.addr)}`);
  console.log(`  TEETH/skip-advance: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH: the wrong-task-byte twin is CAUGHT in the ring", () => {
  const caps = captureDrivenDispatches(1, 1200);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");
  const entry = caps[0];
  const tail = entry.mem.read8(TASK_TAIL);
  const argSlot = 0x6000 | ((tail + 1) & 0xff); // the first task's argument byte
  const { bad } = replay(entry, brokenWrongTask);
  assert.notEqual(bad, null, "the gate FAILED to catch a wrong posted task byte — it is worthless");
  assert.equal(bad.addr, argSlot, `expected the caught diff at ${hx(argSlot)}, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-task: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});
