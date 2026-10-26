// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seatInPagePointer (ROM 0x91b5) -- doubles selector A into a word index, clears $29, and
// copies the ROM word table 0x91c6[index] into $2a/$2b. Live-out is RAM only (A/X at RTS are incidental),
// so each arm compares RAM (dumpState, minus stack scratch below the entry SP). No POKEY read -> the crafted diffs are
// deterministic. The table read is plain ROM, so no clock coupling.
// Run: node --test games/tempest/idiomatic/test/equivalence-91b5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_91b5 } from "../../translated/loc_91b5.js";
import { seatInPagePointer } from "../seatInPagePointer.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, loc_2a, loc_2b } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? rd("maincpu.bin") : null;
const opt = (n) => (existsSync(new URL(n, ROM_DIR)) ? rd(n) : undefined);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x91b5;
const oracle = atEntry(loc_91b5);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x91b5 dispatches -- seatInPagePointer == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); seatInPagePointer(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

const SENTINEL29 = 0x99;
function seeded(a) {
  const m = new Machine(ROM, OPTS);
  m.regs.a = a;
  m.mem.write8(loc_29, SENTINEL29); // must be cleared to 0
  m.mem.write8(loc_2a, 0x11);
  m.mem.write8(loc_2b, 0x22);
  return m;
}

test("CRAFTED: A -> index*2 -> table[index] lands at $2a/$2b, $29 cleared (== oracle, RAM)", () => {
  // Table @0x91c6: A=0 ->(00,00), A=1 ->(60,00), A=3 ->(20,03).
  const cases = [
    { a: 0x00, lo: 0x00, hi: 0x00 },
    { a: 0x01, lo: 0x60, hi: 0x00 },
    { a: 0x03, lo: 0x20, hi: 0x03 },
  ];
  for (const { a, lo, hi } of cases) {
    const o = seeded(a), c = seeded(a);
    oracle(o); seatInPagePointer(c);
    assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)}`);
    assert.equal(c.mem.read8(loc_29), 0x00, `$29 cleared A=0x${a.toString(16)}`);
    assert.equal(c.mem.read8(loc_2a), lo, `$2a A=0x${a.toString(16)}`);
    assert.equal(c.mem.read8(loc_2b), hi, `$2b A=0x${a.toString(16)}`);
  }
});

test("TEETH: a twin that forgets to clear $29 diverges from the oracle", () => {
  const o = seeded(0x03);
  oracle(o);
  assert.equal(o.mem.read8(loc_29), 0x00, "precondition: oracle cleared $29 off the sentinel");
  const c = seeded(0x03);
  seatInPagePointer(c);
  c.mem.write8(loc_29, SENTINEL29); // BUG: $29 never cleared
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch an uncleared $29");
});

test("TEETH: a twin that omits the A*2 doubling picks the wrong table pointer", () => {
  // A=3: correct index 6 -> (0x20,0x03); a twin using index=A=3 reads (0x00,0x60) -> must diverge.
  const o = seeded(0x03);
  oracle(o);
  const c = seeded(0x03);
  const index = 0x03; // BUG: selector not doubled
  c.mem.write8(loc_29, 0x00);
  c.mem.write8(loc_2a, c.mem.read8(0x91c6 + index));
  c.mem.write8(loc_2b, c.mem.read8(0x91c7 + index));
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a missing A*2 doubling");
});
