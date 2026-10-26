// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for settleFireOnGirderSlope (ROM 0x33C3) — on 25m, re-step one object-record
 * coordinate through the girder-slope single-step (snapYToGirder) and store it back into
 * record field +0x0F; on any other board, do nothing.
 *
 * 0x33C3 is NOT wired into the live dispatcher (its callers 0x32AB and the fall-through
 * from 0x33AD are still frozen oracles), so there are NO natural attract dispatches to
 * capture — the whole gate is CRAFTED on a real attract-base machine, identically poked on
 * both sides. The routine dissolves the oracle's push16/call/ret bracket (snapYToGirder is a
 * pure JS function), so it models no stack; runCandidate performs ONE m.ret() after it to
 * line pc + SP up with the oracle, and the RAM diff EXCLUDES the dead STACK_SCRATCH the
 * oracle's push16 churn writes (the memory-equivalence contract, mirroring
 * equivalence-0350.test.js).
 *
 *   1. EQUAL (board guard) — every non-25m selector early-outs with no non-stack RAM
 *      write, matching the oracle's `cp 1 / ret nz`; the crafted fields WOULD step if the
 *      guard were missing, so the no-write is genuine.
 *   2. EQUAL (25m step sweep) — a matrix of (companion, coord, state) that exercises every
 *      snapYToGirder arm (hold vs step, both sentinel coordinates 240/76, both slope directions,
 *      both travel directions). Each asserts identical contract (RAM − the stack scratch below the entry SP, pc,
 *      SP) AND that the stored +0x0F equals snapYToGirder(companion, coord, state) — proving the
 *      wrapper actually passes the coordinates through and stores the result. Non-vacuity:
 *      the sweep is required to contain both cases that changed the coordinate and cases
 *      that held it.
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) dropped board guard (always steps) — caught on a non-25m case where the step
 *          changes the coordinate.
 *      (b) swapped snapYToGirder coordinates (companion<->coord) — caught on a 25m case where
 *          the two argument orders give different results.
 *
 * LIVE-OUT, cross-file and therefore recorded here rather than in the routine: memory-only — the
 * single stored coordinate at record +0x0F. The oracle's residual registers and flags and its
 * terminal return are dead ABI; the board-guard early-out replaces its `ret nz`.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-33c3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_33c3 as oracle } from "../../translated/loc_33c3.js";
import { settleFireOnGirderSlope } from "../settleFireOnGirderSlope.js";
import { snapYToGirder } from "../snapYToGirder.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, OBJ_STATE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const RET_ADDR = 0x32ae;  // a plausible caller-return site (the 0x32AB `call 0x33C3` + 3)
const OBJ_BASE = 0x6900;  // object-record base for the crafted dispatches (work RAM, clear of STACK_SCRATCH)
const OFF_0D = OBJ_STATE; // record +0x0D — direction/state byte (snapYToGirder's `step`)
const OFF_0E = 0x0e;      // record +0x0E — companion coordinate (snapYToGirder's `x`)
const OFF_0F = 0x0f;      // record +0x0F — coordinate stepped + stored (snapYToGirder's `y`)
const FIELD_0F = (OBJ_BASE + OFF_0F) & 0xffff; // the single cell this routine writes

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// All non-stack RAM addresses that changed between two machines (for the no-write
// non-vacuity check on the board-guard early-out).
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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so pc +
 * SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself). Both the guard early-out and the step path net
 * exactly one caller-return pop in the oracle, so a single ret models both.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
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

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic
// values. This routine's body is never reached here; it is crafted by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x33C3 dispatch onto a clone of the base: a stack with a plausible caller
// return (so the terminal `ret` has a sane target), the board selector, the object-record
// pointer in ix, and the three record fields the routine reads.
function craft(base, { board = 0x01, companion, coord, state }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.ix = OBJ_BASE;
  m.mem.write8(BOARD, board);
  m.mem.write8((OBJ_BASE + OFF_0E) & 0xffff, companion);
  m.mem.write8((OBJ_BASE + OFF_0F) & 0xffff, coord);
  m.mem.write8((OBJ_BASE + OFF_0D) & 0xffff, state);
  return m;
}

// -- 1. EQUAL (board guard) ---------------------------------------------------

test("EQUAL (board guard): every non-25m board early-outs with no RAM write", () => {
  const base = attractBase();
  // Fields that WOULD step (subCell 0, step 1, bit5 clear -> coord 0x10 becomes 0x11), so a
  // missing guard would be observable as a write.
  const wouldStep = { companion: 0x00, coord: 0x10, state: 0x01 };
  assert.notEqual(snapYToGirder(0x00, 0x10, 0x01), 0x10, "sanity: the guard-probe fields must actually step");

  for (const board of [0x00, 0x02, 0x03, 0x04, 0x05, 0xff]) {
    const entry = craft(base, { board, ...wouldStep });
    const diffs = contractDiffs(entry, settleFireOnGirderSlope);
    assert.equal(diffs.length, 0, `board ${hx(board)}: ${diffs.join("; ")}`);
    // Genuinely the no-write path: the oracle wrote no non-stack RAM.
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], `board ${hx(board)}: guard path wrote non-stack RAM`);
  }
  console.log("  EQUAL/board-guard: 6 non-25m selectors early-out with no non-stack write, identical to the oracle");
});

// -- 2. EQUAL (25m step sweep) ------------------------------------------------

test("EQUAL (25m step): settleFireOnGirderSlope == oracle across snapYToGirder's arms, storing back the step", () => {
  const base = attractBase();

  // companion (x) values touch: sub-cell 0 and 15 (the two travel boundaries), off-boundary
  // holds, the x>=152 / x<152 ledge seam, and the x bit7 top-half seam.
  const companions = [0x00, 0x05, 0x0f, 0x80, 0x8f, 0x90, 0x97, 0x98, 0xff];
  // coord (y) values touch: both sentinels (240, 76), both slope bits (0x10 clear / 0x30 set),
  // and ordinary values.
  const coords = [0x00, 0x10, 0x20, 0x30, 0x4c, 0x7f, 0xf0, 0xff];
  // state (step): 1 = right, everything else = left; a broad set pins the "== 1" test.
  const states = [0x00, 0x01, 0x02, 0xff];

  let cases = 0, changed = 0, held = 0;
  for (const state of states) {
    for (const companion of companions) {
      for (const coord of coords) {
        const entry = craft(base, { board: 0x01, companion, coord, state });
        const diffs = contractDiffs(entry, settleFireOnGirderSlope);
        assert.equal(diffs.length, 0,
          `state=${hx(state)} companion=${hx(companion)} coord=${hx(coord)}: ${diffs.join("; ")}`);

        // The stored coordinate must be exactly snapYToGirder's step result (wrapper faithfulness).
        const expected = snapYToGirder(companion, coord, state);
        const after = runOracle(entry);
        assert.equal(after.mem.read8(FIELD_0F), expected,
          `state=${hx(state)} companion=${hx(companion)} coord=${hx(coord)}: stored ${hx(after.mem.read8(FIELD_0F))} != snapYToGirder ${hx(expected)}`);

        cases++;
        if (expected === coord) held++; else changed++;
      }
    }
  }
  // Non-vacuity: the sweep must contain both step-and-store and hold cases.
  assert.ok(changed > 0, "sweep never stepped the coordinate — vacuous");
  assert.ok(held > 0, "sweep never held the coordinate — vacuous");
  console.log(`  EQUAL/25m-step: ${cases} crafted dispatches identical to the oracle (${changed} stepped, ${held} held)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): drops the 25m board guard — always steps and stores. */
function brokenNoGuard(m) {
  const { regs, mem } = m;
  const objBase = regs.ix;
  const companion = mem.read8((objBase + OFF_0E) & 0xffff);
  const coord = mem.read8((objBase + OFF_0F) & 0xffff);
  const state = mem.read8((objBase + OFF_0D) & 0xffff);
  mem.write8((objBase + OFF_0F) & 0xffff, snapYToGirder(companion, coord, state)); // BUG: no BOARD guard
}

/** Broken twin (b): swaps snapYToGirder's companion and coordinate arguments. */
function brokenSwapCoords(m) {
  const { regs, mem } = m;
  if (mem.read8(BOARD) !== 0x01) return;
  const objBase = regs.ix;
  const companion = mem.read8((objBase + OFF_0E) & 0xffff);
  const coord = mem.read8((objBase + OFF_0F) & 0xffff);
  const state = mem.read8((objBase + OFF_0D) & 0xffff);
  mem.write8((objBase + OFF_0F) & 0xffff, snapYToGirder(coord, companion, state)); // BUG: x/y swapped
}

test("TEETH: the dropped-guard twin and the swapped-coordinate twin are CAUGHT", () => {
  const base = attractBase();

  // (a) dropped guard: a non-25m board where the step WOULD change the coordinate.
  //     Correct routine holds (no write); the twin writes the step -> diff at +0x0F.
  const guardCase = craft(base, { board: 0x02, companion: 0x00, coord: 0x10, state: 0x01 });
  assert.equal(snapYToGirder(0x00, 0x10, 0x01), 0x11, "sanity: this case must step 0x10 -> 0x11");
  const guardDiffs = contractDiffs(guardCase, brokenNoGuard);
  assert.ok(guardDiffs.length > 0, "the dropped-guard twin escaped — the gate is worthless");
  assert.ok(guardDiffs[0].startsWith(`RAM@${hx(FIELD_0F)}`),
    `expected the dropped-guard diff at ${hx(FIELD_0F)}, got ${guardDiffs[0]}`);

  // (b) swapped coordinates: a 25m case where snapYToGirder(companion,coord) differs from the
  //     swapped order. companion 0x00 coord 0x10 step 1 -> 0x11 correct vs 0x01 swapped.
  assert.notEqual(snapYToGirder(0x00, 0x10, 0x01), snapYToGirder(0x10, 0x00, 0x01),
    "sanity: this case must distinguish the argument order");
  const swapCase = craft(base, { board: 0x01, companion: 0x00, coord: 0x10, state: 0x01 });
  const swapDiffs = contractDiffs(swapCase, brokenSwapCoords);
  assert.ok(swapDiffs.length > 0, "the swapped-coordinate twin escaped — the gate is worthless");
  assert.ok(swapDiffs[0].startsWith(`RAM@${hx(FIELD_0F)}`),
    `expected the swapped-coordinate diff at ${hx(FIELD_0F)}, got ${swapDiffs[0]}`);

  console.log(`  TEETH: dropped-guard caught (${guardDiffs[0]}); swapped-coordinate caught (${swapDiffs[0]})`);
});
