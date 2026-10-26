// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchBoardOverlapSearch (ROM 0x3E88) — select the current board's
 * object-overlap arm by BOARD and return its severity code, handing the probe point and the
 * caller's bounds word to the arm as arguments.
 *
 * The dissolved dispatcher is a local switch (OVERLAP_HANDLERS keyed by BOARD) returning the arm's
 * severity; it opens no guest stack. It is NEVER dispatched during attract, so all coverage is
 * CRAFTED on a real attract-base machine (so work RAM is self-consistent), poking BOARD (0x6227) to
 * pick the arm and seating the probe inputs the way the caller does:
 *
 *   1. SELECTOR — pin the board->arm map identity (boards 1-4: loc_3e99 / search50m / search75m /
 *      search100m) and that every other selector is a never-reached guard slot the dispatcher
 *      throws on.
 *
 *   2. REAL ARM (crafted) — run the board-1..4 arms FOR REAL against the frozen oracle, comparing
 *      RAM(−stack) + the returned severity (pc/SP are seam artifacts of the oracle's trampoline
 *      unwind and are not compared). Board 1 is also run with a hand-activated overlap object so the
 *      search actually COUNTS (OVERLAP_COUNT tracks the L byte of the handed-off bounds) — proving
 *      the bounds word genuinely reaches the arm.
 *
 *   3. NULL GUARD (crafted) — boards 0 and 5 are the reset-vector guards; the frozen oracle throws
 *      NotImplemented(0x0000) and the dissolved dispatcher throws on the guard slot. Assert BOTH
 *      throw (the messages differ, so only that both throw is asserted).
 *
 *   4. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) ignore-board (always runs the 100m arm) — caught on board 2 by the full-handler contract
 *          (different array/count, so OBJ_SEARCH_COUNT diverges).
 *      (b) corrupt-severity (returns the code off by one) — caught by the returned severity.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3e88.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3e88 as oracle } from "../../translated/loc_3e88.js";
import { dispatchBoardOverlapSearch, OVERLAP_HANDLERS } from "../dispatchBoardOverlapSearch.js"; // promoted from loc_3e88
import { loc_3e99 } from "../loc_3e99.js";
import { search50mObjectOverlap } from "../search50mObjectOverlap.js";
import { search75mObjectOverlap } from "../search75mObjectOverlap.js";
import { search100mObjectOverlap } from "../search100mObjectOverlap.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, OVERLAP_COUNT } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const RET = 0x286e;                     // a plausible caller return (the arm's ret lands here on the oracle side)
// OVERLAP_COUNT (0x6060) imported from names.js — the collision counter entry_3e99/entry_3ec3 write.
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First differing RAM byte between two machines, EXCLUDING the dead stack scratch
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// A real, self-consistent machine: boot + a stretch of attract. loc_3e88's arm is never
// reached here; every case is crafted by poking. clone() neutralises the frame machinery
// (nextNmi/nextBoundary = Infinity) so no stray NMI can masquerade as a side effect.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// Stage a crafted dispatch on a clone: a stack carrying a plausible caller return (so the
// arm's final ret has a sane target), the caller's bounds word in HL, and the board type.
function craft(base, { board, hl = 0x8899 }) {
  const m = base.clone();
  m.regs.sp = 0x6bfe;
  m.push16(RET);
  m.regs.hl = hl & 0xffff;
  m.mem.write8(BOARD, board & 0xff);
  return m;
}

// craft(), plus activate object 0 of the 0x6700 search group so entry_3ec3 actually
// counts an overlap: place it so axis-2 always overlaps and axis-1 overlaps only when
// the L byte of the handed-off bounds is >= 0x14 — making 0x6060 a live witness that the
// bounds word reached the arm. Grounded empirically against the frozen oracle.
function craftActive(base, opts) {
  const m = craft(base, opts);
  m.mem.write8(0x6700 + 0x00, 0x01);                                   // active flag (bit0)
  m.mem.write8(0x6700 + 0x05, (m.regs.c + 20) & 0xff);                 // |C - (ix+5)| = 20
  m.mem.write8(0x6700 + 0x0a, 0x02);                                   // axis-1 span
  m.mem.write8(0x6700 + 0x03, m.mem.read8((m.regs.iy + 3) & 0xffff));  // axis-2 diff = 0
  m.mem.write8(0x6700 + 0x09, 0x02);                                   // axis-2 span
  for (let i = 1; i < 10; i++) m.mem.write8((0x6700 + i * 0x20) & 0xffff, 0x00); // rest inactive
  for (let i = 0; i < 5; i++) m.mem.write8((0x6400 + i * 0x20) & 0xffff, 0x00);
  return m;
}

// The probe point (iy/c) and tolerance word (bounds) the caller seats before the dispatch: iy/c in
// registers, bounds in HL (the oracle's trampoline pushes it; the dissolved dispatcher takes it as a
// parameter). Read them off the register file.
function searchArgs(entry) {
  return { iy: entry.regs.iy, c: entry.regs.c, bounds: entry.regs.hl };
}

// Run the ORACLE on a fresh clone; capture a throw instead of letting it escape.
function runOracleOutcome(entry) {
  const c = entry.clone();
  try {
    oracle(c);
    return { c, threw: null };
  } catch (e) {
    return { c: null, threw: `${e.constructor.name}: ${e.message}` };
  }
}

// Run the CANDIDATE on a fresh clone with the dispatch args; capture its returned severity or throw.
function runCandidateOutcome(entry, fn) {
  const c = entry.clone();
  try {
    const severity = fn(c, searchArgs(entry));
    return { c, severity, threw: null };
  } catch (e) {
    return { c: null, severity: undefined, threw: `${e.constructor.name}: ${e.message}` };
  }
}

// Full contract comparison oracle-vs-candidate on one crafted entry: throw-parity (both throw on a
// guard slot — the messages differ, so only that BOTH throw is asserted), then RAM(−stack) + the
// returned severity code (the oracle leaves it in A; the dissolved dispatcher returns it). pc/SP and
// the register file are seam artifacts of the oracle's trampoline unwind and are NOT compared; the
// whole-game SP tests guard SP-correctness now. Returns a list of diffs ([] == equal).
function contractDiffs(entry, fn) {
  const o = runOracleOutcome(entry);
  const c = runCandidateOutcome(entry, fn);
  const diffs = [];
  if (o.threw || c.threw) {
    if (!o.threw || !c.threw) diffs.push(`throw oracle=${o.threw} cand=${c.threw}`);
    return diffs; // both threw on the guard slot -> equal
  }
  const ram = firstRamDiff(o.c, c.c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (c.severity !== o.c.regs.a) diffs.push(`severity oracle=${hx(o.c.regs.a)} cand=${hx(c.severity)}`);
  return diffs;
}

// -- 1. SELECTOR (board -> arm identity + guards) -----------------------------

test("SELECTOR: dispatchBoardOverlapSearch maps each board to its arm and guards the rest", () => {
  // Boards 1..4 select their board's overlap arm (board 1 is the graded 25m counter, 2/3/4 the
  // shared collision arms); the map IS the dispatch, so pin it directly.
  assert.equal(OVERLAP_HANDLERS[1], loc_3e99, "board 1 must select the 25m overlap-count arm");
  assert.equal(OVERLAP_HANDLERS[2], search50mObjectOverlap, "board 2 must select the 50m arm");
  assert.equal(OVERLAP_HANDLERS[3], search75mObjectOverlap, "board 3 must select the 75m arm");
  assert.equal(OVERLAP_HANDLERS[4], search100mObjectOverlap, "board 4 must select the 100m arm");

  // Every other selector is a never-reached reset-vector guard: the dispatcher throws.
  const base = attractBase();
  for (const board of [0, 5, 6, 0x80, 0xff]) {
    const m = craft(base, { board });
    assert.throws(() => dispatchBoardOverlapSearch(m, searchArgs(m)),
      `board ${board}: dispatcher should throw on a guard slot`);
  }
  console.log("  SELECTOR: boards 1-4 map to their arms; guard slots 0/5/6/0x80/0xff throw");
});

// -- 2. REAL ARM (crafted) ----------------------------------------------------

test("REAL ARM: the board-1..4 arms run for real and reproduce the oracle", () => {
  const base = attractBase();

  // Boards 1..4 on a plain attract base — full chain through the frozen oracle target.
  for (const board of [1, 2, 3, 4]) {
    const entry = craft(base, { board, hl: 0x8899 });
    const diffs = contractDiffs(entry, dispatchBoardOverlapSearch);
    assert.equal(diffs.length, 0, `board ${board}: ${diffs.join("; ")}`);
  }

  // Board 1 with an active overlap object: the arm counts, and the count tracks the L
  // byte of the handed-off bounds. Both bounds that count (L=0xff) and that don't (L=0x00)
  // must reproduce the oracle exactly.
  for (const hl of [0x00ff, 0x0000]) {
    const entry = craftActive(base, { board: 1, hl });
    const diffs = contractDiffs(entry, dispatchBoardOverlapSearch);
    assert.equal(diffs.length, 0, `active board 1 hl=${hx(hl)}: ${diffs.join("; ")}`);
    // Confirm the arm really counted (or not) as expected — the hand-off is live, not dead.
    const after = runOracleOutcome(entry).c;
    assert.equal(
      after.mem.read8(OVERLAP_COUNT),
      (hl & 0xff) >= 0x14 ? 1 : 0,
      `active board 1 hl=${hx(hl)}: overlap count did not track the bounds L byte`,
    );
  }
  console.log("  REAL ARM: boards 1-4 (incl. active-object board 1, counting=1 and 0) identical to the oracle");
});

// -- 3. NULL GUARD (crafted) --------------------------------------------------

test("NULL GUARD: boards 0 and 5 hit the guards and BOTH the oracle and the candidate throw", () => {
  const base = attractBase();
  for (const board of [0, 5]) {
    const entry = craft(base, { board });
    const o = runOracleOutcome(entry);
    const c = runCandidateOutcome(entry, dispatchBoardOverlapSearch);
    assert.ok(o.threw, `board ${board}: oracle should throw on the 0x0000 guard`);
    assert.ok(c.threw, `board ${board}: candidate should throw on the guard slot`);
  }
  console.log("  NULL GUARD: boards 0/5 make both the oracle and the dissolved dispatcher throw");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): ignores BOARD and always runs the 100m arm — a mis-selection. */
function twinIgnoreBoard(m, args) {
  return search100mObjectOverlap(m, args).overlap; // BUG: should pick the arm by BOARD
}

/** Twin (b): dispatches the right arm but returns a severity off by one — a passthrough leak. */
function twinCorruptSeverity(m, args) {
  return OVERLAP_HANDLERS[m.mem8[BOARD]](m, args).overlap + 1; // BUG: the severity the caller reads is wrong
}

test("TEETH: the ignore-board and corrupt-severity twins are all CAUGHT", () => {
  const base = attractBase();

  // (a) ignore-board on board 2: the 100m arm stamps a different OBJ_SEARCH_COUNT than the 50m arm.
  const b2 = craft(base, { board: 2 });
  const ignoreDiffs = contractDiffs(b2, twinIgnoreBoard);
  assert.ok(ignoreDiffs.length > 0, "ignore-board twin escaped — the selection is unproven");

  // (b) corrupt-severity on the active board-1 arm: the returned code is off by one.
  const b1 = craftActive(base, { board: 1, hl: 0x00ff });
  const sevDiffs = contractDiffs(b1, twinCorruptSeverity);
  assert.ok(sevDiffs.some((d) => d.startsWith("severity ")), `corrupt-severity twin escaped — got ${sevDiffs.join("; ")}`);

  console.log(`  TEETH: ignore-board caught (${ignoreDiffs.join("; ")}); corrupt-severity caught (${sevDiffs.find((d) => d.startsWith("severity "))})`);
});
