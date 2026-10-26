// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for seedMarioActorRecord (ROM 0x123c) — the game-state-1 setup
 * step that spawns Mario's actor record, advances the sub-state, and posts a task.
 *
 * The routine WRITES MEMORY, calls two sub-routines, and has a gate that can skip its
 * whole body, so it is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc +
 * SP — never on a register file (its live-out is memory-only; see the routine header),
 * and every case runs on a FRESH clone (a reused clone is only safe for a read-only
 * leaf). The idiomatic routine models the Z80 `ret` as a JS return and calls its
 * callees directly (no stack modelling), so the harness performs ONE m.ret() on the
 * candidate clone after the call to line pc + SP up with the oracle:
 *
 *   - Both arms of the caller-skip gate collapse to that single net return. On EXPIRY
 *     the oracle threads push(0x123d) -> sub_0018 `ret z` -> body -> call 0x309f -> the
 *     final `ret`; on the SKIP the oracle's sub_0018 does `inc sp/inc sp/ret` to drop
 *     its own frame and return to the caller's caller. Either way it ends SP = entry+2,
 *     pc = the caller's return — which one candidate m.ret() reproduces. The transient
 *     push bytes land in STACK_SCRATCH (real SP = 0x6bf0), excluded by the contract.
 *
 *   1. EQUAL (real dispatches) — hook 0x123c in a real attract run and clone the
 *      machine at each true dispatch (88 over 4000 frames: 87 skip-arm while the gate
 *      counts down + 1 body-arm on expiry, all BOARD == 1). oracle vs candidate must
 *      agree on RAM + pc + SP for every one.
 *
 *   2. EQUAL (crafted arms) — the arms attract never reaches, from a real captured
 *      state with surgical pokes: a BOARD == 1 body arm and the unreached BOARD == 3
 *      (0xE016) body arm (poke SUBSTATE_TIMER = 1 so the gate expires), and an explicit
 *      skip arm (poke SUBSTATE_TIMER = 5). Each compared identically both sides.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a board-field swap (writes the start constant's bytes to the wrong
 *          coordinates) — caught on the body arms;
 *      (b) a gate-polarity inversion (runs the body while counting, skips on expiry) —
 *          caught on the skip arm and on real skip-arm dispatches.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-123c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_123c as oracle } from "../../translated/loc_123c.js";
import { seedMarioActorRecord } from "../seedMarioActorRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH, SUBSTATE_TIMER, BOARD, GAME_SUBSTATE,
  MARIO_ACTIVE, MARIO_X, MARIO_Y, MARIO_SPRITE_CODE, MARIO_SPRITE_ATTR,
  MARIO_MOVE_STEP_TIMER, MARIO_SPRITE_RECORD,
} from "../names.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { enqueueTask } from "../enqueueTask.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x123c;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the dead
 * stack region the standard gate excludes. The oracle transiently pushes the rst /
 * call return addresses into this region; the idiomatic routine (JS call stack) never
 * writes it, so excluding it is exactly the contract, not a fudge.
 */
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

/** Run the ORACLE on a fresh clone. It performs its own returns, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its return with ONE m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself — the harness supplies the single net return
 * that both gate arms collapse to).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. NO
 * registers — seedMarioActorRecord's live-out is memory-only, and because it calls the
 * idiomatic callees directly (whereas the oracle calls the translated ones) the two
 * leave different DEAD registers behind; comparing them would fail on values nothing
 * reads. Returns a list of human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

/** True when this entry will take the body arm (the gate expires: SUBSTATE_TIMER->0). */
const isBodyArm = (entry) => ((entry.mem.read8(SUBSTATE_TIMER) - 1) & 0xff) === 0;

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x123c in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. m.call(0x123c) resolves through the routine registry the override
 * overlays, so every dispatch is captured here.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** A real captured state with surgical pokes: gate value, board, and a safe SP. */
function craft(seed, { timer, board }) {
  const e = seed.clone();
  e.mem.write8(SUBSTATE_TIMER, timer);
  e.mem.write8(BOARD, board);
  e.regs.sp = 0x6bfe; // pushes land in STACK_SCRATCH, well clear of work RAM
  return e;
}

// -- teeth twins --------------------------------------------------------------

/**
 * Broken twin (a): the board-field swap. Writes the start constant's LOW byte where
 * the HIGH byte belongs and vice-versa (X<->Y), a plausible register mix-up. Agrees
 * on the gate but diverges on any body arm.
 */
function brokenBoardSwap(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  const board3 = mem.read8(BOARD) === 0x03;
  const startX = board3 ? 0x16 : 0x3f;
  const startY = board3 ? 0xe0 : 0xf0;
  mem.write8(MARIO_ACTIVE, 0x01);
  mem.write8(MARIO_X, startY);                 // BUG: Y where X belongs
  mem.write8(MARIO_SPRITE_RECORD + 0, startY); // BUG
  mem.write8(MARIO_SPRITE_CODE, 0x80);
  mem.write8(MARIO_SPRITE_RECORD + 1, 0x80);
  mem.write8(MARIO_SPRITE_ATTR, 0x02);
  mem.write8(MARIO_SPRITE_RECORD + 2, 0x02);
  mem.write8(MARIO_Y, startX);                 // BUG: X where Y belongs
  mem.write8(MARIO_SPRITE_RECORD + 3, startX); // BUG
  mem.write8(MARIO_MOVE_STEP_TIMER, 0x01);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  regs.d = 0x06;
  regs.e = 0x01;
  enqueueTask(m);
}

/**
 * Broken twin (b): the gate-polarity inversion. Runs the body while the counter is
 * still counting down and skips on expiry — the classic "do it every Nth frame"
 * misread. Ticks the timer identically (so the skip arm still decrements) but takes the
 * wrong branch, so it diverges on every arm.
 */
function brokenGatePolarity(m) {
  const { regs, mem } = m;
  const expired = tickSubstateTimer(m);
  if (expired) return; // BUG: inverted — should be `if (!expired) return`
  const board3 = mem.read8(BOARD) === 0x03;
  const startX = board3 ? 0x16 : 0x3f;
  const startY = board3 ? 0xe0 : 0xf0;
  mem.write8(MARIO_ACTIVE, 0x01);
  mem.write8(MARIO_X, startX);
  mem.write8(MARIO_SPRITE_RECORD + 0, startX);
  mem.write8(MARIO_SPRITE_CODE, 0x80);
  mem.write8(MARIO_SPRITE_RECORD + 1, 0x80);
  mem.write8(MARIO_SPRITE_ATTR, 0x02);
  mem.write8(MARIO_SPRITE_RECORD + 2, 0x02);
  mem.write8(MARIO_Y, startY);
  mem.write8(MARIO_SPRITE_RECORD + 3, startY);
  mem.write8(MARIO_MOVE_STEP_TIMER, 0x01);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  regs.d = 0x06;
  regs.e = 0x01;
  enqueueTask(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): seedMarioActorRecord == oracle on every captured 0x123c entry", () => {
  const caps = captureDispatches(128, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x123c dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, seedMarioActorRecord); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const body = caps.filter(isBodyArm).length;
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical (${body} body-arm, ` +
      `${caps.length - body} skip-arm; BOARD seen: ` +
      `${[...new Set(caps.map((c) => hx(c.mem.read8(BOARD))))].join(",")})`,
  );
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): BOARD==1 & BOARD==3 body arms and an explicit skip arm match the oracle", () => {
  const caps = captureDispatches(1, 4000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const cases = [
    { name: "body arm, BOARD==1 (0xF03F: X=0x3F, Y=0xF0)", e: craft(seed, { timer: 0x01, board: 0x01 }) },
    { name: "body arm, BOARD==3 (0xE016: X=0x16, Y=0xE0) — unreached by attract", e: craft(seed, { timer: 0x01, board: 0x03 }) },
    { name: "skip arm (SUBSTATE_TIMER 5 -> 4, gate still counting)", e: craft(seed, { timer: 0x05, board: 0x01 }) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, seedMarioActorRecord);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (incl. the unreached BOARD==3) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the board-field swap and the gate-polarity inversion are CAUGHT", () => {
  const caps = captureDispatches(128, 4000);
  assert.ok(caps.length >= 1, "need real captures for the teeth check");
  const seed = caps[0];

  // (a) board-field swap: only shows on a body arm, so craft both board arms.
  const bodyB1 = craft(seed, { timer: 0x01, board: 0x01 });
  const bodyB3 = craft(seed, { timer: 0x01, board: 0x03 });
  const swapB1 = contractDiffs(bodyB1, brokenBoardSwap);
  const swapB3 = contractDiffs(bodyB3, brokenBoardSwap);
  assert.ok(swapB1.length > 0, "the board-field swap escaped on the BOARD==1 body arm — the gate is worthless");
  assert.ok(swapB3.length > 0, "the board-field swap escaped on the BOARD==3 body arm — the gate is worthless");

  // (b) gate-polarity inversion: diverges on every arm. Catch it on a crafted skip arm
  //     and confirm it is caught on the real skip-arm dispatches too.
  const skip = craft(seed, { timer: 0x05, board: 0x01 });
  const polSkip = contractDiffs(skip, brokenGatePolarity);
  assert.ok(polSkip.length > 0, "the gate-polarity inversion escaped on the crafted skip arm");

  const realSkips = caps.filter((c) => !isBodyArm(c));
  let caughtReal = 0;
  for (const c of realSkips) {
    if (contractDiffs(c, brokenGatePolarity).length > 0) caughtReal++;
  }
  assert.equal(
    caughtReal, realSkips.length,
    `the gate-polarity inversion escaped on ${realSkips.length - caughtReal}/${realSkips.length} real skip dispatches`,
  );

  console.log(
    `  TEETH: board-swap caught on both body arms (e.g. ${swapB1[0]}); ` +
      `gate-polarity caught on the crafted skip arm (${polSkip[0]}) and all ${realSkips.length} real skip dispatches`,
  );
});
