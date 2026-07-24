// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for sub_306f (every-8th-frame sprite animation tick). It runs during
 * gameplay, not the 25m attract, so it never dispatches in a plain run. Its only input is
 * the counter at 0x62AF, so it is verified from a crafted entry (booted machine captured at
 * loc_0fd7's dispatch, cloned): 0x62AF=7 exercises the FULL 8th-call path (adjust sprites,
 * PRNG, toggle 0x692D), 0x62AF=0 the early-return path. PER-INSTRUCTION.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fd7 as translated_0fd7 } from "../../translated/state0.js";
import { sub_306f as translated_306f } from "../../translated/state0.js";
import { sub_306f as optimized_306f } from "../sub_306f.js";
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
  if (entry === null) throw new Error("loc_0fd7 never entered — cannot craft a sub_306f entry");
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
    try { return optimized_306f(m); } finally { m.mem.write8 = realWrite; }
  };
}

function runBoth(counter, optFn = optimized_306f) {
  const a = ENTRY.clone(); a.mem.write8(0x62af, counter);
  const b = ENTRY.clone(); b.mem.write8(0x62af, counter);
  translated_306f(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: [a.pc, b.pc],
  };
}

test("EQUAL (8th-call path): the full animation tick matches translated", () => {
  const { ram, regs, pc } = runBoth(0x07); // ++ -> 0x08, gate fires
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL 8th-call: full tick EQUAL (state + regs + pc)");
});

test("EQUAL (early-return path): the 7-of-8 skip matches translated", () => {
  const { ram, regs, pc } = runBoth(0x00); // ++ -> 0x01, gate skips
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL early-return: skip EQUAL (state + regs + pc)");
});

test("TEETH (8th-call path): a wrong sprite toggle is CAUGHT and names 0x692d", () => {
  // Break the final on-path store (0x692D). Both sides take the full path, so this is the
  // only byte that differs -- a clean first-diff (breaking the counter instead flips the
  // control path, and the resulting PRNG divergence at 0x6018 sorts first).
  const { ram } = runBoth(0x07, brokenAt(0x692d));
  assert.ok(ram != null, "harness FAILED to catch a wrong store");
  assert.equal(ram.addr, 0x692d, `expected first diff at 0x692d, got 0x${ram.addr.toString(16)}`);
  console.log(`  TEETH: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
