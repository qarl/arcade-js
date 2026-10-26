// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drawObjectStackedTiles (ROM 0x7790, Pooyan) — the object-draw handler (rst-0x28
 * state 2) for the record based at IX. It steps the animation, decrements the +0x11 frame timer and
 * returns while it runs; on expiry it draws two stacked 2x2 blocks (a char-table word per row,
 * blitted at the +0x15/+0x16 screen pointer and the row above), raises OBJECT_DRAWN_FLAG once, then
 * falls through to clearAndReseedObjectSlot (clears the record; its ret returns to this handler's caller).
 *
 * IX is an input (param default rec = m.regs.ix). The module dissolves advanceObjectAnimationFrame, fetchWordFromTableIndex,
 * paintTileBlock2x2Above and the clearAndReseedObjectSlot tail to direct calls;
 * the oracle drives the same helpers. drawObjectStackedTiles outputs no register — equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * The record is seated with the animation on its hold-decrement arm and the sprite index < 5 so
 * clearAndReseedObjectSlot returns after its clear (no colour-RAM integrity chain). The screen pointer points into
 * writable tile RAM so both 2x2 blits land in RAM/colour RAM.
 *
 * Jobs:
 *   1. EQUAL — draw (timer expiring) and hold (timer running) arms: oracle == drawObjectStackedTiles (RAM −stack).
 *   2. WRITE-SET — the draw arm raises OBJECT_DRAWN_FLAG; the hold arm leaves it clear.
 *   3. TEETH — a wrong blitted tile is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the tail-dispatch draw arm and the omitted-ret hold arm are both seam-placeable.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7790.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7790 as oracle } from "../../translated/loc_7790.js";
import { drawObjectStackedTiles } from "../drawObjectStackedTiles.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c30; //     object record base (IX)
const ANIM_HOLD = REC + 0x0e; // animation frame-hold -> advanceObjectAnimationFrame just decrements
const TIMER = REC + 0x11; //    per-object frame timer
const SPRITE = REC + 0x13; //   sprite/char index (< 5 -> clearAndReseedObjectSlot returns after its clear)
const PTR_LO = REC + 0x15;
const PTR_HI = REC + 0x16;
const DRAWN = 0x8d58; //    OBJECT_DRAWN_FLAG
const SCREEN = 0x8500; //   writable tile-RAM screen pointer
const TILE = 0x8500; //     a cell the lower-row blit writes
const SP0 = 0x8ff0; //      inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // caller-return word at SP0; the seam completes the omitted ret (moved 0)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft(timer) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.regs.ix = REC; // record base (input register)
  m.mem8[ANIM_HOLD] = 0x05; // animation holds -> advanceObjectAnimationFrame decrements, no stream walk
  m.mem8[TIMER] = timer & 0xff;
  m.mem8[SPRITE] = 0x03; //  < 5 -> clearAndReseedObjectSlot returns after clearing the record
  m.mem8[PTR_LO] = SCREEN & 0xff;
  m.mem8[PTR_HI] = (SCREEN >> 8) & 0xff;
  m.mem8[DRAWN] = 0x00;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------
test("EQUAL: draw + hold arms — drawObjectStackedTiles == oracle in RAM (−stack)", () => {
  for (const [label, timer] of [["draw (timer expiring)", 0x01], ["hold (timer running)", 0x05]]) {
    const o = craft(timer); oracle(o);
    const c = craft(timer); drawObjectStackedTiles(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: draw + hold identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------
test("WRITE-SET: the frame timer gates the draw + drawn-flag", () => {
  const draw = craft(0x01); oracle(draw);
  assert.equal(draw.mem8[DRAWN], 0x01, "timer expiring -> draw raises OBJECT_DRAWN_FLAG");

  const hold = craft(0x05); oracle(hold);
  assert.equal(hold.mem8[DRAWN], 0x00, "timer running -> no draw, flag stays clear");
  assert.notEqual(draw.mem8[DRAWN], hold.mem8[DRAWN], "the timer must gate the draw");
  console.log("  WRITE-SET: expiring draws + sets the flag, running holds");
});

// -- 3. TEETH -----------------------------------------------------------------
test("TEETH: a wrong blitted tile is CAUGHT by the RAM diff", () => {
  const o = craft(0x01); const c = craft(0x01);
  oracle(o); drawObjectStackedTiles(c);
  c.mem8[TILE] = (c.mem8[TILE] + 1) & 0xff; // corrupt one blitted tile
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong blitted tile — it is worthless");
  assert.equal(d.addr, TILE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------
test("SP-TOOTH: draw (tail dispatch) and hold (omitted ret) are both seam-placeable", () => {
  const drawR = seamPlaceable(withOmittedRet, drawObjectStackedTiles, 0x7790, craft(0x01));
  assert.equal(drawR.placeable, true, `draw tail-dispatch must be seam-placeable; got: ${drawR.error}`);
  const holdR = seamPlaceable(withOmittedRet, drawObjectStackedTiles, 0x7790, craft(0x05));
  assert.equal(holdR.placeable, true, `hold omitted-ret arm must be seam-placeable; got: ${holdR.error}`);
  console.log("  SP-TOOTH: draw + hold arms both seam-placeable (moved 0)");
});
