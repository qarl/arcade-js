// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for startOnePlayerGameOnCredit (ROM 0x0de4, Pooyan) — the (0x8810) bit-3 coin/credit branch.
 *
 * With credits remaining it spends one (0x8802--) and restarts a fresh single-player game via
 * startNewGamePlay (DISSOLVED; active-player word = 0). With no credits it either returns inert (play
 * sub-state 0x0e) or nudges the main state to 1.
 *
 * Both sides ultimately reach the SAME frozen loc_0e54 / loc_0e00 through startNewGamePlay, so the gate
 * proves startOnePlayerGameOnCredit's branch and the delegated restart. The display-command ring is freed so the
 * restart's enqueues land; SP is parked in STACK_SCRATCH. Compared on RAM (dumpState, minus
 * stack scratch below the entry SP). No register live-out — memory only.
 *
 * Jobs:
 *   1. EQUAL — restart (credits>0), inert (state 0x0e), and nudge (state != 0x0e): module == oracle.
 *   2. WRITE-SET — restart decrements credits and seeds the game; inert leaves RAM untouched.
 *   3. TEETH — a corrupted post-run byte is caught; a twin that skips the credit spend diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0de4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0de4 as oracle } from "../../translated/loc_0cf8.js";
import { startOnePlayerGameOnCredit } from "../startOnePlayerGameOnCredit.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CREDIT_COUNT = 0x8802;
const PLAY_STATE_INDEX = 0x880a;
const MAIN_GAME_STATE = 0x8805;

const RING_WRITE_PTR = 0x88a0;
const RING_PAGE = 0x8800;
const RING_START = 0xc0;
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: seeded credits + play sub-state, a freed ring (for the restart path). */
function craft({ credits, playState }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(CREDIT_COUNT, credits & 0xff);
  m.mem.write8(PLAY_STATE_INDEX, playState & 0xff);
  m.mem.write8(MAIN_GAME_STATE, 0xaa); // pre-dirty so the nudge (or its absence) is observable
  m.mem.write8(RING_WRITE_PTR, RING_START);
  for (let c = RING_START; c <= 0xff; c++) m.mem.write8(RING_PAGE + c, 0x80); // all slots free
  return m;
}

const CASES = {
  "restart: credits>0 -> spend + startNewGamePlay": { credits: 3, playState: 0x00 },
  "inert: no credits, sub-state 0x0e": { credits: 0, playState: 0x0e },
  "nudge: no credits, sub-state != 0x0e": { credits: 0, playState: 0x05 },
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: restart / inert / nudge — startOnePlayerGameOnCredit == oracle in RAM (−stack)", () => {
  for (const [name, seed] of Object.entries(CASES)) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    startOnePlayerGameOnCredit(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: restart + inert + nudge paths identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: restart decrements credits + seeds the game; inert leaves RAM untouched", () => {
  const restart = craft(CASES["restart: credits>0 -> spend + startNewGamePlay"]);
  oracle(restart);
  assert.equal(restart.mem.read8(CREDIT_COUNT), 2, "one credit spent");
  assert.equal(restart.mem.read8(MAIN_GAME_STATE), 0x03, "restart seeds main state 3 (via startNewGamePlay)");

  const inert = craft(CASES["inert: no credits, sub-state 0x0e"]);
  const before = inert.dumpState();
  oracle(inert);
  assert.deepEqual([...inert.dumpState()], [...before], "the inert path leaves RAM untouched");

  const nudge = craft(CASES["nudge: no credits, sub-state != 0x0e"]);
  oracle(nudge);
  assert.equal(nudge.mem.read8(MAIN_GAME_STATE), 0x01, "the nudge sets main state 1");
  console.log("  WRITE-SET: credit spend + restart; inert inert; nudge -> 1");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES["nudge: no credits, sub-state != 0x0e"]);
  const c = craft(CASES["nudge: no credits, sub-state != 0x0e"]);
  oracle(o);
  startOnePlayerGameOnCredit(c);
  c.mem.write8(MAIN_GAME_STATE, (o.mem.read8(MAIN_GAME_STATE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, MAIN_GAME_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the credit spend diverges from the oracle", () => {
  const o = craft(CASES["restart: credits>0 -> spend + startNewGamePlay"]);
  const c = craft(CASES["restart: credits>0 -> spend + startNewGamePlay"]);
  oracle(o);
  startOnePlayerGameOnCredit(c);
  c.mem.write8(CREDIT_COUNT, o.mem.read8(CREDIT_COUNT) + 1); // twin: never spent the credit
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped credit spend must be caught");
  assert.equal(d.addr, CREDIT_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(credit): caught at ${hx(d.addr)}`);
});
