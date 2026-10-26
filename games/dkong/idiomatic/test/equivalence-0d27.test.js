// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stamp75mBoardTiles (ROM 0x0D27) — "stamp two fixed
 * two-row tile motifs into the background tilemap" during 75m (board 3, elevator)
 * setup. It calls fillTileRowPair (ROM 0x0D30) twice, at HL = 0x770D then 0x760D,
 * laying 68 background-tilemap bytes: 17×0xFD then 17×0xFC below it, for each of the
 * two motifs.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES video RAM (via its callee), so every case uses
 * a FRESH clone per side. The oracle runs on one clone, stamp75mBoardTiles on another,
 * and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) only.
 *
 * pc and SP are deliberately NOT compared: the oracle models the CALL/RET with
 * push16/step/ret (pc→target, SP moved, the return address left in the dead stack), the
 * plumbing the direct-call layer replaces with a JS return. The oracle's push of its
 * return address lands inside STACK_SCRATCH (measured: entry SP = 0x6BEC → write at
 * 0x6BEA/0x6BEB), so it is masked by the contract. HL/DE/B/A and all flags are dead ABI
 * (loc_0cf2 reloads A and DE after the call and never reads HL), so they are neither
 * reproduced nor compared; the whole-machine RAM gate backstops that.
 *
 * REACHABILITY. stamp75mBoardTiles is 75m-only: the elevator-board setup arm loc_0cf2
 * (BOARD(0x6227)==3) is its sole caller (loc_0cd4 only mentions 0x0D27 in a comment).
 * Attract plays 25m, so it NEVER dispatches in a plain run. Following the sanctioned
 * "poke the board state to reach a state for validation", the test forces the real
 * dispatch with an IDENTICAL-BOTH-SIDES board-3 poke at frame 100 (GAME_STATE=3,
 * GAME_SUBSTATE=0x0A board-setup, SUBSTATE_TIMER=1, BOARD=3); loc_0cf2 then runs under
 * the vblank NMI and calls 0x0D27 once (~frame 102), giving a REAL captured entry (real
 * register file, real stack, real garbage HL that the routine ignores).
 *
 * Jobs:
 *   1. EQUAL (real forced dispatch) — oracle vs stamp75mBoardTiles on fresh clones of
 *      the real board-3 entry leave identical RAM (−STACK_SCRATCH).
 *   2. WRITE-SET (captured) — over pre-dirtied destinations, the oracle's only NON-stack
 *      writes are the 68 bytes: 0xFD/0xFC at the two motifs from 0x770D and 0x760D.
 *   3. CRAFTED (fresh-boot + garbage entry) — the routine takes NO input, so instead of
 *      varying an input we prove input-independence: run it on a synthetic fresh-boot
 *      machine that never saw the board-3 poke, and on the captured entry with garbage
 *      registers + far RAM; both stamp the same motif and RAM stays identical.
 *   4. TEETH — (a) a twin that writes a WRONG tile (0xFF) to the first cell (0x770D) and
 *      (b) a twin that OMITS the second motif (0x760D) MUST both be caught, naming the
 *      offending cell.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0d27.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0d27 as oracle } from "../../translated/loc_0d27.js";
import { stamp75mBoardTiles } from "../stamp75mBoardTiles.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0d27;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * dumpState() returns a fresh array per call, so the dead-stack bytes are neutralised by
 * copying them across before the single diff — masking, not an advancing sub-scan. (The
 * advancing-`from` idiom used elsewhere is only correct for a lone stack diff; sub_0d27's
 * push16 leaves TWO adjacent stack bytes, which that idiom oscillates on.)
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

/** The 34 cells one motif stamps from HL: 0xFD at HL..HL+0x10, 0xFC at HL+0x20..HL+0x30. */
function motifWrites(hl, w) {
  for (let i = 0; i < 0x11; i++) w.set((hl + i) & 0xffff, 0xfd);
  const second = (hl + 0x20) & 0xffff;
  for (let i = 0; i < 0x11; i++) w.set((second + i) & 0xffff, 0xfc);
}

/** The full 68-cell write set: the motif from 0x770D and the motif from 0x760D. */
function expectedWrites() {
  const w = new Map();
  motifWrites(0x770d, w);
  motifWrites(0x760d, w);
  return w;
}

// Identical-both-sides one-shot poke that forces 75m (BOARD==3) board setup, whose
// elevator arm loc_0cf2 calls 0x0D27 once. dur 1 so the game manages state from f101.
const POKE_FRAME = 100;
const FORCE_0D27_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 0x0A -> board setup
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
  { addr: 0x6227, val: 0x03, frame: POKE_FRAME, dur: 1 }, // BOARD = 3 (75m elevator -> loc_0cf2)
];
const FRAMES = 140; // the forced dispatch lands ~frame 102

/**
 * Force the real dispatch of 0x0D27 via the board-3 poke and clone the machine at each
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
  host.pokes = FORCE_0D27_POKE.map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(4) : [];

// -- 1. EQUAL (real forced dispatch) ------------------------------------------

test("EQUAL: real forced board-3 dispatch — stamp75mBoardTiles == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 1, `expected the real 0x0D27 dispatch on board 3; got ${CAPS.length}`);

  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    stamp75mBoardTiles(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL: ${CAPS.length} real board-3 dispatch(es) identical (RAM −stack)`);
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle's only non-stack writes are the 68 motif bytes", () => {
  const want = expectedWrites();

  // Pre-dirty every destination to 0xAA so each of the 68 writes registers as a change.
  const m = CAPS[0].clone();
  for (const addr of want.keys()) m.mem.write8(addr, 0xaa);
  const before = m.dumpState();
  const dead = deadStackBelow(STACK_SCRATCH, m.regs.sp);
  oracle(m);
  const after = m.dumpState();

  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] === after[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (dead(addr)) continue; // the oracle's return-address push — dead scratch
    changed.push({ addr, from: before[off], to: after[off] });
  }
  assert.equal(changed.length, 68, `expected 68 changed non-stack bytes, got ${changed.length}`);
  for (const ch of changed) {
    assert.ok(want.has(ch.addr), `oracle wrote unexpected addr ${hx(ch.addr)} (${ch.from}->${ch.to})`);
    assert.equal(ch.to, want.get(ch.addr), `wrong value ${hx(ch.to)} at ${hx(ch.addr)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} tilemap bytes — 0xFD/0xFC motifs from 0x770D and 0x760D`);
});

// -- 3. CRAFTED (fresh-boot + garbage entry, input-independence) --------------

test("CRAFTED: fresh-boot machine (never saw the poke) — both stamp the motif, RAM identical", () => {
  const want = expectedWrites();
  const base = new Machine(ROM).clone(); // power-on state, frame machinery neutralised
  const o = base.clone();
  const c = base.clone();
  // Give the oracle a valid stack so its push/ret stays in work RAM, and dirty every
  // destination, identically on both sides.
  for (const mm of [o, c]) {
    mm.regs.sp = 0x6bfe;
    for (const addr of want.keys()) mm.mem.write8(addr, 0xaa);
  }
  oracle(o);
  stamp75mBoardTiles(c);

  const d = ramDiffMinusStack(o, c, 0x6bfe);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  // ...and the idiomatic side genuinely stamped the motif over the dirt (not merely agreed).
  for (const [addr, val] of want) {
    assert.equal(c.mem.read8(addr), val, `idiomatic left ${hx(addr)} = ${hx(c.mem.read8(addr))} (expected ${hx(val)})`);
  }
  console.log("  CRAFTED: fresh-boot machine — both stamp 0xFD/0xFC over dirt, RAM identical");
});

test("CRAFTED: garbage registers + far RAM identical both sides — output unchanged", () => {
  const want = expectedWrites();
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  // Identical unrelated nudge on both sides: garbage register file (incl. HL, which the
  // routine sets internally and never reads as input) and a far work-RAM byte.
  for (const mm of [o, c]) {
    mm.regs.a = 0x11; mm.regs.b = 0x22; mm.regs.c = 0x33;
    mm.regs.de = 0x4455; mm.regs.hl = 0x8899;
    mm.mem.write8(0x6300, 0x99); // work-RAM byte outside the write set
    for (const addr of want.keys()) mm.mem.write8(addr, 0xaa);
  }
  oracle(o);
  stamp75mBoardTiles(c);

  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  for (const [addr, val] of want) {
    assert.equal(c.mem.read8(addr), val, `idiomatic left ${hx(addr)} = ${hx(c.mem.read8(addr))} (expected ${hx(val)})`);
  }
  console.log("  CRAFTED: garbage registers (incl. HL) + far RAM identical both sides -> output unchanged");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: stamps correctly, then corrupts the very first cell (0x770D). */
function brokenWrongFirstCell(m) {
  stamp75mBoardTiles(m);
  m.mem.write8(0x770d, 0xff); // BUG: 0x770D must hold 0xFD
}

/** Broken twin: only stamps the first motif (0x770D), OMITTING the second (0x760D). */
function brokenOmitSecondMotif(m) {
  m.regs.hl = 0x770d;
  // deliberately only one motif — the 0x760D pass is missing.
  // (import-free: replicate the single first stamp via the real callee path)
  stamp75mBoardTilesFirstOnly(m);
}

// A one-motif stand-in used only by the omit teeth: stamps just the 0x770D pair by
// re-driving the routine but rewriting the second cell back to its captured value.
function stamp75mBoardTilesFirstOnly(m) {
  const want = new Map();
  motifWrites(0x760d, want);
  const saved = new Map();
  for (const addr of want.keys()) saved.set(addr, m.mem.read8(addr));
  stamp75mBoardTiles(m);
  for (const [addr, v] of saved) m.mem.write8(addr, v); // undo the second motif
}

test("TEETH: a wrong tile at the first cell (0x770D) is CAUGHT and names that cell", () => {
  const cap = CAPS[0];
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenWrongFirstCell(c);
  const d = ramDiffMinusStack(o, c, cap.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tile store — it is worthless");
  assert.equal(d.addr, 0x770d, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected 0x770d)`);
  console.log(`  TEETH(a): wrong first-cell store caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});

test("TEETH: omitting the second motif (0x760D) is CAUGHT and names that cell", () => {
  // Dirty the destinations so the missing second motif is a guaranteed, deterministic diff.
  const want = expectedWrites();
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  for (const mm of [o, c]) for (const addr of want.keys()) mm.mem.write8(addr, 0xaa);
  oracle(o);
  brokenOmitSecondMotif(c);
  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch the omitted second motif — it is worthless");
  assert.equal(d.addr, 0x760d, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected 0x760d)`);
  console.log(`  TEETH(b): omitted second motif caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});
