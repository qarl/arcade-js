// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for sub_2441 (seed the object-position blocks 0x6300/0x6310 from a
 * BOARD-selected ROM record table). Called from loc_0d5f during the 25m attract board
 * build (~frame 518), walking board 1's table (0x3AE4). PER-INSTRUCTION.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_2441 as translated_2441 } from "../../translated/state0.js";
import { sub_2441 as optimized_2441 } from "../sub_2441.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2441;
const FRAMES = 600;
const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

// Corrupt sub_2441's first store to `addr` (a seeded object-block byte). The blocks feed
// the sprite renderer, so a wrong seed is a divergence the state gate must catch.
function brokenAt(addr) {
  return (m) => {
    const realWrite = m.mem.write8.bind(m.mem);
    let broke = false;
    m.mem.write8 = (a, value, busOffset) => {
      if (!broke && a === addr) { broke = true; return realWrite(a, value ^ 0xff, busOffset); }
      return realWrite(a, value, busOffset);
    };
    try { return optimized_2441(m); } finally { m.mem.write8 = realWrite; }
  };
}

test("EQUAL (whole-machine): per-instruction sub_2441 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_2441]]));
  assert.ok(r.invocations.get(TARGET) >= 1, `override never dispatched (invocations=${r.invocations.get(TARGET)})`);
  assert.equal(r.equal, true, r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x (25m board 1 table)`);
});

test("EQUAL (unit): per-instruction sub_2441 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_2441, optimized_2441, { maxFrames: FRAMES + 100 });
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

test("TEETH (whole-machine): a wrong object seed is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, brokenAt(0x6300)]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)}`);
});

test("TEETH (unit): a wrong object seed is CAUGHT and names 0x6300", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_2441, brokenAt(0x6300), { maxFrames: FRAMES + 100 });
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(r.ram.addr, 0x6300, `expected first diff at 0x6300, got 0x${r.ram.addr.toString(16)}`);
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});
