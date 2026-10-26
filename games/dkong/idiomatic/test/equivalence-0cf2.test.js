// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for setUp75mBoard (ROM 0x0CF2) — the 75m (board 3, elevators)
 * board-setup arm. It stamps the elevator board's fixed tile motifs
 * (stamp75mBoardTiles, ROM 0x0D27), selects the 75m background tune (SND_BGM = 0x0A),
 * points DE at the 75m elevator layout table (ROM 0x3BE5), and runs the shared draw +
 * setup tail loc_0cc6 (ROM 0x0CC6).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the
 * retired strict whole-machine one. The arm WRITES memory through both callees and the
 * setup continuation carries state, so every case uses a FRESH clone per side and the
 * two are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) only.
 *
 * pc and SP are deliberately NOT compared: the oracle models its CALL/RET brackets with
 * push16/step/ret (return addresses left in the dead stack region), the plumbing the
 * direct-call layer replaces with a JS return. Those pushes land inside STACK_SCRATCH, so
 * they are masked by the contract. A/HL/B/DE and all flags are dead ABI: loc_0c92 (the
 * caller) reads no return value. DE is set only as a live-IN handed to the tail, not a
 * live-out of this arm.
 *
 * REACHABILITY. setUp75mBoard is 75m-only: loc_0c92 branches to it exactly when BOARD == 3.
 * Attract plays 25m, so it NEVER dispatches in a plain run. Following the sanctioned
 * "poke the board state to reach a state for validation", the test forces the real
 * dispatch with an IDENTICAL-BOTH-SIDES board-3 poke at frame 100 (GAME_STATE=3,
 * GAME_SUBSTATE=0x0A board-setup, SUBSTATE_TIMER=1, BOARD=3); loc_0c92 then m.call's
 * 0x0CF2 once (~frame 102) under the vblank NMI, giving a REAL captured entry (real
 * register file, real stack).
 *
 * Jobs:
 *   1. EQUAL (real forced dispatch) — oracle vs setUp75mBoard on fresh clones of the real
 *      board-3 entry leave identical RAM (−STACK_SCRATCH). Non-vacuous: the oracle side
 *      shows the whole chain ran — SND_BGM = 0x0A, the first elevator motif cell stamped
 *      (0x770D = 0xFD), and the setup continuation armed SUBSTATE_TIMER = 0x40. The dead
 *      stack traffic is proven load-bearing to the mask (stackDiffs > 0), and entry SP
 *      sits in STACK_SCRATCH so the exclusion is sound.
 *   2. TEETH (music) — a twin that writes the WRONG tune (0x09) MUST be caught at SND_BGM.
 *   3. TEETH (layout/DE) — a twin that points DE at the 25m table (0x3AE4) draws a
 *      DIFFERENT board; MUST be caught in the drawn tilemap. This proves the DE live-in
 *      marshalling is load-bearing.
 *   4. TEETH (stamp) — a twin that DROPS the elevator tile stamp MUST be caught at the
 *      motif cells.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0cf2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0cf2 as oracle } from "../../translated/loc_0cf2.js";
import { setUp75mBoard as idiomatic } from "../setUp75mBoard.js";
import { stamp75mBoardTiles } from "../stamp75mBoardTiles.js";
import { loc_0cc6 } from "../loc_0cc6.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SND_BGM,
  SUBSTATE_TIMER,
  GAME_STATE,
  GAME_SUBSTATE,
  BOARD,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0cf2;
const FIRST_MOTIF_CELL = 0x770d; // first elevator-motif tilemap cell (holds tile 0xFD)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inStackScratch = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

/**
 * dumpState() returns a fresh array per call, so the dead-stack bytes are neutralised by
 * copying them across before the single diff — masking, not an advancing sub-scan (the
 * oracle leaves several adjacent stack bytes, which an advancing-`from` idiom oscillates on).
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  for (let off = 0; off < a.length; off++) {
    if (dead(ma.stateOffsetToAddr(off))) b[off] = a[off]; // mask dead scratch
  }
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off));
}

function stackDiffCount(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  let n = 0;
  for (let off = 0; off < a.length; off++) {
    if (a[off] !== b[off] && dead(ma.stateOffsetToAddr(off))) n++;
  }
  return n;
}

// Identical-both-sides one-shot poke that forces 75m (BOARD==3) board setup, whose arm
// setUp75mBoard the board-build dispatch (loc_0c92) calls. dur 1 so the game manages state
// from f101 onward.
const POKE_FRAME = 100;
const FORCE_0CF2_POKE = [
  { addr: GAME_STATE, val: 0x03, frame: POKE_FRAME, dur: 1 },     // in-game dispatch
  { addr: GAME_SUBSTATE, val: 0x0a, frame: POKE_FRAME, dur: 1 },  // 0x0A -> board setup
  { addr: SUBSTATE_TIMER, val: 0x01, frame: POKE_FRAME, dur: 1 }, // proceeds this frame
  { addr: BOARD, val: 0x03, frame: POKE_FRAME, dur: 1 },          // 75m elevator -> setUp75mBoard
];
const FRAMES = 140; // the forced dispatch lands ~frame 102

/**
 * Force the real dispatch of 0x0CF2 via the board-3 poke and clone the machine at each
 * true entry. The wrapper snapshots the entry state, then runs the oracle so the host
 * proceeds. A fresh copy of the poke keeps runs independent.
 */
function captureDispatches(K) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = FORCE_0CF2_POKE.map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(4) : [];


test("EQUAL: real forced board-3 dispatch — setUp75mBoard == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 1, `expected the real 0x0CF2 dispatch on board 3; got ${CAPS.length}`);

  for (const cap of CAPS) {
    assert.equal(cap.mem.read8(BOARD), 3, "the forced dispatch must be the 75m board build (BOARD == 3)");
    assert.ok(inStackScratch(cap.regs.sp), `entry SP must sit in STACK_SCRATCH for the exclusion to be sound (SP=${hx(cap.regs.sp)})`);

    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    idiomatic(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);

    // Non-vacuous: the oracle side shows the whole arm+tail chain executed.
    assert.equal(o.mem.read8(SND_BGM), 0x0a, "oracle must select the 75m tune (SND_BGM = 0x0A)");
    assert.equal(o.mem.read8(FIRST_MOTIF_CELL), 0xfd, "oracle must stamp the first elevator motif cell (0x770D = 0xFD)");
    assert.equal(o.mem.read8(SUBSTATE_TIMER), 0x40, "oracle's setup continuation must arm SUBSTATE_TIMER = 0x40");
    // ...and the idiomatic side genuinely reproduced them, not merely agreed on unchanged bytes.
    assert.equal(c.mem.read8(SND_BGM), 0x0a, "idiomatic must select the 75m tune (SND_BGM = 0x0A)");
    assert.equal(c.mem.read8(FIRST_MOTIF_CELL), 0xfd, "idiomatic must stamp the first elevator motif cell");
    assert.ok(stackDiffCount(o, c, cap.regs.sp) > 0, "the oracle's stack traffic must differ (so the STACK_SCRATCH mask is load-bearing)");
  }
  console.log(`  EQUAL: ${CAPS.length} real board-3 dispatch(es) identical (RAM −stack); tune+stamp+continuation confirmed`);
});


/** Broken twin: correct stamp + layout, but writes the WRONG background tune. */
function brokenWrongMusic(m) {
  stamp75mBoardTiles(m);
  m.mem.write8(SND_BGM, 0x09); // BUG: 0x09 is the 50m tune; 75m must be 0x0A
  m.regs.de = 0x3be5;
  loc_0cc6(m);
}

test("TEETH (music): a wrong background tune is CAUGHT at SND_BGM", () => {
  const cap = CAPS[0];
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenWrongMusic(c);
  const d = ramDiffMinusStack(o, c, cap.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong music tune — it is worthless");
  assert.equal(d.addr, SND_BGM, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected SND_BGM ${hx(SND_BGM)})`);
  console.log(`  TEETH(music): wrong tune caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});


/** Broken twin: correct stamp + tune, but points the tail at the 25m table (0x3AE4),
 *  so the shared draw tail walks a DIFFERENT board — the DE live-in is wrong. */
function brokenWrongLayout(m) {
  stamp75mBoardTiles(m);
  m.mem.write8(SND_BGM, 0x0a);
  m.regs.de = 0x3ae4; // BUG: 25m layout table, not the 75m elevator table 0x3BE5
  loc_0cc6(m);
}

test("TEETH (layout/DE): pointing the tail at the wrong layout table is CAUGHT in the drawn tilemap", () => {
  const cap = CAPS[0];
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenWrongLayout(c);
  const d = ramDiffMinusStack(o, c, cap.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong layout pointer — the DE marshalling is untested");
  assert.equal(inStackScratch(d.addr), false, "the caught diff must be game-visible (the wrongly drawn board), not stack scratch");
  console.log(`  TEETH(layout/DE): wrong table caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});

// -- 4. TEETH (tile stamp) ----------------------------------------------------

/** Broken twin: correct tune + layout, but DROPS the elevator tile stamp. */
function brokenSkipStamp(m) {
  // BUG: no stamp75mBoardTiles
  m.mem.write8(SND_BGM, 0x0a);
  m.regs.de = 0x3be5;
  loc_0cc6(m);
}

test("TEETH (stamp): dropping the elevator tile stamp is CAUGHT at the motif cells", () => {
  const cap = CAPS[0];
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenSkipStamp(c);
  const d = ramDiffMinusStack(o, c, cap.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a dropped tile stamp — it is worthless");
  assert.equal(inStackScratch(d.addr), false, "the caught diff must be game-visible (a tilemap cell), not stack scratch");
  console.log(`  TEETH(stamp): dropped stamp caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});
