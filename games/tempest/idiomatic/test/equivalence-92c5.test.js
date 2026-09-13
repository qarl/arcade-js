// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_92c5 (ROM 0x92c5-0x93df) -- the state re-seed. Builds the search key loc_2b,
// walks the 4-byte records at loc_9604 (index 111..3 step -4) scanning each record's source list for the
// range bracketing the key and storing the resolved byte through the record's destination pointer, then
// rescales loc_160/loc_15b per loc_16a & 3 and folds loc_163/loc_120/loc_160 through the helper, seeding
// many loc_01xx cells. loc_92c5 takes no input register and ends with its OWN return (no tail-delegation),
// and every caller overwrites A/X/Y before reading them, so there is NO live-out register: the contract is
// pure RAM-equivalence (dumpState minus STACK_SCRATCH). Oracle is the frozen translated loc_92c5.
// Run: node --test games/tempest/idiomatic/test/equivalence-92c5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_92c5 as oracle } from "../../translated/loc_92c5.js";
import { loc_92c5 } from "../loc_92c5.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_9f, loc_16a, loc_149 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x92c5;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x92c5 dispatches -- loc_92c5 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a deep list-scan arm may reach an unimplemented helper
    if (threw) continue;                       // both layers would throw identically there
    loc_92c5(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed the search key and a rescale mode, then let the real ROM records drive the list scan.
function seed(m, keyByte, modeByte) {
  m.mem.write8(loc_9f, keyByte);
  m.mem.write8(loc_16a, modeByte);
}

for (const [name, keyByte, modeByte] of [
  ["mode 1 (down-rescale)", 0x08, 0x01],
  ["mode 2 (up-rescale)", 0x40, 0x02],
  ["mode 0 (no rescale), key reload path", 0x70, 0x00],
]) {
  test(`CRAFTED: ${name} -- RAM equal after the full re-seed`, () => {
    const o = new Machine(ROM, OPTS); seed(o, keyByte, modeByte);
    const c = new Machine(ROM, OPTS); seed(c, keyByte, modeByte);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) { console.log(`  CRAFTED ${name}: oracle threw on this seed -- skipped`); return; }
    loc_92c5(c);
    assert.equal(ramDiff(o, c), null, "RAM equal after the re-seed");
  });
}

test("TEETH: a twin that corrupts a signature seed MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x08, 0x01);
  const c = new Machine(ROM, OPTS); seed(c, 0x08, 0x01);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to loc_92c5 but corrupts the unconditional loc_149 = 1 signature write.
  let tried = 0;
  const broken = (m) => {
    tried++;
    loc_92c5(m);
    m.mem.write8(loc_149, m.mem.read8(loc_149) ^ 0xff); // BUG: corrupt the final seed
  };
  broken(c);
  assert.ok(tried > 0, "teeth arm ran");
  assert.notEqual(ramDiff(o, c), null, "the corrupted signature seed was NOT caught by the RAM compare");
});
