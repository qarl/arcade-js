// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resetToBoardBuildToContinuePlay (ROM 0x15d1, Pooyan) — the play dispatcher's post-dispatch
 * continuation. Four exits, all returning to the frame caller (the NMI epilogue): ret while the game
 * is active; tail `jp 0x0bb5` (shared attract epilogue) on free play; ret with no credit; else force
 * the board-build state, run the board/HUD reset (resetBoardRamAndReseedSpawnCounters) and arena clear (zeroSpriteListAndActorArena), and blank an
 * eight-tile attribute column.
 *
 * The idiomatic module dissolves resetBoardRamAndReseedSpawnCounters/zeroSpriteListAndActorArena to direct calls and keeps the tail m.call(0x0bb5);
 * the oracle drives the same frozen callees and the same tail. resetToBoardBuildToContinuePlay is a void continuation — the
 * frame caller restores every register — so no register is compared; equivalence is RAM (dumpState)
 * minus stack scratch below the entry SP, with SP parked in dead stack so the oracle's transient return-slot pushes drop
 * out.
 *
 * Jobs:
 *   1. EQUAL — all four arms: oracle == resetToBoardBuildToContinuePlay in RAM (−stack).
 *   2. WRITE-SET — the main arm forces main-state 2 + sub-index 0 and blanks the column.
 *   3. TEETH — a wrong blank tile is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the free-play arm tail-dispatches to the shared epilogue; assert it is seam-placeable.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-15d1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_15d1 as oracle } from "../../translated/loc_15d1.js";
import { resetToBoardBuildToContinuePlay } from "../resetToBoardBuildToContinuePlay.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const GAME_ACTIVE = 0x8806; //  ret while a game is live
const COINAGE = 0x882c; //      0x0f = free play -> shared epilogue tail
const CREDIT = 0x8802; //       ret when no credit remains
const MAIN_STATE = 0x8805; //   forced to 2 (board build) on the main arm
const SUB_INDEX = 0x880a; //    cleared to 0 on the main arm
const COLUMN = 0x855f; //       first (bottom) blank tile of the attribute column
const COLUMN_TOP = 0x847f; //   eighth tile, 7 rows up (COLUMN − 7*0x20)
const INPUT0 = 0x8810; //       read by the shared epilogue on the free-play arm
const FREE_PLAY = 0x0f;
const SP0 = 0x8ff0; //          inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //   caller-return word the free-play tail-dispatch consumes

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone seated on a caller-return word, holding the machine on the named arm. */
function craft(arm) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[GAME_ACTIVE] = 0x00;
  m.mem8[COINAGE] = 0x00; // not free play
  m.mem8[CREDIT] = 0x01; // credit present
  m.mem8[MAIN_STATE] = 0x00; // free-play arm: the epilogue breaks out on state != 1
  m.mem8[INPUT0] = 0x00; // free-play arm: no start pressed -> epilogue rets cleanly
  if (arm === "active") m.mem8[GAME_ACTIVE] = 0x01;
  if (arm === "freeplay") m.mem8[COINAGE] = FREE_PLAY;
  if (arm === "nocredit") m.mem8[CREDIT] = 0x00;
  return m; // arm === "main" uses the defaults above
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: all four arms — resetToBoardBuildToContinuePlay == oracle in RAM (−stack)", () => {
  for (const arm of ["active", "freeplay", "nocredit", "main"]) {
    const o = craft(arm);
    oracle(o);
    const c = craft(arm);
    resetToBoardBuildToContinuePlay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${arm}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: active + freeplay + nocredit + main identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the main arm rebuilds the board and blanks the column", () => {
  const o = craft("main");
  oracle(o);
  assert.equal(o.mem8[MAIN_STATE], 0x02, "main state forced to board-build (2)");
  assert.equal(o.mem8[SUB_INDEX], 0x00, "sub-index cleared");
  assert.equal(o.mem8[COLUMN], 0x10, "bottom blank tile");
  assert.equal(o.mem8[COLUMN_TOP], 0x10, "top blank tile (7 rows up)");

  const nocredit = craft("nocredit");
  oracle(nocredit);
  assert.notEqual(nocredit.mem8[MAIN_STATE], 0x02, "no-credit arm leaves the state alone");
  console.log("  WRITE-SET: main arm forces state 2 + clears sub-index + blanks the column");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong blank tile is CAUGHT by the RAM diff", () => {
  const o = craft("main");
  const c = craft("main");
  oracle(o);
  resetToBoardBuildToContinuePlay(c);
  c.mem8[COLUMN_TOP] = 0x00; // BUG: the top column tile must have been blanked to 0x10
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong column tile — it is worthless");
  assert.equal(d.addr, COLUMN_TOP, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong column tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: the free-play arm tail-dispatches to the shared epilogue — seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, resetToBoardBuildToContinuePlay, 0x15d1, craft("freeplay"));
  assert.equal(r.placeable, true, `free-play tail-dispatch must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: free-play tail-dispatch placeable (moved +2, pc on the caller slot)");
});
