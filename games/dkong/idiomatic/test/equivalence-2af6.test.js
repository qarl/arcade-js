// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2af6 (ROM 0x2AF6) — pick the platform row's drift step by
 * Mario's X (0x63A5 for the far-right half, 0x63A4 for the left half), then advance Mario
 * with it via the shared X mover moveMarioX (0x2B02).
 *
 * loc_2af6 is one arm of the moving-platform row mover, reached only through sub_2ad3 on
 * the moving-platform boards (Y == 0x78 row). Attract never rides those rows, so there are
 * ZERO real 0x2AF6 dispatches in a long attract run (see REACHABILITY); coverage is
 * therefore CRAFTED on a real attract base. The routine's whole memory-observable behaviour
 * is a total function of:
 *   - the prior X in regs.b, which selects the shadow cell (>= 0x80 -> 0x63A5, else 0x63A4);
 *   - the step byte held in the selected shadow cell, handed to moveMarioX as the velocity.
 * so a sweep over all 256 prior-X values (covering both selector halves and the X==0x80
 * boundary) with DISTINCT 0x63A4/0x63A5 steps drives both arms and, through the mover, every
 * position-gate verdict (crossed with board parity and Y band).
 *
 * DISSOLVED CALL / STACK: the oracle tail-jumps into move_2b02 (`jp 0x2b02`, no push), and
 * move_2b02's own `ret` returns on loc_2af6's behalf — so the oracle chain nets exactly ONE
 * caller-return pop. The idiomatic routine models no stack (a direct moveMarioX call, whose
 * idiomatic body does not `ret`), so runCandidate performs ONE m.ret() after it to line pc +
 * SP up with the oracle, and the RAM diff excludes the dead STACK_SCRATCH [0x6be0,0x6c00) the
 * oracle's downstream push writes. With no overrides the oracle's m.call chain (move_2b02 ->
 * sub_241f) resolves to the translated routines, so its stack accounting is self-contained.
 *
 *   1. REACHABILITY — 0x2AF6 is NOT dispatched during attract (documents why the gate is
 *      crafted; if this ever becomes nonzero, add captured coverage).
 *   2. EQUAL (crafted sweep) — loc_2af6 == oracle over the full 256 x 2 x 2 space
 *      (RAM - the stack scratch below the entry SP, pc, SP).
 *   3. TEETH — three broken twins, each MUST be caught:
 *      (a) inverted boundary (`< 0x80`)  -> wrong cell on both halves -> MARIO_X diverges.
 *      (b) off-by-one boundary (`> 0x80`) -> wrong cell only at prior X == 0x80.
 *      (c) dropped selection (always 0x63A4) -> wrong cell on the far-right half.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2af6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2af6 as oracle } from "../../translated/loc_2af6.js";
import { selectConveyorStepAndMoveMario as loc_2af6 } from "../selectConveyorStepAndMoveMario.js";
import { moveMarioX } from "../moveMarioX.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_X, MARIO_Y, BOARD, M50_OBJ2_STEP_POS, M50_OBJ2_STEP_NEG } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2af6;
// A plausible caller (sub_2ad3) return address the modelled `ret` pops. Its value is irrelevant to the compare —
// both oracle and candidate pop the SAME byte.
const RET_ADDR = 0x2ad9;

// The two published step-shadow arms this routine selects between (from names.js).
const STEP_SHADOW_HI = M50_OBJ2_STEP_POS; // 0x63A5 — used when prior X >= 0x80 (far-right half)
const STEP_SHADOW_LO = M50_OBJ2_STEP_NEG; // 0x63A4 — used when prior X <  0x80 (left half)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. { addr, a, b } | null.
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

// Run the ORACLE on a fresh clone. arm_2af6 tail-jumps into move_2b02, whose `ret` returns on its behalf (one net
// caller-return pop).
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so pc +
 * SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM - the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
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
// values. The moving-platform mover is never reached here; it is crafted.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x2AF6 dispatch onto a clone of the base: a stack with a plausible caller
 * return (so the terminal `ret` has a sane target), Mario's prior X in the live-in register,
 * DISTINCT step bytes in the two shadow cells (so a wrong pick is observable), and the Y /
 * board the downstream position gate reads. MARIO_X itself is NOT poked — the mover
 * overwrites it with (step + prior X) before the gate reads it.
 */
function craft(base, { priorX, stepHi, stepLo, y, board }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.b = priorX;
  m.mem.write8(STEP_SHADOW_HI, stepHi);
  m.mem.write8(STEP_SHADOW_LO, stepLo);
  m.mem.write8(MARIO_Y, y);
  m.mem.write8(BOARD, board);
  return m;
}

// Distinct, nonzero step bytes so (i) the add inside the mover is exercised at each X and
// (ii) selecting the wrong shadow cell always changes MARIO_X.
const STEP_HI = 0x02; // in 0x63A5 (far-right half)
const STEP_LO = 0xfe; // in 0x63A4 (left half)  — distinct from STEP_HI
const BOARDS = [0x01, 0x02]; // odd (25m/75m) and even (50m/100m) — only bit0 matters to the gate
const YBANDS = [0x30, 0x60]; // below 0x58, and at/above 0x58

function sweep(candidate) {
  const base = attractBase();
  let count = 0;
  for (let priorX = 0; priorX < 256; priorX++) {
    for (const board of BOARDS) {
      for (const y of YBANDS) {
        const entry = craft(base, { priorX, stepHi: STEP_HI, stepLo: STEP_LO, y, board });
        const diffs = contractDiffs(entry, candidate);
        count++;
        if (diffs.length) return { mismatch: { priorX, board, y, diffs }, count };
      }
    }
  }
  return { mismatch: null, count };
}

const describe = (mm) =>
  mm &&
  `at priorX=${hx(mm.priorX)} board=${hx(mm.board)} y=${hx(mm.y)}: ${mm.diffs.join("; ")}`;

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x2AF6 is NOT dispatched during attract (gate must be crafted)", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.equal(count, 0, `expected 0 natural 0x2AF6 dispatches in attract, saw ${count} — add captured coverage`);
  console.log(`  REACHABILITY: 0 natural 0x2AF6 dispatches in 3000 attract frames — crafted entries are load-bearing`);
});

// -- 2. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL (crafted sweep): loc_2af6 == oracle over all prior-X x parity x Y-band", () => {
  const { mismatch, count } = sweep(loc_2af6);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 256 * BOARDS.length * YBANDS.length, "must have compared the full crafted space");
  console.log(`  EQUAL/crafted: ${count} (prior-X, board, Y) combos — RAM - the stack scratch below the entry SP, pc, SP identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): inverts the boundary comparison — picks the wrong shadow cell on both halves. */
function brokenInvertedBoundary(m) {
  const { regs, mem } = m;
  const step = regs.b < 0x80 ? mem.read8(STEP_SHADOW_HI) : mem.read8(STEP_SHADOW_LO); // BUG: < not >=
  regs.a = step;
  moveMarioX(m);
}

/** BUG (b): off-by-one boundary (`> 0x80`) — picks the wrong cell only at prior X == 0x80. */
function brokenOffByOneBoundary(m) {
  const { regs, mem } = m;
  const step = regs.b > 0x80 ? mem.read8(STEP_SHADOW_HI) : mem.read8(STEP_SHADOW_LO); // BUG: > not >=
  regs.a = step;
  moveMarioX(m);
}

/** BUG (c): drops the X-based selection — always reads the left-half cell. */
function brokenAlwaysLo(m) {
  const { regs, mem } = m;
  const step = mem.read8(STEP_SHADOW_LO); // BUG: ignores prior X and the far-right cell
  regs.a = step;
  moveMarioX(m);
}

test("TEETH: the inverted-boundary twin is CAUGHT", () => {
  const { mismatch } = sweep(brokenInvertedBoundary);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an inverted selector boundary — the gate is worthless");
  assert.equal(mismatch.diffs[0].startsWith(`RAM@${hx(MARIO_X)}`), true,
    `expected the inverted-boundary twin to diverge on MARIO_X (${hx(MARIO_X)}), got ${mismatch.diffs[0]}`);
  console.log(`  TEETH/inverted: caught — ${describe(mismatch)}`);
});

test("TEETH: the off-by-one-boundary twin is CAUGHT (at prior X == 0x80)", () => {
  const { mismatch } = sweep(brokenOffByOneBoundary);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an off-by-one selector boundary — worthless");
  assert.equal(mismatch.priorX, 0x80, `the off-by-one twin should first diverge at prior X == 0x80, got ${hx(mismatch.priorX)}`);
  console.log(`  TEETH/off-by-one: caught — ${describe(mismatch)}`);
});

test("TEETH: the dropped-selection twin is CAUGHT", () => {
  const { mismatch } = sweep(brokenAlwaysLo);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped X-based selection — worthless");
  console.log(`  TEETH/dropped: caught — ${describe(mismatch)}`);
});
