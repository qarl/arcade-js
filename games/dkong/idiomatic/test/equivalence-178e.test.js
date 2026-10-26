// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceToNextBoard (ROM 0x178E) — the board-sequence advance.
 *
 * advanceToNextBoard WRITES memory (BOARD_SEQ_PTR / BOARD / the task ring / 0x6388 /
 * SUBSTATE_TIMER / GAME_SUBSTATE) and calls two sub-routines, so it is gated by
 * capture / clone / replay (docs/decompiler-pipeline), NOT the exhaustive-leaf pattern. It is dispatched
 * only during board-advance (GAME_STATE == 3, GAME_SUBSTATE == 0x16, dispatchBoardClearedInterlude's rst-0x28
 * table, 0x6388 selector at this step) — a state a bounded attract run never reaches — so
 * its real entries are FORCED with an identical-both-sides poke (Karl's sanctioned "poke
 * the board state to reach a state for validation", applied to oracle and candidate
 * alike, so equivalence is preserved):
 *
 *   1. EQUAL (forced real dispatches) — hold GAME_STATE=3 / GAME_SUBSTATE=0x16 / BOARD
 *      bit0 / the 0x6388 selector / SUBSTATE_TIMER=1 across a window so 0x178E dispatches
 *      AND runs its body every frame (the pointer walks a fresh board index each time).
 *      Clone the machine at each true dispatch (a FRESH clone per case — the routine
 *      mutates RAM), run the ORACLE on one clone and advanceToNextBoard on another, and
 *      confirm IDENTICAL RAM everywhere game-visible — the only tolerated residue is in
 *      STACK_SCRATCH (the oracle models push/ret; the idiomatic call does not). Also
 *      confirm advanceToNextBoard leaves SP + pc untouched (it models no stack).
 *
 *   2. EQUAL (crafted arms) — the three data-dependent paths, each poked one variable
 *      identically on both sides on a real captured entry (docs/decompiler-pipeline crafted entry):
 *        - SKIP    : SUBSTATE_TIMER=5 → the rst-0x18 gate has not expired → early return.
 *        - WALK    : SUBSTATE_TIMER=1, BOARD_SEQ_PTR=0x3A65 → +1=0x3A66 is a board byte.
 *        - WRAP    : SUBSTATE_TIMER=1, BOARD_SEQ_PTR=0x3A78 → +1=0x3A79 is the 0x7F
 *                    terminator → reload 0x3A73 (the level-loop wrap).
 *
 *   3. TEETH — a deliberately-broken twin that walks the pointer by 2 instead of 1 (a
 *      plausible off-by-one, the analogue of enqueueTask's tail-advance teeth) MUST be
 *      caught: it publishes the wrong BOARD and leaves BOARD_SEQ_PTR wrong. A gate a real
 *      board-advance corruption slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-178e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_178e as oracle } from "../../translated/loc_178e.js";
import { advanceToNextBoard } from "../advanceToNextBoard.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { enqueueTask } from "../enqueueTask.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, BOARD_SEQ_PTR, SUBSTATE_TIMER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x178e;
const POKE_FRAME = 100;
const HOLD_DUR = 40; // held so 0x178E dispatches + runs its body every frame
const FRAMES = 140; // run ends within the hold
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Identical-both-sides poke that forces board-advance / the 0x1623 table / this selector
// / gate-expiry, held so 0x178E dispatches AND executes its body every frame. A fresh
// copy per machine keeps runs independent.
const FORCE_178E_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_STATE = 3 (in-game)
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_SUBSTATE = 0x16 (board-advance)
  { addr: 0x6227, val: 0x01, frame: POKE_FRAME, dur: HOLD_DUR }, // BOARD bit0 set -> 0x1623 table
  { addr: 0x6388, val: 0x05, frame: POKE_FRAME, dur: HOLD_DUR }, // selector 5 -> 0x178E
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: HOLD_DUR }, // rst-0x18 gate expires -> body runs
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_178E_POKE.map((p) => ({ ...p }));
  return m;
};

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch (the tolerated oracle push/ret residue).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry through the oracle and a candidate on FRESH clones (per side —
 *  the routine writes RAM), and return the game-visible diff. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x178E in a forced board-advance run and clone the machine at up to K true
 * dispatches. Each clone is one real captured entry; the wrapper delegates to the
 * oracle so the host run proceeds undisturbed.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(maxFrames);
  return caps;
}

// Broken twin: walks the board-order pointer by 2 instead of 1 (a plausible off-by-one).
// It reads the wrong table byte -> publishes the wrong BOARD and stores the wrong
// BOARD_SEQ_PTR; everything else is verbatim. Only a real replay catches it.
function brokenAdvance(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  let ptr = (mem.read16(BOARD_SEQ_PTR) + 2) & 0xffff; // BUG: should be +1
  let board = mem.read8(ptr);
  if (board === 0x7f) { ptr = 0x3a73; board = mem.read8(ptr); }
  mem.write16(BOARD_SEQ_PTR, ptr);
  mem.write8(BOARD, board);
  regs.d = 0x05; regs.e = 0x00;
  enqueueTask(m);
  mem.write8(0x6388, 0x00);
  mem.write8(SUBSTATE_TIMER, 0x30);
  mem.write8(0x600a, 0x08);
}

// -- 1. EQUAL (forced real dispatches) ----------------------------------------

test("EQUAL (captured): advanceToNextBoard == oracle on every forced dispatch (diff stack-confined)", () => {
  const caps = captureDispatches(32, FRAMES);
  assert.ok(caps.length >= 1, "expected at least one forced 0x178E dispatch in the hold window");

  for (const entry of caps) {
    const { bad } = replay(entry, advanceToNextBoard);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on seqPtr=${hx(entry.mem.read16(BOARD_SEQ_PTR))}`,
    );
    // The oracle's push (rst-0x18 return addr, then the enqueue return addr) writes at
    // SP-2; that residue must sit inside dead stack scratch, so excluding the stack scratch below the entry SP
    // cannot mask a real diff.
    assert.ok(
      (entry.regs.sp - 2) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's push target must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    // advanceToNextBoard must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    advanceToNextBoard(b);
    assert.equal(b.regs.sp, sp0, "advanceToNextBoard must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "advanceToNextBoard must leave pc unchanged (no ret modelling)");
  }
  console.log(`  EQUAL/captured: ${caps.length} forced dispatches — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): SKIP / WALK / WRAP arms match the oracle", () => {
  const caps = captureDispatches(1, POKE_FRAME + 5);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  const arms = [
    // Gate not expired -> early return; only SUBSTATE_TIMER is decremented.
    ["SKIP", (m) => { m.mem.write8(SUBSTATE_TIMER, 0x05); }],
    // Gate expires, pointer at a normal board byte (0x3A66 = 0x04) -> keep it.
    ["WALK", (m) => { m.mem.write8(SUBSTATE_TIMER, 0x01); m.mem.write16(BOARD_SEQ_PTR, 0x3a65); }],
    // Gate expires, pointer walks onto the 0x7F terminator (0x3A79) -> reload 0x3A73.
    ["WRAP", (m) => { m.mem.write8(SUBSTATE_TIMER, 0x01); m.mem.write16(BOARD_SEQ_PTR, 0x3a78); }],
  ];

  for (const [label, craft] of arms) {
    const a = entry.clone(); const b = entry.clone();
    craft(a); craft(b);
    oracle(a);
    advanceToNextBoard(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(
      `  EQUAL/crafted ${label}: seqPtr -> ${hx(b.mem.read16(BOARD_SEQ_PTR))}, BOARD -> ${hx(b.mem.read8(BOARD))}, identical`,
    );
  }
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong pointer advance is CAUGHT and names BOARD (0x6227)", () => {
  const caps = captureDispatches(1, POKE_FRAME + 5);
  assert.ok(caps.length >= 1, "need a real entry to craft the teeth from");

  // Deterministic WALK entry: 0x3A66 = 0x04 (oracle's board) vs 0x3A67 = 0x01 (broken's),
  // so BOARD (0x6227, the lowest differing output) differs for sure.
  const entry = caps[0].clone();
  entry.mem.write8(SUBSTATE_TIMER, 0x01);
  entry.mem.write16(BOARD_SEQ_PTR, 0x3a65);

  const { bad } = replay(entry, brokenAdvance);
  assert.notEqual(bad, null, "the replay FAILED to catch a wrong pointer advance — it is worthless");
  assert.equal(bad.addr, BOARD, `expected the first caught diff at BOARD 0x6227, got ${hx(bad.addr)}`);
  console.log(`  TEETH: caught at ${hx(bad.addr)} (oracle=${hx(bad.a)} broken=${hx(bad.b)})`);

  // ...and it is caught across the forced real dispatches too, at a board output.
  const sweep = captureDispatches(32, FRAMES);
  let caught = null;
  for (const e of sweep) { const r = replay(e, brokenAdvance); if (r.bad) { caught = r.bad; break; } }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch the wrong advance");
  assert.ok(
    caught.addr === BOARD || caught.addr === BOARD_SEQ_PTR,
    `expected the caught diff at a board output (0x6227/0x622a), got ${hx(caught.addr)}`,
  );
  console.log(`  TEETH/captured: caught at ${hx(caught.addr)} (oracle=${hx(caught.a)} broken=${hx(caught.b)})`);
});
