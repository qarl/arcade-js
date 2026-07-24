// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for sub_1826 (fill a 5-wide × 14-tall tile block with 0x10, stepping
 * one tilemap row up per row — destination HL supplied by the caller). It is used on
 * specific screens, not the 25m attract, so it never dispatches in a plain run; being
 * self-contained apart from HL, it is verified from a crafted entry: a booted machine
 * captured at loc_0fd7's dispatch, cloned, HL set to a tilemap address, invoked on both
 * sides. PER-INSTRUCTION.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fd7 as translated_0fd7 } from "../../translated/state0.js";
import { sub_1826 as translated_1826 } from "../../translated/state0.js";
import { sub_1826 as optimized_1826 } from "../sub_1826.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const FRAMES = 600;
const HL0 = 0x7780; // a tilemap address; 14 rows up (-0x20/row) stays inside VRAM 0x7400-0x77FF
const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

function captureEntry() {
  let entry = null;
  const snap = new Map([[0x0fd7, (mm) => { if (entry === null) entry = mm.clone(); return translated_0fd7(mm); }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0fd7 never entered — cannot craft a sub_1826 entry");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;

function broken_1826(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_1826(m); } finally { m.mem.write8 = realWrite; }
}

function runBoth(optFn = optimized_1826) {
  const a = ENTRY.clone(); a.regs.hl = HL0;
  const b = ENTRY.clone(); b.regs.hl = HL0;
  translated_1826(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: [a.pc, b.pc],
  };
}

test("EQUAL (crafted entry): sub_1826 matches translated in state + registers", () => {
  const { ram, regs, pc } = runBoth();
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL: 5x14 tile fill EQUAL (state + regs + pc)");
});

test("TEETH (crafted entry): a wrong fill is CAUGHT and NOT-EQUAL", () => {
  const { ram } = runBoth(broken_1826);
  assert.ok(ram != null, "harness FAILED to catch a wrong store");
  console.log(`  TEETH: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
