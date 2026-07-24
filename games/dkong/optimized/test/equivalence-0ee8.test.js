// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for loc_0ee8 (draw a VERTICAL strip / ladder run — the record-kind==3
 * arm of the board-layout renderer; kind 4+ tails to entry_0f1b). PER-INSTRUCTION (a draw
 * primitive of sub_0da7, whose callers are not provably mask-cleared).
 *
 * The 25m attract board's records are only kinds 0/1/2, so loc_0ee8 never dispatches in a
 * plain run. We instead craft its entry deterministically: capture the live board-render
 * scratch at loc_0e4f's entry (a real record, so 0x63AB is a valid tilemap pointer and
 * 0x63B1 a real extent), clone it, and poke the kind byte 0x63B3 to 3 (ladder) or 4
 * (delegate to entry_0f1b). Both sides get identical crafted state, so any full-state diff
 * is the optimization's fault — the same clone technique loc_0d5f's BRANCH test uses.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e4f as translated_0e4f } from "../../translated/nmi.js";
import { loc_0ee8 as translated_0ee8 } from "../../translated/state0.js";
import { loc_0ee8 as optimized_0ee8 } from "../loc_0ee8.js";
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

// Capture the machine state at the first loc_0e4f entry: live board-render scratch
// (0x63AB tilemap pointer into VRAM, 0x63B1 extent, DE table pointer) from a real record.
function captureEntry() {
  let entry = null;
  const snap = new Map([[0x0e4f, (mm) => { if (entry === null) entry = mm.clone(); return translated_0e4f(mm); }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0e4f never entered — cannot craft a loc_0ee8 entry");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;

// Run optimized_0ee8 with its FIRST video-RAM store corrupted (a wrong ladder cap): the
// tile lands in the tilemap and persists, so the full-state diff must catch it.
function broken_0ee8(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr >= 0x7400 && addr < 0x7800) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_0ee8(m); } finally { m.mem.write8 = realWrite; }
}

function runBoth(kind, optFn = optimized_0ee8) {
  const a = ENTRY.clone(); a.mem.write8(0x63b3, kind);
  const b = ENTRY.clone(); b.mem.write8(0x63b3, kind);
  translated_0ee8(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: [a.pc, b.pc],
  };
}

test("EQUAL (kind==3): the ladder-strip body matches translated in state + registers", () => {
  const { ram, regs, pc } = runBoth(3);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL kind==3: vertical strip EQUAL (state + regs + pc)");
});

test("EQUAL (kind>=4): the entry_0f1b delegation arm matches translated", () => {
  const { ram, regs, pc } = runBoth(4);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL kind>=4: entry_0f1b delegation EQUAL (state + regs + pc)");
});

test("TEETH (kind==3): a wrong ladder cap is CAUGHT and NOT-EQUAL", () => {
  const { ram } = runBoth(3, broken_0ee8);
  assert.ok(ram != null, "harness FAILED to catch a wrong store");
  console.log(`  TEETH kind==3: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
