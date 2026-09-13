// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_9700 (ROM 0x9700-0x970a) -- a sibling entry sharing loc_96f4's file: it runs loc_96f4
// (which records the cursor at loc_29 and returns loc_2b minus the entry two slots back), advances the
// cursor by the low bit of that result, and returns the list entry the cursor now points at. Contract is
// RAM (dumpState minus STACK_SCRATCH) plus the returned byte (the oracle's exit A). Not necessarily reached
// in a boot capture, so the proof rests on CRAFTED + TEETH.
// Run: node --test games/tempest/idiomatic/test/equivalence-9700.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9700 as oracle } from "../../translated/loc_96f4.js";
import { loc_9700 } from "../loc_96f4.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, loc_2b, loc_2c, loc_2d } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Point the zero-page cursor pointer loc_2c/2d at a list in work RAM, seed the key loc_2b and a few list
// bytes, and enter with a cursor Y so both loc_96f4's (Y-2) read and the final (2c),y read land in the list.
function seed(m, y, key) {
  m.mem.write8(loc_2c, 0x40);
  m.mem.write8(loc_2d, 0x00); // pointer -> 0x0040
  m.mem.write8(loc_2b, key);
  for (let i = 0; i < 0x10; i++) m.mem.write8(u16(0x0040 + i), 0x10 + i);
  m.regs.y = y;
}

test("CRAFTED: loc_9700 == oracle in RAM (-stack) and returned byte, over several cursors", () => {
  let checked = 0;
  for (const y of [4, 5, 6, 7]) {
    for (const key of [0x20, 0x13]) {
      const o = new Machine(ROM, OPTS); seed(o, y, key);
      const c = new Machine(ROM, OPTS); seed(c, y, key);
      const ra = oracle(o);
      const rc = loc_9700(c);
      assert.equal(ramDiff(o, c), null, `RAM equal for y=${y} key=${key}`);
      assert.equal(rc & 0xff, o.regs.a & 0xff, `returned byte matches the oracle exit A for y=${y} key=${key}`);
      checked++;
    }
  }
  console.log(`  CRAFTED: ${checked} cursor/key pair(s) checked`);
  assert.ok(checked >= 1);
});

test("TEETH: a twin that skips the low-bit cursor advance MUST diverge in the returned byte", () => {
  // Pick a case where loc_96f4's result is ODD (low bit set), so the real routine advances the cursor and
  // reads a different list entry than the no-advance twin. loc_2b - (2c),(y-2) = key - list[y-2]; with the
  // list bytes 0x10.. at 0x40, list[y-2] = 0x10+(y-2); choose key so the difference is odd.
  const y = 6;                 // list[y-2]=list[4]=0x14
  const key = 0x21;            // 0x21 - 0x14 = 0x0d (odd) -> real routine does iny
  const o = new Machine(ROM, OPTS); seed(o, y, key);
  const ra = oracle(o);
  const c = new Machine(ROM, OPTS); seed(c, y, key);
  // Broken twin: never advances the cursor by the low bit -> reads (2c),y instead of (2c),y+1.
  const broken = (m) => {
    const yy = m.regs.y;
    return m.mem.read8(u16((m.mem.read8(loc_2c) | (m.mem.read8(loc_2d) << 8)) + yy)) & 0xff;
  };
  const rb = broken(c);
  assert.notEqual(rb, ra & 0xff, "the dropped low-bit advance was NOT caught by the returned byte");
});
