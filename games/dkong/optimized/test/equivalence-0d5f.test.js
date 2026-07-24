// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for loc_0d5f (finish board setup: run two helpers, arm the substate
 * — SUBSTATE_TIMER=0x40, GAME_SUBSTATE++ — copy the sprite template, then seed the board
 * sprites, branching on BOARD). Reached from loc_3fa0 in the 25m attract board build
 * (~frame 518). PER-INSTRUCTION. The BOARD==4 (100m rivets) arm is cold in attract, so
 * it is covered by a synthesized BOARD=4 clone.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0d5f as translated_0d5f } from "../../translated/nmi.js";
import { loc_0d5f as optimized_0d5f } from "../loc_0d5f.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
  firstStateDiff,
  firstRegDiff,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0d5f;
const FRAMES = 600;
const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

// Break the SUBSTATE_TIMER (0x6009) store: it arms the board-setup substate, so a wrong
// value diverges substate timing (and the byte itself in the dump).
function broken_0d5f(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === 0x6009) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_0d5f(m); } finally { m.mem.write8 = realWrite; }
}

function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => { if (entry === null) entry = mm.clone(); return translated_0d5f(mm); }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0d5f never entered within the run window");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;

test("EQUAL (whole-machine): per-instruction loc_0d5f matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0d5f]]));
  assert.ok(r.invocations.get(TARGET) >= 1, `override never dispatched (invocations=${r.invocations.get(TARGET)})`);
  assert.equal(r.equal, true, r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x (25m else-arm)`);
});

test("EQUAL (unit): per-instruction loc_0d5f matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d5f, optimized_0d5f, { maxFrames: FRAMES + 100 });
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

test("BRANCH (BOARD==4): the 100m rivets arm is EQUAL (synthesized clone)", () => {
  const a = ENTRY.clone(); a.mem.write8(0x6227, 4); // BOARD = 4 on both sides
  const b = ENTRY.clone(); b.mem.write8(0x6227, 4);
  translated_0d5f(a);
  optimized_0d5f(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(a.pc, b.pc, "pc must match");
  console.log("  BRANCH BOARD==4: rivets arm EQUAL (RAM + regs + pc)");
});

test("TEETH (whole-machine): a wrong SUBSTATE_TIMER store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0d5f]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)}`);
});

test("TEETH (unit): a wrong SUBSTATE_TIMER store is CAUGHT and names 0x6009", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d5f, broken_0d5f, { maxFrames: FRAMES + 100 });
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(r.ram.addr, 0x6009, `expected first diff at 0x6009, got 0x${r.ram.addr.toString(16)}`);
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});
