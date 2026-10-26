// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drawStageLabelOncePerLevel (ROM 0x1f2f, Pooyan) — the once-per-level stage-label HUD
 * updater. It returns once the done-latch is set. A stage index below ten passes straight through as
 * column zero and arms the latch; a higher index is matched against the five-entry column table
 * (0x1f87), and a miss returns. On column zero it draws the BCD round number and mirrors the
 * countdown; every drawing path then draws the fixed stage label.
 *
 * drawStageLabelOncePerLevel shares the render tail (0x1f4e..0x1f86) with refreshRoundStageHud. The module dissolves fetchWordFromTableIndex,
 * fillByteRun, and blitGlyphBlock4x3 (0x1f8c) to direct calls; the oracle drives the frozen originals.
 * drawStageLabelOncePerLevel is void — its caller reloads every register — so no register is compared; equivalence is
 * RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack so the oracle's return-slot pushes drop.
 *
 * Jobs:
 *   1. EQUAL — latched / below-ten / higher-index arms: oracle == drawStageLabelOncePerLevel (RAM −stack).
 *   2. WRITE-SET — the below-ten arm arms the latch and mirrors the countdown; the latched arm no-ops.
 *   3. TEETH — a wrong latch byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1f2f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1f2f as oracle } from "../../translated/loc_1f2f.js";
import { drawStageLabelOncePerLevel } from "../drawStageLabelOncePerLevel.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LATCH = 0x8d56; //     done-latch: nonzero returns immediately
const COUNTDOWN = 0x8901; // stage index; < 10 passes through as column 0 and arms the latch
const ROUND = 0x8907; //     round counter (BCD round = ROUND + 1)
const HUD_DIGIT = 0x8743; // HUD stage digit; written (= countdown) on the column-zero draw
const SP0 = 0x8ff0; //       inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the latch clear and the HUD digit at a sentinel, on the named arm. */
function craft(arm) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[LATCH] = 0x00;
  m.mem8[ROUND] = 0x03;
  m.mem8[HUD_DIGIT] = 0xee; // sentinel: written only on the column-zero draw
  m.mem8[COUNTDOWN] = arm === "higher" ? 0x2a : 0x05; // 0x2a exercises the table scan; 0x05 is column 0
  if (arm === "latched") m.mem8[LATCH] = 0x01; // done-latch set -> early return
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: latched / below-ten / higher-index — drawStageLabelOncePerLevel == oracle (RAM −stack)", () => {
  for (const arm of ["latched", "below", "higher"]) {
    const o = craft(arm);
    oracle(o);
    const c = craft(arm);
    drawStageLabelOncePerLevel(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${arm}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: latched + below-ten + higher-index identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the below-ten arm arms the latch and mirrors the countdown", () => {
  const below = craft("below");
  oracle(below);
  assert.equal(below.mem8[LATCH], 0x01, "below-ten -> latch armed");
  assert.equal(below.mem8[HUD_DIGIT], 0x05, "below-ten -> HUD digit = countdown (column 0 draws it)");

  const latched = craft("latched");
  oracle(latched);
  assert.equal(latched.mem8[HUD_DIGIT], 0xee, "latched -> no-op, HUD digit held");
  console.log("  WRITE-SET: below-ten arms the latch + writes the HUD digit; latched no-ops");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong latch byte is CAUGHT by the RAM diff", () => {
  const o = craft("below");
  const c = craft("below");
  oracle(o);
  drawStageLabelOncePerLevel(c);
  c.mem8[LATCH] = 0x00; // BUG: the below-ten arm must have armed the latch
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong latch byte — it is worthless");
  assert.equal(d.addr, LATCH, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong latch byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
