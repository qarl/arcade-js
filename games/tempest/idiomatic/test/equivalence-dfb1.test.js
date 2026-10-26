// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitNibbleDigitRun (ROM 0xdfb1-0xdfdb) -- loop over y zeropage bytes ending at index a+y-1,
// downward; for each, emit the high nibble then the low nibble through the ($74) display-list cursor
// (dissolved: idiomatic calls emitStrokeWordFromNibble directly), chaining carry so only the last low-nibble emission sees
// it cleared. A/X/Y at RTS are incidental (every caller reloads a fresh register), so live-out is RAM only;
// the arms compare RAM (dumpState -stack). df19 reads the $31e4 word table (ROM), no POKEY, so deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-dfb1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dfb1 } from "../../translated/loc_dfb1.js";
import { emitNibbleDigitRun } from "../emitNibbleDigitRun.js";
import { emitStrokeWordFromNibble } from "../emitStrokeWordFromNibble.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdfb1;
const oracle = atEntry(loc_dfb1);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// A and Y are the only registers read on entry; the clone carries both.
function diffFrom(cap) {
  const o = cap.clone(), c = cap.clone();
  oracle(o); emitNibbleDigitRun(c, c.regs.a, c.regs.y);
  return ramDiff(o, c);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 4000) : [];

test("CAPTURE: real 0xdfb1 dispatches -- emitNibbleDigitRun == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) assert.equal(diffFrom(cap), null);
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// ($74) -> 0x2400 vector RAM; seed the zeropage object run + A/Y registers, compare emitted list.
function seed(m, a, y, bytes) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00);
  m.mem.write8(DRAW_CURSOR_HI, 0x24);
  for (const [addr, v] of bytes) m.mem.write8(addr & 0xff, v);
  m.regs.a = a;
  m.regs.y = y;
}

test("CRAFTED: multi-byte run (a=0x04,y=0x03) emits high/low nibbles down the list == oracle (RAM -stack)", () => {
  // count=$ae=2, start index x=a+2=6; reads $06,$05,$04 with distinct nibbles.
  const bytes = [[0x06, 0x9c], [0x05, 0x30], [0x04, 0xf7]];
  const o = new Machine(ROM, OPTS); seed(o, 0x04, 0x03, bytes);
  const c = new Machine(ROM, OPTS); seed(c, 0x04, 0x03, bytes);
  oracle(o); emitNibbleDigitRun(c, c.regs.a, c.regs.y);
  assert.equal(ramDiff(o, c), null, "RAM equal after the run");
  // the $ae/$af scratch and the ($74) cursor must all agree too
  assert.equal(c.mem.read8(0x00ae), o.mem.read8(0x00ae), "$ae matches");
  assert.equal(c.mem.read8(0x00af), o.mem.read8(0x00af), "$af matches");
});

test("CRAFTED: carry-chain case -- an interior 0x00 byte carries a set flag into its low-nibble emit == oracle", () => {
  // a=0x10,y=0x02: count=1, x=0x11; iter1 byte $11=0x00 (not last) -> high 0 keeps carry set into the low
  // call; iter2 byte $10=0x35 (last) clears it. This is the path a naive twin gets wrong.
  const bytes = [[0x11, 0x00], [0x10, 0x35]];
  const o = new Machine(ROM, OPTS); seed(o, 0x10, 0x02, bytes);
  const c = new Machine(ROM, OPTS); seed(c, 0x10, 0x02, bytes);
  oracle(o); emitNibbleDigitRun(c, c.regs.a, c.regs.y);
  assert.equal(ramDiff(o, c), null, "RAM equal on the carry-chain path");
});

test("CRAFTED: single byte (y=0x01) -- one high/low pair, last-iter clc == oracle (RAM -stack)", () => {
  const bytes = [[0x20, 0xab]];
  const o = new Machine(ROM, OPTS); seed(o, 0x20, 0x01, bytes);
  const c = new Machine(ROM, OPTS); seed(c, 0x20, 0x01, bytes);
  oracle(o); emitNibbleDigitRun(c, c.regs.a, c.regs.y);
  assert.equal(ramDiff(o, c), null, "RAM equal after single pair");
});

test("TEETH: a twin that never chains the carry (always passes it clear) diverges on the 0x00-byte path", () => {
  const bytes = [[0x11, 0x00], [0x10, 0x35]];
  const o = new Machine(ROM, OPTS); seed(o, 0x10, 0x02, bytes);
  const c = new Machine(ROM, OPTS); seed(c, 0x10, 0x02, bytes);
  oracle(o);
  // BUG: hand df19 a cleared carry every time, so the interior 0x00 byte's low-nibble emit picks idx 1
  // instead of idx 0 -> a different table word lands in the ($74) list.
  const broken = (m, a, y) => {
    const { mem8 } = m;
    let count = (y - 1) & 0xff;
    mem8[0x00ae] = count;
    let x = (a + count) & 0xff;
    do {
      mem8[0x00af] = x;
      const byte = mem8[(0x0000 + x) & 0xffff];
      emitStrokeWordFromNibble(m, byte >> 4, false);
      emitStrokeWordFromNibble(m, byte, false);
      x = (mem8[0x00af] - 1) & 0xff;
      count = (mem8[0x00ae] - 1) & 0xff;
      mem8[0x00ae] = count;
    } while (count < 0x80);
  };
  broken(c, 0x10, 0x02);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped carry chain");
});

test("TEETH: a twin off by one on the count (drops the last byte) diverges from the oracle", () => {
  const bytes = [[0x06, 0x9c], [0x05, 0x30], [0x04, 0xf7]];
  const o = new Machine(ROM, OPTS); seed(o, 0x04, 0x03, bytes);
  const c = new Machine(ROM, OPTS); seed(c, 0x04, 0x03, bytes);
  oracle(o);
  const broken = (m, a, y) => {
    const { mem8 } = m;
    let count = (y - 1) & 0xff;
    mem8[0x00ae] = count;
    let x = (a + count) & 0xff;
    let carry = true;
    while (count > 0) { // BUG: stops one short, never emits the final (count==0) byte
      mem8[0x00af] = x;
      const byte = mem8[(0x0000 + x) & 0xffff];
      const high = byte >> 4;
      emitStrokeWordFromNibble(m, high, carry);
      const carryHigh = carry && high === 0;
      emitStrokeWordFromNibble(m, byte, carryHigh);
      carry = carryHigh && (byte & 0x0f) === 0;
      x = (mem8[0x00af] - 1) & 0xff;
      count = (mem8[0x00ae] - 1) & 0xff;
      mem8[0x00ae] = count;
    }
  };
  broken(c, 0x04, 0x03);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped final byte");
});
