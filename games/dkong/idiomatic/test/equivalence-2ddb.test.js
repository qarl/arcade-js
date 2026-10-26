// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for raisePeriodicObjectSpawnRequests (ROM 0x2DDB) — on 50m/100m, while Mario is alive, raise two
 * periodic event-request latches (0x63A0, 0x639A) on a difficulty-scaled frame trigger.
 *
 * raisePeriodicObjectSpawnRequests is called every frame by the per-frame cascade loc_197a. It has three shapes:
 *   • rst 0x30 board gate (mask 0x0A) CLOSED -> return at once (any board but 50m/100m).
 *   • rst 0x10 alive gate CLOSED -> return (Mario dead).
 *   • both open -> build a frame mask from (DIFFICULTY, BOARD); if FRAME lands zero under it,
 *     write 1 to 0x63A0 and 0x639A, else write nothing.
 * The idiomatic routine dissolves the oracle's rst-0x30 / rst-0x10 caller-skip stack idiom into
 * two boolean-guard returns and its djnz mask-fold loop into a plain loop.
 *
 * CONTRACT (memory-equivalence): RAM − the stack scratch below the entry SP (the oracle's rst push16/ret churn writes
 * dead stack the direct-call candidate never touches — verified: every real dispatch pushes
 * inside [0x6BE0,0x6C00)), plus pc + SP. The register live-out is DEAD — loc_197a issues its
 * next call without reading A / B / flags — so registers are not compared; pc + SP are lined up
 * by modelling the ONE terminal caller-return every path nets (runCandidate does a single
 * m.ret() after the candidate: each skip gate nets one caller-return pop via the rst helper, and
 * the trigger/no-trigger paths net one via the routine's own terminal `ret`).
 *
 *   0. REACHABILITY — 0x2ddb is dispatched by the attract cascade (board gate shut on 25m, so it
 *      returns immediately — attract never reaches the trigger body).
 *   1. EQUAL (captured) — hook 0x2ddb in a real boot/attract run, clone at each dispatch, and
 *      confirm raisePeriodicObjectSpawnRequests == oracle on the real (rst-0x30-closed) skip path.
 *   2. EQUAL (crafted) — on a real attract base, drive boards 2 and 4 with Mario alive across a
 *      difficulty sweep AND the full 0..255 frame range (so the exact mask boundary is swept for
 *      every mask value 0xFF..0x00, incl. the difficulty-0 / difficulty-wrap edges), plus the
 *      alive-gate skip and the board-gate skip on 25m / 75m. Each matches the oracle on the whole
 *      contract; firing frames are proven to write both latches, non-firing / skip frames nothing.
 *   3. TEETH — six broken twins (skip alive gate, skip board gate, wrong board mask, drop the 50m
 *      step bump, invert the trigger polarity, raise only one latch); crafted cases catch each.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2ddb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ddb as oracle } from "../../translated/loc_2ddb.js";
import { raisePeriodicObjectSpawnRequests as candidate } from "../raisePeriodicObjectSpawnRequests.js";
import { boardBitGate } from "../boardBitGate.js";        // ROM 0x0030 (twins)
import { marioActiveGuard } from "../marioActiveGuard.js"; // ROM 0x0010 (twins)
import { Machine } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import {
  STACK_SCRATCH,
  DIFFICULTY,
  BOARD,
  FRAME,
  MARIO_ACTIVE,
  EVENT_REQ_313C,
  OBJ_SPAWN_REQ,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2ddb;
const RET_ADDR = 0x1998;    // the loc_197a site right after `call 0x2ddb` (the real caller return)
const SP_TOP = 0x6c00;      // stack top: every push16 in this cascade lands in STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hx16 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// First RAM byte that differs, skipping the stack scratch below the entry SP (the memory-equivalence
// contract is RAM − the stack scratch below the entry SP: the oracle's rst push16/ret writes there). null | { addr, a, b }.
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

// All non-stack RAM addresses that changed between two machines (for the skip / no-trigger
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
 * JS call stack, and both skip gates and the trigger/no-trigger paths net exactly one
 * caller-return pop.
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
// values. The trigger body is never reached here (attract plays 25m); it is crafted by poking.
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x2ddb dispatch onto a clone of the base: a stack with the real caller return
// (so the terminal ret has a sane target), the board / alive / difficulty / frame bytes, and the
// two request latches zeroed so a firing write (0 -> 1) is a real, detectable change.
function craft(base, { board, marioActive, difficulty, frame }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(RET_ADDR);
  m.mem.write8(BOARD, board);
  m.mem.write8(MARIO_ACTIVE, marioActive);
  m.mem.write8(DIFFICULTY, difficulty);
  m.mem.write8(FRAME, frame);
  m.mem.write8(EVENT_REQ_313C, 0);
  m.mem.write8(OBJ_SPAWN_REQ, 0);
  m.nextNmi = Infinity; m.nextBoundary = Infinity;
  return m;
}

// Reference mask (independent of the candidate) so the test can name the expected firing frames
// itself — used only for the non-vacuity classification, never as the equality oracle.
function refMask(difficulty, board) {
  let steps = u8(difficulty + 1) >> 1;
  if (board === 2) steps += 1;
  let mask = 0xfe;
  const turns = steps === 0 ? 256 : steps;
  for (let i = 0; i < turns; i++) mask = ((i === 0 ? 0x80 : 0) | (mask >> 1)) & 0xff;
  return mask;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2ddb is dispatched during boot/attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(count > 0, "0x2ddb should be dispatched — loc_197a calls it every per-frame pass");
  console.log(`  REACHABILITY: ${count} natural 0x2ddb dispatches in 1200 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------
//
// Attract plays 25m, so every real dispatch takes the rst-0x30-closed skip (the board gate is
// shut). Each must match the oracle bit-for-bit off the stack scratch and write nothing.

test("EQUAL (captured): raisePeriodicObjectSpawnRequests == oracle on every real dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(600);
  assert.ok(caps.length >= 1, "expected at least one real 0x2ddb dispatch during boot/attract");

  for (const entry of caps) {
    const diffs = contractDiffs(entry, candidate);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    // Confirm the real path really is the board-gate skip: the oracle wrote nothing non-stack.
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], "captured dispatch was expected to take the board-gate skip");
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (all board-gate skips)`);
});

// -- 2. EQUAL (crafted: trigger sweep + both skip gates) ----------------------

test("EQUAL (crafted): the difficulty/frame trigger sweep, alive-gate skip, and board-gate skips match", () => {
  const base = attractBase();

  // Difficulty values chosen to span every distinct mask (0xFF..0x00) on each board, plus the
  // difficulty-0 edge (board 2 -> mask 0xFF via the +1 bump; board 4 -> the 256-turn-wrap mask 0)
  // and the inc-wrap edge (0xFF -> inc to 0). The full 0..255 frame sweep pins each mask boundary.
  const diffsByBoard = {
    2: [0x00, 0x01, 0x03, 0x05, 0x07, 0x09, 0x0b, 0x0d, 0x0f, 0x11, 0xfe, 0xff],
    4: [0x00, 0x01, 0x02, 0x03, 0x05, 0x07, 0x09, 0x0b, 0x0d, 0x0f, 0x11, 0xfe, 0xff],
  };

  let combos = 0, fired = 0, quiet = 0;
  for (const board of [2, 4]) {
    for (const difficulty of diffsByBoard[board]) {
      const mask = refMask(difficulty, board);
      for (let frame = 0; frame < 256; frame++) {
        const entry = craft(base, { board, marioActive: 1, difficulty, frame });
        const diffs = contractDiffs(entry, candidate);
        assert.equal(
          diffs.length, 0,
          `board=${board} diff=${hx(difficulty)} frame=${hx(frame)} mask=${hx(mask)}: ${diffs.join("; ")}`,
        );
        // Non-vacuity: a firing frame writes BOTH latches to 1; a non-firing frame writes nothing.
        const o = runOracle(entry);
        if ((frame & mask) === 0) {
          assert.equal(o.mem.read8(EVENT_REQ_313C), 1, `board=${board} diff=${hx(difficulty)} frame=${hx(frame)}: 0x63A0 not raised`);
          assert.equal(o.mem.read8(OBJ_SPAWN_REQ), 1, `board=${board} diff=${hx(difficulty)} frame=${hx(frame)}: 0x639A not raised`);
          fired++;
        } else {
          assert.deepEqual(changedAddrs(entry, o, entry.regs.sp), [], `board=${board} diff=${hx(difficulty)} frame=${hx(frame)}: no-trigger path wrote RAM`);
          quiet++;
        }
        combos++;
      }
    }
  }
  assert.ok(fired > 0 && quiet > 0, "the sweep must exercise BOTH firing and non-firing frames");
  console.log(`  EQUAL/crafted: ${combos} (board, difficulty, frame) combos identical to the oracle (${fired} firing, ${quiet} quiet)`);

  // Alive-gate skip: board 4 (board gate open), Mario dead -> return with no writes.
  const dead = craft(base, { board: 4, marioActive: 0, difficulty: 0x01, frame: 0x00 });
  assert.equal(contractDiffs(dead, candidate).length, 0, "alive-gate skip diverged");
  assert.deepEqual(changedAddrs(dead, runOracle(dead), dead.regs.sp), [], "alive-gate skip wrote non-stack RAM");

  // Board-gate skip on 25m / 75m (mask 0x0A selects the current-board bit only on boards 2 and 4).
  for (const board of [1, 3]) {
    const skip = craft(base, { board, marioActive: 1, difficulty: 0x01, frame: 0x00 });
    assert.equal(contractDiffs(skip, candidate).length, 0, `board-${board} skip diverged`);
    assert.deepEqual(changedAddrs(skip, runOracle(skip), skip.regs.sp), [], `board-${board} skip wrote non-stack RAM`);
  }
  console.log("  EQUAL/crafted: alive-gate skip + board 1/3 skips identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------
//
// Each twin is a faithful copy of raisePeriodicObjectSpawnRequests with ONE injected bug, calling the same idiomatic
// callees, so the ONLY difference is the mutation. Crafted cases must catch every one.

function buildMask(steps) {
  let mask = 0xfe;
  const turns = steps === 0 ? 256 : steps;
  for (let i = 0; i < turns; i++) mask = ((i === 0 ? 0x80 : 0) | (mask >> 1)) & 0xff;
  return mask;
}

/** (a) skips the alive gate: raises the latches even when Mario is dead. */
function brokenNoAliveGate(m) {
  const { regs, mem } = m;
  regs.a = 0x0a;
  if (!boardBitGate(m)) return;
  // BUG: no marioActiveGuard check
  let steps = u8(mem.read8(DIFFICULTY) + 1) >> 1;
  if (mem.read8(BOARD) === 2) steps += 1;
  if ((mem.read8(FRAME) & buildMask(steps)) !== 0) return;
  mem.write8(EVENT_REQ_313C, 1); mem.write8(OBJ_SPAWN_REQ, 1);
}
/** (b) skips the board gate: runs on any board. */
function brokenNoBoardGate(m) {
  const { mem } = m;
  // BUG: no boardBitGate check
  if (!marioActiveGuard(m)) return;
  let steps = u8(mem.read8(DIFFICULTY) + 1) >> 1;
  if (mem.read8(BOARD) === 2) steps += 1;
  if ((mem.read8(FRAME) & buildMask(steps)) !== 0) return;
  mem.write8(EVENT_REQ_313C, 1); mem.write8(OBJ_SPAWN_REQ, 1);
}
/** (c) wrong board mask (0x05 = boards 1/3 instead of 0x0A = boards 2/4). */
function brokenWrongMask(m) {
  const { regs, mem } = m;
  regs.a = 0x05; // BUG: should be 0x0a
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  let steps = u8(mem.read8(DIFFICULTY) + 1) >> 1;
  if (mem.read8(BOARD) === 2) steps += 1;
  if ((mem.read8(FRAME) & buildMask(steps)) !== 0) return;
  mem.write8(EVENT_REQ_313C, 1); mem.write8(OBJ_SPAWN_REQ, 1);
}
/** (d) drops the 50m step bump (no +1 on board 2 -> wrong mask on 50m). */
function brokenNoBump(m) {
  const { regs, mem } = m;
  regs.a = 0x0a;
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  const steps = u8(mem.read8(DIFFICULTY) + 1) >> 1; // BUG: no +1 on board 2
  if ((mem.read8(FRAME) & buildMask(steps)) !== 0) return;
  mem.write8(EVENT_REQ_313C, 1); mem.write8(OBJ_SPAWN_REQ, 1);
}
/** (e) inverts the trigger polarity (fires when the masked frame is non-zero). */
function brokenPolarity(m) {
  const { regs, mem } = m;
  regs.a = 0x0a;
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  let steps = u8(mem.read8(DIFFICULTY) + 1) >> 1;
  if (mem.read8(BOARD) === 2) steps += 1;
  if ((mem.read8(FRAME) & buildMask(steps)) === 0) return; // BUG: inverted
  mem.write8(EVENT_REQ_313C, 1); mem.write8(OBJ_SPAWN_REQ, 1);
}
/** (f) raises only the first latch. */
function brokenOneLatch(m) {
  const { regs, mem } = m;
  regs.a = 0x0a;
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  let steps = u8(mem.read8(DIFFICULTY) + 1) >> 1;
  if (mem.read8(BOARD) === 2) steps += 1;
  if ((mem.read8(FRAME) & buildMask(steps)) !== 0) return;
  mem.write8(EVENT_REQ_313C, 1); // BUG: 0x639A left un-raised
}

test("TEETH: the crafted cases CATCH every broken twin", () => {
  const base = attractBase();
  const fireB4 = craft(base, { board: 4, marioActive: 1, difficulty: 0x01, frame: 0x00 }); // mask 0xFF, fires
  const fireB2 = craft(base, { board: 2, marioActive: 1, difficulty: 0x00, frame: 0x00 }); // mask 0xFF, fires
  const deadB2 = craft(base, { board: 2, marioActive: 0, difficulty: 0x01, frame: 0x00 }); // alive gate skips
  const board1 = craft(base, { board: 1, marioActive: 1, difficulty: 0x01, frame: 0x00 }); // board gate skips
  const bump   = craft(base, { board: 2, marioActive: 1, difficulty: 0x01, frame: 0x80 }); // bump: mask 0x7F fires; no-bump 0xFF quiet

  const twins = [
    ["skip alive gate", brokenNoAliveGate, deadB2],  // twin raises latches; correct skips (Mario dead)
    ["skip board gate", brokenNoBoardGate, board1],  // twin raises on 25m; correct skips
    ["wrong board mask", brokenWrongMask, fireB2],   // twin's 0x05 shuts the gate on board 2; correct fires
    ["drop 50m bump", brokenNoBump, bump],           // twin quiet (mask 0xFF); correct fires (mask 0x7F)
    ["invert polarity", brokenPolarity, fireB4],     // twin quiet on the firing frame; correct fires
    ["one latch only", brokenOneLatch, fireB4],      // twin leaves 0x639A at 0; correct raises both
  ];
  for (const [name, twin, entry] of twins) {
    const diffs = contractDiffs(entry, twin);
    assert.ok(diffs.length > 0, `the crafted case FAILED to catch "${name}" — the gate is worthless`);
    console.log(`  TEETH/${name}: caught — ${diffs.join("; ")}`);
  }
});
