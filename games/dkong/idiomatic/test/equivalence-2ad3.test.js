// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2ad3 (ROM 0x2AD3) — carry Mario along whichever 50m moving-platform
 * row he is standing on, by dispatching on his Y band to that row's per-object step mover.
 *
 * loc_2ad3 is the 50m moving-platform mover, reached only through sub_25f2 on the 50m board
 * (right after the three per-object step publishers run). Attract only plays 25m and never
 * rides those rows, so there are ZERO real 0x2AD3 dispatches in a long attract run (see
 * REACHABILITY); coverage is therefore CRAFTED on a real attract base. The routine's whole
 * memory-observable behaviour is a total function of:
 *   - Mario's Y, which selects the row (0x50 -> object-1 step, 0x78 -> loc_2af6's X-selected
 *     object-2 step, 0xC8 -> object-3 step, anything else -> not carried);
 *   - Mario's prior X, marshalled to the movers and added to the selected step;
 *   - the step bytes in the four shadow cells (0x63A3/0x63A4/0x63A5/0x63A6);
 *   - board parity and Y band, which the movers' downstream position gate reads.
 * so a sweep over all 256 prior-X values (both mover-selector halves and the X==0x80 boundary
 * on the object-2 row) crossed with each Y band, off-row Ys, and both board parities — with
 * DISTINCT step bytes so a wrong row-to-step pick always moves Mario's X — drives every arm
 * and, through the movers, every position-gate verdict and edge nudge.
 *
 * DISSOLVED CALL / STACK: the oracle tail-jumps into move_2b02 (via arm_2af6 on the object-2
 * row), whose `ret` returns on loc_2ad3's behalf, and the off-row path `ret`s directly — so on
 * every path the oracle nets exactly ONE caller-return pop and never pushes its own. The
 * idiomatic routine models no stack (direct moveMarioX / loc_2af6 calls), so runCandidate
 * performs ONE m.ret() after it to line pc + SP up with the oracle, and the RAM diff excludes
 * the dead STACK_SCRATCH [0x6be0,0x6c00) that move_2b02's internal push writes. With no
 * overrides the oracle's whole downstream chain is translated, so its stack accounting is
 * self-contained.
 *
 *   1. REACHABILITY — 0x2AD3 is NOT dispatched during attract (documents why the gate is
 *      crafted; if this ever becomes nonzero, add captured coverage).
 *   2. EQUAL (crafted sweep) — loc_2ad3 == oracle over Y-band x all-256-prior-X x parity
 *      (RAM - the stack scratch below the entry SP, pc, SP).
 *   3. TEETH — three broken twins, each MUST be caught:
 *      (a) dropped prior-X marshal -> the movers add the step to a stale X -> MARIO_X diverges.
 *      (b) swapped row-to-step pick (object-1 row reads object-3's step) -> MARIO_X diverges.
 *      (c) missing off-row guard (off-row Y falls into the object-1 arm) -> Mario is carried
 *          when he should not be -> MARIO_X diverges on an off-row Y.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2ad3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ad3 as oracle } from "../../translated/loc_2ad3.js";
import { carryMarioOnConveyorRow as loc_2ad3 } from "../carryMarioOnConveyorRow.js";
import { moveMarioX } from "../moveMarioX.js";
import { selectConveyorStepAndMoveMario as loc_2af6 } from "../selectConveyorStepAndMoveMario.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_X,
  MARIO_Y,
  BOARD,
  M50_OBJ1_STEP,
  M50_OBJ2_STEP_POS,
  M50_OBJ2_STEP_NEG,
  M50_OBJ3_STEP,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2ad3;
// The real caller (sub_25f2_body) return address the modelled `ret` pops. Its value is
// irrelevant to the compare — both oracle and candidate pop the SAME byte — it only needs the
// two sides to agree, which they do by construction.
const RET_ADDR = 0x2601;

// Distinct, nonzero step bytes in the four 50m shadow cells so (i) the add inside the mover is
// exercised at each X and (ii) selecting the wrong row's step always changes MARIO_X.
const STEP_OBJ1 = 0x03; // 0x63A3 — object-1 row (Y == 0x50)
const STEP_OBJ2_POS = 0x05; // 0x63A5 — object-2 row, far-right half (prior X >= 0x80)
const STEP_OBJ2_NEG = 0xfb; // 0x63A4 — object-2 row, left half
const STEP_OBJ3 = 0x07; // 0x63A6 — object-3 row (Y == 0xC8)

// A sentinel left in the shared prior-X register at craft time. The correct routine overwrites
// it with MARIO_X; a twin that drops the marshal keeps this value, so any priorX != SENTINEL
// makes the drop observable through the mover's add.
const PRIOR_X_SENTINEL = 0x11;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM - the stack scratch below the entry SP). { addr, a, b } | null.
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
 * Run the ORACLE on a fresh clone. sub_2ad3 tail-jumps into its movers, whose `ret` returns on
 * its behalf (one net caller-return pop), or `ret`s directly off-row. With no overrides the
 * whole downstream chain is translated, so this is self-contained.
 */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call stack, so
 * it does not touch pc/SP itself).
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
// values. The 50m mover is never reached here; it is crafted.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x2AD3 dispatch onto a clone of the base: a stack with a plausible caller
 * return (so the terminal `ret` has a sane target), a sentinel in the shared prior-X register
 * (so a dropped marshal is observable), Mario's prior X and Y, the board the downstream
 * position gate reads, and DISTINCT step bytes in the four 50m shadow cells.
 */
function craft(base, { priorX, y, board }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.b = PRIOR_X_SENTINEL;
  m.mem.write8(MARIO_X, priorX);
  m.mem.write8(MARIO_Y, y);
  m.mem.write8(BOARD, board);
  m.mem.write8(M50_OBJ1_STEP, STEP_OBJ1);
  m.mem.write8(M50_OBJ2_STEP_POS, STEP_OBJ2_POS);
  m.mem.write8(M50_OBJ2_STEP_NEG, STEP_OBJ2_NEG);
  m.mem.write8(M50_OBJ3_STEP, STEP_OBJ3);
  return m;
}

// The three moving-platform rows, then off-row Y bands (below/between/above the rows).
const YBANDS = [0x50, 0x78, 0xc8, 0x30, 0x60, 0xff];
const BOARDS = [0x01, 0x02]; // odd (25m/75m) and even (50m/100m) — only bit0 matters to the gate

function sweep(candidate) {
  const base = attractBase();
  let count = 0;
  for (const y of YBANDS) {
    for (const board of BOARDS) {
      for (let priorX = 0; priorX < 256; priorX++) {
        const entry = craft(base, { priorX, y, board });
        const diffs = contractDiffs(entry, candidate);
        count++;
        if (diffs.length) return { mismatch: { priorX, board, y, diffs }, count };
      }
    }
  }
  return { mismatch: null, count };
}

const describe = (mm) =>
  mm && `at y=${hx(mm.y)} board=${hx(mm.board)} priorX=${hx(mm.priorX)}: ${mm.diffs.join("; ")}`;

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x2AD3 is NOT dispatched during attract (gate must be crafted)", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.equal(count, 0, `expected 0 natural 0x2AD3 dispatches in attract, saw ${count} — add captured coverage`);
  console.log(`  REACHABILITY: 0 natural 0x2AD3 dispatches in 3000 attract frames — crafted entries are load-bearing`);
});

// -- 2. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL (crafted sweep): loc_2ad3 == oracle over Y-band x all-prior-X x parity", () => {
  const { mismatch, count } = sweep(loc_2ad3);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, YBANDS.length * BOARDS.length * 256, "must have compared the full crafted space");
  console.log(`  EQUAL/crafted: ${count} (Y, board, prior-X) combos — RAM - the stack scratch below the entry SP, pc, SP identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): drops the prior-X marshal — the movers add the step to a stale prior X. */
function brokenNoMarshal(m) {
  const { regs, mem } = m;
  // BUG: does not load Mario's current X into the shared prior-X register.
  const y = mem.read8(MARIO_Y);
  if (y === 0x50) { regs.a = mem.read8(M50_OBJ1_STEP); moveMarioX(m); return; }
  if (y === 0x78) { loc_2af6(m); return; }
  if (y === 0xc8) { regs.a = mem.read8(M50_OBJ3_STEP); moveMarioX(m); return; }
}

/** BUG (b): swaps the row-to-step pick — the object-1 row reads object-3's step. */
function brokenSwappedStep(m) {
  const { regs, mem } = m;
  regs.b = mem.read8(MARIO_X);
  const y = mem.read8(MARIO_Y);
  if (y === 0x50) { regs.a = mem.read8(M50_OBJ3_STEP); moveMarioX(m); return; } // BUG: object-3 step
  if (y === 0x78) { loc_2af6(m); return; }
  if (y === 0xc8) { regs.a = mem.read8(M50_OBJ3_STEP); moveMarioX(m); return; }
}

/** BUG (c): drops the off-row guard — an off-row Y falls into the object-1 arm and is carried. */
function brokenNoOffRowGuard(m) {
  const { regs, mem } = m;
  regs.b = mem.read8(MARIO_X);
  const y = mem.read8(MARIO_Y);
  if (y === 0x78) { loc_2af6(m); return; }
  if (y === 0xc8) { regs.a = mem.read8(M50_OBJ3_STEP); moveMarioX(m); return; }
  // BUG: no off-row guard — treat everything else (including off-row Y) as the object-1 row.
  regs.a = mem.read8(M50_OBJ1_STEP);
  moveMarioX(m);
}

test("TEETH: the dropped-prior-X-marshal twin is CAUGHT", () => {
  const { mismatch } = sweep(brokenNoMarshal);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped prior-X marshal — the gate is worthless");
  assert.equal(mismatch.diffs[0].startsWith(`RAM@${hx(MARIO_X)}`), true,
    `expected the dropped-marshal twin to diverge on MARIO_X (${hx(MARIO_X)}), got ${mismatch.diffs[0]}`);
  console.log(`  TEETH/no-marshal: caught — ${describe(mismatch)}`);
});

test("TEETH: the swapped-row-to-step twin is CAUGHT (on the object-1 row)", () => {
  const { mismatch } = sweep(brokenSwappedStep);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a swapped row-to-step pick — worthless");
  assert.equal(mismatch.y, 0x50, `the swapped-step twin should first diverge on the object-1 row (Y==0x50), got ${hx(mismatch.y)}`);
  console.log(`  TEETH/swapped-step: caught — ${describe(mismatch)}`);
});

test("TEETH: the missing-off-row-guard twin is CAUGHT", () => {
  const { mismatch } = sweep(brokenNoOffRowGuard);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a missing off-row guard — worthless");
  assert.equal(YBANDS.includes(mismatch.y) && mismatch.y !== 0x50 && mismatch.y !== 0x78 && mismatch.y !== 0xc8, true,
    `the missing-off-row-guard twin should first diverge on an off-row Y, got ${hx(mismatch.y)}`);
  console.log(`  TEETH/no-off-row-guard: caught — ${describe(mismatch)}`);
});
