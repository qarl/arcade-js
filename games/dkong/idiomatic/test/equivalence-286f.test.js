// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchBoardCollision (ROM 0x286F) — the per-board collision
 * dispatcher: `ld a,(0x6227)` (BOARD), `push hl`, then vector through the 6-entry inline
 * jump table at ROM 0x2874 to that board's collision handler.
 *
 * The dissolved dispatchBoardCollision takes { iy, c, bounds } and selects the board arm by BOARD
 * (a local switch), returning the arm's { overlap, residue, stride, base } tuple; it opens no guest
 * stack. It is validated by MEMORY-equivalence against the frozen oracle (RAM − the stack scratch below the entry SP) plus
 * that returned tuple against the four values the oracle leaves in A/B/E/IX. pc/SP are seam
 * artifacts of the oracle's rst-0x28 trampoline unwind and are not compared; the RAM diff excludes
 * the dead STACK_SCRATCH region. It IS reached in plain attract (BOARD holds 1, the 25m arm), so the
 * reached arm is covered by real captures; the other three arms (BOARD 2/3/4) are crafted.
 *
 *   1. REACHABILITY — 0x286f is dispatched during attract (the collision cascade calls it).
 *
 *   2. REALISM (captured attract dispatches) — hook 0x286f in attract and clone at each real
 *      dispatch. Run the ORACLE on one clone and dispatchBoardCollision on another and prove
 *      RAM(−stack) + the returned tuple identical — the FULL oracle handler runs on the oracle
 *      side, so a wrong input handoff or a wrong arm surfaces as divergent memory or tuple.
 *
 *   3. CRAFTED (the other three boards) — poke BOARD to 2/3/4 on a real captured state,
 *      identically on both sides, to run arms 0x28B0 / 0x28E0 / 0x2901 in full and prove the same
 *      contract for the arms attract never reaches.
 *
 *   4. SELECTOR — pin the board->arm map identity (boards 1-4) and that every other selector is a
 *      never-reached guard slot the dissolved dispatcher throws on.
 *
 *   5. TEETH — two broken twins, each MUST be caught:
 *      (a) a twin that ignores BOARD and always runs the 100m arm — caught on boards 2/3 by the
 *          full-handler contract (different array/count, different returned base).
 *      (b) a twin that corrupts the returned base — caught by the tuple's base field.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-286f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_286f as oracle } from "../../translated/loc_286f.js";
import { dispatchBoardCollision, COLLISION_HANDLERS } from "../dispatchBoardCollision.js";
import { search25mObjectOverlap } from "../search25mObjectOverlap.js";
import { search50mObjectOverlap } from "../search50mObjectOverlap.js";
import { search75mObjectOverlap } from "../search75mObjectOverlap.js";
import { search100mObjectOverlap } from "../search100mObjectOverlap.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x286f;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The search inputs the caller seats before `call 0x286f`: reference pointer/coordinate in IY/C,
// and the tolerance word in HL (the oracle's `push hl` stacks it; the dissolved dispatcher takes it
// as a parameter). Read them straight off the captured register file.
function searchArgs(entry) {
  return { iy: entry.regs.iy, c: entry.regs.c, bounds: entry.regs.hl };
}

// First differing RAM byte between two dumps, EXCLUDING the dead stack-scratch region (the
// memory-equivalence contract is RAM − the stack scratch below the entry SP; the oracle leaves the trampoline's
// popped table-base word there and this routine does not). Returns { addr, a, b } or null.
function firstRamDiffExStack(a, b, offToAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

// Full contract diff for a full-handler run: RAM − the stack scratch below the entry SP, plus the returned tuple
// { overlap, residue, stride, base } against the four values the frozen oracle handler leaves in
// A (overlap), B (residue), E (stride low byte) and IX (base). The full oracle handler runs on the
// oracle side; the candidate runs the idiomatic arm and returns the tuple. pc/SP are NOT compared:
// the dissolved dispatcher does no guest-stack ops (the oracle's rst-0x28 trampoline and handler
// unwind do), so they are seam artifacts; the whole-game SP tests guard SP-correctness now.
function contractDiffs(entry, fn) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  const tuple = fn(b, searchArgs(entry));
  const diffs = [];
  const ram = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (tuple.overlap !== a.regs.a) diffs.push(`overlap oracle=${hx(a.regs.a)} cand=${hx(tuple.overlap)}`);
  if (tuple.residue !== a.regs.b) diffs.push(`residue oracle=${hx(a.regs.b)} cand=${hx(tuple.residue)}`);
  if ((tuple.stride & 0xff) !== (a.regs.e & 0xff)) diffs.push(`stride oracle=${hx(a.regs.e)} cand=${hx(tuple.stride)}`);
  if (tuple.base !== a.regs.ix) diffs.push(`base oracle=${hx(a.regs.ix)} cand=${hx(tuple.base)}`);
  return diffs;
}

// Hook 0x286f in a plain attract run and clone the machine at up to K real dispatches. The
// wrapper clones the entry state (only while capturing), then runs the oracle so the host
// game proceeds undisturbed; capturing is gated off after the host run so the isolated
// replays below cannot pollute it.
function captureAttract(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x286f is dispatched during attract", () => {
  let count = 0;
  const boards = new Set();
  const snap = new Map([[TARGET, (mm) => { count++; boards.add(mm.mem.read8(BOARD)); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.ok(count > 0, "0x286f should be dispatched — the collision cascade calls it during the attract demo");
  console.log(`  REACHABILITY: ${count} natural 0x286f dispatches in 2000 attract frames; BOARD values {${[...boards].map(hx).join(", ")}}`);
});

// -- 2. REALISM (captured attract dispatches) ---------------------------------

test("REALISM: real captured attract 0x286f dispatches — RAM(−stack) + returned tuple match", () => {
  const caps = captureAttract(200, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x286f dispatch during attract");

  for (const cap of caps) {
    const diffs = contractDiffs(cap, dispatchBoardCollision);
    assert.equal(
      diffs.length,
      0,
      diffs.length ? `captured dispatch (BOARD=${hx(cap.mem.read8(BOARD))}): ${diffs.join("; ")}` : "",
    );
  }
  const board = caps[0].mem.read8(BOARD);
  console.log(`  REALISM: ${caps.length} real dispatches (BOARD=${hx(board)} -> handler 0x2880) — full-handler contract identical`);
});

// -- 3. CRAFTED (the other three boards) --------------------------------------

test("CRAFTED: boards 2/3/4 run handlers 0x28B0/0x28E0/0x2901 — full contract matches", () => {
  const base = captureAttract(1, 1500)[0];
  assert.ok(base, "expected a real 0x286f attract state to craft from");

  for (const b of [2, 3, 4]) {
    const entry = base.clone();
    entry.mem.write8(BOARD, b); // identically on both sides (contractDiffs clones this entry)
    const diffs = contractDiffs(entry, dispatchBoardCollision);
    assert.equal(diffs.length, 0, `BOARD=${b}: ${diffs.join("; ")}`);
  }
  console.log("  CRAFTED: boards 2/3/4 handlers run in full — RAM(−stack) + returned tuple identical to the oracle");
});

// -- 4. SELECTOR (board -> arm identity + guards) -----------------------------

test("SELECTOR: dispatchBoardCollision maps each board to its arm and guards the rest", () => {
  // Boards 1..4 select their board's collision arm; the map IS the dispatch, so pin it directly.
  assert.equal(COLLISION_HANDLERS[1], search25mObjectOverlap, "board 1 must select the 25m arm");
  assert.equal(COLLISION_HANDLERS[2], search50mObjectOverlap, "board 2 must select the 50m arm");
  assert.equal(COLLISION_HANDLERS[3], search75mObjectOverlap, "board 3 must select the 75m arm");
  assert.equal(COLLISION_HANDLERS[4], search100mObjectOverlap, "board 4 must select the 100m arm");

  // Every other selector is a never-reached reset-vector guard (BOARD is always 1..4 live): the
  // dissolved dispatcher throws rather than dispatching a bogus arm.
  const base = captureAttract(1, 1500)[0];
  assert.ok(base, "expected a real 0x286f attract state to craft from");
  for (const board of [0, 5, 6, 0x80, 0xff]) {
    const m = base.clone();
    m.mem.write8(BOARD, board);
    assert.throws(() => dispatchBoardCollision(m, { iy: 0x6200, c: 0, bounds: 0x0407 }),
      `board ${board}: dispatcher should throw on a guard slot`);
  }
  console.log("  SELECTOR: boards 1-4 map to their arms; guard slots 0/5/6/0x80/0xff throw");
});

// -- 5. TEETH -----------------------------------------------------------------

/** Broken twin (a): ignores BOARD and always runs the 100m arm — a mis-selection. */
function brokenIgnoreBoard(m, args) {
  return search100mObjectOverlap(m, args); // BUG: should pick the arm by BOARD
}

/** Broken twin (b): dispatches the right arm but corrupts the returned base — a passthrough leak. */
function brokenCorruptBase(m, args) {
  const t = COLLISION_HANDLERS[m.mem8[BOARD]](m, args);
  return { ...t, base: (t.base + 1) & 0xffff }; // BUG: the array base the caller latches is off by one
}

test("TEETH: the ignore-board and corrupt-base twins are CAUGHT by the full-handler contract", () => {
  const base = captureAttract(1, 1500)[0];
  assert.ok(base, "expected a real 0x286f attract state to craft from");

  // (a) ignore-board: on boards 2/3 the 100m arm sweeps a different array/count than the correct
  // arm, so OBJ_SEARCH_COUNT and the returned base diverge from the oracle.
  let ignoreCaught = null;
  for (const b of [2, 3]) {
    const entry = base.clone();
    entry.mem.write8(BOARD, b);
    const diffs = contractDiffs(entry, brokenIgnoreBoard);
    if (diffs.length) { ignoreCaught = `board ${b}: ${diffs.join("; ")}`; break; }
  }
  assert.notEqual(ignoreCaught, null, "the ignore-board twin escaped — the selection is unproven");

  // (b) corrupt-base: the returned array base the caller latches is wrong on any dispatch.
  const baseTwinDiffs = contractDiffs(base.clone(), brokenCorruptBase);
  assert.ok(baseTwinDiffs.some((d) => d.startsWith("base ")), `the corrupt-base twin escaped — got ${baseTwinDiffs.join("; ")}`);

  console.log(`  TEETH: ignore-board caught (${ignoreCaught}); corrupt-base caught (${baseTwinDiffs.find((d) => d.startsWith("base "))})`);
});
