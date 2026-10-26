// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for redrawScoreHud (ROM 0x472c, The Pit) — the score-HUD
 * refresh. It sweeps both player slots (copy the player's saved state into the shared
 * display slot, repaint its four score digits, blank the two cells above the score
 * column), restores the active player, draws the status label from the player count
 * (one/two players -> the in-game panel drawPlayerLabel, otherwise -> the "GAME OVER" label
 * loc_48e5), and tints colour 2 up two HUD colour columns.
 *
 * THE CONTRACT — OBSERVABLE RAM. The two status-label routines it calls (drawPlayerLabel @ 0x47e1,
 * drawGameOverLabel @ 0x48e5) tail-JUMPED into the colour-column filler 0x3e01 via an m.call; that tail-jump has
 * now been DISSOLVED on both routines into a DIRECT JS call `return fillColourColumn(m)`. A direct JS call has no
 * Z80 stack frame: fillColourColumn paints its column but never rets, so the label return slot redrawScoreHud
 * pushed is left on the stack and the routine's own closing m.ret() pops THAT slot instead of the caller's return.
 * pc and SP therefore diverge from the oracle by exactly one un-popped return slot (SP off by 2), and the dead
 * residual value registers diverge too. All three are EXCLUDED here.
 *
 * WHY THAT DIVERGENCE IS BENIGN: (1) A Z80 `ret` only reads the stack and adjusts SP; it writes no memory, so the
 *   un-popped slot changes no RAM. (2) The diverged value registers are dead. All three callers of 0x472c reload
 *   their registers with a constant as the very first instruction after the call — loc_0673 (06a3: `ld a,0x01`),
 *   showSetupScreen (3a78: `ld a,0x01`; 3a7a: `ld c,0x02`), drawSharedPanel (3cc7: `ld a,0x07`). (3) The diverged
 *   pc / SP have no live consumer. redrawScoreHud is not wired live (no manifest override, no idiomatic importer):
 *   the three callers dispatch to the frozen oracle loc_472c, whose stack unwinds correctly.
 *
 * The routine's only observable output is RAM: both players' repainted score digits, the blanked cells above each
 * score column, the status label glyphs + colour, and the two tinted HUD colour columns — with ONE wrinkle:
 *
 *   THE STACK SCRATCH. The Pit's stack is real diffed work RAM (entry SP 0x83fb here). The dissolved handoff
 *   removed the push16 return slots redrawScoreHud parked just below the entry SP (the ghost byte at 0x83f7 = SP-4:
 *   oracle wrote it, the stack-free idiomatic never does), and neither side writes ABOVE the entry SP. Classic dead
 *   stack scratch, overwritten by the caller's next push before anything reads it — so the diff excludes exactly
 *   the [SP-8, SP) window and compares everything else byte-for-byte. Every real output (score digits, blanks,
 *   label, the tinted colour columns at 0x89xx/0x8bxx) sits far below the stack, so the window never hides one —
 *   the teeth confirm it (caught at real painted cells, never at the excluded 0x83f7).
 *
 * Checks:
 *   1. EQUAL (captured) — the real attract dispatch is the game-over arm (player count 0, "GAME OVER" label).
 *   2. EQUAL (harness) — an independent fresh capture of the real dispatch, clone/replay, RAM-EQUAL outside the
 *      [SP-8, SP) stack scratch (NOT through unitEquivalence: its full-dump diff would false-catch the removed
 *      push16 ghost at 0x83f7 first).
 *   3. EQUAL (crafted) — a player-count-1 entry forces the in-game-panel arm (drawPlayerLabel), which attract never
 *      reaches.
 *   4. IDENTITY — oracle vs oracle is fully EQUAL (gate wiring sanity; identical arms share pc + registers, so the
 *      strict harness still reports equal here).
 *   5. MODEL — a structural re-emit of the routine, itself RAM-EQUAL to the oracle, so each teeth twin below
 *      differs from the oracle by exactly one thing.
 *   6. TEETH — a wrong HUD colour and a wrong blank offset are both CAUGHT, and a corrupted output through the
 *      harness is CAUGHT at the corrupted painted cell — never masked by the excluded stack scratch.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-472c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_472c as oracle } from "../../translated/loc_472c.js";
import { redrawScoreHud as idiomatic } from "../redrawScoreHud.js";
import { makeMachineFactory } from "../../machine.js";
import { unitEquivalence, deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) =>
      nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x472c;
const STACK_SCRATCH = 8; // dead bytes the dissolved handoff's removed push16 slots parked below entry SP
const GAME_STATE = 0x8001; // player count -> which status label is drawn
const ACTIVE_PLAYER = 0x8002; // active player index (swept 1,2 then restored)
const ROW = 32; // one screen row across the 32-wide map
const FIRST_COLUMN_BOTTOM = 0x8ba1; // first tinted HUD colour column
const CAPTURE_FRAMES = 240; // 0x472c dispatches early in attract (its 0x48e5 arm ~frame 61)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The Pit's routine registry is async, so build the factory once and reuse it.
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Capture the pristine machine state at 0x472c's genuine attract dispatch. */
function captureRealEntry() {
  let entry = null;
  let playerCount = null;
  const overrides = new Map([
    [TARGET, (mm) => {
      if (entry === null) {
        entry = mm.clone();
        playerCount = mm.mem.read8(GAME_STATE);
      }
      return oracle(mm);
    }],
  ]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return { entry, playerCount };
}

const CAP = ROM_PRESENT ? captureRealEntry() : { entry: null, playerCount: null };
const ENTRY = CAP.entry;

/** First differing state byte between two machines, EXCLUDING the dead stack scratch the dissolved handoff parks
 *  just below the entry stack pointer — the removed push16 return slots the stack-free idiomatic never writes
 *  ([entrySP - STACK_SCRATCH, entrySP)). Compares everything else byte-for-byte. Null when otherwise identical. */
function stateDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** The observable contract: run the oracle and a candidate on two independent clones of one entry and diff the RAM
 *  dump OUTSIDE the dead [SP-8, SP) stack-scratch window; pc, SP and the value registers are unobserved (header). */
function observableDiff(entry, candidate) {
  const entrySP = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  candidate(b);
  return stateDiffOutsideStack(a, b, entrySP);
}

/** A structural re-emit of redrawScoreHud, parameterised by the two things the teeth perturb: the HUD tint colour and
 *  how many rows above the score column the second blank lands. It drives the oracle callees through the registry,
 *  so the correct instance (colour 2, blank two rows above) must itself be RAM-EQUAL to the oracle. */
function emitHud({ colour, blankRowsAbove }) {
  return function (m) {
    const { mem } = m;
    const activePlayer = mem.read8(ACTIVE_PLAYER);
    for (const [player, copyRet, drawRet] of [[1, 0x4738, 0x473b], [2, 0x474b, 0x474e]]) {
      mem.write8(ACTIVE_PLAYER, player);
      m.push16(copyRet); m.call(0x4644); // copy player state into the shared slot
      m.push16(drawRet); m.call(0x46af); // repaint the digits; base returned in ix
      const base = m.regs.ix;
      mem.write8(base - ROW, 0);
      mem.write8(base - blankRowsAbove * ROW, 0);
    }
    mem.write8(ACTIVE_PLAYER, activePlayer);
    m.push16(0x475d); m.call(0x4644);
    const players = mem.read8(GAME_STATE);
    if (players === 1 || players === 2) { m.push16(0x4768); m.call(0x47e1); }
    else { m.push16(0x476d); m.call(0x48e5); }
    let cell = 0x8ba1; for (let i = 0; i < 9; i++) { mem.write8(cell, colour); cell -= ROW; }
    cell = 0x8961; for (let i = 0; i < 10; i++) { mem.write8(cell, colour); cell -= ROW; }
    m.ret();
  };
}

const correctModel = emitHud({ colour: 2, blankRowsAbove: 2 });
const brokenColour = emitHud({ colour: 3, blankRowsAbove: 2 }); // BUG: HUD tint 3, not 2
const brokenBlank = emitHud({ colour: 2, blankRowsAbove: 3 }); // BUG: blanks the wrong cell

test("EQUAL (captured): idiomatic == oracle on the real GAME OVER dispatch (whole RAM dump)", () => {
  assert.ok(ENTRY, "captured the real 0x472c attract dispatch");
  assert.equal(CAP.playerCount, 0, "the captured dispatch is the game-over (player count 0) arm");
  const ram = observableDiff(ENTRY, idiomatic);
  assert.equal(ram, null, ram && `RAM diverged at ${hx(ram.addr ?? 0)} (oracle=${ram.a} idiomatic=${ram.b})`);
  console.log("  EQUAL/captured: real 0x472c entry identical (whole RAM dump)");
});


test("EQUAL (harness): a fresh-captured real 0x472c dispatch is RAM-EQUAL outside the stack scratch", () => {
  const { entry } = captureRealEntry();
  assert.ok(entry, "captured a real 0x472c attract dispatch");
  const ram = observableDiff(entry, idiomatic);
  assert.equal(ram, null, ram && `harness RAM diverged at ${hx(ram.addr ?? 0)} (oracle=${ram.a} idiomatic=${ram.b})`);
  console.log("  EQUAL/harness: fresh capture -> idiomatic RAM-EQUAL outside [SP-8, SP)");
});

test("EQUAL (crafted): the in-game-panel arm (player count 1 -> drawPlayerLabel) is RAM-EQUAL", () => {
  const seed = ENTRY.clone();
  seed.mem.write8(GAME_STATE, 1);
  const ram = observableDiff(seed, idiomatic);
  assert.equal(ram, null, ram && `RAM diverged at ${hx(ram.addr ?? 0)} (oracle=${ram.a} idiomatic=${ram.b})`);
  console.log("  EQUAL/crafted: player-count-1 (in-game panel) entry identical (whole RAM dump)");
});


test("IDENTITY: oracle vs oracle reports EQUAL (gate wiring sanity)", () => {
  const res = unitEquivalence(makeMachine, TARGET, oracle, oracle, { maxFrames: CAPTURE_FRAMES });
  assert.equal(res.equal, true, `gate reported a diff for identical arms: ${JSON.stringify(res)}`);
  console.log("  IDENTITY: oracle vs oracle -> EQUAL");
});

test("MODEL: the correct structural re-emit matches the oracle (so each twin isolates its bug)", () => {
  const ram = observableDiff(ENTRY, correctModel);
  assert.equal(ram, null, ram && `model RAM diverged at ${hx(ram.addr ?? 0)} (oracle=${ram.a} model=${ram.b})`);
  console.log("  MODEL: correct re-emit identical to the oracle (whole RAM dump)");
});

test("TEETH: a wrong HUD colour is CAUGHT (in a tinted colour cell)", () => {
  const ram = observableDiff(ENTRY, brokenColour);
  assert.notEqual(ram, null, "the gate FAILED to catch a wrong HUD colour — it is worthless");
  // The first diff is the lowest-address tinted cell; assert the perturbation itself: oracle colour 2, twin colour 3.
  assert.equal(ram.a, 2, `expected the oracle's tint colour 2 at ${hx(ram.addr ?? 0)}`);
  assert.equal(ram.b, 3, `expected the twin's wrong tint colour 3 at ${hx(ram.addr ?? 0)}`);
  assert.ok(ram.addr >= 0x8800, `expected a colour cell (>= 0x8800), got ${hx(ram.addr ?? 0)}`);
  console.log(`  TEETH/colour: wrong tint caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH: a wrong blank offset is CAUGHT (corrupts a written cell)", () => {
  const ram = observableDiff(ENTRY, brokenBlank);
  assert.notEqual(ram, null, "the gate FAILED to catch a wrong blank offset — it is worthless");
  console.log(`  TEETH/blank: wrong blank caught at ${hx(ram.addr ?? 0)} (oracle=${ram.a} broken=${ram.b})`);
});

/** Broken twin for the harness: the correct routine, then one wrong store to a tinted cell. */
function brokenHarness(m) {
  idiomatic(m);
  m.mem.write8(FIRST_COLUMN_BOTTOM, m.mem.read8(FIRST_COLUMN_BOTTOM) ^ 0xff); // BUG: corrupt a tinted cell
}

test("TEETH (harness): a corrupted output is CAUGHT at the corrupted cell (not the stack ghost)", () => {
  const { entry } = captureRealEntry();
  const ram = observableDiff(entry, brokenHarness);
  // The correct idiomatic is already RAM-EQUAL outside the stack scratch; the corruption is the
  // ONLY thing that moves observable RAM, so the diff must land at the corrupted painted cell —
  // proving the stack-scratch exclusion did not swallow a real cell (it would if too broad).
  assert.notEqual(ram, null, "the gate FAILED to catch the corrupted twin on RAM — it is worthless");
  assert.equal(ram.addr, FIRST_COLUMN_BOTTOM, `harness caught ${hx(ram?.addr ?? 0)} (expected ${hx(FIRST_COLUMN_BOTTOM)})`);
  console.log(`  TEETH/harness: corrupted tinted cell caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
