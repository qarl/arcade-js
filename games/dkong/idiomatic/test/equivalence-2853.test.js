// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2853 (ROM 0x2853) — set up the object-overlap search inputs
 * (object base, a Y-derived bound, and a direction-selected threshold word) and tail-
 * dispatch to the current board's overlap-search arm, returning the severity code the
 * caller consumes.
 *
 * Attract dispatches 0x2853 only sparsely, so captured states under-cover the input space. The
 * behaviour factors into three set-ups — object base (IY=0x6200), search bound (C=MARIO_Y+12),
 * threshold word (HL, directed by the input's two direction bits) — consumed by the search arm;
 * on 25m that arm counts overlaps into OVERLAP_COUNT (0x6060) and returns a 0/1/3/7 severity.
 *
 * The dissolved routine returns the severity by JS value and opens no guest-stack bracket, so it is
 * validated by RAM − the stack scratch below the entry SP plus that returned severity vs the oracle's A. pc/SP are seam
 * artifacts (oracle `call 0x3e88` / terminal `ret`) and are not compared.
 *
 *   1. REALISM (captured) — hook 0x2853 in attract, clone at each true dispatch, confirm == oracle
 *      (RAM − the stack scratch below the entry SP, returned severity) across the count-0 and count>0 arms.
 *   2. EQUAL (crafted) — sweep player Y over both direction arms through the live 25m counter, and
 *      route through the other boards' arms (2/3/4), matching the oracle.
 *   3. EQUAL (boundary) — three single-object entries at the overlap boundary, each depending on
 *      exactly one set-up; confirms == oracle AND that the oracle counts the expected object.
 *
 *   4. TEETH — three broken twins, each MUST be caught at OVERLAP_COUNT:
 *      (a) wrong Y offset (MARIO_Y + 13) — shifts the search bound, flips the boundary object.
 *      (b) inverted threshold select — picks the wrong threshold word for the input.
 *      (c) wrong object base (IY = 0x6300) — the cross-axis reference reads the wrong cell.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2853.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2853 as oracle } from "../../translated/loc_2853.js";
import { searchPlayerObjectOverlap as loc_2853 } from "../searchPlayerObjectOverlap.js";
import { dispatchBoardOverlapSearch } from "../dispatchBoardOverlapSearch.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_ACTIVE, MARIO_Y, P1_INPUT, BOARD, OVERLAP_COUNT } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2853;
const RET_ADDR = 0x1c23;   // the real caller-resume site (entry_1c05 right after `call 0x2853`)
const SAFE_SP = 0x6c00;    // crafted stack top; pushes land in STACK_SCRATCH below this

// The two scan groups the 25m overlap arm walks: [base, object count] at stride 0x20.
const SCAN_GROUPS = [[0x6700, 10], [0x6400, 5]];
const OBJ_ACTIVE = 0x6700; // the one object we keep active in the boundary entries
const IY_AXIS2_REF = 0x6203; // (iy+0x03) — the cross-axis reference the arm reads off the base
const IY_WRONG_AXIS2_REF = 0x6303; // (0x6300+0x03) — the cell the wrong-base twin would read

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs, skipping the stack scratch below the entry SP (the
// memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

/** Run the ORACLE on a fresh clone (it performs its own call/ret stack dance). */
function runOracle(entry) {
  const c = entry.clone();
  c.nextNmi = Infinity; c.nextBoundary = Infinity;
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone. The dissolved routine returns the severity code by JS value and
 * opens no guest-stack bracket, so pc/SP are not modelled.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  c.nextNmi = Infinity; c.nextBoundary = Infinity;
  const returned = fn(c);
  return { c, returned };
}

/**
 * Full contract diff: RAM − the stack scratch below the entry SP, and the severity code (the oracle leaves it in A; the
 * dissolved routine returns it). pc/SP are NOT compared — the dissolved dispatch does no guest-stack
 * ops, so they are seam artifacts; the whole-game SP tests guard SP-correctness now.
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const { c, returned } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (returned !== o.regs.a) diffs.push(`severity oracle=${o.regs.a} cand=${returned}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM (object
// records, board state) holds realistic values.
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Give a crafted entry a valid stack with a plausible caller-return on top (so the tail
// dispatch's arm has a real address to return to).
function withStack(m) {
  m.regs.sp = SAFE_SP;
  m.push16(RET_ADDR);
  return m;
}

// A crafted natural dispatch: real attract RAM with the player Y, input, and board poked.
function craftNatural(base, { y, input, board = 1 }) {
  const m = withStack(base.clone());
  m.mem.write8(MARIO_Y, y);
  m.mem.write8(P1_INPUT, input);
  m.mem.write8(BOARD, board);
  return m;
}

/**
 * A controlled boundary entry: deactivate every scanned object, then place ONE active
 * object whose single-axis overlap sits exactly at the boundary set by the routine's
 * inputs. `iy3` is the cross-axis reference at (iy+0x03); `iy3Wrong` optionally seeds the
 * cell a wrong object base would read instead. The counted result is then 1 iff the arm
 * sees the object, so a wrong set-up flips OVERLAP_COUNT (and the returned code).
 */
function craftBoundary(base, { y, input, ax1Pos, ax2Pos, iy3, iy3Wrong }) {
  const m = withStack(base.clone());
  for (const [gbase, n] of SCAN_GROUPS) {
    for (let i = 0; i < n; i++) {
      const ix = gbase + i * 0x20;
      m.mem.write8(ix, m.mem.read8(ix) & ~0x01); // clear the active bit
    }
  }
  m.mem.write8(OBJ_ACTIVE, 0x01);          // (ix+0x00) active
  m.mem.write8(OBJ_ACTIVE + 0x05, ax1Pos); // (ix+0x05) axis-1 position
  m.mem.write8(OBJ_ACTIVE + 0x0a, 0x00);   // (ix+0x0a) axis-1 span
  m.mem.write8(OBJ_ACTIVE + 0x03, ax2Pos); // (ix+0x03) axis-2 position
  m.mem.write8(OBJ_ACTIVE + 0x09, 0x00);   // (ix+0x09) axis-2 span
  m.mem.write8(IY_AXIS2_REF, iy3);
  if (iy3Wrong !== undefined) m.mem.write8(IY_WRONG_AXIS2_REF, iy3Wrong);
  m.mem.write8(MARIO_Y, y);
  m.mem.write8(P1_INPUT, input);
  m.mem.write8(BOARD, 1); // 25m -> the object-overlap counter arm
  return m;
}

// -- 0. REACHABILITY / REALISM (captured) -------------------------------------

test("REALISM: real captured 0x2853 dispatches — loc_2853 matches the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2853 dispatch during attract");

  let sawCount = 0, sawZero = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_2853);
    assert.equal(diffs.length, 0, `captured dispatch (board=${cap.mem.read8(BOARD)} input=${cap.mem.read8(P1_INPUT)} Y=${cap.mem.read8(MARIO_Y)}): ${diffs.join("; ")}`);
    if (runOracle(cap).regs.a !== 0) sawCount++; else sawZero++;
  }
  console.log(`  REALISM: ${caps.length} real dispatches identical (RAM − the stack scratch below the entry SP, pc, SP, A) — ${sawCount} overlap, ${sawZero} clear`);
});

// -- 1. EQUAL (crafted: Y sweep, both direction arms, all boards) -------------

test("EQUAL (crafted): loc_2853 == oracle across Y, both direction arms, and boards 1-4", () => {
  const base = attractBase();
  let count = 0;

  // 25m overlap counter: a spread of player Y over the neutral (input 0) and directed
  // (input 1/2/3) threshold arms.
  for (const y of [0, 40, 80, 100, 128, 160, 200, 240]) {
    for (const input of [0, 1, 2, 3]) {
      const entry = craftNatural(base, { y, input });
      const diffs = contractDiffs(entry, loc_2853);
      assert.equal(diffs.length, 0, `Y=${y} input=${input}: ${diffs.join("; ")}`);
      count++;
    }
  }

  // The other boards route the dispatch through their own collision arms; both sides run
  // the same underlying dispatch, so every board must match.
  for (const board of [2, 3, 4]) {
    const entry = craftNatural(base, { y: 128, input: 0, board });
    const diffs = contractDiffs(entry, loc_2853);
    assert.equal(diffs.length, 0, `board=${board}: ${diffs.join("; ")}`);
    count++;
  }

  console.log(`  EQUAL/crafted: ${count} entries (Y × direction × boards) identical to the oracle`);
});

// -- 2. EQUAL (boundary) + the teeth premise ----------------------------------
//
// Each boundary entry is tuned so the correct routine counts exactly one object. The
// EQUAL side confirms loc_2853 == oracle; the counted-result assertion pins the premise
// the teeth twins invert.

const BOUNDARY = {
  // C = 100+12 = 112. Axis-1 object at 106: |112-106|+1 = 7 < L(8) -> the correct routine
  // counts it. The +1-offset twin gives 8, which fails, so the count drops to 0.
  badC: { y: 100, input: 0, ax1Pos: 106, ax2Pos: 50, iy3: 50, expectCount: 1 },
  // Axis-1 dead-centre (counts regardless of the +1). Axis-2 |50-40| = 10: with the
  // neutral threshold (0x0508 -> H = 5) it FAILS, so the correct routine counts 0; the
  // inverted twin picks the directed word (H = 0x13 = 19) and it counts, flipping to 1.
  badHL: { y: 100, input: 0, ax1Pos: 112, ax2Pos: 40, iy3: 50, expectCount: 0 },
  // Both axes overlap when the base reads iy+3 = 50 (correct counts 1); the wrong-base twin
  // reads 0x6303 = 200 instead, giving |200-50| which fails axis-2, dropping the count to 0.
  badIY: { y: 100, input: 0, ax1Pos: 112, ax2Pos: 50, iy3: 50, iy3Wrong: 200, expectCount: 1 },
};

test("EQUAL (boundary): loc_2853 == oracle with the expected boundary-object count", () => {
  const base = attractBase();
  for (const [name, spec] of Object.entries(BOUNDARY)) {
    const entry = craftBoundary(base, spec);
    const diffs = contractDiffs(entry, loc_2853);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    const after = runOracle(entry);
    assert.equal(after.mem.read8(OVERLAP_COUNT), spec.expectCount, `${name}: unexpected overlap count`);
    // The arm maps count 0 -> code 0 and count 1 -> code 1, so A tracks the count here.
    assert.equal(after.regs.a, spec.expectCount, `${name}: unexpected returned code`);
  }
  console.log("  EQUAL/boundary: 3 boundary entries identical to the oracle (counts as designed)");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): wrong Y offset — the search bound is off by one. */
function twinBadYOffset(m) {
  const { mem } = m;
  const bounds = (mem.read8(P1_INPUT) & 0x03) === 0 ? 0x0508 : 0x1308;
  return dispatchBoardOverlapSearch(m, { iy: MARIO_ACTIVE, c: mem.read8(MARIO_Y) + 13, bounds }); // BUG: + 13, should be + 12
}

/** Twin (b): inverted threshold select — picks the wrong threshold word for the input. */
function twinInvertedThresholds(m) {
  const { mem } = m;
  const bounds = (mem.read8(P1_INPUT) & 0x03) === 0 ? 0x1308 : 0x0508; // BUG: arms swapped
  return dispatchBoardOverlapSearch(m, { iy: MARIO_ACTIVE, c: mem.read8(MARIO_Y) + 12, bounds });
}

/** Twin (c): wrong object base — the arm walks/reads the wrong record block. */
function twinWrongBase(m) {
  const { mem } = m;
  const bounds = (mem.read8(P1_INPUT) & 0x03) === 0 ? 0x0508 : 0x1308;
  return dispatchBoardOverlapSearch(m, { iy: 0x6300, c: mem.read8(MARIO_Y) + 12, bounds }); // BUG: iy should be MARIO_ACTIVE
}

test("TEETH: the wrong-offset, inverted-threshold, and wrong-base twins are all CAUGHT", () => {
  const base = attractBase();

  for (const [name, spec, twin] of [
    ["wrong-Y-offset", BOUNDARY.badC, twinBadYOffset],
    ["inverted-thresholds", BOUNDARY.badHL, twinInvertedThresholds],
    ["wrong-object-base", BOUNDARY.badIY, twinWrongBase],
  ]) {
    const entry = craftBoundary(base, spec);
    const diffs = contractDiffs(entry, twin);
    assert.ok(diffs.length > 0, `the ${name} twin escaped — the gate is worthless`);
    assert.ok(
      diffs[0].startsWith(`RAM@${hx(OVERLAP_COUNT)}`),
      `expected the ${name} twin to diverge at OVERLAP_COUNT (${hx(OVERLAP_COUNT)}), got ${diffs[0]}`,
    );
    console.log(`  TEETH/${name}: caught — ${diffs.join("; ")}`);
  }
});
