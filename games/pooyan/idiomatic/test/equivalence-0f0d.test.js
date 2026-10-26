// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand0B (ROM 0x0f0d) — append the fixed byte 0x0b into the
 * page-0x8a command ring.
 *
 * The wrapper hands byte 0x0b to the ring-append helper. The helper always stashes the byte into
 * the pending cell, then — only while a game is active OR the play-mode latch is set — writes it
 * into the ring page at the cursor and advances the cursor (last slot 0x5e wraps to first 0x43);
 * on the gates-closed path it leaves the cursor alone and reloads A to 0. Crafted inputs: the two
 * gate cells and the ring cursor.
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP) PLUS the register live-out A — the
 * advanced ring cursor the helper leaves in the accumulator (0 when gated off), which callers read
 * back. pc/SP/cycles are NOT compared. The EQUAL job also asserts the module SET A on its own clone
 * (not merely returned it), since the frozen caller reads A out of the register.
 *
 * All cases are CRAFTED: the gate cells and cursor are poked identically on both sides, sp seated
 * inside STACK_SCRATCH so the oracle's push/pop/ret stay there.
 *
 * Jobs:
 *   1. EQUAL — over gates-open / gates-closed / play-mode / wrap paths, oracle == queueSoundCommand0B in
 *      RAM (−stack) AND in A (returned and set).
 *   2. WRITE-SET — gates-open first-slot writes the pending byte, the ring slot, and the cursor.
 *   3. TEETH — a wrong appended byte is caught by the RAM diff, and a wrong A by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f0d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f0d as oracle } from "../../translated/loc_0f0d.js";
import { queueSoundCommand0B } from "../queueSoundCommand0B.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_WRITE_PTR,
  HIGH_SCORE_TABLE,
  SOUND_RING_PENDING_BYTE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const COMMAND_BYTE = 0x0b;
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the two gates and the ring cursor seated. */
function craft(gameActive, playMode, cursor) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, gameActive & 0xff);
  m.mem.write8(PLAY_MODE_LATCH, playMode & 0xff);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor & 0xff);
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH; the oracle's push/pop/ret stay there
  return m;
}

// (label, gameActive, playMode, cursor, expected A)
const CASES = [
  { label: "game active -> append, advance", ga: 0x01, pm: 0x00, cur: RING_FIRST, wantA: RING_FIRST + 1 },
  { label: "gated off -> A := 0, no append", ga: 0x00, pm: 0x00, cur: RING_FIRST, wantA: 0x00 },
  { label: "play-mode set -> append despite inactive", ga: 0x00, pm: 0x01, cur: 0x50, wantA: 0x51 },
  { label: "last slot -> wraps to first", ga: 0x01, pm: 0x00, cur: RING_LAST, wantA: RING_FIRST },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor paths — queueSoundCommand0B == oracle in RAM (−stack) + A", () => {
  for (const { label, ga, pm, cur, wantA } of CASES) {
    const o = craft(ga, pm, cur);
    const c = craft(ga, pm, cur);
    oracle(o); // the oracle leaves its A live-out in o.regs.a (it rets; the JS fn returns undefined)
    const ca = queueSoundCommand0B(c);
    assert.equal(o.regs.a & 0xff, wantA, `oracle A for "${label}"`);
    assert.equal(ca & 0xff, o.regs.a & 0xff, `module A return mismatch for "${label}"`);
    // SIDE-EFFECT arm: the wrapper must SET A on its own clone (the frozen caller reads A back).
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A for the caller ("${label}")`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} ("${label}")`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted paths identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gates-open first-slot writes pending byte, ring slot, and advanced cursor", () => {
  const o = craft(0x01, 0x00, RING_FIRST);
  oracle(o);
  assert.equal(o.mem.read8(SOUND_RING_PENDING_BYTE), COMMAND_BYTE, "pending cell must hold 0x0b");
  assert.equal(o.mem.read8(HIGH_SCORE_TABLE + RING_FIRST), COMMAND_BYTE, "ring slot must hold 0x0b");
  assert.equal(o.mem.read8(SOUND_RING_WRITE_PTR), RING_FIRST + 1, "cursor must advance by one");
  console.log(`  WRITE-SET: pending ${hx(SOUND_RING_PENDING_BYTE)}, slot ${hx(HIGH_SCORE_TABLE + RING_FIRST)}, cursor ${hx(SOUND_RING_WRITE_PTR)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong appended byte is CAUGHT by the RAM diff", () => {
  const slot = HIGH_SCORE_TABLE + RING_FIRST;
  const o = craft(0x01, 0x00, RING_FIRST);
  const c = craft(0x01, 0x00, RING_FIRST);
  oracle(o);
  queueSoundCommand0B(c);
  c.mem.write8(slot, 0x00); // BUG: this slot must hold command 0x0b
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, slot, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong appended byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A live-out is CAUGHT by the register check", () => {
  const o = craft(0x01, 0x00, RING_FIRST);
  const c = craft(0x01, 0x00, RING_FIRST);
  oracle(o); // A live-out is left in o.regs.a (the oracle rets; its JS fn returns undefined)
  const ca = queueSoundCommand0B(c);
  assert.equal(ca & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle");
  // an un-advanced cursor (the input 0x43) is a plausible bug the live-out check must reject
  assert.notEqual(RING_FIRST, o.regs.a & 0xff, "the live-out check must reject an un-advanced cursor in A");
  console.log(`  TEETH/A: module A ${hx(ca & 0xff)} == oracle; an un-advanced ${hx(RING_FIRST)} is rejected`);
});
