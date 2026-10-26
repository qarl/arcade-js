// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for rebuildSpikeTable (ROM 0xa7bd) -- zeroes $03fe..$0405, then $0405 = 0xf0 and $0115 = 0xff.
// Live-out is RAM only (A/X at RTS incidental), so each arm compares RAM (dumpState, minus stack scratch below the entry SP).
// No POKEY/clock coupling -> the crafted diff is deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-a7bd.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a7bd } from "../../translated/loc_a7bd.js";
import { rebuildSpikeTable } from "../rebuildSpikeTable.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_3fe, loc_405, SPIKE_TABLE_GUARD } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const opt = (name) => existsSync(new URL(name, ROM_DIR)) ? new Uint8Array(readFileSync(new URL(name, ROM_DIR))) : undefined;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa7bd;
const oracle = atEntry(loc_a7bd);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seed the table and the flag with non-zero sentinels so both the zero-fill and the $0115 = 0xff bite.
const S115 = 0x55;
function seed(m) {
  for (let x = 0; x <= 7; x++) m.mem.write8(loc_3fe + x, (0xa0 + x) & 0xff);
  m.mem.write8(SPIKE_TABLE_GUARD, S115);
}

test("CAPTURE: real 0xa7bd dispatches -- rebuildSpikeTable == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); rebuildSpikeTable(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: table zeroed, $0405 = 0xf0, $0115 = 0xff == oracle (RAM -stack)", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); rebuildSpikeTable(c);
  assert.equal(ramDiff(o, c), null);
  for (let x = 0; x <= 6; x++) assert.equal(c.mem.read8(loc_3fe + x), 0x00, `zeroed $03fe+${x}`);
  assert.equal(c.mem.read8(loc_405), 0xf0, "$0405 overwritten with 0xf0");
  assert.equal(c.mem.read8(SPIKE_TABLE_GUARD), 0xff, "$0115 armed to 0xff");
});

test("TEETH: a twin that forgets the $0115 = 0xff fixup diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // BUG: do the zero-fill and $0405 = 0xf0, but leave $0115 at its sentinel.
  for (let x = 7; x >= 0; x--) c.mem.write8(loc_3fe + x, 0x00);
  c.mem.write8(loc_405, 0xf0);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a missing $0115 fixup");
});
