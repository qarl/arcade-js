// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for sub_30bd (run the sub_30e4 sprite-buffer pass over four regions:
 * 0x6950/0x6980/0x69B8/0x6A0C). It does not dispatch in the 25m attract; being a
 * self-contained coordinator (it sets its own HL/B) it is verified from a crafted entry: a
 * booted machine captured at loc_0fd7's dispatch, cloned, invoked on both sides.
 * PER-INSTRUCTION.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fd7 as translated_0fd7 } from "../../translated/state0.js";
import { sub_30bd as translated_30bd } from "../../translated/state0.js";
import { sub_30bd as optimized_30bd } from "../sub_30bd.js";
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
  if (entry === null) throw new Error("loc_0fd7 never entered — cannot craft a sub_30bd entry");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;

// Seed a few nonzero sprite records so the sub_30e4 pass has something to transform.
function seed(mm) {
  for (const base of [0x6950, 0x6980, 0x69b8, 0x6a0c]) {
    for (let i = 0; i < 8; i++) mm.mem.write8(base + i, (base + i) & 0xff);
  }
  return mm;
}

function broken_30bd(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr >= 0x6900 && addr < 0x6b00) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_30bd(m); } finally { m.mem.write8 = realWrite; }
}

function runBoth(optFn = optimized_30bd) {
  const a = seed(ENTRY.clone());
  const b = seed(ENTRY.clone());
  translated_30bd(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: [a.pc, b.pc],
  };
}

test("EQUAL (crafted entry): sub_30bd matches translated in state + registers", () => {
  const { ram, regs, pc } = runBoth();
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL: four-region pass EQUAL (state + regs + pc)");
});

test("TEETH (crafted entry): a wrong sprite-buffer write is CAUGHT and NOT-EQUAL", () => {
  const { ram } = runBoth(broken_30bd);
  assert.ok(ram != null, "harness FAILED to catch a wrong store");
  console.log(`  TEETH: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
