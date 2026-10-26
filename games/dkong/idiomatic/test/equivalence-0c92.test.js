// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for loc_0c92 (ROM 0x0C92) — the board builder: wipe the
 * playfield + sprite shadow buffer, reset the bonus readout BONUS_DISPLAY, post the opening deferred
 * task (opcode 5, argument 1), select palette bank 2 (0x7d86 -> 0, 0x7d87 -> 1), then
 * dispatch on BOARD to the per-board setup arm (25m/50m/75m, or the inline 100m-rivet
 * fall-through which raises palette bit0 to bank 3 and queues SND_BGM = 0x0B).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the
 * retired strict whole-machine one. The routine WRITES memory through its callees and the
 * setup continuation carries state, so every case uses a FRESH clone per side and the two
 * are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP), PLUS the palette-bank output latch.
 *
 * The palette-bank latch is I/O device state (io.paletteBank), NOT part of dumpState
 * (work + sprite + video RAM only) — the display reads it to pick its colour set. It is
 * checked directly, alongside the RAM diff, so the routine's palette-bank job is not blind.
 *
 * pc and SP are deliberately NOT compared: the oracle models its CALL/RET brackets with
 * push16/step/ret (return addresses left in the dead stack region), the plumbing the
 * direct-call layer replaces with a JS return. Those pushes land inside STACK_SCRATCH, so
 * they are masked by the contract. A/HL and all flags are dead ABI: the caller reads no
 * return value. DE is set only as a live-IN (to enqueueTask and to the shared tail).
 *
 * REACHABILITY. Attract only ever builds the 25m board, so BOARD == 1 is a REAL captured
 * attract dispatch (unpoked). The 50m/75m/100m arms are 50m+ only, so they never dispatch
 * in a plain run; following the sanctioned "poke the board state to reach a state for
 * validation", the test forces each with an IDENTICAL-BOTH-SIDES board poke at frame 100
 * (GAME_STATE=3, GAME_SUBSTATE=0x0A board-setup, SUBSTATE_TIMER=1, BOARD=2/3/4); loc_0c92
 * then dispatches once under the vblank service with the real board, giving a REAL captured
 * entry (real register file, real stack).
 *
 * Jobs:
 *   1. EQUAL — for every board 1..4, oracle vs loc_0c92 on fresh clones of the real entry
 *      leave identical RAM (−STACK_SCRATCH) and identical palette bank. Both clones are
 *      pre-seeded with a distinct sentinel palette bank AND a sentinel BONUS_DISPLAY, so
 *      the match proves the writes actually happened (not unchanged bytes). Non-vacuous:
 *      the oracle side shows the whole chain ran (BONUS_DISPLAY cleared, SND_BGM + palette bank
 *      at the board's values), and the idiomatic side genuinely reproduced them. The dead
 *      stack traffic is proven load-bearing to the mask (stackDiffs > 0), and entry SP sits
 *      in STACK_SCRATCH so the exclusion is sound.
 *   2. TEETH (palette) — a twin that DROPS the two palette-bank writes leaves the sentinel
 *      bank; MUST be caught at the palette-bank latch. Proves the latch writes are load-
 *      bearing (they are invisible to the RAM diff).
 *   3. TEETH (dispatch) — a twin that mis-routes a board-1 entry to the 50m arm draws a
 *      DIFFERENT board and queues the wrong tune; MUST be caught in RAM at SND_BGM.
 *   4. TEETH (rivet tune) — a twin that queues the wrong background tune on the 100m-rivet
 *      arm (0x0A instead of 0x0B) MUST be caught at SND_BGM.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0c92.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0c92 as oracle } from "../../translated/loc_0c92.js";
import { buildBoard as idiomatic } from "../buildBoard.js";
import { clearPlayfieldAndSprites } from "../clearPlayfieldAndSprites.js";
import { enqueueTask } from "../enqueueTask.js";
import { setup25mGirderBoard } from "../setup25mGirderBoard.js";
import { setup50mConveyorBoard } from "../setup50mConveyorBoard.js";
import { stampRivetBoardBands } from "../stampRivetBoardBands.js";
import { loc_0cc6 } from "../loc_0cc6.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  BOARD,
  SND_BGM,
  BONUS_DISPLAY,
  GAME_STATE,
  GAME_SUBSTATE,
  SUBSTATE_TIMER,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0c92;
const PALETTE_SENTINEL = 0x00;      // a distinct entry bank so a dropped latch write shows up
const SCRATCH_SENTINEL = 0xab;      // a distinct entry value in BONUS_DISPLAY so the reset write shows up
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// What loc_0c92 leaves for each board: the final palette bank and the background tune.
const EXPECTED = {
  1: { bank: 2, bgm: 0x08 }, // 25m — arm leaves loc_0c92's bank 2
  2: { bank: 1, bgm: 0x09 }, // 50m — arm overrides to bank 1
  3: { bank: 2, bgm: 0x0a }, // 75m — arm leaves loc_0c92's bank 2
  4: { bank: 3, bgm: 0x0b }, // 100m rivet — arm raises bit0 to bank 3
};

const inStackScratch = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

/**
 * First RAM difference between two machines on the go-forward contract: the whole state
 * dump minus the stack scratch below the entry SP (dead scratch — the oracle pushes return addresses
 * there while the direct-call idiomatic side does not). Returns {addr,a,b,offset} or null.
 *
 * dumpState() returns a fresh array per call, so the dead-stack bytes are neutralised by
 * copying them across before the single diff — masking, not an advancing sub-scan.
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

/** How many of the masked-away diffs actually fell in the dead stack region. */
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

/** Capture natural (unpoked) loc_0c92 dispatches during boot/attract — these are board 1. */
function captureNatural(K, frames = 1300) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(frames);
  return caps;
}

/**
 * Force the real dispatch of loc_0c92 on a given board via an identical-both-sides poke and
 * clone the machine at each true entry. The wrapper snapshots the entry, then runs the
 * oracle so the host proceeds. dur 1 so the game manages state from the poke frame onward.
 */
function captureForced(boardVal, K) {
  const POKE_FRAME = 100;
  const FRAMES = 140; // the forced dispatch lands ~frame 102
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = [
    { addr: GAME_STATE, val: 0x03, frame: POKE_FRAME, dur: 1 },
    { addr: GAME_SUBSTATE, val: 0x0a, frame: POKE_FRAME, dur: 1 },
    { addr: SUBSTATE_TIMER, val: 0x01, frame: POKE_FRAME, dur: 1 },
    { addr: BOARD, val: boardVal, frame: POKE_FRAME, dur: 1 },
  ];
  host.runFrames(FRAMES);
  return caps;
}

// Board 1 is real+unpoked (attract builds 25m); 2/3/4 are forced by the board poke.
const CAPS = ROM_PRESENT
  ? { 1: captureNatural(2), 2: captureForced(2, 2), 3: captureForced(3, 2), 4: captureForced(4, 2) }
  : {};

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: loc_0c92 is dispatched building the 25m board during attract", () => {
  assert.ok(CAPS[1].length >= 1, `expected a natural attract dispatch of 0x0C92; got ${CAPS[1].length}`);
  assert.equal(CAPS[1][0].mem.read8(BOARD), 1, "the natural attract build must be the 25m board (BOARD == 1)");
  console.log(`  REACHABILITY: ${CAPS[1].length} natural 25m dispatch(es); forced 50m/75m/100m captured for the other arms`);
});

// -- 1. EQUAL (every board arm) -----------------------------------------------

test("EQUAL: loc_0c92 == oracle in RAM (−stack) and palette bank on every board", () => {
  for (const board of [1, 2, 3, 4]) {
    const caps = CAPS[board];
    assert.ok(caps.length >= 1, `expected a real 0x0C92 dispatch for board ${board}; got ${caps.length}`);
    const { bank, bgm } = EXPECTED[board];

    for (const cap of caps) {
      assert.equal(cap.mem.read8(BOARD), board, `entry must be the board-${board} build`);
      assert.ok(inStackScratch(cap.regs.sp), `entry SP must sit in STACK_SCRATCH for the exclusion to be sound (SP=${hx(cap.regs.sp)})`);

      const o = cap.clone();
      const c = cap.clone();
      // Pre-seed distinct entry state on BOTH sides so a match proves the writes happened.
      o.io.paletteBank = PALETTE_SENTINEL;  c.io.paletteBank = PALETTE_SENTINEL;
      o.mem.write8(BONUS_DISPLAY, SCRATCH_SENTINEL);  c.mem.write8(BONUS_DISPLAY, SCRATCH_SENTINEL);
      oracle(o);
      idiomatic(c);

      const d = ramDiffMinusStack(o, c, cap.regs.sp);
      assert.equal(d, null, d && `board ${board}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
      assert.equal(o.io.paletteBank, c.io.paletteBank, `board ${board}: palette bank must match the oracle`);

      // Non-vacuous: the oracle side shows the whole prologue+arm chain executed...
      assert.equal(o.mem.read8(BONUS_DISPLAY), 0, `board ${board}: oracle must reset BONUS_DISPLAY to 0`);
      assert.equal(o.mem.read8(SND_BGM), bgm, `board ${board}: oracle must queue tune ${hx(bgm)}`);
      assert.equal(o.io.paletteBank, bank, `board ${board}: oracle must select palette bank ${bank}`);
      // ...and the idiomatic side genuinely reproduced them, not merely agreed on unchanged bytes.
      assert.equal(c.mem.read8(BONUS_DISPLAY), 0, `board ${board}: idiomatic must reset BONUS_DISPLAY to 0`);
      assert.equal(c.mem.read8(SND_BGM), bgm, `board ${board}: idiomatic must queue tune ${hx(bgm)}`);
      assert.equal(c.io.paletteBank, bank, `board ${board}: idiomatic must select palette bank ${bank}`);
      assert.ok(stackDiffCount(o, c, cap.regs.sp) > 0, `board ${board}: the oracle's stack traffic must differ (so the STACK_SCRATCH mask is load-bearing)`);
    }
    console.log(`  EQUAL board ${board}: ${caps.length} real dispatch(es) identical (RAM −stack + bank=${bank}, tune=${hx(bgm)})`);
  }
});

// -- 2. TEETH (palette bank) --------------------------------------------------

/** Broken twin: correct everything EXCEPT it DROPS the two palette-bank writes, so the
 *  entry sentinel bank survives instead of being set to bank 2. Runs the board-1 arm. */
function brokenDropPalette(m) {
  const { regs, mem } = m;
  clearPlayfieldAndSprites(m);
  mem.write8(BONUS_DISPLAY, 0);
  regs.de = 0x0501;
  enqueueTask(m);
  // BUG: no palette-bank latch writes
  setup25mGirderBoard(m); // board-1 entry
}

test("TEETH (palette): dropping the palette-bank writes is CAUGHT at the palette bank", () => {
  const cap = CAPS[1][0];
  const o = cap.clone();
  const c = cap.clone();
  o.io.paletteBank = PALETTE_SENTINEL;
  c.io.paletteBank = PALETTE_SENTINEL;
  oracle(o);
  brokenDropPalette(c);
  // The RAM diff is blind to the latch (io state), so this teeth is on the bank directly.
  assert.notEqual(o.io.paletteBank, c.io.paletteBank, "the gate FAILED to catch a dropped palette-bank write — it is worthless");
  assert.equal(o.io.paletteBank, EXPECTED[1].bank, "oracle must set palette bank 2");
  assert.equal(c.io.paletteBank, PALETTE_SENTINEL, "the twin (no latch write) must leave the sentinel bank");
  console.log(`  TEETH(palette): dropped bank caught (oracle=${o.io.paletteBank} broken=${c.io.paletteBank})`);
});

// -- 3. TEETH (board dispatch) ------------------------------------------------

/** Broken twin: correct prologue, but mis-routes a board-1 entry to the 50m arm, so it
 *  draws the wrong board and queues the wrong tune (0x09 vs 0x08). */
function brokenWrongArm(m) {
  const { regs, mem } = m;
  clearPlayfieldAndSprites(m);
  mem.write8(BONUS_DISPLAY, 0);
  regs.de = 0x0501;
  enqueueTask(m);
  mem.write8(0x7d86, 0);
  mem.write8(0x7d87, 1);
  setup50mConveyorBoard(m); // BUG: board 1 must route to setup25mGirderBoard
}

test("TEETH (dispatch): mis-routing the board-1 entry to the 50m arm is CAUGHT at SND_BGM", () => {
  const cap = CAPS[1][0];
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenWrongArm(c);
  const d = ramDiffMinusStack(o, c, cap.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-routed board arm — it is worthless");
  assert.equal(d.addr, SND_BGM, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected SND_BGM ${hx(SND_BGM)})`);
  console.log(`  TEETH(dispatch): wrong arm caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});

// -- 4. TEETH (rivet tune) ----------------------------------------------------

/** Broken twin: correct 100m-rivet arm EXCEPT it queues the wrong background tune. */
function brokenRivetTune(m) {
  const { regs, mem } = m;
  clearPlayfieldAndSprites(m);
  mem.write8(BONUS_DISPLAY, 0);
  regs.de = 0x0501;
  enqueueTask(m);
  mem.write8(0x7d86, 0);
  mem.write8(0x7d87, 1);
  stampRivetBoardBands(m);
  mem.write8(0x7d86, 1);
  mem.write8(SND_BGM, 0x0a); // BUG: the rivet tune is 0x0B, not 0x0A (the 75m tune)
  regs.de = 0x3c8b;
  loc_0cc6(m);
}

test("TEETH (rivet tune): a wrong 100m background tune is CAUGHT at SND_BGM", () => {
  const cap = CAPS[4][0];
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenRivetTune(c);
  const d = ramDiffMinusStack(o, c, cap.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong rivet tune — it is worthless");
  assert.equal(d.addr, SND_BGM, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected SND_BGM ${hx(SND_BGM)})`);
  console.log(`  TEETH(rivet tune): wrong tune caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});
