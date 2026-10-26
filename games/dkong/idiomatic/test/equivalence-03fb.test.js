// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for slide50mSpriteRowAndServiceColorCycle (ROM 0x03FB) — the per-frame colour-cycle driver entry
 * with a 50m-only sprite-object row X-shift preamble in front of it.
 *
 * slide50mSpriteRowAndServiceColorCycle reads BOARD (0x6227) and routes two ways:
 *
 *   - BOARD != 2 (any board but 50m) -> serviceColorCycle (ROM 0x0413) directly.
 *   - BOARD == 2 (50m) -> the preamble, THEN serviceColorCycle:
 *       1. shift the X column of all ten sprite-object records (SPRITE_OBJ_BLOCK) by
 *          the 50m object-1 step (M50_OBJ1_STEP), via addToSpriteObjectColumn (rst 0x38);
 *       2. store ((the shifted third record's X byte at 0x6910) - 0x3b) into
 *          M50_OBJ_ROW_SHIFT (0x63B7).
 *
 * Its caller (loc_197a) `call`s it and the colour-cycle tail chain nets exactly ONE
 * caller-return pop down EVERY path — the rst-0x38 CALL on the BOARD == 2 arm pushes and
 * its callee pops (balanced), and both exits fall/jump into the loc_0413 colour chain
 * whose net `ret` returns on slide50mSpriteRowAndServiceColorCycle's behalf. The oracle only READS the stack past that
 * (the pushed bytes land in STACK_SCRATCH, excluded by the memory-equivalence contract).
 * The idiomatic routine models the Z80 stack as the JS call stack (direct calls, no
 * push16/ret of its own), so the harness performs ONE m.ret() on the candidate to line
 * pc + SP up with the oracle. A `new Machine(ROM)` with no overrides runs the pure
 * translated subtree for every m.call (oracle side is the frozen translated cascade); the
 * candidate side is the idiomatic cascade via direct imports. Every case runs on a FRESH
 * clone (the callees write memory).
 *
 *   1. REALISM (captured) — hook 0x03FB in a real attract run and confirm slide50mSpriteRowAndServiceColorCycle ==
 *      oracle over every natural dispatch. Attract plays 25m, so every real dispatch is
 *      BOARD == 1 (the colour-cycle hand-off); the BOARD == 2 preamble is COLD on tape.
 *
 *   2. EQUAL (crafted) — force the cold BOARD == 2 preamble (object-1 step +1 / -1 / 0,
 *      an 8-bit shift+subtract wrap) across the three colour-cycle routes (active /
 *      repaint / start-of-sweep), and the BOARD != 2 hand-off (boards 1/3/4) across the
 *      same routes, each over the whole contract (RAM - the stack scratch below the entry SP + pc + SP) plus a
 *      non-vacuity check on M50_OBJ_ROW_SHIFT (written on 50m, untouched otherwise).
 *
 *   3. TEETH — four deliberately-broken twins, each reusing the real idiomatic callees so
 *      the only divergence is the injected bug, each MUST be caught:
 *      (a) skipped preamble on 50m   — BOARD == 2 entry runs only the colour cycle; caught at 0x63B7.
 *      (b) preamble on the wrong board — BOARD == 1 entry runs the preamble; caught at 0x63B7.
 *      (c) dropped row-shift store    — 50m entry shifts but skips the M50_OBJ_ROW_SHIFT store; caught at 0x63B7.
 *      (d) wrong subtract constant    — 50m entry subtracts 0x3a instead of 0x3b; caught at 0x63B7.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-03fb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_03fb as oracle } from "../../translated/loc_03fb.js";
import { slide50mSpriteRowAndServiceColorCycle } from "../slide50mSpriteRowAndServiceColorCycle.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { serviceColorCycle } from "../serviceColorCycle.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  SPRITE_OBJ_BLOCK,
  M50_OBJ1_STEP,
  M50_OBJ_ROW_SHIFT,
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

const TARGET = 0x03fb;
const RET_ADDR = 0x19b3;          // loc_197a's return site after `call 0x03fb` (any value works)
const SPRITE_OBJ_REC2_X = 0x6910; // third sprite-object record's X byte (read back after the shift)
const SWEEP_COUNTER = 0x6390;     // colour-cycle sweep counter (unnamed in names.js — kept hex)
const OBJ_RELOAD_GATE = 0x6393;   // advanceColorCycleSweep's reload gate

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

/** Run the ORACLE on a fresh clone. Its colour tail chain performs the net `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single net return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call stack, so it
 * does not touch pc/SP itself — the harness supplies the one return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the full contract: RAM - the stack scratch below the entry SP, pc, SP. */
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

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic values.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Expected M50_OBJ_ROW_SHIFT after a BOARD == 2 preamble: the third record's X byte is first
// shifted by the object-1 step, then reduced by 0x3b (all 8-bit).
const expectedRowShift = (rec2x, step) => u8(u8(rec2x + step) - 0x3b);

/**
 * Stamp a crafted 0x03FB entry onto a clone of the base: a clean stack with a plausible caller
 * return (so the net `ret` has a sane target), the board selector, the 50m preamble inputs (the
 * object-1 step and the read-back sprite X byte, plus a SENTINEL in M50_OBJ_ROW_SHIFT so the
 * preamble's store is observable), and the colour-cycle route bytes so the tail is deterministic.
 */
function craft(base, {
  board = 1, step = 0x01, rec2x = 0x50, rowSentinel = 0xee,
  active = 0x00, frame = 0x33, sweep = 0x10, gate = 1,
} = {}) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(BOARD, board & 0xff);
  m.mem.write8(M50_OBJ1_STEP, step & 0xff);
  m.mem.write8(SPRITE_OBJ_REC2_X, rec2x & 0xff);
  m.mem.write8(M50_OBJ_ROW_SHIFT, rowSentinel & 0xff);
  m.mem.write8(COLOUR_CYCLE_ACTIVE, active & 0xff);
  m.mem.write8(FRAME, frame & 0xff);
  m.mem.write8(SWEEP_COUNTER, sweep & 0xff);
  m.mem.write8(OBJ_RELOAD_GATE, gate & 0xff);
  return m;
}

// -- 1. REALISM (captured) ----------------------------------------------------

test("REALISM: real captured 0x03FB dispatches match the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 1500) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x03FB dispatch during attract");

  let board1 = 0, board2 = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, slide50mSpriteRowAndServiceColorCycle);
    assert.equal(diffs.length, 0, `real dispatch (BOARD=${cap.mem.read8(BOARD)}): ${diffs.join("; ")}`);
    if (cap.mem.read8(BOARD) === 2) board2++; else board1++;
  }
  // Attract plays 25m, so every natural dispatch is the BOARD != 2 colour-cycle hand-off.
  assert.ok(board1 >= 1, "expected the natural BOARD != 2 (colour-cycle) path in attract");
  console.log(`  REALISM: ${caps.length} real 0x03FB dispatches identical to the oracle (${board1} colour-cycle / non-50m, ${board2} 50m preamble)`);
});

// -- 2. EQUAL (crafted, both routes) ------------------------------------------

test("EQUAL (crafted): the 50m preamble arm and the colour-cycle hand-off both match the oracle", () => {
  const base = attractBase();

  const cases = [
    // BOARD == 2 (50m): the cold preamble, across all three colour-cycle routes and step signs.
    { name: "50m preamble, step +1, active sweep", board: 2, step: 0x01, rec2x: 0x50, active: 0x01, frame: 0x33, preamble: true },
    { name: "50m preamble, step -1, repaint", board: 2, step: 0xff, rec2x: 0x50, active: 0x00, frame: 0x05, preamble: true },
    { name: "50m preamble, step 0, start-of-sweep (wrap)", board: 2, step: 0x00, rec2x: 0x50, active: 0x00, frame: 0x00, preamble: true },
    { name: "50m preamble, 8-bit shift+subtract wrap", board: 2, step: 0x05, rec2x: 0x38, active: 0x40, frame: 0x33, preamble: true },
    // BOARD != 2: the colour-cycle hand-off (no preamble), all routes and every non-50m board.
    { name: "25m hand-off, active sweep", board: 1, active: 0x01, frame: 0x33, preamble: false },
    { name: "25m hand-off, repaint", board: 1, active: 0x00, frame: 0x05, preamble: false },
    { name: "25m hand-off, start-of-sweep (wrap)", board: 1, active: 0x00, frame: 0x00, preamble: false },
    { name: "75m hand-off, repaint", board: 3, active: 0x00, frame: 0x05, preamble: false },
    { name: "100m hand-off (rivet blink), repaint", board: 4, active: 0x00, frame: 0x05, preamble: false },
  ];

  for (const c of cases) {
    const entry = craft(base, c);
    const diffs = contractDiffs(entry, slide50mSpriteRowAndServiceColorCycle);
    assert.equal(diffs.length, 0, `${c.name}: ${diffs.join("; ")}`);

    // Non-vacuity: the preamble writes M50_OBJ_ROW_SHIFT on 50m and leaves it at the sentinel otherwise.
    const after = runOracle(entry);
    if (c.preamble) {
      assert.equal(
        after.mem.read8(M50_OBJ_ROW_SHIFT), expectedRowShift(c.rec2x, c.step),
        `${c.name}: preamble did not store the expected row-shift`,
      );
    } else {
      assert.equal(
        after.mem.read8(M50_OBJ_ROW_SHIFT), 0xee,
        `${c.name}: non-50m path must not touch M50_OBJ_ROW_SHIFT`,
      );
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (50m preamble x4, colour-cycle hand-off x5) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): skips the 50m preamble entirely — just services the colour cycle. */
function teethSkippedPreamble(m) {
  serviceColorCycle(m);
}

/** BUG (b): runs the preamble on EVERY board (drops the BOARD == 2 gate). */
function teethPreambleAlways(m) {
  const { regs, mem } = m;
  regs.hl = SPRITE_OBJ_BLOCK;
  regs.c = mem.read8(M50_OBJ1_STEP);
  addToSpriteObjectColumn(m);
  mem.write8(M50_OBJ_ROW_SHIFT, mem.read8(SPRITE_OBJ_REC2_X) - 0x3b);
  serviceColorCycle(m);
}

/** BUG (c): does the sprite-column shift on 50m but forgets the M50_OBJ_ROW_SHIFT store. */
function teethDroppedStore(m) {
  const { regs, mem } = m;
  if (mem.read8(BOARD) !== 2) { serviceColorCycle(m); return; }
  regs.hl = SPRITE_OBJ_BLOCK;
  regs.c = mem.read8(M50_OBJ1_STEP);
  addToSpriteObjectColumn(m);
  // BUG: no `mem.write8(M50_OBJ_ROW_SHIFT, ...)` here
  serviceColorCycle(m);
}

/** BUG (d): subtracts 0x3a instead of 0x3b when forming the row-shift. */
function teethWrongConstant(m) {
  const { regs, mem } = m;
  if (mem.read8(BOARD) !== 2) { serviceColorCycle(m); return; }
  regs.hl = SPRITE_OBJ_BLOCK;
  regs.c = mem.read8(M50_OBJ1_STEP);
  addToSpriteObjectColumn(m);
  mem.write8(M50_OBJ_ROW_SHIFT, mem.read8(SPRITE_OBJ_REC2_X) - 0x3a); // BUG: 0x3a not 0x3b
  serviceColorCycle(m);
}

test("TEETH: skipped-preamble, preamble-always, dropped-store, and wrong-constant twins are all CAUGHT", () => {
  const base = attractBase();

  // (a) skipped preamble on 50m: the correct routine stores M50_OBJ_ROW_SHIFT (0x63B7 -> 0x16),
  //     the twin leaves it at the 0xee sentinel; caught at 0x63B7.
  const aEntry = craft(base, { board: 2, step: 0x01, rec2x: 0x50, active: 0x01, frame: 0x33 });
  const aDiffs = contractDiffs(aEntry, teethSkippedPreamble);
  assert.notEqual(aDiffs.length, 0, "the skipped-preamble twin escaped — the gate is worthless");
  assert.ok(aDiffs[0].startsWith(`RAM@${hx(M50_OBJ_ROW_SHIFT)}`), `expected a ${hx(M50_OBJ_ROW_SHIFT)} diff, got ${aDiffs[0]}`);

  // (b) preamble on the wrong board: a BOARD == 1 entry. The correct routine leaves 0x63B7 at the
  //     sentinel; the twin runs the preamble and overwrites it; caught at 0x63B7.
  const bEntry = craft(base, { board: 1, step: 0x01, rec2x: 0x50, active: 0x01, frame: 0x33 });
  const bDiffs = contractDiffs(bEntry, teethPreambleAlways);
  assert.notEqual(bDiffs.length, 0, "the preamble-always twin escaped — the gate is worthless");
  assert.ok(bDiffs[0].startsWith(`RAM@${hx(M50_OBJ_ROW_SHIFT)}`), `expected a ${hx(M50_OBJ_ROW_SHIFT)} diff, got ${bDiffs[0]}`);

  // (c) dropped store on 50m: the correct routine writes 0x63B7, the twin does not; caught at 0x63B7.
  const cEntry = craft(base, { board: 2, step: 0x01, rec2x: 0x50, active: 0x01, frame: 0x33 });
  const cDiffs = contractDiffs(cEntry, teethDroppedStore);
  assert.notEqual(cDiffs.length, 0, "the dropped-store twin escaped — the gate is worthless");
  assert.ok(cDiffs[0].startsWith(`RAM@${hx(M50_OBJ_ROW_SHIFT)}`), `expected a ${hx(M50_OBJ_ROW_SHIFT)} diff, got ${cDiffs[0]}`);

  // (d) wrong subtract constant on 50m: 0x16 (correct, x-0x3b) vs 0x17 (twin, x-0x3a); caught at 0x63B7.
  const dEntry = craft(base, { board: 2, step: 0x01, rec2x: 0x50, active: 0x01, frame: 0x33 });
  const dDiffs = contractDiffs(dEntry, teethWrongConstant);
  assert.notEqual(dDiffs.length, 0, "the wrong-constant twin escaped — the gate is worthless");
  assert.ok(dDiffs[0].startsWith(`RAM@${hx(M50_OBJ_ROW_SHIFT)}`), `expected a ${hx(M50_OBJ_ROW_SHIFT)} diff, got ${dDiffs[0]}`);

  console.log(`  TEETH: skipped-preamble caught (${aDiffs[0]}); preamble-always caught (${bDiffs[0]}); dropped-store caught (${cDiffs[0]}); wrong-constant caught (${dDiffs[0]})`);
});
