// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resetToAttractScreenStart (ROM 0x08b3, Pooyan) — attract sub-state 0 handler: kick the
 * watchdog + clear a scratch byte, arm the tile fill (armTileFillFromPlayfieldBase), advance the attract sub-state, run
 * the backward ROM checksum from 0x64d5 to the 0x96 sentinel (miss -> raise the tamper flag), clear
 * the in-play gate, then zero the board-init RAM (zeroSpriteListAndActorArena) and run the sprite-slot tail (stampSecondScrollColumn).
 * All three internal calls are dissolved to direct idiomatic calls; the oracle drives the frozen
 * siblings.
 *
 * resetToAttractScreenStart is a void attract handler — no register survives — so equivalence is RAM (dumpState)
 * minus stack scratch below the entry SP, SP parked in dead stack. The checksum path is fixed by the ROM (an intact ROM
 * leaves the tamper flag clear), so a single capture-clone-replay exercises the whole body.
 *
 * Jobs:
 *   1. EQUAL — oracle == resetToAttractScreenStart in RAM (−stack).
 *   2. WRITE-SET — the sub-state is advanced and the in-play gate cleared.
 *   3. TEETH — a corrupted post-run byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-08b3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08b3 as oracle } from "../../translated/loc_08b3.js";
import { resetToAttractScreenStart } from "../resetToAttractScreenStart.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ATTRACT_SUBSTATE, GAME_ACTIVE_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8fe0; //        inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // the final ret pops this dead-stack word
const SUB0 = 0x03; //         a known sub-state to watch advance to 0x04

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: SP in dead scratch with a caller-return word, a known attract sub-state + gate. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[ATTRACT_SUBSTATE] = SUB0;
  m.mem8[GAME_ACTIVE_FLAG] = 0x01;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: attract sub-state 0 — resetToAttractScreenStart == oracle in RAM (−stack)", () => {
  const o = craft();
  oracle(o);
  const c = craft();
  resetToAttractScreenStart(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: attract sub-state 0 body identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the sub-state advances and the in-play gate clears", () => {
  const o = craft();
  oracle(o);
  assert.equal(o.mem8[ATTRACT_SUBSTATE], (SUB0 + 1) & 0xff, "sub-state advanced by one");
  assert.equal(o.mem8[GAME_ACTIVE_FLAG], 0x00, "in-play gate cleared");
  console.log("  WRITE-SET: sub-state advanced, in-play gate cleared");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  resetToAttractScreenStart(c);
  c.mem8[ATTRACT_SUBSTATE] = (o.mem8[ATTRACT_SUBSTATE] ^ 0xff) & 0xff; // BUG: wrong sub-state
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte — it is worthless");
  assert.equal(d.addr, ATTRACT_SUBSTATE, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: corrupted byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
