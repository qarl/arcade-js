// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchPerFrameActorUpdatePasses (ROM 0x20d4, Pooyan) — the per-frame update gate.
 *
 * The module direct-calls the six idiomatic siblings (the lead-actor driver on the tail, the five
 * sub-passes on the chain); the oracle drives the same frozen siblings through the registry that
 * new Machine(ROM) builds. dispatchPerFrameActorUpdatePasses is a void driver — no register survives — so the register file
 * is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * Both crafted states hold every sub-pass on a benign arm (formation off, rope pass on its timer
 * decrement, launch state 0, actor record on its descent arm, integrity flags clear) so the gate
 * isolates dispatchPerFrameActorUpdatePasses's own job: pick the tail vs the chain, and clear the grab flag when busy. The
 * lead-actor driver's state-1 handler ticks the record delay byte, an isolated tail footprint.
 *
 * Jobs:
 *   1. EQUAL — chain (busy, corruption pair clear) and tail (idle, grab set): oracle == module in
 *      RAM (−stack).
 *   2. WRITE-SET — the busy branch clears the grab flag; the tail ticks the delay byte, the chain
 *      leaves it — so the branch choice is observable at the delay byte.
 *   3. TEETH — a wrong chain byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-20d4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_20d4 as oracle } from "../../translated/loc_20d4.js";
import { dispatchPerFrameActorUpdatePasses } from "../dispatchPerFrameActorUpdatePasses.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LATCH = 0x8f50; //   play-mode latch: 0 -> grab-flag branch, nonzero -> busy branch
const GRAB = 0x8d32; //    grab-active flag: routes idle frames; cleared when busy
const CORRUPT = 0x8df8; // corruption pair
const TERM = 0x8df9;
const ACTOR = 0x8a80; //   actor table (movePlayerVerticallyAndTickStatusRender record base)
const A_STATE = 0x8a82; // lead record state (dispatch index 1)
const A_DELAY = 0x8a91; // lead record frame-delay byte (state-1 handler ticks it)
const A_REC7 = 0x8a87; //  lead record +7 (descent arm / sub-pass minimal)
const ENABLE = 0x8f04; //  formation off
const ROUND = 0x8907; //   round parity (bit0 set -> rope timer path)
const ROPE_TIMER = 0x8f09;
const LAUNCH = 0x8f30; //  launch state 0
const FLAG_BASE = 0x89e7; // integrity flag block
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat every sub-pass / the lead-actor driver on a benign arm. */
function seatBenign(m) {
  m.regs.sp = SP0;
  m.mem8[ENABLE] = 0x00; //  formation manager no-op
  m.mem8[ROUND] = 0x01; //   odd -> rope pass on its timer decrement
  m.mem8[ROPE_TIMER] = 0x05; // rope timer running -> dec + ret
  m.mem8[LAUNCH] = 0x00; //  launch state 0
  m.mem8[A_STATE] = 0x01; // lead record state 1 -> frame-delay handler
  m.mem8[A_DELAY] = 0x05; // frame delay running
  m.mem8[A_REC7] = 0x00; //  descent arm / minimal
  for (let i = 0; i < 7; i++) m.mem8[FLAG_BASE + i] = 0x00; // integrity flags clear
  return m;
}

function craftChain() {
  const m = seatBenign(BASE.clone());
  m.mem8[LATCH] = 0x01; //   busy -> clears grab, then chain
  m.mem8[CORRUPT] = 0x00; // corruption pair clear -> not the tail
  m.mem8[GRAB] = 0x77; //    seeded set; the busy branch must clear it
  return m;
}
function craftTail() {
  const m = seatBenign(BASE.clone());
  m.mem8[LATCH] = 0x00; //   idle
  m.mem8[GRAB] = 0x01; //    grab set -> tail to the lead-actor driver
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatchPerFrameActorUpdatePasses == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["chain", craftChain], ["tail", craftTail]]) {
    const a = craft();
    const b = craft();
    oracle(a);
    dispatchPerFrameActorUpdatePasses(b);
    const d = ramDiffMinusStack(a, b);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: chain + tail identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: busy clears the grab flag; the branch choice shows at the delay byte", () => {
  const chain = craftChain();
  oracle(chain);
  assert.equal(chain.mem8[GRAB], 0x00, "the busy branch must clear the grab flag");
  assert.equal(chain.mem8[A_DELAY], 0x05, "the chain does not run the lead-actor dispatch");

  const tail = craftTail();
  oracle(tail);
  assert.equal(tail.mem8[A_DELAY], 0x04, "the tail runs the lead-actor driver -> delay ticked");

  assert.notEqual(chain.mem8[A_DELAY], tail.mem8[A_DELAY], "tail vs chain must diverge at the delay byte");
  console.log("  WRITE-SET: busy clears grab; tail ticks delay, chain holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong chain byte is CAUGHT by the RAM diff", () => {
  const a = craftChain();
  const b = craftChain();
  oracle(a);
  dispatchPerFrameActorUpdatePasses(b);
  b.mem8[ROPE_TIMER] = (a.mem8[ROPE_TIMER] ^ 0xff) & 0xff; // corrupt a chain-pass result
  const d = ramDiffMinusStack(a, b);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted chain byte — worthless");
  assert.equal(d.addr, ROPE_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong chain byte caught at ${hx(d.addr)}`);
});
