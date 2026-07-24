// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for sub_0f56 (per-board work-RAM setup: zero 0x6200-0x6AFF, copy the
 * board-layout ROM data, compute the bonus timer, seed sprites, then dispatch via the
 * inline rst 0x28 table to the board's own setup). Called from loc_0d5f during the 25m
 * attract board build (~frame 518), dispatching to board 1 (loc_0fd7). PER-INSTRUCTION.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0f56 as translated_0f56 } from "../../translated/state0.js";
import { sub_0f56 as optimized_0f56 } from "../sub_0f56.js";
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

const TARGET = 0x0f56;
const FRAMES = 600;
const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

// Corrupt sub_0f56's first store to `addr`. Two targets, because the routine dispatches
// into the board's own setup (loc_0fd7) before it returns:
//   - 0x62B0 (bonus timer): re-derived by end of the setup frame, but the corrupted
//     BACKUP surfaces a frame later through the timer countdown -- a PERSISTENT full-game
//     divergence the whole-machine gate catches at frame 519.
//   - 0x6200 (a cleared game-state byte): loc_0fd7 relies on the zero-fill and never
//     rewrites it, so it survives to the routine boundary where the unit gate compares.
function brokenAt(addr) {
  return (m) => {
    const realWrite = m.mem.write8.bind(m.mem);
    let broke = false;
    m.mem.write8 = (a, value, busOffset) => {
      if (!broke && a === addr) { broke = true; return realWrite(a, value ^ 0xff, busOffset); }
      return realWrite(a, value, busOffset);
    };
    try { return optimized_0f56(m); } finally { m.mem.write8 = realWrite; }
  };
}

test("EQUAL (whole-machine): per-instruction sub_0f56 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0f56]]));
  assert.ok(r.invocations.get(TARGET) >= 1, `override never dispatched (invocations=${r.invocations.get(TARGET)})`);
  assert.equal(r.equal, true, r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x (25m board build -> board 1)`);
});

test("EQUAL (unit): per-instruction sub_0f56 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0f56, optimized_0f56, { maxFrames: FRAMES + 100 });
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

test("TEETH (whole-machine): a wrong bonus-timer store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, brokenAt(0x62b0)]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} (bonus-timer backup surfaces via the countdown)`);
});

test("TEETH (unit): a wrong game-state clear is CAUGHT and names 0x6200", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0f56, brokenAt(0x6200), { maxFrames: FRAMES + 100 });
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(r.ram.addr, 0x6200, `expected first diff at 0x6200, got 0x${r.ram.addr.toString(16)}`);
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});
