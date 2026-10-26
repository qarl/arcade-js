// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_33a1 (ROM 0x33A1) — the board gate + height test that guards
 * driveFireLadderClimb's movement path, and returns the caller-skip boolean.
 *
 * The routine reads exactly two bytes (BOARD, through boardBitGate, and the object record's
 * +0x0f Y base) and writes none, so its whole product is the boolean. The gate is therefore
 * built around that boolean — but the RAM half of the contract is asserted too (both sides must
 * leave work RAM untouched) and twin (e) below proves it bites.
 *
 * NOT RECURSIVE. 0x33A1 is twelve ROM bytes whose only transfer out is the one-byte board gate
 * at 0x0030, and a scan of the whole 16K ROM finds exactly ONE reference to 0x33A1 — the call at
 * 0x334A inside driveFireLadderClimb. There is no self-recursive arm, so none is covered here; the test that
 * would exercise it does not exist because the code path does not.
 *
 * WHAT IS COMPARED. RAM − the stack scratch below the entry SP plus the boolean. pc/SP are NOT compared: they are the
 * Z80 stack idiom the boolean replaces (the oracle's board-gate skip, its splice and its plain
 * return all move pc/SP; the idiomatic routine touches neither). Instead of dropping that
 * meaning, test 2 pins it directly — it asserts WHERE THE ORACLE'S OWN RETURN LANDS on each arm,
 * against distinct sentinel return addresses, which is what makes "true = driveFireLadderClimb was returned
 * to normally" a measured claim rather than a reading of the disassembly.
 *
 *   0. REACHABILITY — 0x33A1 is dispatched naturally: 114 times in an 8000-frame attract run.
 *      The test measures the count AND classifies each captured entry by arm behaviourally (it
 *      re-runs the oracle with the Y base poked to both extremes and sees whether the answer
 *      moves). Every natural dispatch lands on ONE arm — gate open, Y base at or below the line
 *      — so the captured case alone proves only that arm; the number is printed, not rounded up
 *      into a claim of coverage.
 *   1. EQUAL (captured) — every captured dispatch replayed oracle-vs-candidate on fresh clones.
 *   2. ORACLE STACK SEMANTICS — the boolean's meaning, measured on all three arms.
 *   3. EQUAL (crafted) — the two arms attract never reaches: the 100m gate-closed arm (with the
 *      Y base at both extremes, proving the gate short-circuits the height test) and the
 *      above-the-line splice, plus the 88/89/90 boundary and the 0/255 ends.
 *   4. EQUAL (exhaustive) — all 65,536 (BOARD, +0x0f) pairs. The routine's behaviour is a total
 *      function of those two bytes, so this is complete coverage of its input space. The BOOLEAN
 *      is compared on every pair; the full 5KB RAM dump is compared on every board at eight Y
 *      bases (the ends, the boundary and its neighbours — 2,048 pairs) and once more after the
 *      last iteration, where a stray write from ANY of the 65,536 would still be sitting, since
 *      the two machines are never reset between them.
 *   5. IX-RELATIVE — the tested byte follows the record pointer, not a fixed address.
 *   6. TEETH — five broken twins, each of which the gate MUST catch:
 *      (a) the board gate conflated with the caller-skip (returns false when the gate closes),
 *      (b) the height test inverted, (c) the boundary off by one (only 89 exactly separates
 *      them), (d) the wrong record offset (+0x0e — the offset-namespace trap), and
 *      (e) a twin that WRITES the compared byte into the record, which only the RAM half of the
 *      contract can catch.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-33a1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_33a1 as oracle } from "../../translated/loc_33a1.js";
import { loc_33a1 } from "../loc_33a1.js";
import { boardBitGate } from "../boardBitGate.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, OBJ_ARRAY_64, OBJ_STATE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x33a1;
const RECORD_Y_BASE = 0x0f; // the object-record field the routine tests; names.js names no field here
const THRESHOLD = 89; // at or above -> normal return; below -> the caller-skip
const RECORD = OBJ_ARRAY_64; // record 0 of the stride-0x20 array — the record every natural dispatch uses
const RECORD_1 = OBJ_ARRAY_64 + 0x20; // its neighbour, for the IX-relative check

// The stack the crafted entries hand the oracle: entry SP inside STACK_SCRATCH with room for the
// gate's push below it (SP-2) and the splice's two pops above it (SP+4).
const SAFE_SP = 0x6bf4;
const CALLER_RET = 0x334d; // driveFireLadderClimb, the instruction after its call — where a NORMAL return lands
const SKIP_RET = 0x3233; // advanceFire, where the splice lands when driveFireLadderClimb is skipped

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/**
 * Run the oracle and a candidate on two FRESH byte-identical clones and compare the contract:
 * RAM − the stack scratch below the entry SP and the boolean.
 */
function comparePair(entry, fn) {
  const o = entry.clone();
  const c = entry.clone();
  const retO = oracle(o);
  let retC, threw = null;
  try {
    retC = fn(c);
  } catch (e) {
    threw = e;
  }
  const ram = threw ? null : firstRamDiff(o, c, entry.regs.sp);
  return { ram, retO, retC, threw, oracleMachine: o };
}

const mismatched = (r) => r.threw != null || r.ram !== null || r.retO !== r.retC;
const describeMismatch = (r) =>
  r.threw ? `candidate threw: ${r.threw.message}`
    : r.ram ? `RAM@${hx(r.ram.addr)} oracle=${r.ram.a} cand=${r.ram.b}`
      : `return oracle=${r.retO} cand=${r.retC}`;

// A real, self-consistent machine (boot + a stretch of attract) so crafted entries sit on
// realistic RAM. clone() neutralises the frame machinery (nextNmi/nextBoundary = Infinity).
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/** A crafted 0x33A1 entry: real RAM, a stack carrying both sentinel returns, board + Y base set. */
function craft(base, { board, y, ix = RECORD }) {
  const e = base.clone();
  e.regs.sp = SAFE_SP + 4;
  e.push16(SKIP_RET); // what driveFireLadderClimb would return to
  e.push16(CALLER_RET); // what THIS routine returns to
  e.regs.ix = ix;
  e.mem.write8(BOARD, board);
  e.mem.write8(RECORD + RECORD_Y_BASE, y);
  return e;
}

/**
 * Classify an entry by ARM, behaviourally: re-run the ORACLE on that entry with the Y base poked
 * to each extreme. If the answer does not move, the height test never ran — the board gate was
 * closed. Otherwise the arm is whichever the entry's own Y base selects.
 */
function classify(entry) {
  const low = entry.clone(), high = entry.clone();
  low.mem.write8(low.regs.ix + RECORD_Y_BASE, 0);
  high.mem.write8(high.regs.ix + RECORD_Y_BASE, 255);
  if (oracle(low) === oracle(high)) return "gate-closed";
  return entry.mem.read8(entry.regs.ix + RECORD_Y_BASE) >= THRESHOLD ? "at-or-below-line" : "above-line(skip)";
}

/** Drive attract and clone the machine at up to K real 0x33A1 dispatches. */
function captureDispatches(K, frames) {
  const caps = [];
  let total = 0;
  const ov = new Map([[TARGET, (mm) => {
    total++;
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(frames);
  return { caps, total };
}

// One 8000-frame attract run, shared by the reachability and captured-equality tests (the run is
// the expensive part; the two tests ask different questions of the same real dispatches).
let CAPTURED = null;
const captured = () => (CAPTURED ??= captureDispatches(128, 8000));

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x33a1 is dispatched naturally, and every dispatch lands on ONE arm", () => {
  const { caps, total } = captured();
  assert.ok(total > 0, "0x33a1 should be dispatched during attract (advanceFire -> driveFireLadderClimb -> here)");

  const arms = { "gate-closed": 0, "at-or-below-line": 0, "above-line(skip)": 0 };
  const ixs = new Set();
  for (const entry of caps) {
    arms[classify(entry)]++;
    ixs.add(entry.regs.ix);
  }
  assert.ok(arms["at-or-below-line"] > 0, "the naturally-reached arm must be the at-or-below-line return");
  // The honest hole, asserted so it cannot silently change into coverage without this line failing.
  assert.equal(arms["gate-closed"] + arms["above-line(skip)"], 0,
    "attract was expected to reach NEITHER the 100m gate-closed arm nor the splice — if it now does, " +
    "the header's crafted-carries-these-arms claim needs updating");
  console.log(`  REACHABILITY: ${total} natural dispatches in 8000 attract frames ` +
    `(${caps.length} captured); arms ${JSON.stringify(arms)}; record pointers ${[...ixs].map(hx).join(",")}`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_33a1 == oracle on every real dispatch", () => {
  const { caps } = captured();
  assert.ok(caps.length >= 1, "expected at least one real 0x33a1 dispatch during attract");

  for (const entry of caps) {
    // The oracle's deepest push and the splice's two pops must all land inside STACK_SCRATCH, or
    // excluding that region could mask a real difference.
    assert.ok(entry.regs.sp - 2 >= STACK_SCRATCH.lo && entry.regs.sp + 4 <= STACK_SCRATCH.hi,
      `oracle stack traffic must stay inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`);
    const r = comparePair(entry, loc_33a1);
    assert.ok(!mismatched(r), `captured dispatch: ${describeMismatch(r)}`);
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical (RAM − the stack scratch below the entry SP + boolean)`);
});

// -- 2. what the boolean MEANS (measured on the oracle's own stack) -----------

test("ORACLE STACK SEMANTICS: true = driveFireLadderClimb was returned to, false = driveFireLadderClimb is skipped", () => {
  const base = attractBase();
  const cases = [
    { name: "100m: board gate closed", board: 4, y: 240, ret: true, pc: CALLER_RET, sp: SAFE_SP + 2 },
    { name: "25m: at or below the line", board: 1, y: 240, ret: true, pc: CALLER_RET, sp: SAFE_SP + 2 },
    { name: "25m: above the line -> splice", board: 1, y: 0, ret: false, pc: SKIP_RET, sp: SAFE_SP + 4 },
  ];
  for (const c of cases) {
    const entry = craft(base, c);
    const o = entry.clone();
    const retO = oracle(o);
    assert.equal(retO, c.ret, `${c.name}: oracle returned ${retO}, expected ${c.ret}`);
    assert.equal(o.pc, c.pc, `${c.name}: oracle returned to ${hx(o.pc)}, expected ${hx(c.pc)}`);
    assert.equal(o.regs.sp, c.sp, `${c.name}: oracle SP ${hx(o.regs.sp)}, expected ${hx(c.sp)}`);
    assert.equal(loc_33a1(entry.clone()), c.ret, `${c.name}: loc_33a1 disagrees with the oracle's own return`);
  }
  console.log("  SEMANTICS: the board-gate skip returns INTO driveFireLadderClimb (true); only the below-89 " +
    "splice returns past it (false) — measured on the oracle, both boolean and landing address");
});

// -- 3. EQUAL (crafted): the arms attract never reaches ------------------------

test("EQUAL (crafted): the gate-closed arm, the splice arm, and the boundary match the oracle", () => {
  const base = attractBase();
  const cases = [
    // 100m — the gate closes, and the Y base must not matter on either side.
    { name: "board 4, y below the line", board: 4, y: 0, expect: true },
    { name: "board 4, y above the line", board: 4, y: 255, expect: true },
    { name: "board 0, gate closed", board: 0, y: 240, expect: true },
    { name: "board 5, gate closed", board: 5, y: 0, expect: true },
    // The splice arm, on each board whose gate is open.
    { name: "board 1, above the line", board: 1, y: 0, expect: false },
    { name: "board 2, above the line", board: 2, y: 88, expect: false },
    { name: "board 3, above the line", board: 3, y: 1, expect: false },
    // The boundary itself: 88 splices, 89 and 90 do not.
    { name: "board 1, y = 88", board: 1, y: THRESHOLD - 1, expect: false },
    { name: "board 1, y = 89", board: 1, y: THRESHOLD, expect: true },
    { name: "board 1, y = 90", board: 1, y: THRESHOLD + 1, expect: true },
    // The ends.
    { name: "board 1, y = 0", board: 1, y: 0, expect: false },
    { name: "board 1, y = 255", board: 1, y: 255, expect: true },
  ];
  for (const c of cases) {
    const entry = craft(base, c);
    const r = comparePair(entry, loc_33a1);
    assert.ok(!mismatched(r), `${c.name}: ${describeMismatch(r)}`);
    // Non-vacuity: the oracle really took the arm this entry targets.
    assert.equal(r.retO, c.expect, `${c.name}: oracle returned ${r.retO}, expected ${c.expect}`);
    // Neither side may touch work RAM outside the dead stack.
    assert.equal(firstRamDiff(entry, r.oracleMachine, entry.regs.sp), null, `${c.name}: the oracle wrote non-stack RAM`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} entries — 4 gate-closed, 3 splice, the 88/89/90 boundary, both ends`);
});

// -- 4. EQUAL (exhaustive): the whole input space ------------------------------

test("EQUAL (exhaustive): all 65,536 (BOARD, +0x0f) pairs match the oracle", () => {
  const base = attractBase();
  // Two long-lived machines instead of 131,072 clones: the routine writes no RAM, so re-poking
  // the two input bytes (and the stack) identically on both sides is a byte-identical restart.
  const o = craft(base, { board: 1, y: 240 });
  const oFloor = o.regs.sp;
  const c = o.clone();
  // The BOOLEAN is compared on every one of the 65,536 pairs. The full RAM dump — 5KB a side —
  // is compared on every board at the Y bases that matter (the ends, the boundary and its
  // neighbours) and, because the two machines are never reset between iterations, ONCE MORE at
  // the very end, where a stray write from ANY iteration would still be sitting.
  const ramCheckedY = new Set([0, 1, THRESHOLD - 1, THRESHOLD, THRESHOLD + 1, 128, 240, 255]);
  let n = 0, ramChecks = 0, sawTrue = false, sawFalse = false;
  for (let board = 0; board < 256; board++) {
    for (let y = 0; y < 256; y++) {
      for (const m of [o, c]) {
        m.regs.sp = SAFE_SP;
        m.regs.ix = RECORD;
        m.mem.write8(BOARD, board);
        m.mem.write8(RECORD + RECORD_Y_BASE, y);
      }
      const retO = oracle(o);
      const retC = loc_33a1(c);
      assert.equal(retO, retC, `board=${board} y=${y}: return oracle=${retO} cand=${retC}`);
      if (ramCheckedY.has(y)) {
        const ram = firstRamDiff(o, c, oFloor);
        assert.equal(ram, null, ram && `board=${board} y=${y}: RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
        ramChecks++;
      }
      sawTrue ||= retO === true;
      sawFalse ||= retO === false;
      n++;
    }
  }
  const residue = firstRamDiff(o, c, oFloor);
  assert.equal(residue, null,
    residue && `after the sweep, RAM@${hx(residue.addr)} oracle=${residue.a} cand=${residue.b}`);
  assert.ok(sawTrue && sawFalse, "the sweep must exercise BOTH the normal return and the caller-skip");
  console.log(`  EQUAL/exhaustive: ${n} (BOARD, +0x0f) pairs — boolean identical on all of them, ` +
    `full RAM identical on ${ramChecks} of them plus the end-of-sweep residue, both returns seen`);
});

// -- 5. the tested byte is IX-RELATIVE ----------------------------------------

test("IX-RELATIVE: the height test reads the pointed-at record, not a fixed address", () => {
  const base = attractBase();
  // Record 0 above the line, record 1 below it: the answer must follow the pointer.
  const entry = craft(base, { board: 1, y: 0 });
  entry.mem.write8(RECORD_1 + RECORD_Y_BASE, 240);

  const at0 = entry.clone(); at0.regs.ix = RECORD;
  const at1 = entry.clone(); at1.regs.ix = RECORD_1;
  assert.equal(oracle(at0.clone()), false, "record 0 is above the line -> oracle splices");
  assert.equal(oracle(at1.clone()), true, "record 1 is below the line -> oracle returns normally");

  for (const [name, e] of [["record 0", at0], ["record 1", at1]]) {
    const r = comparePair(e, loc_33a1);
    assert.ok(!mismatched(r), `${name}: ${describeMismatch(r)}`);
  }
  console.log("  IX-RELATIVE: the same RAM gives opposite answers for the two record pointers, both matched");
});

// -- 6. TEETH -----------------------------------------------------------------

/** (a) conflates the two skips: reports the board gate's early return as a caller-skip. */
function brokenGateConflated(m) {
  m.regs.a = 0x07;
  if (!boardBitGate(m)) return false; // BUG: the gate's skip returns INTO driveFireLadderClimb, so this is true
  return m.mem.read8(m.regs.ix + RECORD_Y_BASE) >= THRESHOLD;
}

/** (b) inverts the height test. */
function brokenInverted(m) {
  m.regs.a = 0x07;
  if (!boardBitGate(m)) return true;
  return m.mem.read8(m.regs.ix + RECORD_Y_BASE) < THRESHOLD; // BUG
}

/** (c) the boundary off by one — only a Y base of exactly 89 tells them apart. */
function brokenBoundary(m) {
  m.regs.a = 0x07;
  if (!boardBitGate(m)) return true;
  return m.mem.read8(m.regs.ix + RECORD_Y_BASE) > THRESHOLD; // BUG: 89 itself returns normally
}

/** (d) the offset-namespace trap: tests +0x0e instead of the +0x0f Y base. */
function brokenWrongOffset(m) {
  m.regs.a = 0x07;
  if (!boardBitGate(m)) return true;
  return m.mem.read8(m.regs.ix + 0x0e) >= THRESHOLD; // BUG: the neighbouring field
}

/** (e) writes the compared byte back into the record — a RAM-only defect. */
function brokenWrites(m) {
  m.regs.a = 0x07;
  if (!boardBitGate(m)) return true;
  const y = m.mem.read8(m.regs.ix + RECORD_Y_BASE);
  m.mem.write8(m.regs.ix + OBJ_STATE, y); // BUG: the routine writes nothing
  return y >= THRESHOLD;
}

test("TEETH: five broken twins are all CAUGHT", () => {
  const base = attractBase();
  // The entries the twins are hunted over: one per arm plus the boundary, and a record whose
  // +0x0e differs from its +0x0f so the wrong-offset twin has something to get wrong.
  const entries = [
    { name: "board 4 (gate closed)", cfg: { board: 4, y: 240 } },
    { name: "board 1, y = 240", cfg: { board: 1, y: 240 } },
    { name: "board 1, y = 0", cfg: { board: 1, y: 0 } },
    { name: "board 1, y = 89", cfg: { board: 1, y: THRESHOLD } },
  ].map((e) => {
    const entry = craft(base, e.cfg);
    entry.mem.write8(RECORD + 0x0e, 0); // distinct from every Y base above except y = 0
    return { ...e, entry };
  });

  const hunt = (fn) => {
    for (const { name, entry } of entries) {
      const r = comparePair(entry, fn);
      if (mismatched(r)) return { name, r };
    }
    return null;
  };

  const caught = {};
  for (const [label, fn] of Object.entries({
    "gate-conflated": brokenGateConflated,
    inverted: brokenInverted,
    boundary: brokenBoundary,
    "wrong-offset": brokenWrongOffset,
    writes: brokenWrites,
  })) {
    const hit = hunt(fn);
    assert.notEqual(hit, null, `the ${label} twin ESCAPED — the gate proves nothing`);
    caught[label] = `${hit.name}: ${describeMismatch(hit.r)}`;
  }

  // The boundary twin must be caught by the y = 89 entry specifically — that is the only input
  // that separates >= 89 from > 89, so this is what pins the threshold rather than its neighbourhood.
  const boundaryOnly = comparePair(craft(base, { board: 1, y: THRESHOLD }), brokenBoundary);
  assert.ok(mismatched(boundaryOnly), "the off-by-one twin must be caught at a Y base of exactly 89");
  assert.equal(comparePair(craft(base, { board: 1, y: THRESHOLD + 1 }), brokenBoundary).retC, true,
    "at 90 the off-by-one twin agrees — proving 89 is what caught it");

  // The writing twin is the one the RAM half of the contract catches; the other four are boolean.
  const writesHit = hunt(brokenWrites);
  assert.notEqual(writesHit.r.ram, null, "the writing twin must be caught by the RAM compare, not the boolean");
  assert.equal(writesHit.r.retO, writesHit.r.retC, "the writing twin's boolean is correct — only its RAM is wrong");

  for (const [label, where] of Object.entries(caught)) console.log(`  TEETH/${label}: caught on ${where}`);
});
