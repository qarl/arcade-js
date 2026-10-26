// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for refreshRoundStageHud (ROM 0x1f18, Pooyan) — the per-frame round/stage HUD refresh.
 * Holds off if any integrity-flag slot is armed; else derives the stage countdown's tens digit and,
 * only on the first stage (tens zero), draws the BCD round number, blanks three trailing tiles, and
 * mirrors the countdown into its HUD digit; both paths then draw the fixed stage label.
 *
 * The module dissolves the three sub-renderers (fetchWordFromTableIndex, fillByteRun, blitGlyphBlock4x3 at 0x1f8c) to
 * direct calls; the oracle drives the frozen originals. refreshRoundStageHud is void — its caller reloads every
 * register before reading one — so no register is compared; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP, SP parked in dead stack so the oracle's transient return-slot pushes drop out.
 *
 * Jobs:
 *   1. EQUAL — three arms (integrity armed / first stage / later stage): oracle == refreshRoundStageHud (RAM −stack).
 *   2. WRITE-SET — the first-stage arm mirrors the countdown into its HUD digit; a later stage does not.
 *   3. TEETH — a wrong HUD digit is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1f18.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1f18 as oracle } from "../../translated/loc_1f18.js";
import { refreshRoundStageHud } from "../refreshRoundStageHud.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FLAG_BASE = 0x89e7; //    seven overlapping integrity-flag pairs (bytes 0x89e7..0x89ee)
const COUNTDOWN = 0x8901; //    stage countdown; its tens digit gates the round-number draw
const ROUND = 0x8907; //        round counter (BCD round = ROUND + 1)
const HUD_DIGIT = 0x8743; //    HUD stage digit; written (= countdown) only on the first stage
const SP0 = 0x8ff0; //          inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the integrity flags clear and the HUD digit at a sentinel, on the named arm. */
function craft(arm) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  for (let i = 0; i < 8; i++) m.mem8[FLAG_BASE + i] = 0x00; // integrity clear
  m.mem8[ROUND] = 0x03;
  m.mem8[HUD_DIGIT] = 0xee; // sentinel: written only by the first-stage arm
  m.mem8[COUNTDOWN] = arm === "later" ? 0x25 : 0x05; // 0x25 -> tens 2 (skip round); 0x05 -> first stage
  if (arm === "armed") m.mem8[FLAG_BASE] = 0x01; // an integrity slot set -> early return
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: integrity-armed / first-stage / later-stage — refreshRoundStageHud == oracle (RAM −stack)", () => {
  for (const arm of ["armed", "first", "later"]) {
    const o = craft(arm);
    oracle(o);
    const c = craft(arm);
    refreshRoundStageHud(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${arm}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: armed + first-stage + later-stage identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the first stage mirrors the countdown into the HUD digit; a later stage does not", () => {
  const first = craft("first");
  oracle(first);
  assert.equal(first.mem8[HUD_DIGIT], 0x05, "first stage -> HUD digit = countdown");

  const later = craft("later");
  oracle(later);
  assert.equal(later.mem8[HUD_DIGIT], 0xee, "later stage -> HUD digit held (round block skipped)");

  assert.notEqual(first.mem8[HUD_DIGIT], later.mem8[HUD_DIGIT], "the tens digit must gate the round block");
  console.log("  WRITE-SET: first stage writes the HUD digit, a later stage holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong HUD digit is CAUGHT by the RAM diff", () => {
  const o = craft("first");
  const c = craft("first");
  oracle(o);
  refreshRoundStageHud(c);
  c.mem8[HUD_DIGIT] = 0x00; // BUG: the first stage must have mirrored the countdown here
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong HUD digit — it is worthless");
  assert.equal(d.addr, HUD_DIGIT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong HUD digit caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
