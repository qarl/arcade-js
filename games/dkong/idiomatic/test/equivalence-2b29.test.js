// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for probeMarioDescentLanding (ROM 0x2b29) — the board split at the head of the
 * player-vs-tilemap descent probe.
 *
 * Off 25m (BOARD != 1) the whole probe is loc_2b53's two-point form and this routine just
 * returns its result. On 25m it runs a single probe at (MARIO_X, MARIO_Y + 7) through the tile
 * classifier probeTileForLanding and has four outcomes: the classifier landed Mario (its false
 * return, propagated); result code 0, nothing landable, abort via loc_2b51; result code 2 with the
 * probe point four or more past the surface boundary, still too far, abort via loc_2b74 with a
 * zeroed result; or code 2 within three of the boundary — snap MARIO_Y to boundary - 7, report the
 * (1, 1) result, and abort via loc_2b51. true = normal return, false = the two-frame caller-skip
 * unwind past entry_2b1c.
 *
 * STACK MODEL. In the oracle every false path nets one discarded pop plus one return (SP += 4, pc
 * two frames up — loc_2b51 / loc_2b74's pop-hl + ret, loc_2b91's, or the classifier's landed
 * double-skip), and the single true path (loc_2b53's both-probes-clear return) nets one return
 * (SP += 2, pc to the caller). The idiomatic routine models no stack — a boolean return plus direct
 * calls — so runCandidate replays exactly that net op. The dissolved push/pop churn lives in
 * STACK_SCRATCH, excluded by the memory-equivalence contract; every live cell is kept.
 *
 *   1. CAPTURED — 0x2B29 is naturally reached, so real in-distribution states carry most of the
 *      gate: an 8000-frame attract run dispatches it 443x (entry_1c05 -> entry_2b1c -> here) and
 *      the captured entries are replayed oracle-vs-idiomatic on the contract below. Attract plays
 *      25m only, and covers three of the five terminal paths (no-surface abort, too-far abort, the
 *      classifier's landed-unwind); the test asserts that coverage so a change in reachability
 *      cannot silently hollow the section out.
 *
 *   2. CRAFTED — the two paths attract never reaches, plus the threshold itself, on a real attract
 *      base with a surgical poke: BOARD -> 2 for the off-25m arm (both its outcomes, and its
 *      X-snap tail), and the probe tile + descent inputs poked to put the probe point exactly 3
 *      (snap) and exactly 4 (too far) past the boundary, which pins the reach threshold. Each case
 *      asserts RAM (minus the stack scratch below the entry SP) + pc + SP + both live result bytes identical to the
 *      oracle, the same boolean, and an oracle post-condition proving the intended path was taken.
 *
 *   3. TEETH — five deliberately-broken twins, each MUST be caught:
 *      (a) no-unwind-propagate — drops the classifier's landed-unwind propagation and blunders on
 *          into the reach test; caught on the classifier-landed case, where the fall-through then
 *          takes the too-far abort and reports (0, 0) instead of (1, 1).
 *      (b) snap-offset — snaps to boundary - 6 instead of boundary - 7; caught on the snap case.
 *      (c) drop-second-result — omits the second result byte on the snap arm; caught on the snap
 *          case (the consumer past entry_2b1c reads it back).
 *      (d) reach-threshold — lands at a gap of exactly 4 (`>` instead of `>=`); caught on the
 *          too-far case, which sits exactly on the threshold.
 *      (e) board-test — splits on board 2 instead of board 1; caught on the off-25m cases.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b29.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { u8 } from "../../../../core/int.js";
import { loc_2b29 as oracle } from "../../translated/loc_2b29.js";
import { probeMarioDescentLanding } from "../probeMarioDescentLanding.js";
import { loc_2b53 } from "../loc_2b53.js";
import { probeTileForLanding } from "../probeTileForLanding.js";
import { loc_2b51 } from "../loc_2b51.js";
import { loc_2b74 } from "../loc_2b74.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  MARIO_X,
  MARIO_Y,
  MARIO_AIR_PREV_Y,
  MARIO_AIR_VX_HI,
  MARIO_SPRITE_RECORD,
  SPRITE_X,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b29;
const SPRITE_X_ADDR = (MARIO_SPRITE_RECORD + SPRITE_X) & 0xffff; // 0x694c — Mario's sprite record +0 (X)
const IX_BASE = 0x6200; // object pointer -> Mario's block, so ix+5 aliases MARIO_Y (0x6205)
const RET_L0 = 0x2b23;  // probeMarioDescentLanding's own return (entry_2b1c's continuation; the unwind discards it)
const RET_L1 = 0x1c08;  // the grandparent the two-frame unwind lands on
const SP_TOP = 0x6bf8;  // inside STACK_SCRATCH; RET_L0 at 0x6bf8, RET_L1 at 0x6bfa
const POISON_A = 0xaa;  // entry accumulator; overwritten by the board load
const POISON_B = 0x55;  // entry second result byte; every terminal path rewrites it

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// tileAddrForPixel (ROM 0x2FF0), replicated to poke the tile cell under a probe point.
const tileAddr = (y, x) => (0x7400 + (((~y) & 0xff) >> 3) * 32 + ((x >> 3) & 0x1f)) & 0xffff;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead stack
 *  region excluded by contract — the dissolved push/pop/return churn lives there). */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** All non-stack RAM addresses that changed between two machines (for non-vacuity). */
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/** Run the ORACLE on a fresh clone. Its `m.call` reaches the translated classifier / abort-exit
 *  chain, which performs the real pops and returns. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { c, ret };
}

/** Run a candidate on a fresh clone, then replay the net stack op the oracle nets on the path the
 *  candidate took, keyed on the caller-skip (the idiomatic routine uses the JS call stack; it never
 *  touches pc/SP itself):
 *    - skip false (unwind): one discarded pop + one return -> SP += 4, pc two frames up.
 *    - skip true  (normal): one return                     -> SP += 2, pc to the caller. */
// probeMarioDescentLanding (and loc_2b53) now return { skip, verdict } (skip = the old caller-skip
// boolean; verdict = the value the airborne handler branches on, formerly left in A). The frozen
// oracle and the broken twins still return the bare boolean — read either shape uniformly.
const skipOf = (r) => (r && typeof r === "object") ? r.skip : r;
const verdictOf = (r) => (r && typeof r === "object") ? r.verdict : undefined;

function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  if (skipOf(ret) === false) {
    c.pop16(); // discard probeMarioDescentLanding's own return (the unwind's first pop)
    c.ret();   // net return two frames up
  } else {
    c.ret();   // the normal return
  }
  return { c, ret };
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP, and BOTH live
 *  result bytes (the consumer past entry_2b1c decrements the first, then the second). The
 *  coordinate registers and flags are dead ABI. */
function contractDiffs(entry, fn) {
  const { c: o } = runOracle(entry);
  const { c } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=0x${(ram.a & 0xff).toString(16)} cand=0x${(ram.b & 0xff).toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=0x${(o.regs.a & 0xff).toString(16)} cand=0x${(c.regs.a & 0xff).toString(16)}`);
  if (o.regs.b !== c.regs.b) diffs.push(`B oracle=0x${(o.regs.b & 0xff).toString(16)} cand=0x${(c.regs.b & 0xff).toString(16)}`);
  return diffs;
}

// A real booted attract machine, built once and reused as the base for every crafted entry
// (cloned per case, never mutated).
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    assert.equal(host.stoppedBy, null, "attract base run must reach the vblank spin cleanly");
    _base = host.clone();
  }
  return _base;
}

// -- crafted geometry ----------------------------------------------------------
//
// X = 0x50 with a surface tile (0xB0, the "silent" hit band) under the probe cell gives the
// classifier boundary C = ((MARIO_Y + 7) & 0xf8) - 1, so the gap the reach test measures is
// ((MARIO_Y + 7) & 7) + 1. Y_SNAP puts that gap at 3 (snap) and Y_FAR at exactly 4 (too far) —
// the threshold sits between the two cases.
const X = 0x50;
const Y_SNAP = 0x43;                 // gap 3 -> the snap arm
const Y_FAR = 0x44;                  // gap 4 -> the too-far abort (exactly on the threshold)
const BOUNDARY = 0x47;               // ((Y + 7) & 0xf8) - 1, the same for both Y values
const LANDED_Y = u8(BOUNDARY - 7);   // 0x40 — MARIO_Y after a snap or a classifier landing
const SURFACE_TILE = 0xb0;           // lands in the classifier's "silent" hit band
const CLEAR_TILE = 0x00;             // below the surface band -> the classifier rejects
const PREV_Y_CLEAR = 0x50;           // probe stays past the boundary -> result code 2 (still clear)
const PREV_Y_LANDED = 0x10;          // probe at/behind the boundary -> the classifier lands Mario
const SNAPPED_X = u8((X | 0x07) - 4); // 0x53 — the X loc_2b7a commits on the off-25m snap arm

const cell25m = (y) => tileAddr(X, u8(y + 7));              // the 25m arm's single probe cell
const cellOff1 = (y) => tileAddr(u8(X - 3), u8(y + 7));      // loc_2b53's first probe cell
const cellOff2 = (y) => tileAddr(u8(X + 4), u8(y + 7));      // loc_2b53's second probe cell

/** A fresh crafted entry: real attract RAM; the board, Mario's X/Y, the previous-frame airborne Y,
 *  the airborne-velocity high byte and the object pointer poked; the tile under each of the three
 *  probe cells set; the sprite-record X pre-poked to a sentinel so an X commit shows; poisoned
 *  result bytes; and a controlled return stack — RET_L0 (probeMarioDescentLanding's own return) then RET_L1 (the
 *  grandparent) in STACK_SCRATCH. */
function craftEntry({ board, y, tile25m, tileOff1, tileOff2, prevY, vxHi = 0x01 }) {
  const e = base().clone();
  e.nextNmi = Infinity;      // neutralise the frame machinery so the oracle's `m.step`
  e.nextBoundary = Infinity; // cannot fire an NMI or push a frame while running isolated
  e.mem.write8(BOARD, board & 0xff);
  e.mem.write8(MARIO_X, X);
  e.mem.write8(MARIO_Y, y & 0xff);
  e.mem.write8(MARIO_AIR_PREV_Y, prevY & 0xff);
  e.mem.write8(MARIO_AIR_VX_HI, vxHi & 0xff);
  e.mem.write8(SPRITE_X_ADDR, (SNAPPED_X ^ 0xff) & 0xff); // sentinel != the committed X

  // The 25m probe point and loc_2b53's second probe point fall in the same 8-pixel band, so they
  // share a tilemap cell for any X (the two offsets are 7 apart and the 25m point sits between
  // them — no X separates all three). Write the idle arm's cells first and the arm under test's
  // last, then check the cells that matter for this case actually hold their tile.
  const writes = board === 1
    ? [[cellOff1(y), tileOff1], [cellOff2(y), tileOff2], [cell25m(y), tile25m]]
    : [[cell25m(y), tile25m], [cellOff1(y), tileOff1], [cellOff2(y), tileOff2]];
  for (const [addr, tile] of writes) e.mem.write8(addr, tile & 0xff);
  if (board === 1) {
    assert.equal(e.mem.read8(cell25m(y)), tile25m & 0xff, "the 25m probe cell must hold its tile");
  } else {
    assert.equal(e.mem.read8(cellOff1(y)), tileOff1 & 0xff, "loc_2b53's first probe cell must hold its tile");
    assert.equal(e.mem.read8(cellOff2(y)), tileOff2 & 0xff, "loc_2b53's second probe cell must hold its tile");
  }

  e.regs.ix = IX_BASE;
  e.regs.a = POISON_A;
  e.regs.b = POISON_B;
  e.regs.sp = 0x6bfc;
  e.push16(RET_L1); // -> 0x6bfa
  e.push16(RET_L0); // -> 0x6bf8 (probeMarioDescentLanding's own return; SP now SP_TOP)
  assert.equal(e.regs.sp, SP_TOP, "staged SP must be SP_TOP");
  return e;
}

// The terminal paths, each pinned by an oracle post-condition (non-vacuity). `ret` is the
// caller-skip boolean; `a`/`b` are the two live result bytes the consumer past entry_2b1c reads.
const CASES = [
  {
    name: "off-25m both probes clear (the only normal return)",
    opts: { board: 2, y: Y_SNAP, tile25m: CLEAR_TILE, tileOff1: CLEAR_TILE, tileOff2: CLEAR_TILE, prevY: PREV_Y_CLEAR },
    ret: true, a: 0, b: 0,
    check: (o) => o.mem.read8(MARIO_Y) === Y_SNAP && o.mem.read8(MARIO_X) === X,
  },
  {
    name: "off-25m classifier landed",
    opts: { board: 2, y: Y_SNAP, tile25m: CLEAR_TILE, tileOff1: SURFACE_TILE, tileOff2: CLEAR_TILE, prevY: PREV_Y_LANDED },
    ret: false, a: 1, b: 1,
    check: (o) => o.mem.read8(MARIO_Y) === LANDED_Y,
  },
  {
    name: "off-25m X-snap tail",
    opts: { board: 2, y: Y_SNAP, tile25m: CLEAR_TILE, tileOff1: SURFACE_TILE, tileOff2: CLEAR_TILE, prevY: PREV_Y_CLEAR },
    ret: false, a: 1, b: 0,
    check: (o) => o.mem.read8(MARIO_X) === SNAPPED_X && o.mem.read8(SPRITE_X_ADDR) === SNAPPED_X,
  },
  {
    name: "25m no surface under the probe point",
    opts: { board: 1, y: Y_SNAP, tile25m: CLEAR_TILE, tileOff1: CLEAR_TILE, tileOff2: CLEAR_TILE, prevY: PREV_Y_CLEAR },
    ret: false, a: 0, b: 0,
    check: (o) => o.mem.read8(MARIO_Y) === Y_SNAP && o.mem.read8(MARIO_X) === X,
  },
  {
    name: "25m classifier landed (gap 4 behind it)",
    opts: { board: 1, y: Y_FAR, tile25m: SURFACE_TILE, tileOff1: CLEAR_TILE, tileOff2: CLEAR_TILE, prevY: PREV_Y_LANDED },
    ret: false, a: 1, b: 1,
    check: (o) => o.mem.read8(MARIO_Y) === LANDED_Y,
  },
  {
    name: "25m too far to land (gap exactly 4)",
    opts: { board: 1, y: Y_FAR, tile25m: SURFACE_TILE, tileOff1: CLEAR_TILE, tileOff2: CLEAR_TILE, prevY: PREV_Y_CLEAR },
    ret: false, a: 0, b: 0,
    check: (o) => o.mem.read8(MARIO_Y) === Y_FAR,
  },
  {
    name: "25m snap onto the surface (gap 3)",
    opts: { board: 1, y: Y_SNAP, tile25m: SURFACE_TILE, tileOff1: CLEAR_TILE, tileOff2: CLEAR_TILE, prevY: PREV_Y_CLEAR },
    ret: false, a: 1, b: 1,
    check: (o) => o.mem.read8(MARIO_Y) === LANDED_Y,
  },
];

// -- 1. CAPTURED (real attract dispatches) ------------------------------------

const ATTRACT_FRAMES = 8000;
const CAPTURE_CAP = 96;

/** Capture real entry states at 0x2B29 over an attract run (the game runs undisturbed — the hook
 *  clones, then lets the oracle run). */
function captureDispatches() {
  const caps = [];
  let dispatches = 0;
  const snapMap = new Map([[TARGET, (mm) => {
    dispatches++;
    if (caps.length < CAPTURE_CAP) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapMap });
  host.runFrames(ATTRACT_FRAMES);
  return { caps, dispatches };
}

/** Which terminal path an entry takes — TEST-SIDE BOOKKEEPING for the coverage report only, never
 *  part of the equivalence assertion (that is the oracle-vs-candidate diff). It re-derives the
 *  decision through the already-gated classifier on a throwaway clone. */
function classify(entry) {
  const c = entry.clone();
  c.nextNmi = Infinity;
  c.nextBoundary = Infinity;
  if (c.mem.read8(BOARD) !== 1) return "off-25m";
  c.regs.hl = (c.mem.read8(MARIO_X) << 8) | u8(c.mem.read8(MARIO_Y) + 7);
  const probe = probeTileForLanding(c);
  if (probe.skip === false) return "classifier-landed";
  if (probe.a === 0) return "no-surface";
  return u8(probe.e - probe.c) >= 4 ? "too-far" : "snap";
}

test("CAPTURED: probeMarioDescentLanding == oracle on RAM+pc+SP+A+B across real attract dispatches", () => {
  const { caps, dispatches } = captureDispatches();
  assert.ok(dispatches > 0, "0x2b29 must be naturally dispatched in attract — reachability claim in the header");

  const tally = {};
  for (const entry of caps) {
    entry.nextNmi = Infinity;
    entry.nextBoundary = Infinity;
    const diffs = contractDiffs(entry, probeMarioDescentLanding);
    assert.equal(diffs.length, 0, diffs.join("; "));
    // The threaded verdict must equal the value the oracle leaves in A.
    assert.equal(verdictOf(runCandidate(entry, probeMarioDescentLanding).ret), runOracle(entry).c.regs.a,
      "captured verdict must equal the oracle's first result byte");
    const path = classify(entry);
    tally[path] = (tally[path] || 0) + 1;
  }

  // Coverage the captured section is claimed to carry; a reachability change must not silently
  // hollow this out.
  for (const path of ["no-surface", "too-far", "classifier-landed"]) {
    assert.ok(tally[path] > 0, `attract no longer covers the ${path} path (tally ${JSON.stringify(tally)})`);
  }

  console.log(
    `  CAPTURED: ${dispatches} real 0x2b29 dispatches in ${ATTRACT_FRAMES} attract frames, ` +
      `${caps.length} replayed — RAM+pc+SP+A+B identical to the oracle; paths ${JSON.stringify(tally)}`,
  );
});

// -- 2. CRAFTED (the arms attract never reaches + the reach threshold) ---------

test("CRAFTED: probeMarioDescentLanding == oracle on RAM+pc+SP+A+B across all seven terminal paths", () => {
  assert.notEqual(cellOff1(Y_SNAP), cellOff2(Y_SNAP), "loc_2b53's two probe cells must be distinct");
  assert.equal(cell25m(Y_SNAP), cell25m(Y_FAR), "both 25m cases must probe the same cell");

  for (const { name, opts, ret, a, b, check } of CASES) {
    const entry = craftEntry(opts);

    // Non-vacuity: the oracle really took the expected path and left the expected result bytes.
    const { c: o, ret: oret } = runOracle(entry);
    assert.equal(oret, ret, `${name}: oracle return should be ${ret}`);
    assert.equal(o.regs.a, a, `${name}: oracle first result byte`);
    assert.equal(o.regs.b, b, `${name}: oracle second result byte`);
    assert.ok(check(o), `${name}: oracle did not take the expected path (post-condition failed)`);

    // Equivalence: candidate identical to the oracle over the contract, same caller-skip, and the
    // threaded verdict equal to the oracle's first result byte (the value formerly read from A).
    const diffs = contractDiffs(entry, probeMarioDescentLanding);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    const cand = runCandidate(entry, probeMarioDescentLanding);
    assert.equal(skipOf(cand.ret), ret, `${name}: idiomatic caller-skip should be ${ret}`);
    assert.equal(verdictOf(cand.ret), a, `${name}: idiomatic verdict should be ${a}`);
    assert.equal(verdictOf(cand.ret), o.regs.a, `${name}: verdict must equal the oracle's first result byte`);

    // The normal return writes NO non-stack RAM at all.
    if (ret === true) {
      assert.deepEqual(changedAddrs(entry, o, entry.regs.sp), [], `${name}: normal return wrote non-stack RAM`);
    }
  }

  console.log(
    `  CRAFTED: ${CASES.length} paths (off-25m clear/landed/X-snap, 25m no-surface/landed/too-far/snap) — ` +
      `RAM+pc+SP+A+B identical to the oracle; boundary=${hx(BOUNDARY)}, LANDED_Y=${hx(LANDED_Y)}, ` +
      `SNAPPED_X=${hx(SNAPPED_X)}, 25m cell ${hx(cell25m(Y_SNAP))}, off-25m cells ${hx(cellOff1(Y_SNAP))}/${hx(cellOff2(Y_SNAP))}`,
  );
});

// -- 3. TEETH -----------------------------------------------------------------

/** (a) no-unwind-propagate — drops the classifier's landed-unwind propagation. */
function brokenNoUnwindPropagate(m) {
  const { regs, mem } = m;
  if (mem.read8(BOARD) !== 1) return loc_2b53(m);
  regs.hl = (mem.read8(MARIO_X) << 8) | u8(mem.read8(MARIO_Y) + 7);
  const probe = probeTileForLanding(m); // BUG: no `if (probe.skip === false) return false`
  if (probe.a === 0) return loc_2b51(m);
  if (u8(probe.e - probe.c) >= 4) return loc_2b74(m);
  mem.write8(MARIO_Y, probe.c - 7);
  regs.a = 1;
  regs.b = 1;
  return loc_2b51(m);
}

/** (b) snap-offset — snaps to boundary - 6 instead of boundary - 7. */
function brokenSnapOffset(m) {
  const { regs, mem } = m;
  if (mem.read8(BOARD) !== 1) return loc_2b53(m);
  regs.hl = (mem.read8(MARIO_X) << 8) | u8(mem.read8(MARIO_Y) + 7);
  const probe = probeTileForLanding(m);
  if (probe.skip === false) return false;
  if (probe.a === 0) return loc_2b51(m);
  if (u8(probe.e - probe.c) >= 4) return loc_2b74(m);
  mem.write8(MARIO_Y, probe.c - 6); // BUG: should be - 7
  regs.a = 1;
  regs.b = 1;
  return loc_2b51(m);
}

/** (c) drop-second-result — omits the second result byte on the snap arm. */
function brokenDropSecondResult(m) {
  const { regs, mem } = m;
  if (mem.read8(BOARD) !== 1) return loc_2b53(m);
  regs.hl = (mem.read8(MARIO_X) << 8) | u8(mem.read8(MARIO_Y) + 7);
  const probe = probeTileForLanding(m);
  if (probe.skip === false) return false;
  if (probe.a === 0) return loc_2b51(m);
  if (u8(probe.e - probe.c) >= 4) return loc_2b74(m);
  mem.write8(MARIO_Y, probe.c - 7);
  regs.a = 1; // BUG: the second result byte is never written
  return loc_2b51(m);
}

/** (d) reach-threshold — lands at a gap of exactly 4 (`>` instead of `>=`). */
function brokenReachThreshold(m) {
  const { regs, mem } = m;
  if (mem.read8(BOARD) !== 1) return loc_2b53(m);
  regs.hl = (mem.read8(MARIO_X) << 8) | u8(mem.read8(MARIO_Y) + 7);
  const probe = probeTileForLanding(m);
  if (probe.skip === false) return false;
  if (probe.a === 0) return loc_2b51(m);
  if (u8(probe.e - probe.c) > 4) return loc_2b74(m); // BUG: should be >=
  mem.write8(MARIO_Y, probe.c - 7);
  regs.a = 1;
  regs.b = 1;
  return loc_2b51(m);
}

/** (e) board-test — splits on board 2 instead of board 1. */
function brokenBoardTest(m) {
  const { regs, mem } = m;
  if (mem.read8(BOARD) !== 2) return loc_2b53(m); // BUG: should be !== 1
  regs.hl = (mem.read8(MARIO_X) << 8) | u8(mem.read8(MARIO_Y) + 7);
  const probe = probeTileForLanding(m);
  if (probe.skip === false) return false;
  if (probe.a === 0) return loc_2b51(m);
  if (u8(probe.e - probe.c) >= 4) return loc_2b74(m);
  mem.write8(MARIO_Y, probe.c - 7);
  regs.a = 1;
  regs.b = 1;
  return loc_2b51(m);
}

/** First crafted case (by name) where `candidate` diverges from the oracle, or null. */
function firstCatch(candidate) {
  for (const { name, opts } of CASES) {
    const diffs = contractDiffs(craftEntry(opts), candidate);
    if (diffs.length) return { name, diffs };
  }
  return null;
}

test("TEETH: all five broken twins are CAUGHT", () => {
  const twins = [
    ["no-unwind-propagate", brokenNoUnwindPropagate, "the classifier's landed-unwind propagation is untested"],
    ["snap-offset", brokenSnapOffset, "the snap offset is untested"],
    ["drop-second-result", brokenDropSecondResult, "the second result byte is untested"],
    ["reach-threshold", brokenReachThreshold, "the reach threshold is untested"],
    ["board-test", brokenBoardTest, "the board split is untested"],
  ];

  const caught = [];
  for (const [name, fn, why] of twins) {
    const hit = firstCatch(fn);
    assert.notEqual(hit, null, `the ${name} twin escaped — ${why}`);
    caught.push(`${name} caught @${hit.name} (${hit.diffs[0]})`);
  }

  console.log(`  TEETH: ${caught.join("; ")}`);
});
