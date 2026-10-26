// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armLaunchAndAdvanceToHunterSpawn (ROM 0x278f) — launch-state-machine state 0: arm the
 * launch flag once its preconditions hold, gate on the arrow height and the two hunter-hit
 * bits, then advance the state, reseed the flip countdown, optionally light a HUD cell,
 * refresh the arm latch, and tail-blit a 2x2 tile via loc_3325 (blit2x2TileBlock).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine
 * WRITES work + video RAM, so each case uses a FRESH clone per side: the oracle runs on one
 * clone, armLaunchAndAdvanceToHunterSpawn on another, and they are compared on the go-forward contract — RAM
 * (dumpState) minus stack scratch below the entry SP. pc/SP/cycles are NOT compared. armLaunchAndAdvanceToHunterSpawn is a dispatched
 * handler with NO consumed register live-out (the tail blit sets HL, but the dispatcher does
 * not read it), so only RAM is compared. The oracle's tail m.call(0x3325) and the idiomatic
 * blit2x2TileBlock produce identical VRAM effects; the oracle's ret pops read STACK_SCRATCH.
 *
 * The handler runs under the launch state machine, not a plain attract dispatch of 0x278f,
 * so every case is CRAFTED: all eleven input cells poked identically on both sides. The
 * cases below cover each control path — already-armed vs the three arming sub-paths, the
 * subtle "latch already set + stage zero -> return before arming (no writes)" path, all
 * three gate exits, and both HUD / seed branches on the full path to the blit.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — armLaunchAndAdvanceToHunterSpawn == oracle in RAM (-stack) over every path.
 *   2. WRITE-SET — on the full path the oracle's writes stay within the documented footprint
 *      (state, flip, HUD, latch, and the four blit cells), and the blit copies ROM 0x2d51.
 *   3. TEETH — an inverted arrow gate (bails on a passing arrow) is CAUGHT; and a wrong
 *      launch-state byte is CAUGHT at 0x8f30.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-278f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_278f as oracle } from "../../translated/loc_278f.js";
import { armLaunchAndAdvanceToHunterSpawn } from "../armLaunchAndAdvanceToHunterSpawn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

// Input cells
const LAUNCH_ARMED_FLAG = 0x8f3f;
const LANE_SPAWN_COUNTDOWN = 0x8d75;
const LAUNCH_ARM_LATCH = 0x8f20;
const STAGE_COUNTDOWN = 0x8901;
const ARROW_Y = 0x8ab4;
const ENEMY_TARGET_REC0 = 0x8c90;
const ENEMY_TARGET_REC1 = 0x8ca8;
const LAUNCH_STATE = 0x8f30;
const GAME_ACTIVE_FLAG = 0x8806;
const PLAY_MODE_LATCH = 0x8f50;
const LAUNCH_ARM_LATCH_SEED = 0x8d7a;
// Output cells
const LAUNCH_FLIP_COUNTDOWN = 0x892f;
const LAUNCH_HUD_TILE = 0x8508;
const BLIT_DEST = 0x84a7;
const BLIT_SRC = 0x2d51;
const BLIT_CELLS = [BLIT_DEST, BLIT_DEST + 0x01, BLIT_DEST + 0x21, BLIT_DEST + 0x20];

const ARROW_Y_GATE = 0x3c;
const HIT_BIT = 0x02;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

// A benign full-path state: already armed, arrow up, no hits, HUD path off (game active).
const DEFAULT = {
  armed: 1, lane: 0, latch: 0, stage: 0x08, arrowY: 0x40, rec0: 0, rec1: 0,
  launchState: 0x05, gameActive: 1, playMode: 0, seed: 0x33,
};

function craft(over = {}) {
  const s = { ...DEFAULT, ...over };
  const m = BASE.clone();
  m.mem.write8(LAUNCH_ARMED_FLAG, s.armed & 0xff);
  m.mem.write8(LANE_SPAWN_COUNTDOWN, s.lane & 0xff);
  m.mem.write8(LAUNCH_ARM_LATCH, s.latch & 0xff);
  m.mem.write8(STAGE_COUNTDOWN, s.stage & 0xff);
  m.mem.write8(ARROW_Y, s.arrowY & 0xff);
  m.mem.write8(ENEMY_TARGET_REC0, s.rec0 & 0xff);
  m.mem.write8(ENEMY_TARGET_REC1, s.rec1 & 0xff);
  m.mem.write8(LAUNCH_STATE, s.launchState & 0xff);
  m.mem.write8(GAME_ACTIVE_FLAG, s.gameActive & 0xff);
  m.mem.write8(PLAY_MODE_LATCH, s.playMode & 0xff);
  m.mem.write8(LAUNCH_ARM_LATCH_SEED, s.seed & 0xff);
  m.regs.sp = 0x8ffe; // in work RAM; the oracle's rets only POP (read)
  return m;
}

const CASES = [
  ["armed + arrow below gate -> early return", { armed: 1, arrowY: 0x00 }],
  ["armed + rec0 hit -> return", { armed: 1, arrowY: 0x40, rec0: HIT_BIT }],
  ["armed + rec1 hit -> return", { armed: 1, arrowY: 0x40, rec0: 0, rec1: HIT_BIT }],
  ["armed + full path, game active (no HUD)", { armed: 1, gameActive: 1 }],
  ["armed + full path, game idle -> HUD lit", { armed: 1, gameActive: 0, playMode: 0 }],
  ["armed + full path, seed 0 -> latch untouched", { armed: 1, seed: 0 }],
  ["not armed, lane 0, stage 0 -> return", { armed: 0, lane: 0, stage: 0 }],
  ["not armed, lane 0, stage not /8 -> return", { armed: 0, lane: 0, stage: 0x05 }],
  ["not armed, lane 0, stage /8 -> arm + advance", { armed: 0, lane: 0, stage: 0x08 }],
  ["not armed, lane up, latch 0 -> bump + arm", { armed: 0, lane: 0x05, latch: 0 }],
  // seed 0 so the arm-latch bump survives the seed-refresh and is observable (teeth for the bump).
  ["not armed, lane up, latch 0, seed 0 -> bump observable", { armed: 0, lane: 0x05, latch: 0, seed: 0 }],
  ["not armed, lane up, latch set, stage 0 -> return before arming", { armed: 0, lane: 0x05, latch: 0x03, stage: 0 }],
  ["not armed, lane up, latch set, stage /8 -> arm + advance", { armed: 0, lane: 0x05, latch: 0x03, stage: 0x08 }],
];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted paths — armLaunchAndAdvanceToHunterSpawn == oracle in RAM (−stack)", () => {
  for (const [label, over] of CASES) {
    const o = craft(over);
    const c = craft(over);
    oracle(o);
    armLaunchAndAdvanceToHunterSpawn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} [${label}]`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: full path writes stay within the documented footprint; blit copies ROM 0x2d51", () => {
  const footprint = new Set([LAUNCH_STATE, LAUNCH_FLIP_COUNTDOWN, LAUNCH_HUD_TILE, LAUNCH_ARM_LATCH, ...BLIT_CELLS]);
  const mm = craft({ armed: 1, gameActive: 0, playMode: 0, seed: 0x33 }); // HUD + latch both fire
  for (const cell of footprint) mm.mem.write8(cell, 0x55); // sentinel so each write is visible
  const b0 = mm.dumpState();
  oracle(mm);
  const a1 = mm.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(mm.stateOffsetToAddr(off));
  }
  for (const addr of changed) {
    assert.ok(footprint.has(addr), `oracle wrote outside the footprint at ${hx(addr)}`);
  }
  for (const cell of [LAUNCH_STATE, LAUNCH_FLIP_COUNTDOWN, LAUNCH_HUD_TILE, LAUNCH_ARM_LATCH]) {
    assert.ok(changed.includes(cell), `expected a write at ${hx(cell)}`);
  }
  // The 2x2 blit copies ROM 0x2d51..0x2d54 into TL, TR (+1), BR (+0x21), BL (+0x20).
  assert.equal(mm.mem.read8(BLIT_DEST + 0x00), mm.mem.read8(BLIT_SRC + 0), "blit TL");
  assert.equal(mm.mem.read8(BLIT_DEST + 0x01), mm.mem.read8(BLIT_SRC + 1), "blit TR");
  assert.equal(mm.mem.read8(BLIT_DEST + 0x21), mm.mem.read8(BLIT_SRC + 2), "blit BR");
  assert.equal(mm.mem.read8(BLIT_DEST + 0x20), mm.mem.read8(BLIT_SRC + 3), "blit BL");
  console.log(`  WRITE-SET: ${changed.length} cells, all within footprint; blit copied 0x2d51`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: bails when the arrow is at/above the gate (the real routine bails when BELOW). */
function brokenArrowGate(m) {
  const { mem8 } = m;
  if (mem8[LAUNCH_ARMED_FLAG] === 0) return; // teeth uses an already-armed state
  if (mem8[ARROW_Y] >= ARROW_Y_GATE) return; // BUG: inverted gate — never advances on a valid arrow
  mem8[LAUNCH_STATE] = mem8[LAUNCH_STATE] + 1; // (unreached on the teeth case)
}

test("TEETH: an inverted arrow gate is CAUGHT (twin makes no writes on a passing arrow)", () => {
  const over = { armed: 1, gameActive: 1, arrowY: 0x40 };
  const o = craft(over);
  const c = craft(over);
  oracle(o);
  brokenArrowGate(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the inverted arrow gate — it is worthless");
  console.log(`  TEETH/gate: inverted gate caught (first diff at ${hx(d.addr ?? 0)})`);
});

test("TEETH: a wrong launch-state byte is CAUGHT at 0x8f30", () => {
  const over = { armed: 1, gameActive: 1, launchState: 0x05 };
  const o = craft(over);
  const c = craft(over);
  oracle(o);
  armLaunchAndAdvanceToHunterSpawn(c);
  c.mem.write8(LAUNCH_STATE, 0x00); // BUG: state must have advanced to 0x06
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong launch-state byte");
  assert.equal(d.addr, LAUNCH_STATE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(LAUNCH_STATE)})`);
  console.log(`  TEETH/state: wrong launch-state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
