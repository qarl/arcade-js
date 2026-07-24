// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for sub_304a (run the sub_3064 row effect over two tilemap rows
 * 0x7600/0x75C0 by the index at 0x638E, then decrement it). A screen-transition effect,
 * not in the 25m attract, so it never dispatches in a plain run; it is verified from a
 * crafted entry (booted machine captured at loc_0fd7's dispatch, cloned, 0x638E seeded so
 * the effect runs). PER-INSTRUCTION.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fd7 as translated_0fd7 } from "../../translated/state0.js";
import { sub_304a as translated_304a } from "../../translated/state0.js";
import { sub_304a as optimized_304a } from "../sub_304a.js";
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
  if (entry === null) throw new Error("loc_0fd7 never entered — cannot craft a sub_304a entry");
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
    try { return optimized_304a(m); } finally { m.mem.write8 = realWrite; }
  };
}

function runBoth(optFn = optimized_304a) {
  const a = ENTRY.clone(); a.mem.write8(0x638e, 0x08); // seed the effect index
  const b = ENTRY.clone(); b.mem.write8(0x638e, 0x08);
  translated_304a(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: [a.pc, b.pc],
  };
}

test("EQUAL (crafted entry): sub_304a matches translated in state + registers", () => {
  const { ram, regs, pc } = runBoth();
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL: two-row effect EQUAL (state + regs + pc)");
});

test("TEETH (crafted entry): a wrong index decrement is CAUGHT and names 0x638e", () => {
  const { ram } = runBoth(brokenAt(0x638e));
  assert.ok(ram != null, "harness FAILED to catch a wrong store");
  assert.equal(ram.addr, 0x638e, `expected first diff at 0x638e, got 0x${ram.addr.toString(16)}`);
  console.log(`  TEETH: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
