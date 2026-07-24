// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for entry_0f1b (kind 4/5/6 strip filler — the kind>=4 tail of the
 * board-layout renderer; kind>=7 bails). PER-INSTRUCTION (a draw primitive of sub_0da7,
 * whose callers are not provably mask-cleared).
 *
 * The 25m attract records are only kinds 0/1/2, so entry_0f1b never dispatches in a plain
 * run. We craft its entry deterministically: capture the live board-render scratch at
 * loc_0e4f's entry (a real record — 0x63AB a valid tilemap pointer, 0x63B1 a real extent),
 * clone it, and poke the kind byte 0x63B3 to 4/5/6 (fill tile 0xE0/0xB0/0xFE) or 7 (bail).
 * Both sides get identical crafted state, so any full-state diff is the optimization's
 * fault — the same clone technique loc_0d5f's BRANCH test uses.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e4f as translated_0e4f } from "../../translated/nmi.js";
import { entry_0f1b as translated_0f1b } from "../../translated/state0.js";
import { entry_0f1b as optimized_0f1b } from "../entry_0f1b.js";
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
  const snap = new Map([[0x0e4f, (mm) => { if (entry === null) entry = mm.clone(); return translated_0e4f(mm); }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0e4f never entered — cannot craft an entry_0f1b entry");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;

// Run optimized_0f1b with its FIRST video-RAM store corrupted (a wrong fill tile): the tile
// lands in the tilemap and persists, so the full-state diff must catch it.
function broken_0f1b(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr >= 0x7400 && addr < 0x7800) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_0f1b(m); } finally { m.mem.write8 = realWrite; }
}

function runBoth(kind, optFn = optimized_0f1b) {
  const a = ENTRY.clone(); a.mem.write8(0x63b3, kind);
  const b = ENTRY.clone(); b.mem.write8(0x63b3, kind);
  translated_0f1b(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: [a.pc, b.pc],
  };
}

for (const [kind, tile] of [[4, "0xE0"], [5, "0xB0"], [6, "0xFE"]]) {
  test(`EQUAL (kind==${kind}): the ${tile} strip fill matches translated in state + registers`, () => {
    const { ram, regs, pc } = runBoth(kind);
    assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
    assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
    assert.equal(pc[0], pc[1], "pc must match");
    console.log(`  EQUAL kind==${kind}: ${tile} fill EQUAL (state + regs + pc)`);
  });
}

test("EQUAL (kind>=7): the bail arm matches translated", () => {
  const { ram, regs, pc } = runBoth(7);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(pc[0], pc[1], "pc must match");
  console.log("  EQUAL kind>=7: bail arm EQUAL (state + regs + pc)");
});

test("TEETH (kind==4): a wrong fill tile is CAUGHT and NOT-EQUAL", () => {
  const { ram } = runBoth(4, broken_0f1b);
  assert.ok(ram != null, "harness FAILED to catch a wrong store");
  console.log(`  TEETH kind==4: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
