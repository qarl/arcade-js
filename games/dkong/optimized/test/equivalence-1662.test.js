// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for tail_1662 (bump the animation counter 0x6388, rst 0x30 caller-skip
 * guard, then rst 0x38 stepping the 0x690B sprite block). It does not dispatch in the 25m
 * attract; being self-contained it is verified from a crafted entry: a booted machine
 * captured at loc_0fd7's dispatch, cloned, invoked on both sides. PER-INSTRUCTION.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fd7 as translated_0fd7 } from "../../translated/state0.js";
import { tail_1662 as translated_1662 } from "../../translated/state0.js";
import { tail_1662 as optimized_1662 } from "../tail_1662.js";
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
  if (entry === null) throw new Error("loc_0fd7 never entered — cannot craft a tail_1662 entry");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;

function brokenAt(addr) {
  return (m) => {
    const realWrite = m.mem.write8.bind(m.mem);
    let broke = false;
    m.mem.write8 = (a, value, busOffset) => {
      if (!broke && a === addr) { broke = true; return realWrite(a, value ^ 0xff, busOffset); }
      return realWrite(a, value, busOffset);
    };
    try { return optimized_1662(m); } finally { m.mem.write8 = realWrite; }
  };
}

function runBoth(optFn = optimized_1662) {
  const a = ENTRY.clone();
  const b = ENTRY.clone();
  translated_1662(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: [a.pc, b.pc],
  };
}

test("EQUAL (crafted entry): tail_1662 matches translated in state + registers", () => {
  const { ram, regs, pc } = runBoth();
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL: counter bump + sprite step EQUAL (state + regs + pc)");
});

test("TEETH (crafted entry): a wrong counter is CAUGHT and names 0x6388", () => {
  const { ram } = runBoth(brokenAt(0x6388));
  assert.ok(ram != null, "harness FAILED to catch a wrong store");
  assert.equal(ram.addr, 0x6388, `expected first diff at 0x6388, got 0x${ram.addr.toString(16)}`);
  console.log(`  TEETH: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
