// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stampRivetBoardTiles (ROM 0x0D00) — "stamp the 100m
 * rivet-board decoration": walk the eight little-endian pointers in the ROM table at
 * 0x0D17 and write the fixed tile codes 0xB8 then 0xB7 into each destination cell pair
 * (0x76CA/0x76CF/0x76D4/0x76D9 then 0x752A/0x752F/0x7534/0x7539).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES video RAM, so every case uses a FRESH clone
 * per side. The oracle runs on one clone, stampRivetBoardTiles on another, and they
 * are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) only.
 *
 * pc and SP are deliberately NOT compared. The oracle uses m.step + m.ret, so it
 * advances pc to the return target 0x0CD1 and pops SP+2; both are the modelled
 * step/stack ABI the direct-call layer replaces with a JS return — comparing them
 * would test the control-flow model we drop, not the routine. Memory (the 16
 * video-RAM bytes) is the only live-out: loc_0cc6's next act after `call z,0x0D00` is
 * `jp 0x3FA0`, with no flag branch and no read of any register this leaves.
 *
 * REACHABILITY. stampRivetBoardTiles is board-4-only (loc_0cc6's `call z,0x0D00`
 * guarded by BOARD(0x6227)==4) and attract only plays 25m, so it NEVER dispatches in
 * a plain run. Following the optimized-era gate, the test forces one real dispatch
 * with an IDENTICAL-BOTH-SIDES board poke (Karl-sanctioned "poke the board state to
 * reach a state for validation"): at frame 100 set GAME_STATE=3, GAME_SUBSTATE=10
 * (board setup), SUBSTATE_TIMER=1, BOARD=4 (100m rivet). The board-4 setup arm then
 * runs under the vblank NMI and its `call z,0x0D00` fires the routine once (~frame
 * 102), giving a REAL captured entry (real register file, real stack, real board).
 *
 * Jobs:
 *   1. EQUAL (real forced dispatch) — oracle vs stampRivetBoardTiles on fresh clones
 *      of the captured entry leave identical RAM (−STACK_SCRATCH).
 *   2. WRITE-SET (captured) — the oracle's ONLY writes are the 16 bytes at the 8 table
 *      destinations: 0xB8 at each dest, 0xB7 at dest+1. Documents the exact footprint.
 *   3. CRAFTED (overwrites dirty cells + input-independence) — pre-dirty all 16
 *      destination bytes to 0xAA identically on both sides and confirm both stamp
 *      0xB8/0xB7; and poke unrelated entry state (registers + far RAM) identically to
 *      show the constant output does not depend on it. The straight-line, input-
 *      independent shape means one path — these craft the prior contents, not an arm.
 *   4. TEETH — a twin that writes a WRONG value (0xFF) to the first destination
 *      (0x76CA) MUST be caught, naming 0x76CA, on both a captured and a crafted state.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0d00.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0d00 as oracle } from "../../translated/loc_0d00.js";
import { stampRivetBoardTiles } from "../stampRivetBoardTiles.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0d00;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The eight destination cell pairs the routine stamps (table 0x0D17 decoded), each
// getting 0xB8 at dest and 0xB7 at dest+1 — 16 video-RAM bytes total.
const DESTS = [0x76ca, 0x76cf, 0x76d4, 0x76d9, 0x752a, 0x752f, 0x7534, 0x7539];
const FIRST_TILE = DESTS[0]; // 0x76CA — the teeth target

/**
 * First RAM difference between two machines on the go-forward contract: the whole
 * state dump minus the stack scratch below the entry SP (dead scratch — masked per the contract).
 * Returns {addr,a,b,offset} or null.
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  let d = firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off));
  let from = 0;
  while (d && dead(d.addr)) {
    from = d.offset + 1;
    d = firstStateDiff(a.subarray(from), b.subarray(from), (off) => ma.stateOffsetToAddr(off + from));
  }
  return d;
}

// Identical-both-sides one-shot poke that forces board-4 (100m rivet) setup, whose
// `call z,0x0D00` fires the routine. dur 1 so the game manages state from frame 101.
const POKE_FRAME = 100;
const FORCE_0D00_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> board setup
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
  { addr: 0x6227, val: 0x04, frame: POKE_FRAME, dur: 1 }, // BOARD = 4 (100m rivet -> call z,0x0D00)
];
const FRAMES = 110; // the forced dispatch lands ~frame 102

/**
 * Force one real dispatch of 0x0D00 via the board-4 poke and clone the machine at up
 * to K true entries. The wrapper snapshots the entry state, then runs the oracle so
 * the host proceeds. A fresh copy of the poke per machine keeps runs independent.
 */
function captureDispatches(K) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = FORCE_0D00_POKE.map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(8) : [];

// -- 1. EQUAL (real forced dispatch) ------------------------------------------

test("EQUAL: real forced board-4 dispatch — stampRivetBoardTiles == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x0D00 dispatch after the board-4 poke");

  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    stampRivetBoardTiles(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  }
  console.log(`  EQUAL: ${CAPS.length} real board-4 dispatch(es) identical (RAM −stack)`);
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle's only writes are 0xB8 at each dest and 0xB7 at dest+1", () => {
  const cap = CAPS[0];
  const before = cap.clone();
  const after = cap.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  // Exactly the 16 expected bytes, at the exact addresses, with the exact values.
  const want = new Map();
  for (const d of DESTS) {
    want.set(d, 0xb8);
    want.set((d + 1) & 0xffff, 0xb7);
  }
  assert.equal(changed.length, 16, `expected 16 changed bytes, got ${changed.length}`);
  for (const ch of changed) {
    assert.ok(want.has(ch.addr), `oracle wrote unexpected addr ${hx(ch.addr)} (${ch.from}->${ch.to})`);
    assert.equal(ch.to, want.get(ch.addr), `wrong value ${hx(ch.to)} at ${hx(ch.addr)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} video-RAM bytes changed — 0xB8/0xB7 at the 8 table dests`);
});

// -- 3. CRAFTED (overwrites dirty cells + input-independence) -----------------

test("CRAFTED: pre-dirtied destination cells are overwritten identically by both sides", () => {
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  // Identical surgical nudge on BOTH sides: dirty every destination byte to 0xAA.
  for (const d of DESTS) {
    o.mem.write8(d, 0xaa); o.mem.write8((d + 1) & 0xffff, 0xaa);
    c.mem.write8(d, 0xaa); c.mem.write8((d + 1) & 0xffff, 0xaa);
  }
  oracle(o);
  stampRivetBoardTiles(c);

  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  // ...and both genuinely stamped the motif over the dirt (not merely agreed).
  for (const dest of DESTS) {
    assert.equal(c.mem.read8(dest), 0xb8, `stamp left ${hx(dest)} = ${hx(c.mem.read8(dest))} (expected 0xB8)`);
    assert.equal(c.mem.read8((dest + 1) & 0xffff), 0xb7, `stamp left ${hx(dest + 1)} = ${hx(c.mem.read8(dest + 1))} (expected 0xB7)`);
  }
  console.log("  CRAFTED: 16 destination bytes dirtied to 0xAA -> both stamp 0xB8/0xB7, RAM identical");
});

test("CRAFTED: unrelated entry state (registers + far RAM) does not change the output", () => {
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  // Identical unrelated nudge on both sides: garbage in the register file and in RAM
  // the routine never touches. Output must stay constant (input-independence).
  for (const mm of [o, c]) {
    mm.regs.a = 0x11; mm.regs.b = 0x22; mm.regs.c = 0x33;
    mm.regs.d = 0x44; mm.regs.e = 0x55; mm.regs.hl = 0x1234;
    mm.mem.write8(0x6300, 0x99); // a work-RAM byte outside the write set
  }
  oracle(o);
  stampRivetBoardTiles(c);

  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  for (const dest of DESTS) {
    assert.equal(c.mem.read8(dest), 0xb8, `stamp left ${hx(dest)} = ${hx(c.mem.read8(dest))} (expected 0xB8)`);
    assert.equal(c.mem.read8((dest + 1) & 0xffff), 0xb7, `stamp left ${hx(dest + 1)} = ${hx(c.mem.read8(dest + 1))} (expected 0xB7)`);
  }
  console.log("  CRAFTED: garbage registers + far RAM identical both sides -> output unchanged");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: writes a WRONG value (0xFF) to the first destination (0x76CA). */
function brokenStamp(m) {
  stampRivetBoardTiles(m);
  m.mem.write8(FIRST_TILE, 0xff); // BUG: FIRST_TILE must hold 0xB8
}

test("TEETH: a wrong tile value at 0x76CA is CAUGHT and names 0x76CA", () => {
  // Captured state.
  const cap = CAPS[0];
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenStamp(c);
  const d = ramDiffMinusStack(o, c, cap.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tile store — it is worthless");
  assert.equal(d.addr, FIRST_TILE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);

  // Crafted dirtied state too (must be caught regardless of prior contents).
  const o2 = cap.clone();
  const c2 = cap.clone();
  for (const dest of DESTS) {
    o2.mem.write8(dest, 0xaa); o2.mem.write8((dest + 1) & 0xffff, 0xaa);
    c2.mem.write8(dest, 0xaa); c2.mem.write8((dest + 1) & 0xffff, 0xaa);
  }
  oracle(o2);
  brokenStamp(c2);
  const d2 = ramDiffMinusStack(o2, c2, cap.regs.sp);
  assert.notEqual(d2, null, "the gate FAILED to catch the wrong store on the crafted state");
  assert.equal(d2.addr, FIRST_TILE, `crafted teeth caught the wrong address ${hx(d2.addr ?? 0)}`);

  console.log(`  TEETH: wrong 0x76CA store caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});
