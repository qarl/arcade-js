// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for sub_30fa (read the animation-phase index 0x6380, clamp to 5, and
 * rst-0x28 tail-dispatch to the selected guard). Dispatches in a plain attract run (4
 * callers). PER-INSTRUCTION. Being read-and-dispatch, its teeth corrupt the 0x6380 read so
 * a different guard runs and the outcome diverges.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_30fa as translated_30fa } from "../../translated/state0.js";
import { sub_30fa as optimized_30fa } from "../sub_30fa.js";
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

const TARGET = 0x30fa;
const FRAMES = 600;
const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

// Corrupt the 0x6380 phase-index read so a DIFFERENT guard is dispatched -- a divergent
// animation outcome the state gate must catch.
function broken_30fa(m) {
  const realRead = m.mem.read8.bind(m.mem);
  let broke = false;
  m.mem.read8 = (addr, busOffset) => {
    if (!broke && addr === 0x6380) { broke = true; return realRead(addr, busOffset) ^ 0x05; } // XOR 5 -> always a different (still valid, <=5) guard index
    return realRead(addr, busOffset);
  };
  try { return optimized_30fa(m); } finally { m.mem.read8 = realRead; }
}

test("EQUAL (whole-machine): per-instruction sub_30fa matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_30fa]]));
  assert.ok(r.invocations.get(TARGET) >= 1, `override never dispatched (invocations=${r.invocations.get(TARGET)})`);
  assert.equal(r.equal, true, r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`);
});

test("EQUAL (unit): per-instruction sub_30fa matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_30fa, optimized_30fa, { maxFrames: FRAMES + 100 });
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

test("TEETH (whole-machine): a wrong dispatch index is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_30fa]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong dispatch");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)}`);
});
