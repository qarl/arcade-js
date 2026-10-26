// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2fcb (ROM 0x2FCB) — the timed-board bonus countdown.
 *
 * loc_2fcb WRITES memory (the two countdowns, the spawn-request pair, the task ring, the
 * bonus-expired step) and is NOT a leaf: it runs the idiomatic leaves boardBitGate
 * (rst-0x30 per-board skip gate, ROM 0x0030) and enqueueTask (task-ring post, ROM 0x309F).
 * So it is gated by capture / clone / replay with a FRESH clone per case.
 *
 * The oracle sub_2fcb is entered by `call 0x2fcb` from loc_197a (return address 0x19c2),
 * and on EVERY path returns to that caller: the gate-CLOSED arm does the rst caller-skip
 * (`pop hl` / `ret`), and each body arm ends in `ret` / `ret nz`. Net stack effect is one
 * caller-return pop on every path. loc_2fcb models no stack (the boolean gate return + a
 * plain JS return replace it), so runCandidate performs ONE m.ret() after it to line pc + SP
 * up with the oracle. The oracle's rst push (and the enqueue call's push) land in dead
 * STACK_SCRATCH, so the memory-equivalence contract (RAM − the stack scratch below the entry SP, pc, SP) is exact.
 *
 * Attract dispatches 0x2FCB 1197× over 2000 frames, but every one is the 25m demo
 * (BOARD == 1), where the mask 0x0E leaves the gate CLOSED — so real captures only ever
 * exercise the gate-closed arm. The body arms (period-elapsed spawn/enqueue, bonus-expired)
 * are CRAFTED from a real booted machine with BOARD / BONUS_TICK / BONUS poked, and the gate
 * branch is pinned by an EXHAUSTIVE BOARD 0..255 sweep.
 *
 *   1. REACHABILITY — hook 0x2FCB in attract, confirm it is dispatched, all on BOARD 1.
 *   2. EQUAL (captured) — every real attract dispatch == oracle (the gate-closed arm), the
 *      diff confined to STACK_SCRATCH; loc_2fcb touches no stack itself.
 *   3. EQUAL (crafted) — closed arm, tick-only, period-elapsed (spawn + enqueue + reload),
 *      and bonus-expired arms all match the oracle, with non-vacuous checks that each write
 *      really happened.
 *   4. BOARD (exhaustive) — sweep BOARD 0..255 with a non-elapsing tick: loc_2fcb == oracle
 *      for every value; exactly the 96 boards ≡ 2/3/4 (mod 8) open the gate.
 *   5. TEETH — four twins the suite MUST catch: wrong tick decrement, ignored board gate,
 *      dropped bonus-expired write, wrong task-message opcode.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2fcb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2fcb as oracle } from "../../translated/loc_2fcb.js";
import { tickTimedBoardBonus as loc_2fcb } from "../tickTimedBoardBonus.js";
import { boardBitGate } from "../boardBitGate.js";
import { enqueueTask } from "../enqueueTask.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  BONUS_TICK,
  BONUS_PERIOD,
  BONUS,
  BONUS_EXPIRED_STEP,
  SPAWN_REQUEST,
  TASK_TAIL,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2fcb;
const RET_ADDR = 0x19c2;   // loc_197a's continuation after `call 0x2fcb`
const BOOKKEEP_62B9 = 0x62b9; // the spawn-request sibling byte, unnamed in names.js
const PAGE = 0x6000;       // fixed high byte of every task-ring slot

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region, plus a count of how many bytes differed inside it (the tolerated push residue).
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

// All non-stack RAM addresses that changed between two machines (for no-write checks).
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
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so
 * pc + SP line up with the oracle (the idiomatic routine replaces the Z80 stack with the
 * JS call stack, so it does not touch pc/SP itself).
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
  const { bad } = ramDiffMinusStack(o, c, entry.regs.sp);
  if (bad) diffs.push(`RAM@${hx(bad.addr)} oracle=${bad.a} cand=${bad.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real booted attract machine, built once and reused as the base for every crafted
// entry (cloned per case, never mutated). Genuine work RAM; only the inputs move.
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    _base = host.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
  }
  return _base;
}

// Stamp a crafted 0x2FCB dispatch: a stack carrying a plausible caller return (so the
// modeling ret has a sane target and the oracle's rst push lands in STACK_SCRATCH), then
// the countdown/board inputs.
function craft({ board, tick, bonus, period, freeTailSlot = false }) {
  const m = base().clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(BOARD, board);
  if (tick != null) m.mem.write8(BONUS_TICK, tick);
  if (bonus != null) m.mem.write8(BONUS, bonus);
  if (period != null) m.mem.write8(BONUS_PERIOD, period);
  // Make the enqueue's target slot free so the post is observable (not silently dropped).
  if (freeTailSlot) m.mem.write8(PAGE | m.mem.read8(TASK_TAIL), 0xff);
  return m;
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x2FCB is dispatched during attract, all on the 25m board", () => {
  let count = 0; const boards = new Set();
  const snap = new Map([[TARGET, (mm) => { count++; boards.add(mm.mem.read8(BOARD)); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.ok(count > 0, "0x2FCB should be dispatched — loc_197a calls it every per-frame pass");
  assert.deepEqual([...boards], [1], "attract is the 25m demo, so every dispatch is BOARD == 1");
  console.log(`  REACHABILITY: ${count} natural 0x2FCB dispatches in 2000 frames, all BOARD=1 (gate-closed arm)`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_2fcb == oracle on every real attract dispatch (diff confined to stack)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 64) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x2FCB dispatch during attract");

  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_2fcb);
    assert.equal(diffs.length, 0, `captured dispatch (tick=${entry.mem.read8(BONUS_TICK)}): ${diffs.join("; ")}`);
    // Gate-closed arm: the oracle must touch no game-visible RAM (only the rst push,
    // which lands in dead stack scratch), so BONUS_TICK is untouched.
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], "attract dispatch must be the gate-closed no-op arm");
    // The oracle's rst push target must sit inside STACK_SCRATCH so excluding it is safe.
    assert.ok((entry.regs.sp - 2) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's rst push target must be inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`);
    // loc_2fcb must not model the stack: SP/pc unchanged before the modeling ret.
    const b = entry.clone(); const sp0 = b.regs.sp, pc0 = b.pc;
    loc_2fcb(b);
    assert.equal(b.regs.sp, sp0, "loc_2fcb must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "loc_2fcb must leave pc unchanged (no ret modelling)");
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (all gate-closed)`);
});

// -- 3. EQUAL (crafted, all body arms) ----------------------------------------

test("EQUAL (crafted): closed / tick-only / period-elapsed / bonus-expired arms all match", () => {
  // (a) CLOSED — BOARD=1 skips the whole body; only stack scratch differs.
  {
    const entry = craft({ board: 1, tick: 5 });
    assert.equal(contractDiffs(entry, loc_2fcb).length, 0, "closed arm diverged");
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], "closed arm must write no game-visible RAM");
  }

  // (b) TICK-ONLY — BOARD=2, tick 5 -> 4, nothing else runs.
  {
    const entry = craft({ board: 2, tick: 5 });
    assert.equal(contractDiffs(entry, loc_2fcb).length, 0, "tick-only arm diverged");
    const o = runOracle(entry);
    assert.equal(o.mem.read8(BONUS_TICK), 4, "tick must decrement 5 -> 4");
    assert.deepEqual(changedAddrs(entry, o, entry.regs.sp), [BONUS_TICK], "tick-only arm must write ONLY BONUS_TICK");
  }

  // (c) PERIOD-ELAPSED — BOARD=3, tick 1 -> 0: post spawn + enqueue, reload tick, bonus 5 -> 4.
  {
    const entry = craft({ board: 3, tick: 1, bonus: 5, period: 0x28, freeTailSlot: true });
    const tail0 = entry.mem.read8(TASK_TAIL);
    assert.equal(contractDiffs(entry, loc_2fcb).length, 0, "period-elapsed arm diverged");
    const o = runOracle(entry);
    assert.equal(o.mem.read8(BOOKKEEP_62B9), 3, "0x62b9 bookkeeping byte must be set to 3");
    assert.equal(o.mem.read8(SPAWN_REQUEST), 3, "SPAWN_REQUEST must be set to 3");
    assert.equal(o.mem.read8(BONUS_TICK), 0x28, "BONUS_TICK must reload from BONUS_PERIOD");
    assert.equal(o.mem.read8(BONUS), 4, "BONUS must decrement 5 -> 4");
    assert.notEqual(o.mem.read8(BONUS_EXPIRED_STEP), 1, "bonus not exhausted -> expired-step untouched");
    // The task-ring post actually landed: opcode 5 at the old tail slot, tail advanced.
    assert.equal(o.mem.read8(PAGE | tail0), 0x05, "task opcode 5 must be written at the old tail slot");
    assert.equal(o.mem.read8(TASK_TAIL), (tail0 + 2) & 0xff, "TASK_TAIL must advance by 2");
  }

  // (d) BONUS-EXPIRED — BOARD=4, tick 1 -> 0 AND bonus 1 -> 0: also set the expired step.
  {
    const entry = craft({ board: 4, tick: 1, bonus: 1, period: 0x28, freeTailSlot: true });
    assert.equal(contractDiffs(entry, loc_2fcb).length, 0, "bonus-expired arm diverged");
    const o = runOracle(entry);
    assert.equal(o.mem.read8(BONUS), 0, "BONUS must reach 0");
    assert.equal(o.mem.read8(BONUS_EXPIRED_STEP), 1, "bonus exhausted -> BONUS_EXPIRED_STEP := 1");
  }

  console.log("  EQUAL/crafted: closed, tick-only, period-elapsed (spawn+enqueue+reload), bonus-expired all identical");
});

// -- 4. BOARD (exhaustive) ----------------------------------------------------

test("BOARD (exhaustive): loc_2fcb == oracle over all 256 BOARD values (gate branch pinned)", () => {
  let opened = 0, closed = 0, mismatch = null;
  for (let board = 0; board < 256 && !mismatch; board++) {
    const entry = craft({ board, tick: 5 }); // tick 5 never elapses -> open arm just decrements it
    const diffs = contractDiffs(entry, loc_2fcb);
    // Classify from the oracle: the open arm decrements BONUS_TICK (5 -> 4).
    if (runOracle(entry).mem.read8(BONUS_TICK) !== 5) opened++; else closed++;
    if (diffs.length) mismatch = { board, diffs };
  }
  assert.equal(mismatch, null, mismatch && `mismatch at BOARD=${hx(mismatch.board)}: ${mismatch.diffs.join("; ")}`);
  // Mask 0x0E has bits 1/2/3 set, so the gate opens on boards ≡ 2/3/4 (mod 8): 32 each = 96.
  assert.equal(opened, 96, "exactly the 96 boards ≡ 2/3/4 (mod 8) must open the gate");
  assert.equal(closed, 160, "the other 160 boards must skip the body");
  console.log(`  BOARD/exhaustive: 256 values identical to the oracle (96 open, 160 closed)`);
});

// -- 5. TEETH -----------------------------------------------------------------

/** Twin (a): decrements the inner tick by 2. Faithful otherwise. */
function brokenTick(m) {
  const { regs, mem } = m;
  regs.a = 0x0e;
  if (!boardBitGate(m)) return;
  const tick = mem.read8(BONUS_TICK) - 2; // BUG: step by 2
  mem.write8(BONUS_TICK, tick);
  if (tick !== 0) return;
  mem.write8(BOOKKEEP_62B9, 3);
  mem.write8(SPAWN_REQUEST, 3);
  regs.d = 0x05; regs.e = 0x01; enqueueTask(m);
  mem.write8(BONUS_TICK, mem.read8(BONUS_PERIOD));
  const bonus = mem.read8(BONUS) - 1;
  mem.write8(BONUS, bonus);
  if (bonus !== 0) return;
  mem.write8(BONUS_EXPIRED_STEP, 1);
}

/** Twin (b): runs the body unconditionally, ignoring the board gate. */
function brokenNoGate(m) {
  const { regs, mem } = m;
  regs.a = 0x0e;
  boardBitGate(m); // consulted but its verdict ignored
  const tick = mem.read8(BONUS_TICK) - 1;
  mem.write8(BONUS_TICK, tick);
  if (tick !== 0) return;
  mem.write8(BOOKKEEP_62B9, 3);
  mem.write8(SPAWN_REQUEST, 3);
  regs.d = 0x05; regs.e = 0x01; enqueueTask(m);
  mem.write8(BONUS_TICK, mem.read8(BONUS_PERIOD));
  const bonus = mem.read8(BONUS) - 1;
  mem.write8(BONUS, bonus);
  if (bonus !== 0) return;
  mem.write8(BONUS_EXPIRED_STEP, 1);
}

/** Twin (c): drops the bonus-expired step write. Faithful otherwise. */
function brokenNoExpired(m) {
  const { regs, mem } = m;
  regs.a = 0x0e;
  if (!boardBitGate(m)) return;
  const tick = mem.read8(BONUS_TICK) - 1;
  mem.write8(BONUS_TICK, tick);
  if (tick !== 0) return;
  mem.write8(BOOKKEEP_62B9, 3);
  mem.write8(SPAWN_REQUEST, 3);
  regs.d = 0x05; regs.e = 0x01; enqueueTask(m);
  mem.write8(BONUS_TICK, mem.read8(BONUS_PERIOD));
  const bonus = mem.read8(BONUS) - 1;
  mem.write8(BONUS, bonus);
  if (bonus !== 0) return;
  // BUG: dropped mem.write8(BONUS_EXPIRED_STEP, 1)
}

/** Twin (d): marshals the wrong task opcode (6 instead of 5). Faithful otherwise. */
function brokenOpcode(m) {
  const { regs, mem } = m;
  regs.a = 0x0e;
  if (!boardBitGate(m)) return;
  const tick = mem.read8(BONUS_TICK) - 1;
  mem.write8(BONUS_TICK, tick);
  if (tick !== 0) return;
  mem.write8(BOOKKEEP_62B9, 3);
  mem.write8(SPAWN_REQUEST, 3);
  regs.d = 0x06; regs.e = 0x01; enqueueTask(m); // BUG: opcode 6
  mem.write8(BONUS_TICK, mem.read8(BONUS_PERIOD));
  const bonus = mem.read8(BONUS) - 1;
  mem.write8(BONUS, bonus);
  if (bonus !== 0) return;
  mem.write8(BONUS_EXPIRED_STEP, 1);
}

test("TEETH: wrong-tick / no-gate / dropped-expired / wrong-opcode twins are all CAUGHT", () => {
  // (a) wrong tick decrement — caught at BONUS_TICK on any open board.
  {
    const entry = craft({ board: 2, tick: 5 });
    const diffs = contractDiffs(entry, brokenTick);
    assert.ok(diffs.length > 0 && diffs[0].startsWith(`RAM@${hx(BONUS_TICK)}`),
      `wrong-tick twin escaped or was caught elsewhere: ${diffs.join("; ") || "(none)"}`);
  }
  // (b) ignored board gate — caught on a CLOSED board (BONUS_TICK moved when it should not).
  {
    const entry = craft({ board: 1, tick: 5 });
    const diffs = contractDiffs(entry, brokenNoGate);
    assert.ok(diffs.length > 0 && diffs[0].startsWith(`RAM@${hx(BONUS_TICK)}`),
      `no-gate twin escaped or was caught elsewhere: ${diffs.join("; ") || "(none)"}`);
  }
  // (c) dropped bonus-expired write — caught at BONUS_EXPIRED_STEP on the expired arm.
  {
    const entry = craft({ board: 4, tick: 1, bonus: 1, period: 0x28, freeTailSlot: true });
    const diffs = contractDiffs(entry, brokenNoExpired);
    assert.ok(diffs.length > 0 && diffs[0].startsWith(`RAM@${hx(BONUS_EXPIRED_STEP)}`),
      `dropped-expired twin escaped or was caught elsewhere: ${diffs.join("; ") || "(none)"}`);
  }
  // (d) wrong task opcode — caught in the task ring on the period-elapsed arm.
  {
    const entry = craft({ board: 3, tick: 1, bonus: 5, period: 0x28, freeTailSlot: true });
    const tail0 = entry.mem.read8(TASK_TAIL);
    const diffs = contractDiffs(entry, brokenOpcode);
    assert.ok(diffs.length > 0 && diffs[0] === `RAM@${hx(PAGE | tail0)} oracle=5 cand=6`,
      `wrong-opcode twin escaped or was caught elsewhere: ${diffs.join("; ") || "(none)"}`);
  }
  console.log("  TEETH: wrong-tick, ignored-gate, dropped-bonus-expired, and wrong-opcode twins all caught");
});
