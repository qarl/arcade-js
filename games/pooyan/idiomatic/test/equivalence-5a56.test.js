// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for accrueCreditFromCoin1Pulse (ROM 0x5a56, Pooyan) — variant-C drip step.
 *
 * SEATING: BALANCED (plain ret / tail-calls) -> WIRE. Void handler: no register survives, so LIVE-OUT
 * is memory only and the comparison is RAM (dumpState) minus stack scratch below the entry SP. SP parked in STACK_SCRATCH
 * so nested pushes (emitPresetSound / the accumulate tail) drop out.
 *
 * Crafted paths: ring phase != 1 (inert but for the rl), phase 1 with no coord carry (ret nc), and
 * both accumulate-tail funnels (low nibble != 0x0f -> addCreditsAndQueueDisplay; == 0x0f -> addFullWrapCreditAmount). Those two tails
 * are shared sibling routines; their own gates cover them, this gate only pins the whole-path RAM.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5a56.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5a56 as oracle } from "../../translated/loc_5a56.js";
import { accrueCreditFromCoin1Pulse } from "../accrueCreditFromCoin1Pulse.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, INPUT_PORT0, DRIP_RING_C, SCORE_DRIP_ACCUM, COINAGE_CONFIG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { input = 0x00, ring = 0x00, coord = 0x00, cfg = 0x00 } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(INPUT_PORT0, input);
  m.mem.write8(DRIP_RING_C, ring);
  m.mem.write8(SCORE_DRIP_ACCUM, coord);
  m.mem.write8(COINAGE_CONFIG, cfg);
  return m;
}

const CASES = {
  "phase != 1 -> inert but for the rl": (m) => seat(m, { input: 0x01, ring: 0x02 }),
  "phase 1, no coord carry -> ret nc": (m) => seat(m, { input: 0x01, ring: 0x00, coord: 0x00, cfg: 0x20 }),
  "phase 1 -> accumulate tail addCreditsAndQueueDisplay": (m) => seat(m, { input: 0x01, ring: 0x00, coord: 0x00, cfg: 0x05 }),
  "phase 1 -> accumulate tail addFullWrapCreditAmount": (m) => seat(m, { input: 0x01, ring: 0x00, coord: 0x00, cfg: 0x0f }),
};

test("EQUAL: accrueCreditFromCoin1Pulse == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    accrueCreditFromCoin1Pulse(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

test("WRITE-SET: the rl step lands and phase 1 bumps the coord pair", () => {
  const inert = CASES["phase != 1 -> inert but for the rl"](BASE.clone());
  oracle(inert);
  assert.equal(inert.mem.read8(DRIP_RING_C), 0x05, "rl(0x02) with carry 1 -> 0x05");

  const step = CASES["phase 1, no coord carry -> ret nc"](BASE.clone()); // cfg>=stepped -> early ret preserves the pre-carry coord
  oracle(step);
  assert.equal(step.mem.read8(SCORE_DRIP_ACCUM) & 0xff, (0x00 + 0x10) & 0xff, "coord += 0x10 pre-carry");
  console.log("  WRITE-SET: rl lands; coord stepped");
});

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["phase 1, no coord carry -> ret nc"](BASE.clone());
  const c = CASES["phase 1, no coord carry -> ret nc"](BASE.clone());
  oracle(o);
  accrueCreditFromCoin1Pulse(c);
  c.mem.write8(SCORE_DRIP_ACCUM, (o.mem.read8(SCORE_DRIP_ACCUM) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH: a twin that skips the rl diverges from the oracle", () => {
  const o = CASES["phase != 1 -> inert but for the rl"](BASE.clone());
  const c = CASES["phase != 1 -> inert but for the rl"](BASE.clone());
  oracle(o);
  // twin: skip the routine entirely -> the rl write to DRIP_RING_C never happens
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped rl must be caught by the RAM diff");
  console.log(`  TEETH(rl): caught at ${hx(d.addr ?? 0)}`);
});
