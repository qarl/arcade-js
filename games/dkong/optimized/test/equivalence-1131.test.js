// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for loc_1131 (board-4 (100m/rivets) sprite-and-object setup — rst-0x28 table entry, the
 * board setup sub_0f56 dispatches to). Cold in the 25m attract; being a self-contained
 * coordinator (it sets its own registers) it is verified from a crafted entry: a booted
 * machine captured at loc_0fd7's dispatch, cloned, and the routine invoked on both sides.
 * PER-INSTRUCTION.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fd7 as translated_0fd7 } from "../../translated/state0.js";
import { loc_1131 as translated_1131 } from "../../translated/state0.js";
import { loc_1131 as optimized_1131 } from "../loc_1131.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const FRAMES = 600;
const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

function captureEntry() {
  let entry = null;
  const snap = new Map([[0x0fd7, (mm) => { if (entry === null) entry = mm.clone(); return translated_0fd7(mm); }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0fd7 never entered — cannot craft a loc_1131 entry");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;

function broken_1131(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr >= 0x6400 && addr < 0x6a80) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_1131(m); } finally { m.mem.write8 = realWrite; }
}

function runBoth(optFn = optimized_1131) {
  const a = ENTRY.clone();
  const b = ENTRY.clone();
  translated_1131(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: [a.pc, b.pc],
  };
}

test("EQUAL (crafted entry): loc_1131 matches translated in state + registers", () => {
  const { ram, regs, pc } = runBoth();
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL: board-4 (100m/rivets) setup EQUAL (state + regs + pc)");
});

test("TEETH (crafted entry): a wrong setup store is CAUGHT and NOT-EQUAL", () => {
  const { ram } = runBoth(broken_1131);
  assert.ok(ram != null, "harness FAILED to catch a wrong store");
  console.log(`  TEETH: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
