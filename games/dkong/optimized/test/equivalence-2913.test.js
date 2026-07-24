// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for entry_2913 (proximity/collision query over IX object records, with
 * the sub_0008 skip-return convention). Dispatches many times in a plain attract run (8
 * wrapper callers). PER-INSTRUCTION. Being READ-ONLY, its teeth corrupt an input read (the
 * active-flag test) so the scan visits the wrong records and the outcome diverges.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { entry_2913 as translated_2913 } from "../../translated/state0.js";
import { entry_2913 as optimized_2913 } from "../entry_2913.js";
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

const TARGET = 0x2913;
const FRAMES = 600;
const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

// Corrupt the routine's FIRST input read (the `bit 0,(ix+0)` active-flag test) so it scans
// the wrong record set -- flipping some collision outcome, which the state gate must catch.
function broken_2913(m) {
  const realRead = m.mem.read8.bind(m.mem);
  let broke = false;
  m.mem.read8 = (addr, busOffset) => {
    const v = realRead(addr, busOffset);
    if (!broke) { broke = true; return v ^ 0x01; }
    return v;
  };
  try { return optimized_2913(m); } finally { m.mem.read8 = realRead; }
}

test("EQUAL (whole-machine): per-instruction entry_2913 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_2913]]));
  assert.ok(r.invocations.get(TARGET) >= 1, `override never dispatched (invocations=${r.invocations.get(TARGET)})`);
  assert.equal(r.equal, true, r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x (collision queries)`);
});

test("EQUAL (unit): per-instruction entry_2913 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_2913, optimized_2913, { maxFrames: FRAMES + 100 });
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

test("TEETH (whole-machine): a wrong scan is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_2913]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong collision outcome");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)}`);
});
