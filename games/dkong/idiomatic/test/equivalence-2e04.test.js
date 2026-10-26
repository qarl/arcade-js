// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for update75mActorObjects (ROM 0x2E04) — the actor-object scan loop: on 75m, while
 * Mario is alive, hand each of the ten actor-array records to the per-object updater once.
 *
 * update75mActorObjects is called every frame by the per-frame cascade loc_197a. It has three paths:
 *   • rst 0x30 board gate (mask 0x04) CLOSED -> return at once (any board but 75m).
 *   • rst 0x10 alive gate CLOSED -> return (Mario dead).
 *   • both open -> seed the object cursor at OBJ_ARRAY_65 (0x6500, stride 16) and the sprite
 *     cursor at ACTOR_SPRITES (0x6980, stride 4), then call advanceSpring ten times; advanceSpring
 *     advances both cursors itself, so ten calls sweep the whole array.
 * The idiomatic routine dissolves the oracle's rst-0x30 / rst-0x10 caller-skip stack idiom
 * into two boolean-guard returns and its djnz object loop into a direct advanceSpring call loop.
 *
 * CONTRACT (memory-equivalence): RAM − the stack scratch below the entry SP (the oracle's rst push16/ret churn and
 * advanceSpring's spawn-arm push/ret return-bracket write dead stack the direct-call candidate
 * never touches), plus pc + SP. The routine's register live-out is DEAD — loc_197a issues
 * its next call without reading A / IX / IY / B / DE — so registers are not compared; pc + SP
 * are lined up by modelling the ONE terminal caller-return every path nets (runCandidate does
 * a single m.ret() after the candidate: the two skip gates each net one caller-return pop via
 * the rst helper, and the full path nets one via the routine's own terminal `ret`).
 *
 *   0. REACHABILITY — 0x2e04 is dispatched by the attract cascade (its board gate is shut on
 *      25m, so it returns immediately — attract never reaches the object loop).
 *   1. EQUAL (captured) — hook 0x2e04 in a real boot/attract run, clone at each dispatch, and
 *      confirm update75mActorObjects == oracle on the real (rst-0x30-closed) skip path.
 *   2. EQUAL (crafted) — on a real attract base, drive: the full ten-object loop (board 3,
 *      Mario alive, objects seeded across all four advanceSpring arms), the alive-gate skip (board
 *      3, Mario dead), and the board-gate skip at every non-75m board (1/2/4). Each matches
 *      the oracle on the whole contract; the skip cases are proven to write nothing non-stack
 *      and the loop case to actually update the array.
 *   3. TEETH — five broken twins (skip the alive gate, skip the board gate, wrong board mask,
 *      wrong object count, wrong array base); the same crafted cases must catch every one.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2e04.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e04 as oracle } from "../../translated/loc_2e04.js";
import { update75mActorObjects as candidate } from "../update75mActorObjects.js";
import { boardBitGate } from "../boardBitGate.js";        // ROM 0x0030 (twins)
import { marioActiveGuard } from "../marioActiveGuard.js"; // ROM 0x0010 (twins)
import { advanceSpring } from "../advanceSpring.js";                 // ROM 0x2E12 (twins)
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  MARIO_ACTIVE,
  OBJ_ARRAY_65,
  ACTOR_SPRITES,
  OBJ_ACTIVE,
  OBJ_STATE,
  OBJ_X,
  OBJ_Y,
  FRAME,
  SPAWN_REQUEST,
  RANDOM,
  SPIN_COUNT,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2e04;
const RET_ADDR = 0x1992;   // the loc_197a site right after `call 0x2e04` (the real caller return)
const SP_TOP = 0x6c00;     // stack top: every push16 in this cascade lands in STACK_SCRATCH
const ACTOR_COUNT = 10;
const TERM_SCRATCH = 0x6110; // walk target holding the terminator (0x7f) for the terminator arm
const DEF_SCRATCH = 0x6112;  // walk target holding a normal string byte (0x10) for the default arm

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hx16 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// First RAM byte that differs, skipping the stack scratch below the entry SP (the memory-equivalence
// contract is RAM − the stack scratch below the entry SP: the oracle's rst push16/ret and the spawn arm's return
// bracket write there). null | { addr, a, b }.
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

// All non-stack RAM addresses that changed between two machines (for the skip-path
// "wrote nothing" non-vacuity check).
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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret` (or the rst skip's). */
function runOracle(entry) {
  const c = entry.clone();
  c.nextNmi = Infinity; c.nextBoundary = Infinity;
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its ONE terminal caller-return with a single
 * m.ret() so pc + SP match the oracle's: the idiomatic routine replaces the Z80 stack with the
 * JS call stack, and both skip gates and the full path net exactly one caller-return pop.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  c.nextNmi = Infinity; c.nextBoundary = Infinity;
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
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx16(o.pc)} cand=${hx16(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx16(o.regs.sp)} cand=${hx16(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic
// values. The object loop is never reached here; it is crafted by poking the board / gate.
function attractBase(frames = 700) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Seed the ten actor objects across all four advanceSpring arms (mirrors the object mix the game
// itself produces): 2 inactive -> spawn/advance, 2 state-4 -> loc_2e84, 2 terminator -> loc_2e9c
// (one above / one below the advanceSpringArcAndDropAtTravelEnd boundary), 4 default-motion -> advanceSpringArcAndDropAtTravelEnd. Position-dependent
// source bytes so a wrong field offset or a wrong cursor shows.
function seedActorObjects(m) {
  m.mem.write8(FRAME, 0x00);          // toggle fires this pass for the active objects
  m.mem.write8(SPAWN_REQUEST, 0x03);  // a spawn pending (as sub_2fcb stores) for the inactive arm
  m.mem.write8(RANDOM, 0xa5);         // deterministic spawn-arm entropy (identical on both sides)
  m.mem.write8(SPIN_COUNT, 0x00);
  m.mem.write8(TERM_SCRATCH, 0x7f);
  m.mem.write8(DEF_SCRATCH, 0x10);
  for (let k = 0; k < ACTOR_COUNT; k++) {
    const ix = OBJ_ARRAY_65 + 16 * k;
    if (k < 2) {
      m.mem.write8(ix + OBJ_ACTIVE, 0x00); // inactive -> spawn (k=0 consumes the request) / advance
    } else if (k < 4) {
      m.mem.write8(ix + OBJ_ACTIVE, 0x01);
      m.mem.write8(ix + OBJ_STATE, 0x04);  // state 4 -> loc_2e84
    } else if (k < 6) {
      m.mem.write8(ix + OBJ_ACTIVE, 0x01);
      m.mem.write8(ix + OBJ_STATE, 0x00);
      m.mem.write8(ix + 0x0e, TERM_SCRATCH & 0xff);        // walk pointer low -> terminator
      m.mem.write8(ix + 0x0f, (TERM_SCRATCH >> 8) & 0xff); // walk pointer high
      m.mem.write8(ix + OBJ_X, k === 4 ? 0xc0 : 0x40);     // one above / one below the advanceSpringArcAndDropAtTravelEnd boundary
    } else {
      m.mem.write8(ix + OBJ_ACTIVE, 0x01);
      m.mem.write8(ix + OBJ_STATE, 0x00);
      m.mem.write8(ix + 0x0e, DEF_SCRATCH & 0xff);         // walk pointer low -> default motion
      m.mem.write8(ix + 0x0f, (DEF_SCRATCH >> 8) & 0xff);
      m.mem.write8(ix + OBJ_X, (0x30 + k) & 0xff);
      m.mem.write8(ix + OBJ_Y, (0x40 + k) & 0xff);
    }
  }
}

// Stamp a crafted 0x2e04 dispatch onto a clone of the base: a stack with the real caller return
// (so the terminal ret has a sane target), the board / alive gate bytes, and (optionally) the
// ten seeded objects.
function craft(base, { board, marioActive, seed = true }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(RET_ADDR);
  m.mem.write8(BOARD, board);
  m.mem.write8(MARIO_ACTIVE, marioActive);
  if (seed) seedActorObjects(m);
  m.nextNmi = Infinity; m.nextBoundary = Infinity;
  return m;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2e04 is dispatched during boot/attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(count > 0, "0x2e04 should be dispatched — loc_197a calls it every per-frame pass");
  console.log(`  REACHABILITY: ${count} natural 0x2e04 dispatches in 1200 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------
//
// Attract plays 25m, so every real dispatch takes the rst-0x30-closed skip (the board gate
// is shut). Each must match the oracle bit-for-bit off the stack scratch.

test("EQUAL (captured): update75mActorObjects == oracle on every real dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(600);
  assert.ok(caps.length >= 1, "expected at least one real 0x2e04 dispatch during boot/attract");

  for (const entry of caps) {
    const diffs = contractDiffs(entry, candidate);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    // Confirm the real path really is the board-gate skip: the oracle wrote nothing non-stack.
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], "captured dispatch was expected to take the board-gate skip");
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (all board-gate skips)`);
});

// -- 2. EQUAL (crafted: full loop + both skip gates + mask edges) -------------

test("EQUAL (crafted): the object loop, the alive-gate skip, and every board-mask edge match", () => {
  const base = attractBase();

  // Full ten-object loop: board 3, Mario alive, objects seeded across all four arms.
  const loop = craft(base, { board: 3, marioActive: 1 });
  const loopDiffs = contractDiffs(loop, candidate);
  assert.equal(loopDiffs.length, 0, `full loop: ${loopDiffs.join("; ")}`);
  // Non-vacuity: the loop really swept the array — a default-arm object (index 6) advanced X by 2
  // and accumulated the string byte into Y, and the inactive slot 0 was activated.
  const loopO = runOracle(loop);
  assert.equal(loopO.mem.read8(OBJ_ARRAY_65 + 16 * 6 + OBJ_X), (0x36 + 2) & 0xff, "loop: object 6 X not advanced");
  assert.equal(loopO.mem.read8(OBJ_ARRAY_65 + 16 * 6 + OBJ_Y), (0x46 + 0x10) & 0xff, "loop: object 6 Y not accumulated");
  assert.equal(loopO.mem.read8(OBJ_ARRAY_65 + OBJ_ACTIVE), 1, "loop: inactive slot 0 not activated by the spawn arm");
  assert.ok(changedAddrs(loop, loopO, loop.regs.sp).length > 0, "loop: oracle wrote no non-stack RAM (vacuous)");

  // Alive-gate skip: board 3 (board gate open), Mario dead -> return with no writes.
  const dead = craft(base, { board: 3, marioActive: 0 });
  const deadDiffs = contractDiffs(dead, candidate);
  assert.equal(deadDiffs.length, 0, `alive-gate skip: ${deadDiffs.join("; ")}`);
  assert.deepEqual(changedAddrs(dead, runOracle(dead), dead.regs.sp), [], "alive-gate skip wrote non-stack RAM");

  // Board-gate skip at every non-75m board (mask 0x04 selects the current-board bit only on board 3).
  for (const board of [1, 2, 4]) {
    const skip = craft(base, { board, marioActive: 1 });
    const skipDiffs = contractDiffs(skip, candidate);
    assert.equal(skipDiffs.length, 0, `board-${board} skip: ${skipDiffs.join("; ")}`);
    assert.deepEqual(changedAddrs(skip, runOracle(skip), skip.regs.sp), [], `board-${board} skip wrote non-stack RAM`);
  }

  console.log("  EQUAL/crafted: full ten-object loop + alive-gate skip + board 1/2/4 skips identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------
//
// Each twin is a faithful copy of update75mActorObjects with ONE injected bug, calling the same idiomatic
// callees, so the ONLY difference is the mutation. The crafted cases must catch every one.

/** (a) skips the alive gate: runs the loop even when Mario is dead. */
function brokenNoAliveGate(m) {
  const { regs } = m;
  regs.a = 0x04;
  if (!boardBitGate(m)) return;
  // BUG: no marioActiveGuard check
  regs.ix = OBJ_ARRAY_65;
  regs.iy = ACTOR_SPRITES;
  for (let i = 0; i < ACTOR_COUNT; i++) advanceSpring(m);
}
/** (b) skips the board gate: runs on any board. */
function brokenNoBoardGate(m) {
  const { regs } = m;
  // BUG: no boardBitGate check
  if (!marioActiveGuard(m)) return;
  regs.ix = OBJ_ARRAY_65;
  regs.iy = ACTOR_SPRITES;
  for (let i = 0; i < ACTOR_COUNT; i++) advanceSpring(m);
}
/** (c) wrong board mask (0x08 = board 4 instead of 0x04 = board 3). */
function brokenWrongMask(m) {
  const { regs } = m;
  regs.a = 0x08; // BUG: should be 0x04
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  regs.ix = OBJ_ARRAY_65;
  regs.iy = ACTOR_SPRITES;
  for (let i = 0; i < ACTOR_COUNT; i++) advanceSpring(m);
}
/** (d) wrong object count (9, not 10) — the last record is left un-updated. */
function brokenWrongCount(m) {
  const { regs } = m;
  regs.a = 0x04;
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  regs.ix = OBJ_ARRAY_65;
  regs.iy = ACTOR_SPRITES;
  for (let i = 0; i < ACTOR_COUNT - 1; i++) advanceSpring(m); // BUG: 9 passes
}
/** (e) wrong array base (starts at record 1) — the first record is skipped. */
function brokenWrongBase(m) {
  const { regs } = m;
  regs.a = 0x04;
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  regs.ix = OBJ_ARRAY_65 + 16; // BUG: skips record 0
  regs.iy = ACTOR_SPRITES + 4;
  for (let i = 0; i < ACTOR_COUNT; i++) advanceSpring(m);
}

test("TEETH: the crafted cases CATCH every broken twin", () => {
  const base = attractBase();
  const loop = craft(base, { board: 3, marioActive: 1 }); // exercises the loop
  const dead = craft(base, { board: 3, marioActive: 0 }); // alive gate should skip
  const board1 = craft(base, { board: 1, marioActive: 1 }); // board gate should skip

  const twins = [
    ["skip alive gate", brokenNoAliveGate, dead],     // twin runs the loop; correct skips
    ["skip board gate", brokenNoBoardGate, board1],   // twin runs the loop on 25m; correct skips
    ["wrong board mask", brokenWrongMask, loop],      // twin skips on board 3; correct loops
    ["wrong object count", brokenWrongCount, loop],   // twin leaves record 9 stale
    ["wrong array base", brokenWrongBase, loop],      // twin skips record 0
  ];
  for (const [name, twin, entry] of twins) {
    const diffs = contractDiffs(entry, twin);
    assert.ok(diffs.length > 0, `the crafted case FAILED to catch "${name}" — the gate is worthless`);
    console.log(`  TEETH/${name}: caught — ${diffs.join("; ")}`);
  }
});
