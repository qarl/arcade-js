// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintRoundNumberHud (ROM 0x1ead, Pooyan) — "round-number HUD setup + update
 * chain". On the first pass of a round (freeze flag clear) it builds the round HUD; both entries then
 * run the per-frame update chain (the timer/round updater refreshRoundStageHud, then the stage
 * digits).
 *
 * The module dissolves binToPackedBcd + fetchWordFromTableIndex + blitTile3x3Block + blitGlyphBlock4x3 + stampSelectedGlyphBlock +
 * renderStageCountdownDigits + refreshRoundStageHud to direct calls; the oracle
 * drives the frozen versions of all of them. paintRoundNumberHud is void — no register survives — so equivalence
 * is RAM (dumpState) minus stack scratch below the entry SP. The crafted state holds the integrity-flag scan nonzero so
 * refreshRoundStageHud returns early (identically on both sides), isolating paintRoundNumberHud's own HUD work.
 *
 * Jobs:
 *   1. EQUAL — freeze clear (build the HUD) and freeze set (skip to the update chain): oracle ==
 *      paintRoundNumberHud in RAM (−stack).
 *   2. WRITE-SET — the freeze flag gates the setup: clear paints the round digit, set leaves it.
 *   3. TEETH — a wrong round-digit byte is CAUGHT by the RAM diff.
 *   4. SP — the kept push16 + m.call(refreshRoundStageHud) seats cleanly through the dispatch seam (moved 0).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1ead.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1ead as oracle } from "../../translated/loc_1ead.js";
import { paintRoundNumberHud } from "../paintRoundNumberHud.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TAMPER_FREEZE_FLAG, ROUND_COUNTER, HUD_ROUND_DIGIT_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ROUND = 0x06; //             round+1 = 7 -> BCD 0x07, low digit 7
const LOW_DIGIT = 0x07; //         the painted low digit for this round
const DIGIT_SENTINEL = 0xee; //    poked so the setup write is detectable
const INTEGRITY_SCAN = 0x89e7; //  refreshRoundStageHud returns early while any of its 7 word slots is nonzero
const SP0 = 0x8fe0; //             inside STACK_SCRATCH
const CALLER_RET = 0xfffc;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: round seated, refreshRoundStageHud held on its early return, the round digit set to a sentinel. */
function craft(freeze) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[TAMPER_FREEZE_FLAG] = freeze & 0xff;
  m.mem8[ROUND_COUNTER] = ROUND;
  m.mem8[INTEGRITY_SCAN] = 0x01; // -> refreshRoundStageHud ret nz (early, identical on both sides)
  m.mem8[HUD_ROUND_DIGIT_LO] = DIGIT_SENTINEL;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: setup + skip-setup — paintRoundNumberHud == oracle in RAM (−stack)", () => {
  for (const [label, freeze] of [["setup (freeze clear)", 0x00], ["skip (freeze set)", 0x01]]) {
    const o = craft(freeze);
    oracle(o);
    const c = craft(freeze);
    paintRoundNumberHud(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: setup + skip-setup identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the freeze flag gates the round-HUD setup", () => {
  const setup = craft(0x00);
  oracle(setup);
  assert.equal(setup.mem8[HUD_ROUND_DIGIT_LO], LOW_DIGIT, "freeze clear -> round low digit painted");

  const skip = craft(0x01);
  oracle(skip);
  assert.equal(skip.mem8[HUD_ROUND_DIGIT_LO], DIGIT_SENTINEL, "freeze set -> setup skipped, digit held");

  assert.notEqual(setup.mem8[HUD_ROUND_DIGIT_LO], skip.mem8[HUD_ROUND_DIGIT_LO], "the freeze flag gates setup");
  console.log("  WRITE-SET: freeze clear paints the round digit, freeze set holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong round-digit byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  paintRoundNumberHud(c);
  c.mem8[HUD_ROUND_DIGIT_LO] = DIGIT_SENTINEL; // BUG: the setup must have painted the digit
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong round-digit byte — it is worthless");
  assert.equal(d.addr, HUD_ROUND_DIGIT_LO, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong digit byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP --------------------------------------------------------------------

test("SP: the kept push16 + m.call(refreshRoundStageHud) seats cleanly through the dispatch seam", () => {
  const r = seamPlaceable(withOmittedRet, paintRoundNumberHud, 0x1ead, craft(0x00));
  assert.equal(r.placeable, true, `paintRoundNumberHud must be seam-placeable; got: ${r.error}`);
  console.log("  SP: kept-call routine seats cleanly (moved 0, seam completes the ret)");
});
