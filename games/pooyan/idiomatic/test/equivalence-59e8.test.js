// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for serviceCoinCreditAndCountersUnlessFreePlay (ROM 0x59e8, Pooyan) — credit/coinage-gated update chain.
 *
 * SEATING: BALANCED — no inputs; a void chain (no caller reads a register back), so LIVE-OUT is
 * memory only and the comparison is RAM (dumpState) minus stack scratch below the entry SP. SP parked in STACK_SCRATCH
 * so the nested calls' pushes drop out. Not a dispatcher, no register bridge (every sub-update is
 * dissolved to a direct idiomatic call).
 *
 * Crafted paths: either coinage nibble reading free-play (0x0f) -> inert early return; both non-free
 * -> the full five-sub-update chain plus the tail (pulseCoinCounter2Latch), replayed on the power-on base RAM.
 *
 * Jobs:
 *   1. EQUAL — free-play(slot1), free-play(slot2), and the full chain: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a free-play call leaves RAM untouched.
 *   3. TEETH — a corrupted post-run byte is caught; a twin that skips the chain diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-59e8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_59e8 as oracle } from "../../translated/loc_59e8.js";
import { serviceCoinCreditAndCountersUnlessFreePlay } from "../serviceCoinCreditAndCountersUnlessFreePlay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;
const COINAGE_CONFIG = 0x882c;
const COINAGE_CONFIG_SLOT2 = 0x882f;
const CREDIT_COUNT = 0x8802;
const INPUT_PORT0 = 0x8810;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { slot1 = 0x11, slot2 = 0x11, input = 0x00 } = {}) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.mem.write8(COINAGE_CONFIG, slot1);
  m.mem.write8(COINAGE_CONFIG_SLOT2, slot2);
  m.mem.write8(INPUT_PORT0, input); // drives the drip cadence rings so the chain writes RAM
  return m;
}

const CASES = {
  "free play slot1": (m) => seat(m, { slot1: 0x0f }),
  "free play slot2": (m) => seat(m, { slot1: 0x11, slot2: 0x0f }),
  "full chain": (m) => seat(m, { slot1: 0x11, slot2: 0x11, input: 0xff }),
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: serviceCoinCreditAndCountersUnlessFreePlay == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    serviceCoinCreditAndCountersUnlessFreePlay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a free-play call leaves RAM untouched", () => {
  const c = CASES["free play slot1"](BASE.clone());
  const before = c.dumpState();
  serviceCoinCreditAndCountersUnlessFreePlay(c);
  assert.deepEqual([...c.dumpState()], [...before], "free play must leave RAM untouched");
  console.log("  WRITE-SET: free play inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["full chain"](BASE.clone());
  const c = CASES["full chain"](BASE.clone());
  oracle(o);
  serviceCoinCreditAndCountersUnlessFreePlay(c);
  c.mem.write8(CREDIT_COUNT, (o.mem.read8(CREDIT_COUNT) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, CREDIT_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the chain diverges from the oracle", () => {
  const o = CASES["full chain"](BASE.clone());
  const c = CASES["full chain"](BASE.clone()); // twin: never run the chain
  oracle(o);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped update chain must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
