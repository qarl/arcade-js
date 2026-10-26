// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for service75mBoard (ROM 0x26FA) — the board-gated per-pass service
 * dispatcher: a board gate, then a route to the edge reset, the board-object service,
 * the vertical-reposition machine, or an idle, by the mover's Y and a level-scaled
 * frame cadence.
 *
 * service75mBoard itself reads only the board/position/level/frame and writes NOTHING of its
 * own — every memory effect is the dispatched callee's (killMarioAtEndOfLiftTravel, serviceBoardObjects,
 * loc_271e), each already idiomatic and memory-equivalent to its own oracle. So this
 * test proves service75mBoard's DISPATCH: that the same inputs route to the same callee.
 *
 * THE STACK NETS UNIFORMLY. Every oracle exit nets exactly ONE caller-return pop
 * (SP -> entry+2, pc -> the popped return): the board gate's closed arm double-pops
 * (dropping the pushed body address), the three tail-jumps into the callees each end
 * on the callee's terminal `ret`, and the level-1 idle path `ret`s directly. So the
 * candidate is run then given ONE m.ret() to line pc + SP up with the oracle — the
 * same shim equivalence-03a2/-0350/-271e use.
 *
 * The oracle also churns the stack: the gate pushes then pops the body address 0x26FD,
 * and the loc_271e arm brackets its delegation with push16(0x2721)/ret. Those bytes
 * live in STACK_SCRATCH [0x6be0,0x6c00) and are excluded by the memory-equivalence
 * contract (firstRamDiff); every live work-RAM cell is still compared, and pc + SP are
 * asserted to prove the dissolved brackets line up.
 *
 * 0x26FA rides the ROM-0x197A gameplay cascade the 25m attract demo never drives into
 * the gate-open body (board 3 only), so the body arms are validated by CRAFTED entries
 * on a real booted base; any real gate-closed skips attract does dispatch are validated
 * too.
 *
 *   0. REACHABILITY — count natural 0x26FA dispatches; validate each against the oracle.
 *   1. EQUAL (crafted, all arms) — service75mBoard == oracle over RAM − the stack scratch below the entry SP + pc + SP
 *      across: gate closed (no write), edge reset (killMarioAtEndOfLiftTravel), both cadence branches into
 *      serviceBoardObjects and loc_271e on level 1 and a later level, and the level-1
 *      idle phases — each with its callee's signature write asserted (non-vacuity), and
 *      the off-track boundary (Y 239 vs 240) proving the `>= 240` test.
 *   2. BOUNDED EXCLUSION — on a loc_271e body arm the ONLY whole-dump diff lands inside
 *      STACK_SCRATCH, so the exclusion hides nothing live.
 *   3. TEETH — three broken twins the crafted arms MUST catch: a dropped board gate, a
 *      dropped off-track edge check, and a swapped cadence parity.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-26fa.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_26fa as oracle } from "../../translated/loc_26fa.js";
import { service75mBoard } from "../service75mBoard.js";
// The teeth twins reuse the real idiomatic callees (their own gates prove them faithful)
// so only service75mBoard's dispatch logic is what can diverge.
import { boardBitGate } from "../boardBitGate.js";
import { killMarioAtEndOfLiftTravel } from "../killMarioAtEndOfLiftTravel.js";
import { serviceBoardObjects } from "../serviceBoardObjects.js";
import { loc_271e } from "../loc_271e.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  BOARD,
  MARIO_Y,
  LEVEL,
  FRAME,
  MARIO_ACTIVE,
  EDGE_REPOSITION_FLAG,
  MARIO_AIRBORNE,
  MARIO_X,
  MARIO_SPRITE_RECORD,
  SPRITE_Y,
  OBJ_ARRAY_66,
  OBJ_ACTIVE,
  OBJ_X,
  OBJ_Y,
  OBJ_STATE,
  SPAWN_TIMER,
  SPRITE_BUFFER,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x26fa;
// sub_26fa is reached by `call 0x26FA` at ROM 0x19A7 (3 bytes), so the caller's return
// address on the stack is 0x19AA — the target the terminal pop lands on.
const RET_ADDR = 0x19aa;

const GATE_OPEN_BOARD = 3;   // mask 0x04 (bit2) selects board 3
const GATE_CLOSED_BOARD = 1; // any other board closes the gate
const MARIO_ACTIVE_PRIOR = 0xa5; // the edge reset clears this to 0 -> observable
const SPRITE_Y_CELL = MARIO_SPRITE_RECORD + SPRITE_Y; // Mario's sprite-record Y (loc_271e mirror)
const PUBLISH_BASE = SPRITE_BUFFER + 88; // the board objects' sprite records (serviceBoardObjects)
const OBJ_STRIDE = 16;
const OBJ0_X = 0x37; // object 0's X, published to PUBLISH_BASE by serviceBoardObjects

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// Every NON-STACK RAM address that changed between two machines (the oracle's push
// churn in STACK_SCRATCH is excluded, so this is a genuine live-write set).
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

/** Run the ORACLE on a fresh clone. It performs its own gate/tail-call/ret brackets. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so
 * pc + SP match the oracle's — service75mBoard replaces the Z80 stack with the JS call stack,
 * so it does not touch pc/SP itself, and the oracle nets one caller-return pop on every
 * path.
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

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. The gate-open body is never reached here; entries are crafted.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * A crafted 0x26FA dispatch onto a clone of the base: a stack carrying a plausible
 * caller return (so the terminal pop is well-defined), the four dispatch inputs, and
 * observable priors so every callee's write shows:
 *   - MARIO_ACTIVE nonzero  -> the edge reset (killMarioAtEndOfLiftTravel) clears it to 0.
 *   - EDGE flag set + grounded + MARIO_X in the down-mover band + MARIO_Y a step value
 *     -> loc_271e steps MARIO_Y and mirrors it to the sprite record.
 *   - six inactive board objects + an off-beat spawn timer -> serviceBoardObjects
 *     advances nothing, spawns nothing, and publishes each object's X/Y (object 0's X
 *     lands at PUBLISH_BASE).
 */
function craft(base, { board, marioY, level = 2, frame = 0x00 }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);

  m.mem.write8(BOARD, board);
  m.mem.write8(MARIO_Y, marioY);
  m.mem.write8(LEVEL, level);
  m.mem.write8(FRAME, frame);

  // killMarioAtEndOfLiftTravel observability.
  m.mem.write8(MARIO_ACTIVE, MARIO_ACTIVE_PRIOR);

  // loc_271e (down-mover step) observability: flag set, grounded, X in band, sprite-Y clear.
  m.mem.write8(EDGE_REPOSITION_FLAG, 0x01);
  m.mem.write8(MARIO_AIRBORNE, 0x00);
  m.mem.write8(MARIO_X, 0x30);
  m.mem.write8(SPRITE_Y_CELL, 0x00);

  // serviceBoardObjects observability: six inactive objects, off-beat spawn timer.
  m.mem.write8(SPAWN_TIMER, 0x05);
  for (let i = 0; i < 6; i++) {
    const b = OBJ_ARRAY_66 + i * OBJ_STRIDE;
    m.mem.write8(b + OBJ_ACTIVE, 0x00);
    m.mem.write8(b + OBJ_X, i === 0 ? OBJ0_X : 0x20 + i);
    m.mem.write8(b + OBJ_Y, 0x40 + i);
    m.mem.write8(b + OBJ_STATE, 0x00);
  }
  m.mem.write8(PUBLISH_BASE, 0x00); // sentinel: publish writes object 0's X here

  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: count natural 0x26FA dispatches and validate each against the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 96) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);

  for (const cap of caps) {
    cap.nextNmi = Infinity;
    cap.nextBoundary = Infinity;
    const diffs = contractDiffs(cap, service75mBoard);
    assert.equal(diffs.length, 0, `real dispatch diverged: ${diffs.join("; ")}`);
  }
  // The gate-open body is board-3-only and unreached in 25m attract; the crafted arms
  // carry that proof. Any dispatch that DOES occur (a gate-closed skip) is validated.
  console.log(`  REACHABILITY: ${caps.length} natural 0x26FA dispatches in 2000 attract frames — all identical to the oracle`);
});

// -- 1. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): every dispatch arm matches the oracle over RAM − stack + pc + SP", () => {
  const base = attractBase();

  const cases = [
    // Gate closed on another board: the whole routine is skipped, nothing written.
    { name: "gate closed (board 1)", opts: { board: GATE_CLOSED_BOARD, marioY: 0xff }, arm: "skip" },
    // Off the top of the track -> edge reset, regardless of level/frame.
    { name: "edge reset (Y 240)", opts: { board: GATE_OPEN_BOARD, marioY: 240, level: 2, frame: 0x01 }, arm: "edge" },
    { name: "edge reset (Y 255)", opts: { board: GATE_OPEN_BOARD, marioY: 255, level: 1, frame: 0x00 }, arm: "edge" },
    // Off-track boundary: Y 239 is NOT off-track -> falls into the cadence.
    { name: "boundary Y 239 (below edge)", opts: { board: GATE_OPEN_BOARD, marioY: 239, level: 2, frame: 0x01 }, arm: "objects" },
    // Later-level fast cadence: odd frame -> objects, even frame -> reposition.
    { name: "L2 odd frame -> objects", opts: { board: GATE_OPEN_BOARD, marioY: 0x80, level: 2, frame: 0x01 }, arm: "objects" },
    { name: "L2 even frame -> reposition", opts: { board: GATE_OPEN_BOARD, marioY: 0x80, level: 2, frame: 0x02 }, arm: "reposition" },
    // Level-1 slow cadence: phase 0 -> objects, phase 1 -> reposition, phases 2/3 idle.
    { name: "L1 phase 0 -> objects", opts: { board: GATE_OPEN_BOARD, marioY: 0x80, level: 1, frame: 0x04 }, arm: "objects" },
    { name: "L1 phase 1 -> reposition", opts: { board: GATE_OPEN_BOARD, marioY: 0x80, level: 1, frame: 0x05 }, arm: "reposition" },
    { name: "L1 phase 2 -> idle", opts: { board: GATE_OPEN_BOARD, marioY: 0x80, level: 1, frame: 0x06 }, arm: "idle" },
    { name: "L1 phase 3 -> idle", opts: { board: GATE_OPEN_BOARD, marioY: 0x80, level: 1, frame: 0x07 }, arm: "idle" },
  ];

  for (const { name, opts, arm } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, service75mBoard);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Non-vacuity: the oracle took the expected arm and left its signature.
    const after = runOracle(entry);
    if (arm === "skip" || arm === "idle") {
      assert.deepEqual(changedAddrs(entry, after, entry.regs.sp), [], `${name}: expected no live write, got ${changedAddrs(entry, after, entry.regs.sp).map(hx)}`);
    } else if (arm === "edge") {
      assert.equal(after.mem.read8(MARIO_ACTIVE), 0, `${name}: edge reset must clear MARIO_ACTIVE`);
      assert.equal(after.mem.read8(EDGE_REPOSITION_FLAG), 0, `${name}: edge reset must clear EDGE_REPOSITION_FLAG`);
    } else if (arm === "objects") {
      assert.equal(after.mem.read8(PUBLISH_BASE), OBJ0_X, `${name}: serviceBoardObjects must publish object 0's X`);
      assert.equal(after.mem.read8(MARIO_ACTIVE), MARIO_ACTIVE_PRIOR, `${name}: objects arm must not touch MARIO_ACTIVE`);
    } else { // reposition
      assert.equal(after.mem.read8(MARIO_Y), 0x7f, `${name}: reposition must step MARIO_Y 0x80 -> 0x7f`);
      assert.equal(after.mem.read8(SPRITE_Y_CELL), 0x7f, `${name}: reposition must mirror MARIO_Y to the sprite record`);
      assert.equal(after.mem.read8(MARIO_ACTIVE), MARIO_ACTIVE_PRIOR, `${name}: reposition step must not touch MARIO_ACTIVE`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (skip, edge x2, boundary, cadence L2 x2 + L1 x2, idle x2) identical to the oracle`);
});

// -- 2. BOUNDED EXCLUSION -----------------------------------------------------

test("BOUNDED EXCLUSION: the ONLY whole-dump oracle-vs-candidate diff lands in STACK_SCRATCH", () => {
  const base = attractBase();

  // A loc_271e body arm (board 3, Y a step value, level 2, even frame): the oracle
  // writes live work RAM (MARIO_Y + sprite-Y) AND pushes 0x2721 into the stack scratch.
  const entry = craft(base, { board: GATE_OPEN_BOARD, marioY: 0x80, level: 2, frame: 0x02 });
  const o = entry.clone(); oracle(o);
  const c = entry.clone(); service75mBoard(c); c.ret();

  // Stack excluded -> identical.
  assert.equal(firstRamDiff(o, c, entry.regs.sp), null, "stack-excluded contract must be identical on a loc_271e body arm");

  // Whole-dump diff is non-null and inside STACK_SCRATCH — proving the oracle really
  // does push (so the exclusion is load-bearing) and that the push is all it hides.
  const whole = firstStateDiff(o.dumpState(), c.dumpState(), (off) => o.stateOffsetToAddr(off));
  assert.notEqual(whole, null, "expected the oracle's stack churn to show up in the whole-dump diff");
  assert.ok(deadStackBelow(STACK_SCRATCH, entry.regs.sp)(whole.addr), `the only whole-dump diff must be in the stack scratch below the entry SP, got ${hx(whole.addr)}`);

  console.log(`  BOUNDED EXCLUSION: live RAM identical; the sole whole-dump diff is at ${hx(whole.addr)} (dead stack scratch)`);
});

// -- 3. TEETH -----------------------------------------------------------------

const OFF_TRACK_Y = 240;

/** The shared cadence tail, used by the twins so only their one break differs. */
function dispatchCadence(m) {
  const { mem } = m;
  const level = mem.read8(LEVEL);
  const frame = mem.read8(FRAME);
  if (level !== 1) {
    if ((frame & 1) !== 0) { serviceBoardObjects(m); return; }
    loc_271e(m); return;
  }
  const phase = frame & 3;
  if (phase === 1) { loc_271e(m); return; }
  if (phase === 0) { serviceBoardObjects(m); return; }
}

/** Twin (a): drops the board gate — runs the body on every board. */
function brokenNoGate(m) {
  const { mem } = m;
  // BUG: no `regs.a = 0x04; if (!boardBitGate(m)) return;`
  if (mem.read8(MARIO_Y) >= OFF_TRACK_Y) { killMarioAtEndOfLiftTravel(m); return; }
  dispatchCadence(m);
}

/** Twin (b): drops the off-track edge check — an off-track mover falls into the cadence. */
function brokenNoEdge(m) {
  const { regs, mem } = m;
  regs.a = 0x04;
  if (!boardBitGate(m)) return;
  // BUG: no `if (mem.read8(MARIO_Y) >= OFF_TRACK_Y) { killMarioAtEndOfLiftTravel(m); return; }`
  dispatchCadence(m);
}

/** Twin (c): swaps the later-level cadence parity — objects/reposition inverted. */
function brokenSwapCadence(m) {
  const { regs, mem } = m;
  regs.a = 0x04;
  if (!boardBitGate(m)) return;
  if (mem.read8(MARIO_Y) >= OFF_TRACK_Y) { killMarioAtEndOfLiftTravel(m); return; }
  const level = mem.read8(LEVEL);
  const frame = mem.read8(FRAME);
  if (level !== 1) {
    if ((frame & 1) !== 0) { loc_271e(m); return; }   // BUG: should be serviceBoardObjects
    serviceBoardObjects(m); return;                    // BUG: should be loc_271e
  }
  const phase = frame & 3;
  if (phase === 1) { loc_271e(m); return; }
  if (phase === 0) { serviceBoardObjects(m); return; }
}

test("TEETH: dropped-gate, dropped-edge, and swapped-cadence twins are CAUGHT", () => {
  const base = attractBase();

  // (a) dropped gate: board 1 closes the gate, but Y 255 makes the twin run the edge
  //     reset — the oracle writes nothing, the twin clears MARIO_ACTIVE.
  const gateEntry = craft(base, { board: GATE_CLOSED_BOARD, marioY: 255, level: 2, frame: 0x01 });
  const gateDiffs = contractDiffs(gateEntry, brokenNoGate);
  assert.ok(gateDiffs.length > 0, "the dropped-gate twin escaped — the gate is worthless");
  assert.ok(gateDiffs[0].startsWith(`RAM@${hx(MARIO_ACTIVE)}`), `expected the dropped-gate diff at ${hx(MARIO_ACTIVE)}, got ${gateDiffs[0]}`);

  // (b) dropped edge check: Y 255 off-track should hit the reset; the twin routes it to
  //     the odd-frame objects arm instead — the oracle clears MARIO_ACTIVE, the twin
  //     leaves it and publishes objects.
  const edgeEntry = craft(base, { board: GATE_OPEN_BOARD, marioY: 255, level: 2, frame: 0x01 });
  const edgeDiffs = contractDiffs(edgeEntry, brokenNoEdge);
  assert.ok(edgeDiffs.length > 0, "the dropped-edge twin escaped — the gate is worthless");
  assert.ok(edgeDiffs[0].startsWith(`RAM@${hx(MARIO_ACTIVE)}`), `expected the dropped-edge diff at ${hx(MARIO_ACTIVE)}, got ${edgeDiffs[0]}`);

  // (c) swapped cadence: L2 odd frame should service the objects; the twin repositions
  //     Mario instead — caught at MARIO_Y (0x6205, below the sprite buffer).
  const swapEntry = craft(base, { board: GATE_OPEN_BOARD, marioY: 0x80, level: 2, frame: 0x01 });
  const swapDiffs = contractDiffs(swapEntry, brokenSwapCadence);
  assert.ok(swapDiffs.length > 0, "the swapped-cadence twin escaped — the gate is worthless");
  assert.ok(swapDiffs[0].startsWith(`RAM@${hx(MARIO_Y)}`), `expected the swapped-cadence diff at ${hx(MARIO_Y)}, got ${swapDiffs[0]}`);

  console.log(`  TEETH: dropped-gate caught (${gateDiffs[0]}); dropped-edge caught (${edgeDiffs[0]}); swapped-cadence caught (${swapDiffs[0]})`);
});
