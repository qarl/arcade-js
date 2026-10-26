// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for restorePlayer2Context (ROM 0x09FE) — the PLAYER-2 CONTEXT
 * RESTORE: copy P2's saved 8-byte context into the live player block
 * (LIVES..HOW_HIGH_LAST_SEQ, 0x6228-0x622F), re-derive BOARD (0x6227) from the
 * restored board-sequence pointer, and arm the sub-state machine
 * (SUBSTATE_TIMER 0x6009 = 0x78, GAME_SUBSTATE 0x600A = 4).
 *
 * restorePlayer2Context WRITES memory and is reached by dispatch (dispatchGameState,
 * the NMI's rst-0x28 game-state dispatch) — not a pure leaf — so it is gated by
 * capture / clone / replay (docs/decompiler-pipeline), with a FRESH clone per case. It is straight-
 * line (no data-dependent branch — unlike its P1 twin loc_09ab, which branches on
 * TWO_PLAYER_GAME), so real captures + crafted entries are full path coverage.
 *
 * REACHABILITY. 0x09FE is NEVER reached in attract, nor at a 1-player start, nor
 * even at a 2-player START — it needs control to pass to player 2, i.e. player 1
 * must lose a life in a credited 2-player game. The capture drives that the cheap
 * deterministic way: TWO coins + START2, then leave Mario idle so the bonus timer
 * expires and player 1 dies; control passes to player 2 and 0x09FE dispatches
 * (~frame 1661, stable). A 1700-frame window covers it. (Same tape and timing the
 * optimized-layer test used.)
 *
 *   1. EQUAL (captured) — hook 0x09FE in that driven run, clone the machine at each
 *      true dispatch (FRESH clone per case, since it writes RAM), run the ORACLE on
 *      one clone and restorePlayer2Context on another, and confirm IDENTICAL RAM
 *      everywhere game-visible (minus the stack scratch below the entry SP). Also confirm the
 *      idiomatic routine leaves SP + pc unchanged (JS return replaces the modelled
 *      `ret`) and actually did its work (block == save slot, BOARD == *ptr,
 *      timer/substate armed) so EQUAL is not vacuous.
 *
 *   2. EQUAL (crafted) — from a real entry, poke IDENTICALLY on both sides: distinct
 *      board-sequence pointers (P2's saved SEQPTR at 0x604A/0x604B) to exercise the
 *      BOARD deref across values, distinct save-slot payloads to prove the copy is
 *      faithful, and pre-dirtied destination/output bytes to prove every write is
 *      unconditional. Confirm oracle == idiomatic and the derived outputs.
 *
 *   3. TEETH (captured) — a deliberately-broken twin that SWAPS the two arm
 *      constants (writes 4 to SUBSTATE_TIMER, 0x78 to GAME_SUBSTATE) MUST be caught
 *      by the captured sweep, naming 0x6009 (the lowest-address, always-divergent
 *      output). A gate a real corruption slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-09fe.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09fe as oracle } from "../../translated/loc_09fe.js";
import { restorePlayer2Context } from "../restorePlayer2Context.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  P2_CONTEXT,
  LIVES,
  BOARD,
  BOARD_SEQ_PTR,
  SUBSTATE_TIMER,
  GAME_SUBSTATE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x09fe;
const FRAMES = 1700; // 0x09FE first dispatches at ~frame 1661 (2P start -> P1 dies)

// A 2-coin + START2 tape: two coins on IN2 bit7 (frames 6 and 16), START2 on IN2
// bit3 (frame 40). Credits and starts a TWO-player game; leaving Mario idle then
// lets the bonus timer expire, so player 1 dies and control passes to player 2 —
// the transition that dispatches 0x09FE.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 6, dur: 6 },  // coin 1 (IN2 bit7)
  { port: 0x7d00, bits: 0x80, frame: 16, dur: 6 }, // coin 2 (IN2 bit7)
  { port: 0x7d00, bits: 0x08, frame: 40, dur: 6 }, // START2 (IN2 bit3)
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

function saveSlotBytes(m) {
  const out = [];
  for (let i = 0; i < 8; i++) out.push(m.mem.read8(P2_CONTEXT + i));
  return out;
}

/**
 * Assert a machine on which the restore has ALREADY run holds the expected outputs:
 * the 8-byte block copied from `expectSlot`, BOARD == *(restored ptr), and the arm.
 * (Non-vacuity: proves the routine actually did the work, not that both sides are inert.)
 */
function assertRestored(m, expectSlot, label) {
  for (let i = 0; i < 8; i++) {
    assert.equal(m.mem.read8(LIVES + i), expectSlot[i],
      `${label}: live block byte ${i} (${hx(LIVES + i)}) should be the copied save-slot value ${hx(expectSlot[i])}`);
  }
  const ptr = m.mem.read16(BOARD_SEQ_PTR);
  assert.equal(m.mem.read8(BOARD), m.mem.read8(ptr),
    `${label}: BOARD (${hx(BOARD)}) should be *BOARD_SEQ_PTR (byte at ${hx(ptr)})`);
  assert.equal(m.mem.read8(SUBSTATE_TIMER), 0x78, `${label}: SUBSTATE_TIMER should be armed to 0x78`);
  assert.equal(m.mem.read8(GAME_SUBSTATE), 4, `${label}: GAME_SUBSTATE should be armed to 4`);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  return caps;
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): restorePlayer2Context == oracle on every real P2-restore dispatch", () => {
  const caps = captureDispatches(64, FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x09FE dispatch during the driven 2P run");

  for (const entry of caps) {
    const slot = saveSlotBytes(entry); // what the copy must reproduce

    const { bad, stackDiffs } = replay(entry, restorePlayer2Context);
    assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
    assert.equal(stackDiffs, 0, `unexpected stack-scratch residue (${stackDiffs} bytes) — the oracle writes no stack`);

    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    restorePlayer2Context(b);
    assert.equal(b.regs.sp, sp0, "restorePlayer2Context must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "restorePlayer2Context must leave pc unchanged (no ret modelling)");
    // And it must actually have done the restore (EQUAL is not vacuous).
    assertRestored(b, slot, "captured");
  }
  console.log(`  EQUAL/captured: ${caps.length} real P2-restore dispatches — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted identical-both-sides) ----------------------------------

test("EQUAL (crafted): distinct pointers / payloads / dirtied destinations all match the oracle", () => {
  const caps = captureDispatches(1, FRAMES);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  // A distinctive 8-byte save-slot payload proves the copy is byte-faithful. The
  // 3rd/4th bytes (offsets 2,3) are P2's saved SEQPTR lo/hi — they become
  // BOARD_SEQ_PTR after the copy, so they steer the BOARD deref. Point them at
  // several addresses (real board-order table entries near 0x3A65/0x3A73, plus a
  // couple of arbitrary ROM addresses) to exercise the deref across values.
  const crafts = [
    ["ptr-3a65", [0x11, 0x22, 0x65, 0x3a, 0x55, 0x66, 0x77, 0x88]],
    ["ptr-3a66", [0x01, 0x02, 0x66, 0x3a, 0x03, 0x04, 0x05, 0x06]],
    ["ptr-3a73", [0xaa, 0xbb, 0x73, 0x3a, 0xcc, 0xdd, 0xee, 0xff],],
    ["ptr-3b00", [0x00, 0x00, 0x00, 0x3b, 0x00, 0x00, 0x00, 0x00]],
    ["ptr-0100", [0xde, 0xad, 0x00, 0x01, 0xbe, 0xef, 0x12, 0x34]],
  ];

  for (const [label, payload] of crafts) {
    const a = entry.clone(); const b = entry.clone();
    for (const mm of [a, b]) {
      // Poke P2's save slot to the payload...
      for (let i = 0; i < 8; i++) mm.mem.write8(P2_CONTEXT + i, payload[i]);
      // ...and pre-dirty every destination the routine writes, so a MISSED write
      // would surface as a divergence (or a wrong output below).
      for (let i = 0; i < 8; i++) mm.mem.write8(LIVES + i, 0x5a);
      mm.mem.write8(BOARD, 0x5a);
      mm.mem.write8(SUBSTATE_TIMER, 0x5a);
      mm.mem.write8(GAME_SUBSTATE, 0x5a);
    }
    oracle(a);
    restorePlayer2Context(b);

    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(bad, null, bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
    assertRestored(b, payload, label);
    console.log(`  EQUAL/crafted ${label}: block copied, BOARD=${hx(b.mem.read8(BOARD))}, arm 0x78/4 — identical to oracle`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: everything the idiomatic routine does, EXCEPT the two arm constants
 * are SWAPPED — SUBSTATE_TIMER gets 4 and GAME_SUBSTATE gets 0x78 (a plausible
 * "wrote the values to the wrong slots" bug). It diverges at BOTH 0x6009 and 0x600A,
 * so the first game-visible diff is the lower address, 0x6009.
 */
function brokenRestore(m) {
  const { mem } = m;
  for (let i = 0; i < 8; i++) mem.write8(LIVES + i, mem.read8(P2_CONTEXT + i));
  mem.write8(BOARD, mem.read8(mem.read16(BOARD_SEQ_PTR)));
  mem.write8(SUBSTATE_TIMER, 4);    // BUG: should be 0x78
  mem.write8(GAME_SUBSTATE, 0x78);  // BUG: should be 4
}

test("TEETH (captured): the swapped-arm twin is CAUGHT and names 0x6009", () => {
  const caps = captureDispatches(64, FRAMES);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");

  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenRestore);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a swapped arm — it is worthless");
  assert.equal(caught.addr, SUBSTATE_TIMER, `expected the caught diff at ${hx(SUBSTATE_TIMER)}, got ${hx(caught.addr)}`);
  console.log(`  TEETH/captured: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
