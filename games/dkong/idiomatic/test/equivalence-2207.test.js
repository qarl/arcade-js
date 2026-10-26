// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatch50mObjectState (ROM 0x2207) — the 50m board-object state-machine
 * dispatcher: a `rst 0x30` board gate (mask 0x02 -> the 50m board) in front of a
 * frame-parity record select (0x6280 odd / 0x6288 even) and a state-byte dispatch to one
 * of four arms (hold50mObjectParked / slide50mObjectDown / advance50mObjectStateOnRandomGate / raise50mObjectAndPark, table @0x221B, states 0..3).
 *
 * 0x2207 IS dispatched every board-object pass, but attract plays the 25m board, so every
 * real captured dispatch takes the gate-CLOSED arm — the body is skipped and no object RAM
 * is touched (see REACHABILITY / EQUAL captured). The gate-OPEN 50m body is unreachable in
 * attract, so it is exercised with CRAFTED entries: a real attract base with BOARD poked to
 * 2, FRAME swept (record parity) and the state byte swept 0..3, identically on both sides.
 *
 * STACK / net return. The oracle models the whole thing with `push16`/`m.call`/`ret`; the
 * idiomatic routine models the JS call stack + one genuine push (the record base for the
 * still-oracle-shaped hold50mObjectParked's `pop hl`). On EVERY path the oracle nets exactly ONE
 * caller-return pop:
 *   - gate CLOSED: the `rst 0x30` skip (sub_0030's `pop hl; ret`) pops the caller-return.
 *   - gate OPEN, any state: the dispatched arm pops the pushed record base and then `ret`s
 *     to the caller. hold50mObjectParked pops the base this routine pushes; the other three arms take
 *     the base as a parameter, so this routine pushes nothing for them, yet the oracle's
 *     own `push hl` for them lands in dead STACK_SCRATCH.
 * So runCandidate ALWAYS supplies one m.ret() to line pc + SP up with the oracle; the
 * oracle's push/ret churn all lands in the dead STACK_SCRATCH [0x6be0,0x6c00), excluded.
 *
 *   1. REACHABILITY — 0x2207 dispatched (many x) in attract, but always on the 25m board so
 *      the gate is closed and the body never runs; documents why the body arm is crafted.
 *   2. EQUAL (captured) — real dispatches == oracle over RAM - the stack scratch below the entry SP + pc + SP, and
 *      the arm taken is genuinely gate-closed (no object RAM written).
 *   3. EQUAL (crafted, 50m body) — BOARD=2, each state 0..3 x both record parities dispatches
 *      to the right arm on the right record; identical to the oracle. Non-vacuity: the
 *      dispatched arm writes the selected record's expected cell.
 *   4. EQUAL (crafted, FRAME sweep) — BOARD=2, state 0, FRAME 0..255: the selected record
 *      follows FRAME bit0 exactly (odd -> 0x6280, even -> 0x6288); identical to the oracle.
 *   5. EQUAL (crafted, gate-closed boards) — BOARD in {1,3,4} skip the body and match.
 *   6. TEETH — five broken twins, each MUST be caught:
 *      (a) wrong board mask (0x01) -> skips the 50m body -> object RAM diverges.
 *      (b) dropped board gate -> runs the body on 25m -> object RAM diverges.
 *      (c) inverted record parity -> dispatches on the WRONG record -> diverges.
 *      (d) wrong state routing (always arm 0) -> wrong arm for state 3 -> diverges.
 *      (e) wrong record-base push -> hold50mObjectParked pops the wrong base -> writes the wrong record.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2207.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2207 as oracle } from "../../translated/loc_2207.js";
import { dispatch50mObjectState } from "../dispatch50mObjectState.js";
import { boardBitGate } from "../boardBitGate.js";
import { hold50mObjectParked } from "../hold50mObjectParked.js";
import { slide50mObjectDown } from "../slide50mObjectDown.js";
import { advance50mObjectStateOnRandomGate } from "../advance50mObjectStateOnRandomGate.js";
import { raise50mObjectAndPark } from "../raise50mObjectAndPark.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  BOARD_OBJ_SCRATCH,
  FRAME,
  RANDOM,
  MARIO_X,
  MARIO_Y,
  MARIO_AIRBORNE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2207;
const RET_ADDR = 0x199e; // the site right after `call 0x2207` @0x199B — the modelled `ret` target
// The two object records dispatch50mObjectState selects on frame parity (0x6280 odd / 0x6288 even).
const BASES = [BOARD_OBJ_SCRATCH, BOARD_OBJ_SCRATCH + 8];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The record the routine picks for a given FRAME: odd -> first record, even -> second.
const selectedBase = (frame) => ((frame & 1) === 1 ? BASES[0] : BASES[1]);

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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone. On every path the routine nets exactly one caller-return
 * (the gate skip, or the dispatched arm's `ret`), so the harness does ONE m.ret() to supply
 * that pop and line pc + SP up with the oracle — the idiomatic routine otherwise carries
 * control flow on the JS call stack, touching pc/SP only through hold50mObjectParked's live-in pop.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Contract diff: RAM - the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

/** The gate is open exactly when boardBitGate(mask 0x02) is — reuse the real gate logic. */
function gateOpen(entry) {
  const c = entry.clone();
  c.regs.a = 0x02;
  return boardBitGate(c);
}

// -- fixtures -----------------------------------------------------------------

/** A real, self-consistent machine: boot + a stretch of attract. */
function attractBase(frames = 400) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x2207 dispatch onto a clone of the base: a stack with a plausible caller
 * return (so the modelled `ret` has a sane, excluded target), the board the gate reads, the
 * frame the parity select reads, the RANDOM the state-2 arm gates on, both object records'
 * state/timer fields (so whichever parity selects is a valid dispatch), and Mario's cells
 * (a hit-test miss by default, so the timer-only arms take their minimal write path).
 */
function craft(base, { board = 0x02, frame = 0x01, state = 0x00, timer = 5, random = 0x00 }) {
  const e = base.clone();
  e.regs.sp = 0x6c00;
  e.push16(RET_ADDR); // SP -> 0x6BFE, return address inside STACK_SCRATCH
  e.mem.write8(BOARD, board);
  e.mem.write8(FRAME, frame);
  e.mem.write8(RANDOM, random);
  for (const rb of BASES) {
    e.mem.write8(rb + 0, state); // state byte — selects the arm
    e.mem.write8(rb + 1, timer); // hold50mObjectParked dwell timer (+1)
    e.mem.write8(rb + 2, 0xfe);  // target X — well away from Mario, so the hit tests miss
    e.mem.write8(rb + 4, timer); // slide50mObjectDown / raise50mObjectAndPark tick timer (+4)
  }
  e.mem.write8(MARIO_X, 0x50);
  e.mem.write8(MARIO_Y, 0x40);
  e.mem.write8(MARIO_AIRBORNE, 0);
  return e;
}

// The record cell each state's arm writes, given craft()'s setup (timer=5, random=0):
//   state 0 hold50mObjectParked -> +1 (dwell timer 5->4)   state 1 slide50mObjectDown -> +4 (tick timer 5->4)
//   state 2 advance50mObjectStateOnRandomGate -> +0 (state 2->3, gate open)  state 3 raise50mObjectAndPark -> +4 (countdown 5->4)
const EXPECT_OFFSET = { 0: 1, 1: 4, 2: 0, 3: 4 };

// -- the correct post-gate body, shared by the teeth twins --------------------

function correctBody(m) {
  const { mem } = m;
  const recordBase = selectedBase(mem.read8(FRAME));
  const state = mem.read8(recordBase);
  switch (state) {
    case 0: m.push16(recordBase); return hold50mObjectParked(m);
    case 1: return slide50mObjectDown(m, recordBase);
    case 2: return advance50mObjectStateOnRandomGate(m, recordBase);
    case 3: return raise50mObjectAndPark(m, recordBase);
    default: return;
  }
}

// -- broken twins (each mirrors dispatch50mObjectState with one bug) ------------------------

/** (a) wrong board mask (0x01/25m) — the gate closes on the 50m board. */
function brokenWrongMask(m) {
  const { regs } = m;
  regs.a = 0x01; // BUG
  if (!boardBitGate(m)) return;
  correctBody(m);
}

/** (b) dropped board gate — the body runs on every board. */
function brokenNoGate(m) {
  correctBody(m); // BUG: no gate
}

/** (c) inverted record parity — dispatch reads/writes the wrong object record. */
function brokenInvertedParity(m) {
  const { regs, mem } = m;
  regs.a = 0x02;
  if (!boardBitGate(m)) return;
  const recordBase = selectedBase(mem.read8(FRAME) ^ 1); // BUG: inverted parity
  const state = mem.read8(recordBase);
  switch (state) {
    case 0: m.push16(recordBase); return hold50mObjectParked(m);
    case 1: return slide50mObjectDown(m, recordBase);
    case 2: return advance50mObjectStateOnRandomGate(m, recordBase);
    case 3: return raise50mObjectAndPark(m, recordBase);
    default: return;
  }
}

/** (d) wrong state routing — always run the state-0 arm regardless of the state byte. */
function brokenAlwaysArm0(m) {
  const { regs, mem } = m;
  regs.a = 0x02;
  if (!boardBitGate(m)) return;
  const recordBase = selectedBase(mem.read8(FRAME));
  m.push16(recordBase);
  return hold50mObjectParked(m); // BUG: ignore the state byte
}

/** (e) wrong record-base push — hold50mObjectParked pops the wrong base and writes the wrong record. */
function brokenWrongBasePush(m) {
  const { regs, mem } = m;
  regs.a = 0x02;
  if (!boardBitGate(m)) return;
  const recordBase = selectedBase(mem.read8(FRAME));
  const state = mem.read8(recordBase);
  if (state === 0) {
    m.push16(recordBase === BASES[0] ? BASES[1] : BASES[0]); // BUG: push the sibling record
    return hold50mObjectParked(m);
  }
  return correctBody(m);
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x2207 is dispatched in attract but always gate-closed (25m)", () => {
  let count = 0, open = 0;
  const overrides = new Map([[TARGET, (mm) => {
    count++;
    const c = mm.clone(); c.regs.a = 0x02;
    if (boardBitGate(c)) open++;
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(2500);
  assert.ok(count > 0, "0x2207 should be dispatched — the board-object cascade calls it every pass");
  assert.equal(open, 0, `expected the 50m body arm to be unreached in attract, saw ${open} gate-open dispatches`);
  console.log(`  REACHABILITY: ${count} natural 0x2207 dispatches in 2500 attract frames, all gate-closed (0 ran the 50m body)`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): dispatch50mObjectState == oracle on every real (gate-closed) dispatch", () => {
  const caps = [];
  const overrides = new Map([[TARGET, (mm) => {
    if (caps.length < 128) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(900);
  assert.ok(caps.length >= 1, "expected at least one real 0x2207 dispatch during boot/attract");

  for (const entry of caps) {
    const diffs = contractDiffs(entry, dispatch50mObjectState);
    assert.equal(diffs.length, 0, `captured dispatch (board ${entry.mem.read8(BOARD)}): ${diffs.join("; ")}`);
    assert.equal(gateOpen(entry), false, "captured attract dispatch should be gate-closed");
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], "gate-closed dispatch must not write object RAM");
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (all gate-closed, body skipped)`);
});

// -- 3. EQUAL (crafted, 50m body: every state x both records) -----------------

test("EQUAL (crafted, 50m body): dispatch50mObjectState == oracle for each state 0..3 on both records", () => {
  const base = attractBase();
  let n = 0;
  for (const state of [0, 1, 2, 3]) {
    for (const frame of [0x01, 0x00]) { // odd -> 0x6280, even -> 0x6288
      const rb = selectedBase(frame);
      const entry = craft(base, { board: 0x02, frame, state });
      const diffs = contractDiffs(entry, dispatch50mObjectState);
      assert.equal(diffs.length, 0, `state ${state} @${hx(rb)}: ${diffs.join("; ")}`);

      // Non-vacuity: the oracle dispatched THIS arm — the selected record's expected cell moved.
      const after = runOracle(entry);
      const cell = rb + EXPECT_OFFSET[state];
      const before = entry.mem.read8(cell);
      assert.notEqual(after.mem.read8(cell), before,
        `state ${state}: expected the dispatched arm to write ${hx(cell)} (before=${before})`);
      // And the OTHER record was untouched (proves the parity select isolated one record).
      const other = rb === BASES[0] ? BASES[1] : BASES[0];
      assert.equal(after.mem.read8(other + EXPECT_OFFSET[state]),
        entry.mem.read8(other + EXPECT_OFFSET[state]), `state ${state}: the unselected record must be untouched`);
      n++;
    }
  }
  console.log(`  EQUAL/crafted-body: ${n} (state × record) dispatches identical to the oracle, right arm on the right record`);
});

// -- 4. EQUAL (crafted, FRAME sweep: parity select) ---------------------------

test("EQUAL (crafted, FRAME sweep): the record select follows FRAME bit0 over all 256 frames", () => {
  const base = attractBase();
  let count = 0, mismatch = null, oddPicked0 = 0, evenPicked1 = 0;
  for (let frame = 0; frame < 256 && !mismatch; frame++) {
    const entry = craft(base, { board: 0x02, frame, state: 0 }); // state 0 -> hold50mObjectParked writes +1
    const diffs = contractDiffs(entry, dispatch50mObjectState);
    count++;
    if (diffs.length) { mismatch = { frame, diffs }; continue; }
    // Confirm the selected record (and only it) was ticked, matching FRAME bit0.
    const changed = changedAddrs(entry, runOracle(entry), entry.regs.sp);
    const wantBase = selectedBase(frame);
    assert.ok(changed.includes(wantBase + 1), `frame ${hx(frame)}: expected ${hx(wantBase + 1)} to tick`);
    const other = wantBase === BASES[0] ? BASES[1] : BASES[0];
    assert.ok(!changed.includes(other + 1), `frame ${hx(frame)}: the unselected record ${hx(other + 1)} must not tick`);
    if ((frame & 1) === 1 && wantBase === BASES[0]) oddPicked0++;
    if ((frame & 1) === 0 && wantBase === BASES[1]) evenPicked1++;
  }
  assert.equal(mismatch, null, mismatch && `mismatch at frame=${hx(mismatch.frame)}: ${mismatch.diffs.join("; ")}`);
  assert.equal(count, 256, "must have swept all 256 FRAME values");
  assert.equal(oddPicked0, 128, "every odd frame should select 0x6280");
  assert.equal(evenPicked1, 128, "every even frame should select 0x6288");
  console.log(`  EQUAL/crafted-frame: 256 frames identical to the oracle; odd->0x6280 (${oddPicked0}), even->0x6288 (${evenPicked1})`);
});

// -- 5. EQUAL (crafted, gate-closed boards) -----------------------------------

test("EQUAL (crafted, gate-closed): boards 1, 3 and 4 skip the 50m body and match the oracle", () => {
  const base = attractBase();
  for (const board of [0x01, 0x03, 0x04]) {
    const entry = craft(base, { board, frame: 0x01, state: 0 });
    const diffs = contractDiffs(entry, dispatch50mObjectState);
    assert.equal(diffs.length, 0, `board ${board}: ${diffs.join("; ")}`);
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], `board ${board}: gate should be closed, body must not run`);
  }
  console.log(`  EQUAL/crafted-closed: boards 1, 3 & 4 skip the body — identical to the oracle`);
});

// -- 6. TEETH -----------------------------------------------------------------

/** First non-stack RAM diff between the oracle and a twin (RAM-only, the meaningful catch). */
function ramDiffVsOracle(entry, fn) {
  const o = runOracle(entry);
  const c = entry.clone();
  fn(c);
  return firstRamDiff(o, c, entry.regs.sp);
}

test("TEETH: wrong-mask, dropped-gate, inverted-parity, wrong-routing, wrong-base-push are CAUGHT", () => {
  const base = attractBase();

  // (a) wrong mask: on the 50m board the correct routine runs the body, the twin skips it.
  const a = craft(base, { board: 0x02, frame: 0x01, state: 0 });
  assert.ok(changedAddrs(a, runOracle(a), a.regs.sp).length > 0, "the 50m body must write object RAM on this entry");
  const aDiff = ramDiffVsOracle(a, brokenWrongMask);
  assert.notEqual(aDiff, null, "the wrong-mask twin escaped — the gate is worthless");
  assert.equal(contractDiffs(a, dispatch50mObjectState).length, 0, "dispatch50mObjectState must still pass this entry");

  // (b) dropped gate: on the 25m board the correct routine skips the body, the twin runs it.
  const b = craft(base, { board: 0x01, frame: 0x01, state: 0 });
  assert.deepEqual(changedAddrs(b, runOracle(b), b.regs.sp), [], "the 25m board must skip the body (no object RAM)");
  const bDiff = ramDiffVsOracle(b, brokenNoGate);
  assert.notEqual(bDiff, null, "the dropped-gate twin escaped — the gate is worthless");
  assert.equal(contractDiffs(b, dispatch50mObjectState).length, 0, "dispatch50mObjectState must still pass this entry");

  // (c) inverted parity: the twin ticks the OTHER record, so both records diverge from the oracle.
  const c = craft(base, { board: 0x02, frame: 0x01, state: 0 });
  const cDiff = ramDiffVsOracle(c, brokenInvertedParity);
  assert.notEqual(cDiff, null, "the inverted-parity twin escaped — record selection is unchecked");
  assert.equal(contractDiffs(c, dispatch50mObjectState).length, 0, "dispatch50mObjectState must still pass this entry");

  // (d) wrong routing: a state-3 entry — the oracle runs raise50mObjectAndPark (+4), the twin runs hold50mObjectParked (+1).
  const d = craft(base, { board: 0x02, frame: 0x01, state: 3 });
  const dDiff = ramDiffVsOracle(d, brokenAlwaysArm0);
  assert.notEqual(dDiff, null, "the wrong-routing twin escaped — state dispatch is unchecked");
  assert.equal(contractDiffs(d, dispatch50mObjectState).length, 0, "dispatch50mObjectState must still pass this entry");

  // (e) wrong base push: a state-0 entry — hold50mObjectParked pops the sibling base and writes it instead.
  const e = craft(base, { board: 0x02, frame: 0x01, state: 0 });
  const eDiff = ramDiffVsOracle(e, brokenWrongBasePush);
  assert.notEqual(eDiff, null, "the wrong-base-push twin escaped — the record-base marshalling is unchecked");
  assert.equal(contractDiffs(e, dispatch50mObjectState).length, 0, "dispatch50mObjectState must still pass this entry");

  console.log(`  TEETH: wrong-mask (RAM@${hx(aDiff.addr)}); dropped-gate (RAM@${hx(bDiff.addr)}); inverted-parity (RAM@${hx(cDiff.addr)}); wrong-routing (RAM@${hx(dDiff.addr)}); wrong-base-push (RAM@${hx(eDiff.addr)})`);
});
