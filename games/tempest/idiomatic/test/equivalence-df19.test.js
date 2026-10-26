// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitStrokeWordFromNibble (ROM 0xdf19) -- from the accumulator A and the carry flag, pick a word-
// table index at $31e4 (0 when carry-set and the low nibble is 0, else nibble+1), copy the two-byte entry
// through the ($74) display-list cursor, then advance the cursor by 2 (dissolved: idiomatic calls advanceDisplayCursor
// directly with y=1). A/X/Y are scratch and php/plp restores the flags, so live-out is RAM only; the arms
// compare RAM (dumpState -stack). No POKEY read, so the CRAFTED seeds are deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-df19.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df19 } from "../../translated/loc_df19.js";
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

const TARGET = 0xdf19;
const oracle = atEntry(loc_df19);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// A (the value) and the carry flag are the only registers read on entry; the clone carries both.
function diffFrom(cap) {
  const o = cap.clone(), c = cap.clone();
  oracle(o); emitStrokeWordFromNibble(c, c.regs.a, c.regs.fC);
  return ramDiff(o, c);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 4000) : [];

test("CAPTURE: real 0xdf19 dispatches -- emitStrokeWordFromNibble == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) assert.equal(diffFrom(cap), null);
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: index selection (carry / low-nibble) copies the right table entry == oracle (RAM -stack)", () => {
  // ($74) -> 0x2400 in vector RAM; each case seeds A + carry and compares the two emitted bytes.
  const cases = [
    { tag: "carry clear, nibble 3 -> idx 4", a: 0x03, c: false },
    { tag: "carry set, nibble 0 -> idx 0", a: 0x00, c: true },
    { tag: "carry set, nibble 5 -> idx 6", a: 0x05, c: true },
    { tag: "carry clear, nibble 0 -> idx 1", a: 0x00, c: false },
    { tag: "high bits ignored: A=0xf7 nibble 7 -> idx 8", a: 0xf7, c: true },
  ];
  for (const t of cases) {
    const o = new Machine(ROM, OPTS); o.mem.write8(DRAW_CURSOR_LO, 0x00); o.mem.write8(DRAW_CURSOR_HI, 0x24); o.regs.a = t.a; o.regs.fC = t.c;
    const c = new Machine(ROM, OPTS); c.mem.write8(DRAW_CURSOR_LO, 0x00); c.mem.write8(DRAW_CURSOR_HI, 0x24); c.regs.a = t.a; c.regs.fC = t.c;
    oracle(o); emitStrokeWordFromNibble(c, c.regs.a, c.regs.fC);
    assert.equal(ramDiff(o, c), null, `RAM: ${t.tag}`);
  }
});

test("TEETH: a twin that ignores the carry-set/zero special case picks the wrong entry", () => {
  // carry set + low nibble 0: correct idx = 0, the buggy idx = 1 -> a different table word -> RAM diverges.
  const seedC = true, seedA = 0x00;
  const o = new Machine(ROM, OPTS); o.mem.write8(DRAW_CURSOR_LO, 0x00); o.mem.write8(DRAW_CURSOR_HI, 0x24); o.regs.a = seedA; o.regs.fC = seedC;
  const c = new Machine(ROM, OPTS); c.mem.write8(DRAW_CURSOR_LO, 0x00); c.mem.write8(DRAW_CURSOR_HI, 0x24); c.regs.a = seedA; c.regs.fC = seedC;
  oracle(o);
  const broken = (m, a) => {
    const { mem8, mem16 } = m;
    const idx = (a & 0x0f) + 1; // BUG: always nibble+1, never 0
    const src = (0x31e4 + (idx << 1)) & 0xffff;
    const dst = mem16[DRAW_CURSOR_LO];
    mem8[dst & 0xffff] = mem8[src];
    mem8[(dst + 1) & 0xffff] = mem8[(src + 1) & 0xffff];
  };
  broken(c, c.regs.a);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong table index");
});
