// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for driveHunterSpawnDisplayAndAdvancePhase (Pooyan) — main-loop sub-state 4 handler. Ticks the timer
 * SUBSTATE_FIELD1_COUNTER: while non-zero, decrement it and enqueue HUNTER_SPAWN_DISPLAY_CMD via the
 * (already idiomatic) ring helper enqueueDisplayCommand; when zero, reload the timer to 0x80 and bump
 * MAINLOOP_SUBSTATE_SELECTOR.
 *
 * No register inputs. The counting case seats a FREE ring slot so the enqueue path writes and its
 * bytes join the compared RAM. Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in
 * STACK_SCRATCH so the oracle's push/ret drop out of the diff.
 *
 * Jobs: 1. EQUAL (counting + expired); 2. WRITE-SET (timer/selector per branch); 3. TEETH.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-113c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_113c as oracle } from "../../translated/loc_113c.js";
import { driveHunterSpawnDisplayAndAdvancePhase } from "../driveHunterSpawnDisplayAndAdvancePhase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SUBSTATE_FIELD1_COUNTER,
  MAINLOOP_SUBSTATE_SELECTOR,
  DISPLAY_CMD_RING_WRITE_PTR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH
const RING_PAGE = 0x8800;
const RING_SLOT_LOW = 0xc0;
const COUNTER_RELOAD = 0x80;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat({ timer = 0x05, selector = 0x04 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(SUBSTATE_FIELD1_COUNTER, timer);
  m.mem.write8(MAINLOOP_SUBSTATE_SELECTOR, selector);
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, RING_SLOT_LOW);
  m.mem.write8(RING_PAGE + RING_SLOT_LOW, 0x80); // free slot (bit 7 set)
  return m;
}

const craftCount = () => seat({ timer: 0x05 });
const craftExpire = () => seat({ timer: 0x00 });

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: driveHunterSpawnDisplayAndAdvancePhase == oracle in RAM (−stack)", () => {
  for (const [name, craft] of [["counting", craftCount], ["expired", craftExpire]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    driveHunterSpawnDisplayAndAdvancePhase(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: counting + expired identical (RAM −stack, incl. enqueue)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: counting decrements the timer; expiry reloads 0x80 + advances selector", () => {
  const c = craftCount();
  oracle(c);
  assert.equal(c.mem.read8(SUBSTATE_FIELD1_COUNTER), 0x04, "timer 0x05 -> 0x04");
  assert.equal(c.mem.read8(MAINLOOP_SUBSTATE_SELECTOR), 0x04, "selector untouched while counting");

  const e = craftExpire();
  oracle(e);
  assert.equal(e.mem.read8(SUBSTATE_FIELD1_COUNTER), COUNTER_RELOAD, "timer reloaded to 0x80");
  assert.equal(e.mem.read8(MAINLOOP_SUBSTATE_SELECTOR), 0x05, "selector advanced 0x04 -> 0x05");
  console.log("  WRITE-SET: timer-- (count); timer:=0x80 & selector+1 (expire)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted timer cell is CAUGHT; the branches are load-bearing", () => {
  const o = craftExpire();
  const c = craftExpire();
  oracle(o);
  driveHunterSpawnDisplayAndAdvancePhase(c);
  c.mem.write8(SUBSTATE_FIELD1_COUNTER, (o.mem.read8(SUBSTATE_FIELD1_COUNTER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted timer cell");
  assert.equal(d.addr, SUBSTATE_FIELD1_COUNTER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  const count = craftCount();
  const expire = craftExpire();
  oracle(count);
  oracle(expire);
  assert.notEqual(ramDiffMinusStack(count, expire), null, "counting and expiry branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; branch load-bearing`);
});
