// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0400 (ROM 0x0400) — the colour-cycle driver entered mid-body at
 * the board branch: on the 50m arm, shift the sprite-object row's X column and stage the
 * row-shift delta, then hand off to serviceColorCycle; otherwise straight to serviceColorCycle.
 *
 * WHY THIS TEST SYNTHESISES THE ENTRY INSTEAD OF DRIVING A LIVE DISPATCH.
 * 0x0400 is NEVER dispatched in the current build. It is the shared tail of its sibling
 * loc_03fb entered one instruction later (at the `jp nz` board branch); the ROM's
 * scheduled-task table does not contain 0x0400, so nothing jumps to it (test 0 below confirms
 * 0 entries over a coin+start window, baseline healthy). So there are no natural captures. Per
 * the synthesis clause, the entry is reconstructed from the reachable sibling loc_03fb's REAL
 * captured state (its caller loc_197a runs the in-game cascade), with the deciding board flag
 * forced each way — the exact context the loc_0413 colour tree is built to run in — plus crafted
 * attract-base entries that force the sub-0x3b row-shift over the byte wrap and each colour-cycle
 * route beneath both branches.
 *
 * Down every path the oracle nets exactly ONE caller-return pop (the not-50m arm tail-jumps to
 * loc_0413 which returns; the 50m arm's rst-0x38 is a balanced call/return, then the same
 * loc_0413 tail): it only READS the stack, and the dead pushes land in STACK_SCRATCH, excluded
 * by the memory-equivalence contract. The idiomatic routine models the Z80 stack as the JS call
 * stack (direct calls, no push16/ret of its own), so the harness performs ONE m.ret() on the
 * candidate to line pc + SP up with the oracle.
 *
 *   0. NEVER-DISPATCHED — a counting override fires 0x over a coin+start window; baseline healthy.
 *   1. REALISM (synthesised) — capture real loc_03fb entries, force the board flag each way, and
 *      confirm loc_0400 == oracle over the whole contract on both branches.
 *   2. EQUAL (crafted) — attract base + pokes: the 50m arm over the sub-0x3b byte wrap and the
 *      shift-then-read order, the not-50m arm (no row work), and each colour-cycle route under both.
 *   3. TEETH — three broken twins (wrong branch, wrong row-shift value, dropped column shift), each
 *      reusing the real idiomatic callees so the only divergence is the injected bug; each caught.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0400.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0400 as oracle } from "../../translated/loc_0400.js";
import { loc_03fb } from "../../translated/loc_03fb.js";
import { loc_0400 } from "../loc_0400.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { serviceColorCycle } from "../serviceColorCycle.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  SPRITE_OBJ_BLOCK,
  M50_OBJ1_STEP,
  M50_OBJ_ROW_SHIFT,
  BOARD,
  COLOUR_CYCLE_ACTIVE,
  FRAME,
} from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0400;
const SIBLING = 0x03fb;      // reachable capture point (0x0400 == loc_03fb entered later)
const F_Z = 0x40;            // Z flag bit in F
const RET_ADDR = 0x19b3;     // a plausible caller-return for the one net pop (any value works)
const THIRD_REC_X = 0x6910;  // SPRITE_OBJ_BLOCK + 8: X byte of the block's third record (no names.js name)
const ROW_BIAS = 0x3b;       // the 50m arm's subtraction offset
const SWEEP_COUNTER = 0x6390; // colour-cycle sweep counter (unnamed in names.js — kept hex)
const OBJ_RELOAD_GATE = 0x6393; // advanceColorCycleSweep's reload gate (from the 0413 gate)

// coin on IN2 bit7 @f10, start1 on IN2 bit2 @f30 — credits + starts a game so loc_197a's
// per-frame cascade (and thus loc_03fb) begins dispatching (~frame 1033).
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 },
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 },
];
const CAPTURE_FRAMES = 1120;
const SWEEP_FRAMES = 1300;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
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

/** All non-stack RAM addresses that changed between two machines (for no-write / non-vacuity checks). */
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

/** Run the ORACLE on a fresh clone. Its tail chain performs the net `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single net return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call stack).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${hb(ram.a)} cand=${hb(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// -- entry construction -------------------------------------------------------

function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

// A real, self-consistent attract machine for the crafted arms.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Capture the pristine machine state at the sibling loc_03fb's real entries (0x0400 is the
// same body entered one instruction later, so this is the faithful entry context).
function captureSiblingEntries(limit = 24) {
  const caps = [];
  const snap = new Map([[SIBLING, (mm) => {
    if (caps.length < limit) caps.push(mm.clone());
    return loc_03fb(mm); // let the host run proceed normally
  }]]);
  const host = makeMachine(snap);
  host.runFrames(CAPTURE_FRAMES);
  return caps;
}

// Give an entry a clean stack (one caller-return to pop) and force the board branch flag.
// The dead top-of-stack it overwrites is STACK_SCRATCH, so RAM realism is preserved below it.
function prep(base, zset) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.f = zset ? (m.regs.f | F_Z) : (m.regs.f & ~F_Z);
  return m;
}

// A crafted entry: clean stack + forced branch + the cells the routine and the colour tail read.
function craft(base, { zset, step, third, board = 1, active = 0, frame = 5, sweep = 0x10, gate = 1, rowSeed = 0 }) {
  const m = prep(base, zset);
  if (step !== undefined) m.mem.write8(M50_OBJ1_STEP, step & 0xff);
  if (third !== undefined) m.mem.write8(THIRD_REC_X, third & 0xff);
  m.mem.write8(BOARD, board & 0xff);
  m.mem.write8(COLOUR_CYCLE_ACTIVE, active & 0xff);
  m.mem.write8(FRAME, frame & 0xff);
  m.mem.write8(SWEEP_COUNTER, sweep & 0xff);
  m.mem.write8(OBJ_RELOAD_GATE, gate & 0xff);
  m.mem.write8(M50_OBJ_ROW_SHIFT, rowSeed & 0xff); // pre-existing value, so a real write is visible
  return m;
}

// -- 0. NEVER-DISPATCHED ------------------------------------------------------

test("NEVER-DISPATCHED: 0x0400 fires 0x over a coin+start window; baseline stays healthy", () => {
  let count = 0;
  const counting = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const probe = makeMachine(counting);
  probe.runFrames(SWEEP_FRAMES);
  assert.equal(count, 0, `0x0400 WAS entered (${count}x) — it is reachable after all; a live dispatch test is then required`);

  const baseline = makeMachine();
  baseline.runFrames(SWEEP_FRAMES);
  assert.equal(baseline.stoppedBy ?? null, null, `baseline stopped early: ${baseline.stoppedBy}`);
  console.log(`  NEVER-DISPATCHED: 0 entries / ${SWEEP_FRAMES} frames; baseline healthy (proven unreached, tested by synthesis)`);
});

// -- 1. REALISM (synthesised from the reachable sibling) ----------------------

test("REALISM: loc_0400 == oracle on real captured sibling entries, both branches", () => {
  const caps = captureSiblingEntries();
  assert.ok(caps.length >= 1, `expected at least one real ${hx(SIBLING)} entry within ${CAPTURE_FRAMES} frames`);

  let n = 0;
  for (const cap of caps) {
    for (const zset of [false, true]) {
      const entry = prep(cap, zset);
      const diffs = contractDiffs(entry, loc_0400);
      assert.equal(diffs.length, 0, `sibling entry (zset=${zset}): ${diffs.join("; ")}`);
      n++;
    }
  }
  console.log(`  REALISM: ${caps.length} real sibling entries × 2 branches = ${n} syntheses identical to the oracle`);
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): the 50m row-shift arm, the not-50m arm, and every colour route match", () => {
  const base = attractBase();

  const cases = [
    // not-50m arm (NZ): straight to serviceColorCycle, no row work — each colour route.
    { name: "not-50m, colour active", zset: false, active: 0x01, frame: 0x33, rowSeed: 0x77, rowArm: false },
    { name: "not-50m, colour repaint", zset: false, active: 0x00, frame: 0x05, rowSeed: 0x77, rowArm: false },
    { name: "not-50m, colour frame-wrap", zset: false, active: 0x00, frame: 0x00, rowSeed: 0x77, rowArm: false },
    // 50m arm (Z): shift the X column by step, stage (third+step-0x3b), each colour route.
    { name: "50m, mid-range, colour repaint", zset: true, step: 0x03, third: 0x80, active: 0x00, frame: 0x05, rowArm: true },
    { name: "50m, sub-0x3b byte wrap (result underflows)", zset: true, step: 0x00, third: 0x10, active: 0x00, frame: 0x05, rowArm: true },
    { name: "50m, negative step shifts left", zset: true, step: 0xff, third: 0x40, active: 0x01, frame: 0x33, rowArm: true },
    { name: "50m, colour frame-wrap route", zset: true, step: 0x02, third: 0x90, active: 0x00, frame: 0x00, rowArm: true },
  ];

  for (const c of cases) {
    const entry = craft(base, c);
    const diffs = contractDiffs(entry, loc_0400);
    assert.equal(diffs.length, 0, `${c.name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    if (c.rowArm) {
      // The rst-0x38 shifts the X column (incl. THIRD_REC_X) FIRST, then the row shift reads it:
      // M50_OBJ_ROW_SHIFT = ((third + step) - 0x3b) & 0xff. This proves the formula AND the order.
      const shifted = u8(c.third + c.step);
      assert.equal(after.mem.read8(THIRD_REC_X), shifted, `${c.name}: X column not shifted by step`);
      assert.equal(after.mem.read8(M50_OBJ_ROW_SHIFT), u8(shifted - ROW_BIAS), `${c.name}: wrong staged row-shift`);
      assert.equal(after.mem.read8(SPRITE_OBJ_BLOCK), u8(entry.mem.read8(SPRITE_OBJ_BLOCK) + c.step), `${c.name}: first record X not shifted`);
    } else {
      // Not-50m: the routine's OWN outputs are untouched (only serviceColorCycle writes).
      assert.equal(after.mem.read8(M50_OBJ_ROW_SHIFT), c.rowSeed, `${c.name}: not-50m arm wrote the row-shift`);
      assert.equal(after.mem.read8(THIRD_REC_X), entry.mem.read8(THIRD_REC_X), `${c.name}: not-50m arm shifted the column`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (not-50m × 3 routes, 50m × 4 incl. sub-wrap & negative step) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): ignores the board flag and always runs the 50m preamble. */
function teethWrongBranch(m) {
  const { regs, mem } = m;
  regs.hl = SPRITE_OBJ_BLOCK;
  regs.c = mem.read8(M50_OBJ1_STEP);
  addToSpriteObjectColumn(m);
  mem.write8(M50_OBJ_ROW_SHIFT, mem.read8(THIRD_REC_X) - ROW_BIAS);
  serviceColorCycle(m);
}

/** BUG (b): stages the row byte WITHOUT the -0x3b bias. */
function teethWrongRowShift(m) {
  const { regs, mem } = m;
  if (regs.fNZ) { serviceColorCycle(m); return; }
  regs.hl = SPRITE_OBJ_BLOCK;
  regs.c = mem.read8(M50_OBJ1_STEP);
  addToSpriteObjectColumn(m);
  mem.write8(M50_OBJ_ROW_SHIFT, mem.read8(THIRD_REC_X)); // BUG: missing - 0x3b
  serviceColorCycle(m);
}

/** BUG (c): drops the rst-0x38 sprite-column shift entirely. */
function teethDroppedColumnShift(m) {
  const { regs, mem } = m;
  if (regs.fNZ) { serviceColorCycle(m); return; }
  // BUG: no addToSpriteObjectColumn — the X column is never shifted, so the row read is stale.
  mem.write8(M50_OBJ_ROW_SHIFT, mem.read8(THIRD_REC_X) - ROW_BIAS);
  serviceColorCycle(m);
}

test("TEETH: wrong-branch, wrong-row-shift, and dropped-column-shift twins are all CAUGHT", () => {
  const base = attractBase();

  // (a) wrong branch on a NOT-50m entry: the oracle writes no row output, the twin does.
  const aEntry = craft(base, { zset: false, step: 0x03, third: 0x80, rowSeed: 0x00 });
  const aDiffs = contractDiffs(aEntry, teethWrongBranch);
  assert.ok(aDiffs.length > 0, "the wrong-branch twin escaped — the gate is worthless");
  assert.ok(aDiffs[0].startsWith(`RAM@${hx(M50_OBJ_ROW_SHIFT)}`), `expected a ${hx(M50_OBJ_ROW_SHIFT)} diff, got ${aDiffs[0]}`);

  // (b) wrong row-shift value on a 50m entry: caught at M50_OBJ_ROW_SHIFT.
  const bEntry = craft(base, { zset: true, step: 0x03, third: 0x80, rowSeed: 0x00 });
  const bDiffs = contractDiffs(bEntry, teethWrongRowShift);
  assert.ok(bDiffs.length > 0, "the wrong-row-shift twin escaped — the gate is worthless");
  assert.ok(bDiffs[0].startsWith(`RAM@${hx(M50_OBJ_ROW_SHIFT)}`), `expected a ${hx(M50_OBJ_ROW_SHIFT)} diff, got ${bDiffs[0]}`);

  // (c) dropped column shift on a 50m entry with a nonzero step: the X column stays put and the
  // row read is stale. Caught by the contract, and the column really was shifted by the oracle.
  const cEntry = craft(base, { zset: true, step: 0x05, third: 0x40, rowSeed: 0x00 });
  const cDiffs = contractDiffs(cEntry, teethDroppedColumnShift);
  assert.ok(cDiffs.length > 0, "the dropped-column-shift twin escaped — the gate is worthless");
  const oCol = runOracle(cEntry).mem.read8(SPRITE_OBJ_BLOCK);
  const tCol = runCandidate(cEntry, teethDroppedColumnShift).mem.read8(SPRITE_OBJ_BLOCK);
  assert.notEqual(oCol, tCol, "the dropped-column-shift twin left the X column identical — shift not load-bearing here");

  console.log(`  TEETH: wrong-branch caught (${aDiffs[0]}); wrong-row-shift caught (${bDiffs[0]}); dropped-column-shift caught (${cDiffs[0]})`);
});
