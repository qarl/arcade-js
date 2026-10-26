// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_25f2 (ROM 0x25F2) — the 50m board's per-frame object update:
 * a `rst 0x30` board gate (mask 0x02 -> the 50m board) in front of the four-call cascade
 * loc_2602 / loc_262f / loc_2679 (the three conveyor-object step drivers) then
 * carryMarioOnConveyorRow (carry Mario by his row's published step).
 *
 * 0x25F2 IS dispatched every board-object pass, but attract plays the 25m board, so every
 * real captured dispatch takes the gate-CLOSED arm — the body is skipped and no object RAM
 * is touched (see REACHABILITY / EQUAL captured). The gate-OPEN 50m body is unreachable in
 * attract, so it is exercised with CRAFTED entries: a real attract base with BOARD poked to
 * 2 and the object state swept, identically on both sides.
 *
 * STACK / net return — why pc/SP are NOT compared. The oracle models the whole thing with
 * `push16`/`m.call`/`ret`; the idiomatic routine models no stack (a boolean gate + four direct JS
 * calls to idiomatic leaves — loc_2602 now reaches the idiomatic signStepHalfRate, not the frozen
 * sub_26e9). So neither path performs a guest-stack `ret`: the idiomatic routine ends SP two below
 * the oracle (pc likewise at entry) on both the gate-closed skip and the gate-open body. That is a
 * pure seam artifact — the oracle's push/ret churn all lands in the dead STACK_SCRATCH
 * [0x6be0,0x6c00) which the RAM diff excludes, and the whole-game SP guards (idiomatic.test.js
 * "FULL FLIP", barrel-jump-reset) back-stop any stray push — so the contract is RAM − the stack scratch below the entry SP.
 *
 *   1. REACHABILITY — 0x25F2 dispatched (many x) in attract, but always on the 25m board so the
 *      gate is closed and the body never runs; documents why the body arm is crafted.
 *   2. EQUAL (captured) — real dispatches == oracle over RAM - the stack scratch below the entry SP, and
 *      the arm taken is genuinely gate-closed (no object RAM written).
 *   3. EQUAL (crafted, 50m body) — BOARD=2 swept over FRAME x Mario Y-band x prior-X x timer
 *      config so the whole cascade runs; identical to the oracle. Non-vacuity: the body writes
 *      object RAM and, on a conveyor row, the carry moves MARIO_X.
 *   4. EQUAL (crafted, gate-closed boards) — BOARD in {3,4} skip the body and match the oracle.
 *   5. TEETH — three broken twins, each MUST be caught:
 *      (a) wrong board mask (0x01 instead of 0x02) -> skips the 50m body -> object RAM diverges.
 *      (b) dropped board gate (always runs the body) -> runs on 25m -> object RAM diverges.
 *      (c) dropped Mario carry (omits carryMarioOnConveyorRow) -> MARIO_X not carried -> diverges.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-25f2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_25f2 as oracle } from "../../translated/loc_25f2.js";
import { update50mConveyorObjects as loc_25f2 } from "../update50mConveyorObjects.js";
import { boardBitGate } from "../boardBitGate.js";
import { loc_2602 } from "../loc_2602.js";
import { loc_262f } from "../loc_262f.js";
import { loc_2679 } from "../loc_2679.js";
import { carryMarioOnConveyorRow } from "../carryMarioOnConveyorRow.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  FRAME,
  MARIO_X,
  MARIO_Y,
  M50_OBJ1_REVERSE_TIMER,
  M50_OBJ2_REVERSE_TIMER,
  M50_OBJ3_REVERSE_TIMER,
  M50_OBJ1_STEP_DIR,
  M50_OBJ2_STEP_DIR,
  M50_OBJ3_STEP_DIR,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x25f2;
const RET_ADDR = 0x199d; // the site right after `call 0x25F2` @0x199A — the modelled `ret` target

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- the memory-equivalence contract ------------------------------------------

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

/** Every non-stack RAM address that changed between two machines (body ran / skipped check). */
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

/** The gate is open exactly when boardBitGate(mask 0x02) is — reuse the real gate logic. */
function gateOpen(entry) {
  const c = entry.clone();
  c.regs.a = 0x02;
  return boardBitGate(c);
}

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone. The idiomatic routine touches the guest stack nowhere on
 * either path (a boolean gate + four direct JS-leaf calls), so pc/SP are a seam artifact (see the
 * header) and are neither reconciled nor compared. A pop reads the stack but never writes it, so
 * the RAM contract needs no return-count reconciliation.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  return c;
}

/** Contract diff: RAM - the stack scratch below the entry SP. No pc/SP (a seam artifact of the dissolved calls — see the
 *  header). Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  return diffs;
}

// -- fixtures -----------------------------------------------------------------

/** A real, self-consistent machine: boot + a stretch of attract. */
function attractBase(frames = 400) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x25F2 dispatch onto a clone of the base: a stack with a plausible caller
 * return (so the modelled `ret` has a sane, excluded target), the board the gate reads, and
 * every cell the cascade drivers + carry read — Mario's X/Y, the frame counter, the three
 * reverse-timers and their step-direction latches.
 */
function craft(base, { board = 0x02, frame = 0x00, marioX = 0x80, marioY = 0xd0,
  t1 = 0x08, t2 = 0x08, t3 = 0x08, d1 = 0x05, d2 = 0x05, d3 = 0x05 }) {
  const e = base.clone();
  e.regs.sp = 0x6c00;
  e.push16(RET_ADDR); // SP -> 0x6BFE, return address inside STACK_SCRATCH
  e.mem.write8(BOARD, board);
  e.mem.write8(FRAME, frame);
  e.mem.write8(MARIO_X, marioX);
  e.mem.write8(MARIO_Y, marioY);
  e.mem.write8(M50_OBJ1_REVERSE_TIMER, t1);
  e.mem.write8(M50_OBJ2_REVERSE_TIMER, t2);
  e.mem.write8(M50_OBJ3_REVERSE_TIMER, t3);
  e.mem.write8(M50_OBJ1_STEP_DIR, d1);
  e.mem.write8(M50_OBJ2_STEP_DIR, d2);
  e.mem.write8(M50_OBJ3_STEP_DIR, d3);
  return e;
}

// -- broken twins (each mirrors loc_25f2 with one bug) ------------------------

/** Broken twin (a): wrong board mask (0x01/25m) — the gate closes on the 50m board. */
function brokenWrongMask(m) {
  const { regs } = m;
  regs.a = 0x01; // BUG: 25m mask, so the 50m body never runs
  if (!boardBitGate(m)) return;
  loc_2602(m); loc_262f(m); loc_2679(m); carryMarioOnConveyorRow(m);
}

/** Broken twin (b): dropped board gate — the body runs on every board. */
function brokenNoGate(m) {
  // BUG: no `regs.a = 0x02; if (!boardBitGate(m)) return;`
  loc_2602(m); loc_262f(m); loc_2679(m); carryMarioOnConveyorRow(m);
}

/** Broken twin (c): dropped Mario carry — Mario is not moved along his conveyor row. */
function brokenNoCarry(m) {
  const { regs } = m;
  regs.a = 0x02;
  if (!boardBitGate(m)) return;
  loc_2602(m); loc_262f(m); loc_2679(m); // BUG: carryMarioOnConveyorRow omitted
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x25F2 is dispatched in attract but always gate-closed (25m)", () => {
  let count = 0, open = 0;
  const overrides = new Map([[TARGET, (mm) => {
    count++;
    const c = mm.clone(); c.regs.a = 0x02;
    if (boardBitGate(c)) open++;
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(2500);
  assert.ok(count > 0, "0x25F2 should be dispatched — the board-object cascade calls it every pass");
  assert.equal(open, 0, `expected the 50m body arm to be unreached in attract, saw ${open} gate-open dispatches`);
  console.log(`  REACHABILITY: ${count} natural 0x25F2 dispatches in 2500 attract frames, all gate-closed (0 ran the 50m body)`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_25f2 == oracle on every real (gate-closed) dispatch", () => {
  const caps = [];
  const overrides = new Map([[TARGET, (mm) => {
    if (caps.length < 128) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(900);
  assert.ok(caps.length >= 1, "expected at least one real 0x25F2 dispatch during boot/attract");

  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_25f2);
    assert.equal(diffs.length, 0, `captured dispatch (board ${entry.mem.read8(BOARD)}): ${diffs.join("; ")}`);
    // The arm taken is genuinely gate-closed: the oracle wrote no non-stack RAM (body skipped).
    assert.equal(gateOpen(entry), false, "captured attract dispatch should be gate-closed");
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], "gate-closed dispatch must not write object RAM");
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (all gate-closed, body skipped)`);
});

// -- 3. EQUAL (crafted, 50m body) ---------------------------------------------

const YBANDS = [0x40, 0x50, 0x78, 0xc8, 0xd0, 0xff]; // Mario-high arm, 3 conveyor rows, low off-row, far off-row
const TCFGS = [
  { t1: 0x01, t2: 0x01, t3: 0x01, d1: 0x05, d2: 0x05, d3: 0x05 }, // all timers about-to-underflow, signs clear
  { t1: 0x08, t2: 0x08, t3: 0x08, d1: 0x85, d2: 0x85, d3: 0x85 }, // mid, signs set
];

test("EQUAL (crafted, 50m body): loc_25f2 == oracle over FRAME × Mario-Y × timer-config", () => {
  const base = attractBase();
  let count = 0, mismatch = null, bodyRan = 0, marioMoved = 0;
  outer: for (const y of YBANDS) {
    for (const cfg of TCFGS) {
      for (let frame = 0; frame < 256; frame++) {
        const entry = craft(base, { board: 0x02, frame, marioX: 0x80, marioY: y, ...cfg });
        const diffs = contractDiffs(entry, loc_25f2);
        count++;
        if (diffs.length) { mismatch = { y, cfg, frame, diffs }; break outer; }
        const after = runOracle(entry);
        if (changedAddrs(entry, after, entry.regs.sp).length) bodyRan++;
        if (after.mem.read8(MARIO_X) !== 0x80) marioMoved++;
      }
    }
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at y=${hx(mismatch.y)} frame=${hx(mismatch.frame)} cfg=${JSON.stringify(mismatch.cfg)}: ${mismatch.diffs.join("; ")}`);
  assert.equal(count, YBANDS.length * TCFGS.length * 256, "must have swept the full crafted body space");
  assert.ok(bodyRan > 0, "non-vacuity: the 50m body must have written object RAM on some entries");
  assert.ok(marioMoved > 0, "non-vacuity: the carry must have moved MARIO_X on some conveyor-row entries");
  console.log(`  EQUAL/crafted-body: ${count} (Y × cfg × FRAME) entries identical; body wrote RAM on ${bodyRan}, carry moved Mario on ${marioMoved}`);
});

test("EQUAL (crafted, object-2 conveyor row): loc_25f2 == oracle over all 256 prior-X", () => {
  const base = attractBase();
  let count = 0, mismatch = null;
  for (let marioX = 0; marioX < 256 && !mismatch; marioX++) {
    // Object-2 row (Y==0x78), odd frame so the drivers publish a nonzero step the carry uses;
    // the object-2 arm selects its +/- step by Mario's X, so this sweeps both selector halves.
    const entry = craft(base, { board: 0x02, frame: 0x01, marioX, marioY: 0x78 });
    const diffs = contractDiffs(entry, loc_25f2);
    count++;
    if (diffs.length) mismatch = { marioX, diffs };
  }
  assert.equal(mismatch, null, mismatch && `mismatch at priorX=${hx(mismatch.marioX)}: ${mismatch.diffs.join("; ")}`);
  assert.equal(count, 256, "must have swept all 256 prior-X values on the object-2 row");
  console.log(`  EQUAL/crafted-obj2row: ${count} prior-X values identical to the oracle`);
});

// -- 4. EQUAL (crafted, gate-closed boards) -----------------------------------

test("EQUAL (crafted, gate-closed): boards 3 and 4 skip the 50m body and match the oracle", () => {
  const base = attractBase();
  for (const board of [0x03, 0x04]) {
    const entry = craft(base, { board, frame: 0x01, marioX: 0x80, marioY: 0x50 });
    const diffs = contractDiffs(entry, loc_25f2);
    assert.equal(diffs.length, 0, `board ${board}: ${diffs.join("; ")}`);
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], `board ${board}: gate should be closed, body must not run`);
  }
  console.log(`  EQUAL/crafted-closed: boards 3 & 4 skip the body — identical to the oracle`);
});

// -- 5. TEETH -----------------------------------------------------------------

/**
 * First non-stack RAM diff between the oracle and a twin. Each of these bugs is
 * memory-observable, and the twins do not honour loc_25f2's gate/stack contract (the
 * dropped-gate twin runs the body and pops where the entry says it should not), so the twins
 * are compared on RAM alone — the meaningful catch — with no harness ret to over-pop.
 */
function ramDiffVsOracle(entry, fn) {
  const o = runOracle(entry);
  const c = entry.clone();
  fn(c);
  return firstRamDiff(o, c, entry.regs.sp);
}

test("TEETH: wrong-mask, dropped-gate, and dropped-carry twins are CAUGHT", () => {
  const base = attractBase();

  // (a) wrong mask: on the 50m board the correct routine runs the body, the twin skips it.
  const a = craft(base, { board: 0x02, frame: 0x01, marioX: 0x80, marioY: 0x50 });
  assert.ok(changedAddrs(a, runOracle(a), a.regs.sp).length > 0, "the 50m body must write object RAM on this entry");
  const aDiff = ramDiffVsOracle(a, brokenWrongMask);
  assert.notEqual(aDiff, null, "the wrong-mask twin escaped — the gate is worthless");
  assert.equal(contractDiffs(a, loc_25f2).length, 0, "loc_25f2 must still pass this entry");

  // (b) dropped gate: on the 25m board the correct routine skips the body, the twin runs it.
  const b = craft(base, { board: 0x01, frame: 0x01, marioX: 0x80, marioY: 0x50 });
  assert.deepEqual(changedAddrs(b, runOracle(b), b.regs.sp), [], "the 25m board must skip the body (no object RAM)");
  const bDiff = ramDiffVsOracle(b, brokenNoGate);
  assert.notEqual(bDiff, null, "the dropped-gate twin escaped — the gate is worthless");
  assert.equal(contractDiffs(b, loc_25f2).length, 0, "loc_25f2 must still pass this entry");

  // (c) dropped carry: on a conveyor row the correct routine moves MARIO_X, the twin does not.
  const c = craft(base, { board: 0x02, frame: 0x01, marioX: 0x80, marioY: 0x50 });
  assert.notEqual(runOracle(c).mem.read8(MARIO_X), 0x80, "the carry must move MARIO_X on this entry");
  const cDiff = ramDiffVsOracle(c, brokenNoCarry);
  assert.notEqual(cDiff, null, "the dropped-carry twin escaped — the gate is worthless");
  assert.equal(cDiff.addr, MARIO_X, `expected the dropped-carry diff at MARIO_X (${hx(MARIO_X)}), got ${hx(cDiff.addr)}`);
  assert.equal(contractDiffs(c, loc_25f2).length, 0, "loc_25f2 must still pass this entry");

  console.log(`  TEETH: wrong-mask caught (RAM@${hx(aDiff.addr)}); dropped-gate caught (RAM@${hx(bDiff.addr)}); dropped-carry caught (RAM@${hx(cDiff.addr)})`);
});
