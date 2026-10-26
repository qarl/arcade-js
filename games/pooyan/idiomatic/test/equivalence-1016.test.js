// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for runActivePlayFrame — the active-play sub-state handler, a pure void sequencer
 * that invokes ten subsystem handlers in fixed ROM order and returns.
 *
 * The module dissolves all ten m.call sites to direct idiomatic calls; the oracle drives the same
 * ten frozen handlers through the routines map. This gate COMPOSES the real idiomatic subtree and
 * checks oracle == module in RAM (dumpState, minus stack scratch below the entry SP). runActivePlayFrame has no register
 * live-out (it consumes none of the handlers' results), so only RAM is compared; SP sits in dead stack.
 *
 * Two arms are seated: an idle boot state (the composition is exercised with a near-empty footprint)
 * and a state seated so the TENTH handler (drainSoundCommandRing) drains one queued entry — a positive
 * control that the last call in the sequence actually runs (a dropped or reordered tenth call would
 * leave the slot occupied and the head unadvanced). Demo sounds off + game inactive keep the drain
 * silent, so the audio dispatch is not exercised — only the slot-free + head-advance memory effect.
 *
 * Jobs:
 *   1. EQUAL — idle + tenth-handler-active: oracle == module in RAM (−stack).
 *   2. COMPOSITION — the seated tenth handler frees the slot (-> 0xff) and advances the head,
 *      proving the last call in the sequence executed, and the module matches.
 *   3. TEETH — a wrong head index is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1016.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1016 as oracle } from "../../translated/loc_1016.js";
import { runActivePlayFrame } from "../runActivePlayFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SOUND_RING_READ_PTR,
  HIGH_SCORE_TABLE,
  DEMO_SOUNDS_DSW,
  GAME_ACTIVE_FLAG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_HEAD_FIRST = 0x43; // first ring slot index
const QUEUED_ENTRY = 0x12; //   a non-empty queued sound byte
const SLOT_EMPTY = 0xff; //     empty-slot marker after a drain
const SP0 = 0x8ff8; //          inside STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function base() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  for (let a = STACK_SCRATCH.lo; a < STACK_SCRATCH.hi; a++) m.mem.write8(a, 0x00);
  return m;
}

/** Idle boot state: the sound ring head slot is empty, so the tenth handler no-ops. */
function craftIdle() {
  const m = base();
  m.mem.write8(SOUND_RING_READ_PTR, RING_HEAD_FIRST);
  m.mem.write8(HIGH_SCORE_TABLE + RING_HEAD_FIRST, SLOT_EMPTY);
  return m;
}

/** Seat the tenth handler (drainSoundCommandRing) onto a silent drain-one path. */
function craftTenth() {
  const m = base();
  m.mem.write8(SOUND_RING_READ_PTR, RING_HEAD_FIRST); // head at the first slot
  m.mem.write8(HIGH_SCORE_TABLE + RING_HEAD_FIRST, QUEUED_ENTRY); // one queued entry
  m.mem.write8(DEMO_SOUNDS_DSW, 0x00); // demo sounds off
  m.mem.write8(GAME_ACTIVE_FLAG, 0x00); // game inactive -> silent (no audio dispatch)
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: idle + tenth-handler-active — module == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["idle", craftIdle], ["tenth handler active", craftTenth]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    runActivePlayFrame(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: idle + tenth-active identical (RAM −stack), composed idiomatic subtree");
});

// -- 2. COMPOSITION -----------------------------------------------------------

test("COMPOSITION: the tenth handler runs — slot freed and head advanced", () => {
  const o = craftTenth();
  assert.equal(o.mem.read8(HIGH_SCORE_TABLE + RING_HEAD_FIRST), QUEUED_ENTRY, "pre: slot holds the entry");
  assert.equal(o.mem.read8(SOUND_RING_READ_PTR), RING_HEAD_FIRST, "pre: head at the first slot");
  oracle(o);
  assert.equal(o.mem.read8(HIGH_SCORE_TABLE + RING_HEAD_FIRST), SLOT_EMPTY, "oracle: tenth handler freed the slot");
  assert.equal(o.mem.read8(SOUND_RING_READ_PTR), RING_HEAD_FIRST + 1, "oracle: tenth handler advanced the head");

  const c = craftTenth();
  runActivePlayFrame(c);
  assert.equal(c.mem.read8(HIGH_SCORE_TABLE + RING_HEAD_FIRST), SLOT_EMPTY, "module: tenth handler freed the slot");
  assert.equal(c.mem.read8(SOUND_RING_READ_PTR), RING_HEAD_FIRST + 1, "module: tenth handler advanced the head");
  console.log("  COMPOSITION: the tenth handler executed (slot freed, head advanced)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong head index is caught by the RAM diff", () => {
  const o = craftTenth();
  const c = craftTenth();
  oracle(o);
  runActivePlayFrame(c);
  c.mem.write8(SOUND_RING_READ_PTR, RING_HEAD_FIRST); // BUG: the drain must have advanced the head
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong head index — it is worthless");
  assert.equal(d.addr, SOUND_RING_READ_PTR, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong head index caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
