// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for loc_0dd3 (decode one board-layout record: read its length and
 * phase, resolve the tilemap pointer via sub_2ff0, stamp the endpoint tiles, then fall
 * into loc_0e19). The main draw primitive of sub_0da7, exercised during the 25m attract
 * board draw (~frame 518), so it dispatches in a plain boot run. PER-INSTRUCTION
 * (atomicity not provable across sub_0da7's callers).
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0dd3 as translated_0dd3 } from "../../translated/nmi.js";
import { loc_0dd3 as optimized_0dd3 } from "../loc_0dd3.js";
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

const TARGET = 0x0dd3;
const FRAMES = 600;
const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

// Break loc_0dd3's run-length store 0x63B2 (0x0DDD). The per-record 0x63xx scratch is
// rewritten by later records so it heals, but 0x63B2 feeds the cell COUNT the vertical
// drawer loc_0e19 (or loc_0e4f) walks, so a wrong value misdraws board tiles into video
// RAM — a PERSISTENT divergence the gate catches.
function broken_0dd3(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === 0x63b2) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_0dd3(m); } finally { m.mem.write8 = realWrite; }
}

test("EQUAL (whole-machine): per-instruction loc_0dd3 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0dd3]]));
  assert.ok(r.invocations.get(TARGET) >= 1, `override never dispatched (invocations=${r.invocations.get(TARGET)})`);
  assert.equal(r.equal, true, r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`);
});

test("EQUAL (unit): per-instruction loc_0dd3 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0dd3, optimized_0dd3, { maxFrames: FRAMES + 100 });
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

test("TEETH (whole-machine): a wrong store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0dd3]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)}`);
});

test("TEETH (unit): a wrong store is CAUGHT", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0dd3, broken_0dd3, { maxFrames: FRAMES + 100 });
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});
