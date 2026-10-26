// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for updateGameplayFrame (Pooyan) — dispatch state 2: the per-frame gameplay driver
 * that runs the projectile spawner, arrow mover, eagle blitter, blink-timer swap, and sprite
 * display-list rebuild in order.
 *
 * updateGameplayFrame is a void driver — no register survives — so the register file is not compared;
 * equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack. The spawner spawnNextEnemyOnDelay
 * is decompiled and called directly: the crafted state holds its frame-delay
 * counter running (the spawner just ticks it and returns), isolating the driver's ORDER + the other
 * sub-passes. updateGameplayFrame is a wired override, so it also carries an SP-tooth.
 *
 * Jobs:
 *   1. EQUAL — oracle == updateGameplayFrame in RAM (−stack).
 *   2. WRITE-SET — the driver mutates RAM (the sub-passes are not a no-op).
 *   3. TEETH — a wrong byte at a written cell is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the seated spawner call is stack-placeable through the dispatch seam.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-755d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_755d as oracle } from "../../translated/loc_755d.js";
import { updateGameplayFrame } from "../updateGameplayFrame.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SPAWN_DELAY = 0x8929; //  spawner frame-delay counter; nonzero -> it just ticks and returns
const SP0 = 0x8ff0; //          inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //   caller-return word seated at SP0 for the seam

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the spawner delay running and a caller-return word seated at SP0. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[SPAWN_DELAY] = 0x05; // running -> the spawner just ticks and returns
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: updateGameplayFrame == oracle in RAM (−stack)", () => {
  const o = craft();
  oracle(o);
  const c = craft();
  updateGameplayFrame(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: driver identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the driver mutates RAM (not a no-op)", () => {
  const pre = craft().dumpState();
  const o = craft();
  oracle(o);
  const wrote = firstStateDiff(pre, o.dumpState(), (off) => o.stateOffsetToAddr(off), inDeadStack);
  assert.notEqual(wrote, null, "the driver wrote nothing — the sub-passes did not run");
  console.log(`  WRITE-SET: first driver write at ${hx(wrote.addr ?? 0)} (was ${wrote.a} -> ${wrote.b})`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong byte at a written cell is CAUGHT by the RAM diff", () => {
  const pre = craft().dumpState();
  const o = craft();
  oracle(o);
  const c = craft();
  updateGameplayFrame(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: driver must match before the poke");
  const wrote = firstStateDiff(pre, o.dumpState(), (off) => o.stateOffsetToAddr(off), inDeadStack);
  c.mem8[wrote.addr] = (c.mem8[wrote.addr] ^ 0xff) & 0xff; // corrupt a cell the driver wrote
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong written byte — it is worthless");
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: the seated spawner call is stack-placeable through the seam", () => {
  const r = seamPlaceable(withOmittedRet, updateGameplayFrame, 0x755d, craft());
  assert.equal(r.placeable, true, `driver must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: updateGameplayFrame seated dispatch placeable (moved 0, seam supplies the ret)");
});
