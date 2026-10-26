// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for sampleJoystickIntoPlayerAimState (ROM 0x1e55) — "sample the joystick into the player-actor
 * state byte": abort/freeze flags zero the state byte; an inactive game leaves it untouched;
 * otherwise the complemented live joystick becomes the state byte and its bit 4 is rotated into a
 * shift latch, which in turn decides whether the state byte's bit 4 is cleared.
 *
 * This is the cycle-free / memory-equivalence gate. sampleJoystickIntoPlayerAimState takes NO register inputs and returns via
 * a plain ret, so the contract is RAM only (dumpState minus stack scratch below the entry SP) — no register live-out
 * (A/IX/IY are scratch, unconsumed). pc/SP/cycles are not compared. The joystick is read from the
 * hardware input ports (IN1 0xa0a0 upright, IN2 0xa0c0 flipped); the test drives them through io.in1
 * / io.in2, seeded identically on both clones.
 *
 * Jobs:
 *   1. EQUAL — every abort/gate/input arm: oracle == sampleJoystickIntoPlayerAimState in RAM (−stack).
 *   2. WRITE-SET — the input path writes exactly {PLAYER_AIM_FLAGS, INPUT_ROTATE_LATCH}; the gate-
 *      closed arm writes nothing.
 *   3. CRAFTED — the keep-vs-clear split is isolated by the OLD latch value with a fixed input; both
 *      require a live game with all abort flags clear.
 *   4. TEETH — a twin with a wrong state byte AND a twin with a wrong latch are caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1e55.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e55 as oracle } from "../../translated/loc_1e55.js";
import { sampleJoystickIntoPlayerAimState } from "../sampleJoystickIntoPlayerAimState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BOARD_CLEAR = 0x89e5;
const TAMPER_FREEZE = 0x89fb;
const GAME_ACTIVE = 0x8806;
const LEAD_STATE = 0x8a82;
const WAVE_TEARDOWN = 0x8f24;
const SECONDARY = 0x8f57;
const FLIP = 0x881f;
const LATCH = 0x8f03;
const AIM = 0x8a87;
const AIM_DIRTY = 0x33; // pre-dirty marker so a "clear to 0" is observable

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(cfg) {
  const m = BASE.clone();
  m.regs.sp = 0x8ff8; // ret only POPs (reads) work RAM here
  m.mem.write8(BOARD_CLEAR, cfg.board ?? 0);
  m.mem.write8(TAMPER_FREEZE, cfg.freeze ?? 0);
  m.mem.write8(GAME_ACTIVE, cfg.active ?? 0);
  m.mem.write8(LEAD_STATE, cfg.lead ?? 0);
  m.mem.write8(WAVE_TEARDOWN, cfg.teardown ?? 0);
  m.mem.write8(SECONDARY, cfg.secondary ?? 0);
  m.mem.write8(FLIP, cfg.flip ?? 0);
  m.mem.write8(LATCH, cfg.latch ?? 0);
  m.mem.write8(AIM, cfg.aim ?? AIM_DIRTY);
  m.io.in1 = cfg.in1 ?? 0xff;
  m.io.in2 = cfg.in2 ?? 0xff;
  return m;
}

// in1/in2 = 0xEF -> bit4 clear -> complement bit4 set (topBit 1); complement = 0x10.
const CASES = [
  { name: "abort/board", board: 1, active: 1, aim: AIM_DIRTY },
  { name: "abort/freeze", freeze: 1, active: 1, aim: AIM_DIRTY },
  { name: "gate closed", active: 0, aim: AIM_DIRTY },
  { name: "abort/lead", active: 1, lead: 1, aim: AIM_DIRTY },
  { name: "abort/teardown", active: 1, teardown: 1, aim: AIM_DIRTY },
  { name: "abort/secondary", active: 1, secondary: 1, aim: AIM_DIRTY },
  { name: "input upright keep", active: 1, flip: 1, latch: 0x00, in1: 0xef, aim: AIM_DIRTY },
  { name: "input upright clear", active: 1, flip: 1, latch: 0x01, in1: 0xef, aim: AIM_DIRTY },
  { name: "input flipped", active: 1, flip: 0, latch: 0x00, in2: 0xef, aim: AIM_DIRTY },
  { name: "input idle (0xff)", active: 1, flip: 1, latch: 0x00, in1: 0xff, aim: AIM_DIRTY },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every arm — sampleJoystickIntoPlayerAimState == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    sampleJoystickIntoPlayerAimState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (${cfg.name})`);
  }
  console.log(`  EQUAL: ${CASES.length} arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: input path writes exactly {AIM, LATCH}; gate-closed writes nothing", () => {
  const keep = CASES[6];
  const before = craft(keep);
  const after = craft(keep);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) changed.push(addr);
  }
  assert.deepEqual(changed.sort((x, y) => x - y), [AIM, LATCH].sort((x, y) => x - y), "input path footprint");

  const gate = craft(CASES[2]);
  const gBefore = gate.dumpState();
  oracle(gate);
  const gAfter = gate.dumpState();
  for (let off = 0; off < gBefore.length; off++) {
    const addr = gate.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) assert.equal(gBefore[off], gAfter[off], `gate-closed wrote ${hx(addr)}`);
  }
  console.log("  WRITE-SET: {AIM, LATCH} on input path; empty on gate-closed");
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: latch keep vs clear isolated by the old latch value (both == oracle)", () => {
  const keep = craft(CASES[6]); // old latch 0 -> new latch 1, low3==1 -> keep the complement 0x10
  const keepO = craft(CASES[6]);
  oracle(keepO);
  sampleJoystickIntoPlayerAimState(keep);
  assert.equal(keep.mem.read8(AIM), 0x10, "keep: state byte is the complement 0x10");
  assert.equal(keep.mem.read8(LATCH), 0x01, "keep: latch shifted to 1");
  assert.equal(ramDiffMinusStack(keepO, keep), null, "keep arm matches oracle");

  const clr = craft(CASES[7]); // old latch 1 -> new latch 3, low3!=1 -> clear bit4 -> 0x00
  const clrO = craft(CASES[7]);
  oracle(clrO);
  sampleJoystickIntoPlayerAimState(clr);
  assert.equal(clr.mem.read8(AIM), 0x00, "clear: bit4 cleared to 0x00");
  assert.equal(clr.mem.read8(LATCH), 0x03, "clear: latch shifted to 3");
  assert.equal(ramDiffMinusStack(clrO, clr), null, "clear arm matches oracle");
  console.log("  CRAFTED: keep(latch 0->1) and clear(latch 1->3) confirmed");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong state byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[6]);
  const c = craft(CASES[6]);
  oracle(o);
  sampleJoystickIntoPlayerAimState(c);
  c.mem.write8(AIM, 0x77); // BUG: wrong state byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong state byte");
  assert.equal(d.addr, AIM, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/aim: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong latch is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[7]);
  const c = craft(CASES[7]);
  oracle(o);
  sampleJoystickIntoPlayerAimState(c);
  c.mem.write8(LATCH, 0x00); // BUG: latch not advanced
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong latch");
  assert.equal(d.addr, LATCH, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/latch: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
