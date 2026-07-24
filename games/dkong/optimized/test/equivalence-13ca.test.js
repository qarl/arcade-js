// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for sub_13ca (format a score to display digits and insertion-sort it
 * into the high-score table). PER-INSTRUCTION. Verified from a crafted entry: a booted
 * machine captured at loc_0fd7's dispatch, cloned, with HL pointed at a 3-byte score, A set
 * to an entry index, and 0x6007 bit0 cleared so the rst 0x08 guard does not abort.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fd7 as translated_0fd7 } from "../../translated/state0.js";
import { sub_13ca as translated_13ca } from "../../translated/state0.js";
import { sub_13ca as optimized_13ca } from "../sub_13ca.js";
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
  if (entry === null) throw new Error("loc_0fd7 never entered — cannot craft a sub_13ca entry");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;

// Seed a machine so sub_13ca takes the full path with a concrete score to insert.
function seed(mm) {
  mm.mem.write8(0x6007, mm.mem.read8(0x6007) & 0xfe); // clear bit0 -> rst 0x08 does not abort
  // a 3-byte packed BCD score at 0x3f00 (unused-ish ROM addr is read-only; use work RAM):
  mm.mem.write8(0x6100, 0x50); mm.mem.write8(0x6101, 0x00); mm.mem.write8(0x6102, 0x01);
  mm.regs.hl = 0x6100; // source score
  mm.regs.a = 0x00;    // entry index
  return mm;
}

function brokenAt(addr) {
  return (m) => {
    const realWrite = m.mem.write8.bind(m.mem);
    let broke = false;
    m.mem.write8 = (a, value, busOffset) => {
      if (!broke && a === addr) { broke = true; return realWrite(a, value ^ 0xff, busOffset); }
      return realWrite(a, value, busOffset);
    };
    try { return optimized_13ca(m); } finally { m.mem.write8 = realWrite; }
  };
}

function runBoth(optFn = optimized_13ca) {
  const a = seed(ENTRY.clone());
  const b = seed(ENTRY.clone());
  translated_13ca(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: [a.pc, b.pc],
  };
}

test("EQUAL (crafted entry): sub_13ca matches translated in state + registers", () => {
  const { ram, regs, pc } = runBoth();
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL: score format + insert EQUAL (state + regs + pc)");
});

test("TEETH (crafted entry): a wrong digit unpack is CAUGHT and NOT-EQUAL", () => {
  // Break the first unpacked BCD digit (0x61B1). The insertion-sort swap can relocate the
  // corrupted byte, so the first-diff address is data-dependent -- assert only that the wrong
  // value is caught somewhere.
  const { ram } = runBoth(brokenAt(0x61b1));
  assert.ok(ram != null, "harness FAILED to catch a wrong store");
  console.log(`  TEETH: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
