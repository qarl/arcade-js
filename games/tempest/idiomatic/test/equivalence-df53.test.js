// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitVectorHeaderWord (ROM 0xdf53) -- write the {0x40,0x80} header pair at ($74/$75)+0 and +1,
// then advance the ($74/$75) cursor by 2 (tail into advanceDisplayCursor). The oracle m.call(0xdf5f)s the translated
// tail; the idiomatic calls the idiomatic advanceDisplayCursor -- both memory-equivalent, so the contract is RAM
// (dumpState, minus stack scratch below the entry SP). Registers are scratch for this display-builder family (A/X/Y at RTS are
// incidental; the landed advanceDisplayCursor tail preserves none), so no register live-out is asserted. Plain
// (non-dispatching) caller -- no SP tooth. No POKEY read, so the CRAFTED seeds are deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-df53.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df53 } from "../../translated/loc_df53.js";
import { emitVectorHeaderWord } from "../emitVectorHeaderWord.js";
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

const TARGET = 0xdf53;
const oracle = atEntry(loc_df53);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function seed(m, s) {
  for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdf53 dispatches -- emitVectorHeaderWord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitVectorHeaderWord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: header pair written and cursor advanced by 2 == oracle (RAM -stack)", () => {
  // The ($74/$75) cursor points into the AVG display list = vector RAM (0x2000-0x2FFF, "diffed").
  // Seeding it at 0x4000 (coin-counter MMIO) sent the header writes to a device and out of the RAM
  // dump, so nothing could be observed -- keep every seed inside vector RAM.
  const cases = [
    { tag: "no carry: ptr=0x2000", lo: 0x00, hi: 0x20 },
    { tag: "low carry: $74=0xff -> +2 carries into $75", lo: 0xff, hi: 0x20 },
    { tag: "top of vec RAM: ptr=0x2ffe -> cursor advances to 0x3000", lo: 0xfe, hi: 0x2f },
  ];
  for (const t of cases) {
    const o = new Machine(ROM, OPTS); seed(o, { [DRAW_CURSOR_LO]: t.lo, [DRAW_CURSOR_HI]: t.hi });
    const c = new Machine(ROM, OPTS); seed(c, { [DRAW_CURSOR_LO]: t.lo, [DRAW_CURSOR_HI]: t.hi });
    oracle(o); emitVectorHeaderWord(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${t.tag}`);
  }
  // Explicit content/advance check on the clean case.
  const m = new Machine(ROM, OPTS); seed(m, { [DRAW_CURSOR_LO]: 0x00, [DRAW_CURSOR_HI]: 0x20 });
  emitVectorHeaderWord(m);
  assert.equal(m.mem.read8(0x2000), 0x40, "byte 0 = 0x40");
  assert.equal(m.mem.read8(0x2001), 0x80, "byte 1 = 0x80");
  assert.equal(m.mem.read8(DRAW_CURSOR_LO) | (m.mem.read8(DRAW_CURSOR_HI) << 8), 0x2002, "cursor += 2");
});

test("TEETH: twins that skip the 0x80 byte or the cursor advance diverge from the oracle", () => {
  const s = { [DRAW_CURSOR_LO]: 0x00, [DRAW_CURSOR_HI]: 0x20 }; // cursor -> vector RAM 0x2000 (diffed), so the writes are observable
  // Twin A: writes 0x40 but never the 0x80 second byte.
  {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o);
    const brokenNoSecond = (mm) => { const ptr = mm.mem16[DRAW_CURSOR_LO]; mm.mem8[ptr] = 0x40; mm.mem8[DRAW_CURSOR_LO] = ptr + 2; };
    brokenNoSecond(c);
    assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the missing 0x80 byte");
  }
  // Twin B: writes both bytes but leaves the cursor unadvanced.
  {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o);
    const brokenNoAdvance = (mm) => { const ptr = mm.mem16[DRAW_CURSOR_LO]; mm.mem8[ptr] = 0x40; mm.mem8[ptr + 1] = 0x80; };
    brokenNoAdvance(c);
    assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the un-advanced cursor");
  }
});
