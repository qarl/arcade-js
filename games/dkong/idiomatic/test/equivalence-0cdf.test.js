// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for loc_0cdf (ROM 0x0CDF) — the 50m (board 2, conveyors)
 * board-setup arm. It selects the 50m colour/palette bank (the two ls259 palette-bank
 * output latches -> 01: 0x7d86 = 1, 0x7d87 = 0), selects the 50m background tune
 * (SND_BGM = 0x09), points DE at the 50m conveyor layout table (ROM 0x3B5D), and runs
 * the shared draw + setup tail loc_0cc6 (ROM 0x0CC6).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the
 * retired strict whole-machine one. The arm WRITES memory through the tail and the setup
 * continuation carries state, so every case uses a FRESH clone per side and the two are
 * compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP), PLUS the palette-bank output latch.
 *
 * The palette-bank latch is I/O device state (io.paletteBank), NOT part of dumpState
 * (work + sprite + video RAM only) — the display reads it to pick its colour set. It is
 * checked directly, alongside the RAM diff, so the arm's palette-bank job is not blind.
 *
 * pc and SP are deliberately NOT compared: the oracle models its CALL/RET brackets with
 * push16/step/ret (return addresses left in the dead stack region), the plumbing the
 * direct-call layer replaces with a JS return. Those pushes land inside STACK_SCRATCH, so
 * they are masked by the contract. A/HL and all flags are dead ABI: loc_0c92 (the caller)
 * reads no return value. DE is set only as a live-IN handed to the tail, not a live-out of
 * this arm.
 *
 * REACHABILITY. loc_0cdf is 50m-only: loc_0c92 branches to it exactly when BOARD == 2.
 * Attract plays 25m, so it NEVER dispatches in a plain run. Following the sanctioned
 * "poke the board state to reach a state for validation", the test forces the real
 * dispatch with an IDENTICAL-BOTH-SIDES board-2 poke at frame 100 (GAME_STATE=3,
 * GAME_SUBSTATE=0x0A board-setup, SUBSTATE_TIMER=1, BOARD=2); loc_0c92 then m.call's
 * 0x0CDF once (~frame 102) under the vblank NMI, giving a REAL captured entry (real
 * register file, real stack).
 *
 * Jobs:
 *   1. EQUAL (real forced dispatch) — oracle vs loc_0cdf on fresh clones of the real
 *      board-2 entry leave identical RAM (−STACK_SCRATCH) and identical palette bank.
 *      Both entry clones are pre-seeded with a distinct sentinel palette bank so the
 *      match at bank 1 proves the latch writes actually happened (not an unchanged byte).
 *      Non-vacuous: the oracle side shows the whole chain ran — SND_BGM = 0x09, palette
 *      bank = 1, and the setup continuation armed SUBSTATE_TIMER = 0x40. The dead stack
 *      traffic is proven load-bearing to the mask (stackDiffs > 0), and entry SP sits in
 *      STACK_SCRATCH so the exclusion is sound.
 *   2. TEETH (music) — a twin that writes the WRONG tune (0x0A) MUST be caught at SND_BGM.
 *   3. TEETH (palette) — a twin that DROPS the palette-bank latch writes leaves the
 *      sentinel bank in place; MUST be caught at the palette-bank latch. This proves the
 *      latch writes are load-bearing (they are invisible to the RAM diff).
 *   4. TEETH (layout/DE) — a twin that points DE at the 75m table (0x3BE5) draws a
 *      DIFFERENT board; MUST be caught in the drawn tilemap. This proves the DE live-in
 *      marshalling is load-bearing.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0cdf.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0cdf as oracle } from "../../translated/loc_0cdf.js";
import { setup50mConveyorBoard as idiomatic } from "../setup50mConveyorBoard.js";
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

const TARGET = 0x0cdf;
const PALETTE_50M = 0x01; // 0x7d86 -> 1 (bit0), 0x7d87 -> 0 (bit1)
const PALETTE_SENTINEL = 0x02; // a distinct entry bank so a dropped latch write shows up
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

// Identical-both-sides one-shot poke that forces 50m (BOARD==2) board setup, whose arm
// loc_0cdf the board-build dispatch (loc_0c92) calls. dur 1 so the game manages state
// from f101 onward.
const POKE_FRAME = 100;
const FORCE_0CDF_POKE = [
  { addr: GAME_STATE, val: 0x03, frame: POKE_FRAME, dur: 1 },     // in-game dispatch
  { addr: GAME_SUBSTATE, val: 0x0a, frame: POKE_FRAME, dur: 1 },  // 0x0A -> board setup
  { addr: SUBSTATE_TIMER, val: 0x01, frame: POKE_FRAME, dur: 1 }, // proceeds this frame
  { addr: BOARD, val: 0x02, frame: POKE_FRAME, dur: 1 },          // 50m conveyor -> loc_0cdf
];
const FRAMES = 140; // the forced dispatch lands ~frame 102

function captureDispatches(K) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = FORCE_0CDF_POKE.map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(4) : [];


test("EQUAL: real forced board-2 dispatch — loc_0cdf == oracle in RAM (−stack) and palette bank", () => {
  assert.ok(CAPS.length >= 1, `expected the real 0x0CDF dispatch on board 2; got ${CAPS.length}`);

  for (const cap of CAPS) {
    assert.equal(cap.mem.read8(BOARD), 2, "the forced dispatch must be the 50m board build (BOARD == 2)");
    assert.ok(inStackScratch(cap.regs.sp), `entry SP must sit in STACK_SCRATCH for the exclusion to be sound (SP=${hx(cap.regs.sp)})`);

    const o = cap.clone();
    const c = cap.clone();
    o.io.paletteBank = PALETTE_SENTINEL;
    c.io.paletteBank = PALETTE_SENTINEL;
    oracle(o);
    idiomatic(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
    assert.equal(o.io.paletteBank, c.io.paletteBank, "palette bank must match the oracle");

    // Non-vacuous: the oracle side shows the whole arm+tail chain executed.
    assert.equal(o.mem.read8(SND_BGM), 0x09, "oracle must select the 50m tune (SND_BGM = 0x09)");
    assert.equal(o.io.paletteBank, PALETTE_50M, "oracle must select the 50m palette bank (= 1)");
    assert.equal(o.mem.read8(SUBSTATE_TIMER), 0x40, "oracle's setup continuation must arm SUBSTATE_TIMER = 0x40");
    // ...and the idiomatic side genuinely reproduced them, not merely agreed on unchanged bytes.
    assert.equal(c.mem.read8(SND_BGM), 0x09, "idiomatic must select the 50m tune (SND_BGM = 0x09)");
    assert.equal(c.io.paletteBank, PALETTE_50M, "idiomatic must select the 50m palette bank (= 1)");
    assert.ok(stackDiffCount(o, c, cap.regs.sp) > 0, "the oracle's stack traffic must differ (so the STACK_SCRATCH mask is load-bearing)");
  }
  console.log(`  EQUAL: ${CAPS.length} real board-2 dispatch(es) identical (RAM −stack + palette bank); tune+bank+continuation confirmed`);
});


/** Broken twin: correct palette + layout, but writes the WRONG background tune. */
function brokenWrongMusic(m) {
  m.mem.write8(0x7d86, 0x01);
  m.mem.write8(0x7d87, 0x00);
  m.mem.write8(SND_BGM, 0x0a); // BUG: 0x0A is the 75m tune; 50m must be 0x09
  m.regs.de = 0x3b5d;
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


/** Broken twin: correct tune + layout, but DROPS the palette-bank latch writes, so the
 *  entry sentinel bank survives instead of being set to the 50m bank. */
function brokenSkipPalette(m) {
  // BUG: no palette-bank latch writes
  m.mem.write8(SND_BGM, 0x09);
  m.regs.de = 0x3b5d;
  loc_0cc6(m);
}

test("TEETH (palette): dropping the palette-bank latch writes is CAUGHT at the palette bank", () => {
  const cap = CAPS[0];
  const o = cap.clone();
  const c = cap.clone();
  o.io.paletteBank = PALETTE_SENTINEL;
  c.io.paletteBank = PALETTE_SENTINEL;
  oracle(o);
  brokenSkipPalette(c);
  assert.notEqual(o.io.paletteBank, c.io.paletteBank, "the gate FAILED to catch a dropped palette-bank write — it is worthless");
  assert.equal(o.io.paletteBank, PALETTE_50M, "oracle must set the 50m palette bank");
  assert.equal(c.io.paletteBank, PALETTE_SENTINEL, "the twin (no latch write) must leave the sentinel bank");
  console.log(`  TEETH(palette): dropped bank caught (oracle=${hx(o.io.paletteBank)} broken=${hx(c.io.paletteBank)})`);
});


/** Broken twin: correct palette + tune, but points the tail at the 75m table (0x3BE5),
 *  so the shared draw tail walks a DIFFERENT board — the DE live-in is wrong. */
function brokenWrongLayout(m) {
  m.mem.write8(0x7d86, 0x01);
  m.mem.write8(0x7d87, 0x00);
  m.mem.write8(SND_BGM, 0x09);
  m.regs.de = 0x3be5; // BUG: 75m elevator table, not the 50m conveyor table 0x3B5D
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
