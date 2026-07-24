// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for loc_0e19 (draw a vertical run of 0xC0 cells, stepping the span
 * counter 0x63B2 down by 8 until it underflows, then tail into loc_0e2a). A draw
 * primitive of the board-layout renderer sub_0da7, which draws the 25m board during
 * the attract demo (~frame 518) — so it dispatches in a plain boot run, no coin needed.
 * PER-INSTRUCTION (atomicity not provable across sub_0da7's callers).
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e19 as translated_0e19 } from "../../translated/nmi.js";
import { loc_0e19 as optimized_0e19 } from "../loc_0e19.js";
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

const TARGET = 0x0e19;
const FRAMES = 600; // 25m board draws in attract at ~frame 518

const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

// Break loc_0e19's own first VRAM output (a 0xC0 cell) — a static board tile that
// persists to the frame boundary.
function broken_0e19(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && value === 0xc0) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_0e19(m); } finally { m.mem.write8 = realWrite; }
}

test("EQUAL (whole-machine): per-instruction loc_0e19 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0e19]]));
  assert.ok(r.invocations.get(TARGET) >= 1, `override never dispatched (invocations=${r.invocations.get(TARGET)})`);
  assert.equal(r.equal, true, r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x (25m attract draw)`);
});

test("EQUAL (unit): per-instruction loc_0e19 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0e19, optimized_0e19, { maxFrames: FRAMES + 100 });
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

test("TEETH (whole-machine): a wrong 0xC0 cell store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0e19]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)}`);
});

test("TEETH (unit): a wrong 0xC0 cell store is CAUGHT", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0e19, broken_0e19, { maxFrames: FRAMES + 100 });
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});
