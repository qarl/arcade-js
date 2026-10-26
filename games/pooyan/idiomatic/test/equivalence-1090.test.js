// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueBonusStageTallyDisplayOnDelay (Pooyan) — a main-loop sub-state handler running a frame-delay
 * countdown. While SUBSTATE_FIELD1_COUNTER is non-zero it decrements it and returns; when the counter
 * is zero it bumps the sub-state selector (MAINLOOP_SUBSTATE_SELECTOR) and enqueues
 * BONUS_STAGE_TALLY_DISPLAY_CMD via the (already idiomatic) ring helper enqueueDisplayCommand.
 *
 * No register inputs. The expired case seats a FREE ring slot so the enqueue path actually writes, and
 * the enqueue bytes are part of the compared RAM. Compared on RAM (dumpState) minus stack scratch below the entry SP; SP
 * is parked in STACK_SCRATCH so the oracle's push/ret drop out of the diff.
 *
 * Jobs: 1. EQUAL (counting + expired); 2. WRITE-SET (counter tick vs selector+enqueue); 3. TEETH.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1090.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1090 as oracle } from "../../translated/loc_1090.js";
import { queueBonusStageTallyDisplayOnDelay } from "../queueBonusStageTallyDisplayOnDelay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  MAINLOOP_SUBSTATE_SELECTOR,
  SUBSTATE_FIELD1_COUNTER,
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
const RING_SLOT_LOW = 0xc0; // point the write ptr at a free ring slot so the enqueue writes

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat({ counter = 0x00, selector = 0x02 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(SUBSTATE_FIELD1_COUNTER, counter);
  m.mem.write8(MAINLOOP_SUBSTATE_SELECTOR, selector);
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, RING_SLOT_LOW);
  m.mem.write8(RING_PAGE + RING_SLOT_LOW, 0x80); // free slot (bit 7 set)
  return m;
}

const craftCounting = () => seat({ counter: 0x03 });
const craftExpired = () => seat({ counter: 0x00 });

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: queueBonusStageTallyDisplayOnDelay == oracle in RAM (−stack)", () => {
  for (const [name, craft] of [["counting", craftCounting], ["expired", craftExpired]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    queueBonusStageTallyDisplayOnDelay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: counting + expired identical (RAM −stack, incl. enqueue)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: counting ticks the counter down; expired advances selector + enqueues", () => {
  const c = craftCounting();
  oracle(c);
  assert.equal(c.mem.read8(SUBSTATE_FIELD1_COUNTER), 0x02, "counter ticked 0x03 -> 0x02");
  assert.equal(c.mem.read8(MAINLOOP_SUBSTATE_SELECTOR), 0x02, "selector untouched while counting");

  const e = craftExpired();
  oracle(e);
  assert.equal(e.mem.read8(MAINLOOP_SUBSTATE_SELECTOR), 0x03, "selector advanced 0x02 -> 0x03");
  assert.equal(e.mem.read8(SUBSTATE_FIELD1_COUNTER), 0x00, "counter left at zero");
  assert.notEqual(e.mem.read8(RING_PAGE + RING_SLOT_LOW), 0x80, "enqueue wrote into the free slot");
  console.log("  WRITE-SET: counter-1 (counting); selector+1 & enqueue (expired)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted selector bump is CAUGHT; the guard is load-bearing", () => {
  const o = craftExpired();
  const c = craftExpired();
  oracle(o);
  queueBonusStageTallyDisplayOnDelay(c);
  c.mem.write8(MAINLOOP_SUBSTATE_SELECTOR, (o.mem.read8(MAINLOOP_SUBSTATE_SELECTOR) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted selector");
  assert.equal(d.addr, MAINLOOP_SUBSTATE_SELECTOR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  const counting = craftCounting();
  const expired = craftExpired();
  oracle(counting);
  oracle(expired);
  assert.notEqual(ramDiffMinusStack(counting, expired), null, "counting and expired branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; guard load-bearing`);
});
