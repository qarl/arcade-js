// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for swapDrawPointers (ROM 0xb944) -- swaps the 16-bit pointers ($75:$74) <-> ($77:$76).
// Live-out is RAM only (X/Y/A at RTS are incidental temporaries), so each arm compares RAM (dumpState,
// minus stack scratch below the entry SP). No POKEY/clock coupling -> the crafted diff is deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-b944.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b944 } from "../../translated/loc_b944.js";
import { swapDrawPointers } from "../swapDrawPointers.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI, DRAW_CURSOR_ALT_LO, DRAW_CURSOR_ALT_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const opt = (name) => existsSync(new URL(name, ROM_DIR)) ? new Uint8Array(readFileSync(new URL(name, ROM_DIR))) : undefined;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb944;
const oracle = atEntry(loc_b944);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Distinguishable pointer bytes so a swap is observable.
function seed(m) {
  m.mem.write8(DRAW_CURSOR_LO, 0x11); m.mem.write8(DRAW_CURSOR_HI, 0x22);
  m.mem.write8(DRAW_CURSOR_ALT_LO, 0x33); m.mem.write8(DRAW_CURSOR_ALT_HI, 0x44);
}

test("CAPTURE: real 0xb944 dispatches -- swapDrawPointers == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); swapDrawPointers(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: pointer pair swapped == oracle (RAM -stack)", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); swapDrawPointers(c);
  assert.equal(ramDiff(o, c), null);
  // Sanity: the two pointers actually crossed over.
  assert.equal(c.mem.read8(DRAW_CURSOR_LO), 0x33, "$74 holds old $76");
  assert.equal(c.mem.read8(DRAW_CURSOR_HI), 0x44, "$75 holds old $77");
  assert.equal(c.mem.read8(DRAW_CURSOR_ALT_LO), 0x11, "$76 holds old $74");
  assert.equal(c.mem.read8(DRAW_CURSOR_ALT_HI), 0x22, "$77 holds old $75");
});

test("TEETH: a twin that swaps only the low bytes ($74<->$76) diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // BUG: swap $74<->$76 but leave the high bytes $75/$77 in place -- the RAM diff must catch it.
  const lo0 = c.mem.read8(DRAW_CURSOR_LO), lo1 = c.mem.read8(DRAW_CURSOR_ALT_LO);
  c.mem.write8(DRAW_CURSOR_LO, lo1); c.mem.write8(DRAW_CURSOR_ALT_LO, lo0);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped high-byte swap");
});
