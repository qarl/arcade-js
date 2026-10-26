// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceToPhaseCompleteOnStageEnd (Pooyan) — a main-loop sub-state handler gated on the stage
 * countdown. If STAGE_COUNTDOWN is non-zero it returns untouched; otherwise it bumps the sub-state
 * selector (MAINLOOP_SUBSTATE_SELECTOR), enqueues PHASE1_COMPLETE_DISPLAY_CMD via the (already
 * idiomatic) ring helper enqueueDisplayCommand, and seeds SUBSTATE_FIELD1_COUNTER with 64.
 *
 * No register inputs. Each case seats a FREE ring slot so the enqueue path actually writes, and the
 * enqueue bytes are part of the compared RAM. Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is
 * parked in STACK_SCRATCH so the oracle's push/ret drop out of the diff.
 *
 * Jobs: 1. EQUAL (guard-busy + expired); 2. WRITE-SET (selector + counter per branch); 3. TEETH.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-107d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_107d as oracle } from "../../translated/loc_107d.js";
import { advanceToPhaseCompleteOnStageEnd } from "../advanceToPhaseCompleteOnStageEnd.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  STAGE_COUNTDOWN,
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

function seat({ countdown = 0x00, selector = 0x02 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(STAGE_COUNTDOWN, countdown);
  m.mem.write8(MAINLOOP_SUBSTATE_SELECTOR, selector);
  m.mem.write8(SUBSTATE_FIELD1_COUNTER, 0x11); // pre-dirty so the 64 seed is visible
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, RING_SLOT_LOW);
  m.mem.write8(RING_PAGE + RING_SLOT_LOW, 0x80); // free slot (bit 7 set)
  return m;
}

const craftBusy = () => seat({ countdown: 0x03 });
const craftExpired = () => seat({ countdown: 0x00 });

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceToPhaseCompleteOnStageEnd == oracle in RAM (−stack)", () => {
  for (const [name, craft] of [["guard busy", craftBusy], ["expired", craftExpired]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    advanceToPhaseCompleteOnStageEnd(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: guard-busy + expired identical (RAM −stack, incl. enqueue)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: expired advances selector + seeds 64; busy touches nothing", () => {
  const e = craftExpired();
  oracle(e);
  assert.equal(e.mem.read8(MAINLOOP_SUBSTATE_SELECTOR), 0x03, "selector advanced 0x02 -> 0x03");
  assert.equal(e.mem.read8(SUBSTATE_FIELD1_COUNTER), 64, "field-1 counter seeded to 64");

  const b = craftBusy();
  const before = b.dumpState();
  oracle(b);
  assert.deepEqual(b.dumpState(), before, "guard-busy path writes nothing");
  console.log("  WRITE-SET: selector+1 & counter:=64 (expired); no-op (busy)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted counter seed is CAUGHT; the guard is load-bearing", () => {
  const o = craftExpired();
  const c = craftExpired();
  oracle(o);
  advanceToPhaseCompleteOnStageEnd(c);
  c.mem.write8(SUBSTATE_FIELD1_COUNTER, (o.mem.read8(SUBSTATE_FIELD1_COUNTER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted counter seed");
  assert.equal(d.addr, SUBSTATE_FIELD1_COUNTER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  const busy = craftBusy();
  const expired = craftExpired();
  oracle(busy);
  oracle(expired);
  assert.notEqual(ramDiffMinusStack(busy, expired), null, "busy and expired branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; guard load-bearing`);
});
