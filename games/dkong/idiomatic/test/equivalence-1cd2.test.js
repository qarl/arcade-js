// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceMarioWalkX (ROM 0x1CD2) — advance Mario one pixel along a
 * horizontal walk step: MARIO_X += the signed walk delta; on 25m (BOARD == 1) re-snap
 * MARIO_Y to the sloped girder under the new X via snapYToGirder; then tail into
 * continueWalkStep (which decrements the sub-step timer and refreshes the sprite record).
 *
 * The routine WRITES MEMORY and ends by tailing into continueWalkStep's `ret`, so it is
 * gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never on a register
 * file (its live-out is memory-only; see the routine header). Every case runs on a FRESH
 * clone (this routine writes; a reused clone is only safe for a read-only leaf).
 *
 * REGISTER ABI: the oracle reads B (the signed walk delta the caller loads) and, on 25m,
 * passes H = the new X, L = the current Y, B = the delta into 0x2333. The idiomatic
 * routine takes `delta` as a parameter and calls snapYToGirder(newX, Y, delta) directly.
 *
 * STACK: the oracle brackets the 25m clamp with a push16(0x1ce7)/call(0x2333)/ret (the
 * pushed bytes linger in RAM — the Z80 does not clear popped bytes), and every path nets
 * exactly ONE caller-return pop through the loc_1ceb -> loc_1da6 tail. The idiomatic
 * routine models no stack (direct JS calls), so the pushed 0x1ce7 lives only in the dead
 * STACK_SCRATCH region (excluded by the memory-equivalence contract) and the harness
 * performs ONE m.ret() on the candidate to line pc + SP up with the oracle.
 *
 *   1. EQUAL (real dispatches) — hook 0x1cd2 in a real attract run (the 25m demo walks
 *      Mario, so this fires each in-progress move frame) and clone at each true dispatch;
 *      oracle vs candidate agree on RAM + pc + SP for every one, passing the captured
 *      delta (regs.b) to the candidate. Attract only ever exercises BOARD == 1 moving
 *      right, so the crafted arms below cover the rest.
 *   2. EQUAL (crafted) — the non-25m skip arm (BOARD 2/4, Y untouched), the leftward
 *      (delta 255) and held (delta 0) deltas, the off-boundary hold, and the top-marker
 *      (Y 240) and ledge-marker (Y 76) girder sentinels with X on both sides of their
 *      thresholds. Each compared identically both sides, plus a non-vacuity check that the
 *      oracle's resulting X/Y match the independently-computed expectation.
 *   3. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) always-clamp (drops the BOARD guard) — caught at MARIO_Y on a non-25m entry.
 *      (b) wrong X delta (subtract instead of add) — caught at MARIO_X.
 *      (c) swapped snapYToGirder args (x/y transposed) — caught at MARIO_Y on 25m.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1cd2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1cd2 as oracle } from "../../translated/loc_1cd2.js";
import { advanceMarioWalkX } from "../advanceMarioWalkX.js";
import { snapYToGirder } from "../snapYToGirder.js";
import { continueWalkStep } from "../continueWalkStep.js";
import { Machine } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import { STACK_SCRATCH, MARIO_X, MARIO_Y, BOARD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1cd2;
const FRAMES = 800;         // the 25m demo is walking Mario well before this
const RET_ADDR = 0x1cb0;    // a plausible caller-return; only pc-equality matters, not its value
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
 *  region (the oracle's push16(0x1ce7) + the tail `ret` linger there; the idiomatic
 *  routine uses the JS call stack, so excluding it is the contract, not a fudge). */
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

/** Run the ORACLE on a fresh clone; its tail `ret` advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its single net return with ONE m.ret()
 *  so pc + SP match the oracle's. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. */
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

// The idiomatic routine takes the walk delta as a parameter; wrap it for the harness.
const withDelta = (delta) => (c) => advanceMarioWalkX(c, delta);

// -- capture + craft ----------------------------------------------------------

/** Hook 0x1cd2 in a real attract run; clone the machine at up to K real dispatches. */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push({ entry: mm.clone(), delta: mm.regs.b });
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

/** A real, self-consistent attract machine (its clone neutralises the frame machinery). */
function attractBase(frames = 400) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/** Stamp a crafted 0x1cd2 dispatch onto a clone of the base: a stack with a plausible
 *  caller return (so the terminal `ret` has a sane target), the signed walk delta in B
 *  (the register the oracle reads), then Mario's X/Y and the board. */
function craft(base, { x, y, board, delta }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.b = delta; // the oracle's delta live-in; the candidate is handed the same value
  m.mem.write8(MARIO_X, x);
  m.mem.write8(MARIO_Y, y);
  m.mem.write8(BOARD, board);
  return m;
}

// Independent expectation for a case: X always += delta; Y re-snapped only on 25m.
const expectX = ({ x, delta }) => u8(x + delta);
const expectY = ({ x, y, board, delta }) =>
  board === 1 ? snapYToGirder(u8(x + delta), y, delta) : y;

// -- teeth twins --------------------------------------------------------------

/** (a) always-clamp: runs the girder snap + Y store regardless of the board. */
function brokenAlwaysClamp(m, delta) {
  const { mem } = m;
  const newX = u8(mem.read8(MARIO_X) + delta);
  mem.write8(MARIO_X, newX);
  mem.write8(MARIO_Y, snapYToGirder(newX, mem.read8(MARIO_Y), delta)); // BUG: no BOARD == 1 guard
  return continueWalkStep(m);
}

/** (b) wrong X delta: subtracts the walk delta instead of adding it. */
function brokenWrongX(m, delta) {
  const { mem } = m;
  const newX = u8(mem.read8(MARIO_X) - delta); // BUG: should add
  mem.write8(MARIO_X, newX);
  if (mem.read8(BOARD) === 1) mem.write8(MARIO_Y, snapYToGirder(newX, mem.read8(MARIO_Y), delta));
  return continueWalkStep(m);
}

/** (c) swapped snapYToGirder args: passes (Y, X) where the oracle passes (X, Y). */
function brokenSwappedArgs(m, delta) {
  const { mem } = m;
  const newX = u8(mem.read8(MARIO_X) + delta);
  mem.write8(MARIO_X, newX);
  if (mem.read8(BOARD) === 1) {
    mem.write8(MARIO_Y, snapYToGirder(mem.read8(MARIO_Y), newX, delta)); // BUG: x/y transposed
  }
  return continueWalkStep(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("REACHABILITY + EQUAL (real dispatches): advanceMarioWalkX == oracle on every captured 0x1cd2 entry", () => {
  const caps = captureDispatches(256, FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x1cd2 dispatch during attract");
  for (const { entry, delta } of caps) {
    const diffs = contractDiffs(entry, withDelta(delta)); // FRESH clones inside — entry untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const deltas = new Set(caps.map((c) => c.delta));
  const xs = new Set(caps.map((c) => c.entry.mem.read8(MARIO_X)));
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(distinct deltas: [${[...deltas].join(",")}], distinct X seen: ${xs.size})`,
  );
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): skip arm, left/held deltas, boundary hold, and the girder sentinels match", () => {
  const base = attractBase();

  const cases = [
    // non-25m skip arm: X advances, Y is left untouched (BOARD != 1).
    { name: "BOARD 2 skip (right)", x: 0x4f, y: 0x30, board: 2, delta: 1 },
    { name: "BOARD 4 skip (left)",  x: 0x80, y: 0x50, board: 4, delta: 0xff },
    // 25m ordinary run: right/left steps and an off-boundary hold.
    { name: "25m right on boundary",  x: 0x3f, y: 0x10, board: 1, delta: 1 },    // newX 0x40 subCell 0 -> steps
    { name: "25m left on boundary",   x: 0x10, y: 0x10, board: 1, delta: 0xff }, // newX 0x0f subCell 15 -> steps
    { name: "25m off-boundary hold",  x: 0x41, y: 0x10, board: 1, delta: 1 },    // newX 0x42 subCell 2 -> Y held
    { name: "25m held delta 0",       x: 0x2f, y: 0x10, board: 1, delta: 0 },    // X unchanged, subCell 15 left-steps
    // top-marker girder sentinel (Y 240): descends only while X is in the upper half.
    { name: "25m top-marker descend", x: 0x8f, y: 240, board: 1, delta: 1 }, // newX 0x90 (&0x80 set) -> steps
    { name: "25m top-marker hold",    x: 0x0f, y: 240, board: 1, delta: 1 }, // newX 0x10 (&0x80 clear) -> held
    // ledge-marker girder sentinel (Y 76): rises only once X has reached 152.
    { name: "25m ledge-marker rise",  x: 0x9f, y: 76, board: 1, delta: 1 }, // newX 0xa0 (>=152) -> steps
    { name: "25m ledge-marker hold",  x: 0x8f, y: 76, board: 1, delta: 1 }, // newX 0x90 (<152) -> held
  ];

  for (const c of cases) {
    const entry = craft(base, c);
    const diffs = contractDiffs(entry, withDelta(c.delta));
    assert.equal(diffs.length, 0, `${c.name}: ${diffs.join("; ")}`);

    // Non-vacuity: the oracle really moved X and re-snapped (or held) Y as expected.
    const after = runOracle(entry);
    assert.equal(after.mem.read8(MARIO_X), expectX(c), `${c.name}: X not advanced as expected`);
    assert.equal(after.mem.read8(MARIO_Y), expectY(c), `${c.name}: Y not as expected`);
    if (c.board !== 1) {
      assert.equal(after.mem.read8(MARIO_Y), c.y, `${c.name}: non-25m arm must not touch Y`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (skip, left/held, off-boundary, top/ledge sentinels) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: always-clamp, wrong-X, and swapped-args twins are CAUGHT", () => {
  const base = attractBase();

  // (a) always-clamp — a non-25m entry where the clamp WOULD change Y (newX subCell 0,
  //     bit5(Y) set -> snapYToGirder steps Y down). Correct leaves Y alone; the twin writes it.
  const clampEntry = craft(base, { x: 0x4f, y: 0x30, board: 2, delta: 1 }); // newX 0x50
  assert.equal(runOracle(clampEntry).mem.read8(MARIO_Y), 0x30, "sanity: non-25m arm must hold Y");
  assert.notEqual(snapYToGirder(0x50, 0x30, 1), 0x30, "sanity: the clamp must change Y here for the twin to diverge");
  const dClamp = contractDiffs(clampEntry, (c) => brokenAlwaysClamp(c, 1));
  assert.ok(dClamp.length > 0, "the always-clamp twin escaped — the gate is worthless");
  assert.ok(dClamp[0].startsWith(`RAM@${hx(MARIO_Y)}`), `expected the Y diff first, got ${dClamp[0]}`);

  // (b) wrong X delta — any moving 25m entry; correct X = newX+1, twin X = newX-1.
  const xEntry = craft(base, { x: 0x40, y: 0x10, board: 1, delta: 1 });
  const dX = contractDiffs(xEntry, (c) => brokenWrongX(c, 1));
  assert.ok(dX.length > 0, "the wrong-X twin escaped — the gate is worthless");
  assert.ok(dX[0].startsWith(`RAM@${hx(MARIO_X)}`), `expected the X diff first, got ${dX[0]}`);

  // (c) swapped snapYToGirder args — a 25m entry where snapYToGirder(X,Y) != snapYToGirder(Y,X).
  const swapEntry = craft(base, { x: 0x7f, y: 0x10, board: 1, delta: 1 }); // newX 0x80
  assert.notEqual(
    snapYToGirder(0x80, 0x10, 1), snapYToGirder(0x10, 0x80, 1),
    "sanity: X/Y must be transposition-sensitive here for the twin to diverge",
  );
  const dSwap = contractDiffs(swapEntry, (c) => brokenSwappedArgs(c, 1));
  assert.ok(dSwap.length > 0, "the swapped-args twin escaped — the gate is worthless");
  assert.ok(dSwap[0].startsWith(`RAM@${hx(MARIO_Y)}`), `expected the Y diff first, got ${dSwap[0]}`);

  console.log(`  TEETH: always-clamp caught (${dClamp[0]}); wrong-X caught (${dX[0]}); swapped-args caught (${dSwap[0]})`);
});
